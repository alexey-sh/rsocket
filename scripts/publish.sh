#!/usr/bin/env bash
#
# Publish every public @rsocket-ts/* package to npm at the version currently in
# its package.json. Versioning is a separate step -- run `npx lerna version
# <patch|minor|major>` (and push the tag) before this script.
#
# Why not `lerna publish`: `npm pack`/`npm publish` writes a `gitHead` field
# into each package.json it packs. That dirties the working tree, and lerna's
# EUNCOMMIT pre-check then aborts the run before it ever reaches npm. This
# script publishes package-by-package (no clean-tree check at publish time) and
# reverts npm's gitHead pollution afterwards.
#
# Usage: scripts/publish.sh [options]
#
#   -n, --dry-run           Pack and validate, upload nothing (npm --dry-run).
#   -y, --yes               Do not ask for confirmation.
#   -t, --tag <dist-tag>    Publish under this dist-tag (default: latest).
#       --otp <code>        2FA one-time password to pass to npm. npm can also
#                           prompt interactively, but that is once per package;
#                           a Granular Access Token with 2FA bypass avoids both.
#       --skip-gates        Skip lint/test/build+attw. For retrying a run that
#                           already passed them.
#       --allow-any-branch  Permit publishing from a branch other than main.
#   -h, --help              Show this help.
#
set -Eeuo pipefail

# ---------------------------------------------------------------- output ------

if [ -t 1 ] && command -v tput >/dev/null 2>&1 && [ "$(tput colors 2>/dev/null || echo 0)" -ge 8 ]; then
  BOLD=$(tput bold); RED=$(tput setaf 1); GREEN=$(tput setaf 2)
  YELLOW=$(tput setaf 3); BLUE=$(tput setaf 4); RESET=$(tput sgr0)
else
  BOLD=""; RED=""; GREEN=""; YELLOW=""; BLUE=""; RESET=""
fi

step() { printf '%s\n%s==>%s %s%s\n' "" "$BLUE" "$RESET" "$BOLD$1" "$RESET"; }
info() { printf '    %s\n' "$1"; }
ok() { printf '    %s+%s %s\n' "$GREEN" "$RESET" "$1"; }
warn() { printf '    %s!%s %s\n' "$YELLOW" "$RESET" "$1" >&2; }
die() { printf '\n%serror:%s %s\n' "$RED" "$RESET" "$1" >&2; exit 1; }

# ------------------------------------------------------------------ args ------

DRY_RUN=0
ASSUME_YES=0
DIST_TAG="latest"
OTP=""
SKIP_GATES=0
ALLOW_ANY_BRANCH=0

# Print the header comment (everything from line 2 up to the first non-comment
# line) so the help text and the file's own documentation cannot drift apart.
usage() {
  awk 'NR > 1 { if (!/^#/) exit; sub(/^# ?/, ""); print }' "$0" | sed -e '/./,$!d' -e ':a' -e '/^$/{$d;N;ba' -e '}'
}

while [ $# -gt 0 ]; do
  case "$1" in
    -n|--dry-run) DRY_RUN=1 ;;
    -y|--yes) ASSUME_YES=1 ;;
    -t|--tag) shift; [ $# -gt 0 ] || die "--tag needs a value"; DIST_TAG="$1" ;;
    --otp) shift; [ $# -gt 0 ] || die "--otp needs a value"; OTP="$1" ;;
    --skip-gates) SKIP_GATES=1 ;;
    --allow-any-branch) ALLOW_ANY_BRANCH=1 ;;
    -h|--help) usage; exit 0 ;;
    *) die "unknown option: $1 (try --help)" ;;
  esac
  shift
done

# ------------------------------------------------------------------ setup -----

command -v git >/dev/null 2>&1 || die "git not found"
command -v node >/dev/null 2>&1 || die "node not found"
command -v npm >/dev/null 2>&1 || die "npm not found"
command -v yarn >/dev/null 2>&1 || die "yarn not found"

ROOT=$(git rev-parse --show-toplevel 2>/dev/null) || die "not inside a git repository"
cd "$ROOT"
[ -d packages ] || die "no packages/ directory in $ROOT -- is this the monorepo root?"

# `yarn run` (and lerna) export their own npm_config_* environment, which npm
# prefers over ~/.npmrc. Two problems: registry becomes
# https://registry.yarnpkg.com, so `yarn pub` would publish to yarn's mirror
# instead of npm; and npm warns "Unknown env config" for a batch of options it
# no longer recognises. Drop the plain option names so npm resolves config the
# way it does when invoked directly. Credential-bearing entries are left alone,
# both the `//registry.../:_authToken` form (its name contains `/` and `:`, so
# the pattern below never matches it) and anything auth-shaped.
for _var in $(env | sed -n 's/^\(npm_config_[a-z0-9_]*\)=.*/\1/p'); do
  case "$_var" in
    *auth*|*token*|*otp*|*password*|*username*|*email*|*cert*|*key*) continue ;;
  esac
  unset "$_var"
done
unset _var

# Revert the `gitHead` field npm adds to each package.json it packs, but only
# when that is the *only* change, so a genuine edit is never discarded.
restore_git_head() {
  local out
  out=$(git diff --name-only -- 'packages/*/package.json' || true)
  [ -n "$out" ] || return 0
  printf '%s\n' "$out" | node -e '
    const { execFileSync } = require("child_process");
    const fs = require("fs");
    let input = "";
    process.stdin.on("data", (d) => (input += d)).on("end", () => {
      for (const file of input.split("\n").filter(Boolean)) {
        let head, cur;
        try {
          head = JSON.parse(execFileSync("git", ["show", `HEAD:${file}`], { encoding: "utf8" }));
          cur = JSON.parse(fs.readFileSync(file, "utf8"));
        } catch {
          console.log(`!\t${file}\tunreadable, left alone`);
          continue;
        }
        if (!("gitHead" in cur)) {
          console.log(`!\t${file}\tmodified but no gitHead, left alone`);
          continue;
        }
        delete cur.gitHead;
        if (JSON.stringify(cur) !== JSON.stringify(head)) {
          console.log(`!\t${file}\tother changes present, left alone`);
          continue;
        }
        execFileSync("git", ["checkout", "--", file]);
        console.log(`+\t${file}`);
      }
    });
  ' | while IFS=$'\t' read -r mark file note; do
    if [ "$mark" = "+" ]; then info "reverted npm gitHead in $file"
    else warn "$file: $note"; fi
  done
}

cleanup() { restore_git_head; }
trap cleanup EXIT

# -------------------------------------------------------------- preflight -----

step "Preflight"

BRANCH=$(git rev-parse --abbrev-ref HEAD)
if [ "$BRANCH" != "main" ]; then
  if [ "$ALLOW_ANY_BRANCH" -eq 1 ]; then warn "publishing from '$BRANCH', not main"
  else die "on branch '$BRANCH'; releases come from main (override: --allow-any-branch)"; fi
fi
ok "branch: $BRANCH"

# A clean tree here means anything dirty later is npm's gitHead, which
# restore_git_head can safely revert. Untracked files count: a release should be
# reproducible from the commit it claims to be built from.
DIRTY=$(git status --porcelain)
if [ -n "$DIRTY" ]; then
  printf '%s\n' "$DIRTY" | while IFS= read -r line; do warn "$line"; done
  die "working tree is dirty (see above) -- commit, stash, or clean first"
fi
ok "working tree clean at $(git rev-parse --short HEAD)"

REGISTRY=$(npm config get registry)
case "$REGISTRY" in
  https://registry.npmjs.org*) ok "registry: $REGISTRY" ;;
  *) die "registry is '$REGISTRY', expected https://registry.npmjs.org/" ;;
esac
SCOPED_REGISTRY=$(npm config get @rsocket-ts:registry)
[ "$SCOPED_REGISTRY" = "undefined" ] || die "@rsocket-ts:registry overrides the default: $SCOPED_REGISTRY"

# Passes even for a token too restricted to publish, so it is a smoke test only.
NPM_USER=$(npm whoami 2>/dev/null) || die "npm is not authenticated (npm login, or set //registry.npmjs.org/:_authToken)"
ok "npm user: $NPM_USER (publishing needs 2FA or a granular token with 2FA bypass)"

# Publishable packages in dependency order: each package's prepublishOnly runs
# its own build, which resolves @rsocket-ts/* deps through their built dist/.
PKG_LINES=$(node - <<'NODE'
const fs = require("fs");
const path = require("path");
const dir = path.join(process.cwd(), "packages");
const pkgs = [];
for (const entry of fs.readdirSync(dir).sort()) {
  const file = path.join(dir, entry, "package.json");
  if (!fs.existsSync(file)) continue;
  const json = JSON.parse(fs.readFileSync(file, "utf8"));
  if (json.private) continue;
  pkgs.push({
    name: json.name,
    version: json.version,
    dir: `packages/${entry}`,
    access: (json.publishConfig || {}).access || "-",
    deps: Object.keys({ ...json.dependencies, ...json.peerDependencies }).filter((d) =>
      d.startsWith("@rsocket-ts/"),
    ),
  });
}
const byName = new Map(pkgs.map((p) => [p.name, p]));
const done = new Set();
const onStack = new Set();
const sorted = [];
const visit = (pkg) => {
  if (done.has(pkg.name)) return;
  if (onStack.has(pkg.name)) throw new Error(`dependency cycle involving ${pkg.name}`);
  onStack.add(pkg.name);
  for (const dep of pkg.deps) if (byName.has(dep)) visit(byName.get(dep));
  onStack.delete(pkg.name);
  done.add(pkg.name);
  sorted.push(pkg);
};
for (const pkg of pkgs) visit(pkg);
for (const pkg of sorted) console.log([pkg.name, pkg.version, pkg.dir, pkg.access].join("\t"));
NODE
) || die "failed to enumerate packages"
[ -n "$PKG_LINES" ] || die "no publishable packages found under packages/"

VERSION=""
PKG_COUNT=0
while IFS=$'\t' read -r name version dir access; do
  [ -n "$name" ] || continue
  PKG_COUNT=$((PKG_COUNT + 1))
  [ "$access" = "public" ] || die "$name has publishConfig.access='$access', expected 'public'"
  if [ -z "$VERSION" ]; then VERSION="$version"
  elif [ "$version" != "$VERSION" ]; then
    die "version mismatch: $name is $version but others are $VERSION (this repo is fixed-versioned)"
  fi
done <<< "$PKG_LINES"
ok "$PKG_COUNT packages, all public, all at version $VERSION"

# Fixed versioning tags the release once as `v<version>`; the per-package
# `<name>@<version>` form is what independent mode would produce.
if git rev-parse -q --verify "refs/tags/v$VERSION" >/dev/null; then
  ok "git tag v$VERSION exists"
elif git rev-parse -q --verify "refs/tags/@rsocket-ts/core@$VERSION" >/dev/null; then
  ok "git tag @rsocket-ts/core@$VERSION exists"
else
  warn "no git tag v$VERSION -- did you run 'npx lerna version'?"
fi

# lerna version does not push. Publishing a version whose commit and tag exist
# only locally leaves nothing to trace the release back to.
if UPSTREAM=$(git rev-parse --abbrev-ref '@{u}' 2>/dev/null); then
  UNPUSHED=$(git rev-list --count "$UPSTREAM..HEAD")
  if [ "$UNPUSHED" -gt 0 ]; then
    warn "$UNPUSHED local commit(s) not on $UPSTREAM -- run: git push --follow-tags"
  else
    ok "in sync with $UPSTREAM"
  fi
else
  warn "no upstream branch configured -- cannot tell whether this commit is pushed"
fi

# ------------------------------------------------------------------ plan ------

step "Plan"

TO_PUBLISH=""
ALREADY=""
while IFS=$'\t' read -r name version dir access <&3; do
  [ -n "$name" ] || continue
  if npm view "$name@$version" version >/dev/null 2>&1; then
    ALREADY="$ALREADY$name@$version"$'\n'
    info "$name@$version -- already on npm, will skip"
  else
    TO_PUBLISH="$TO_PUBLISH$name"$'\t'"$version"$'\t'"$dir"$'\n'
    info "$name@$version -- to publish"
  fi
done 3<<< "$PKG_LINES"

if [ -z "$TO_PUBLISH" ]; then
  step "Nothing to do"
  info "every package is already published at $VERSION"
  exit 0
fi

PUBLISH_COUNT=$(printf '%s' "$TO_PUBLISH" | grep -c . || true)

if [ "$ASSUME_YES" -ne 1 ]; then
  printf '\n'
  if [ "$DRY_RUN" -eq 1 ]; then
    printf 'Dry run: pack %s package(s) at %s, upload nothing. Continue? [y/N] ' "$PUBLISH_COUNT" "$VERSION"
  else
    printf '%sPublish %s package(s) at %s to %s under dist-tag "%s". This cannot be undone.%s\nContinue? [y/N] ' \
      "$BOLD" "$PUBLISH_COUNT" "$VERSION" "$REGISTRY" "$DIST_TAG" "$RESET"
  fi
  read -r reply
  case "$reply" in [yY]|[yY][eE][sS]) ;; *) die "aborted" ;; esac
fi

# ----------------------------------------------------------------- gates ------

if [ "$SKIP_GATES" -eq 1 ]; then
  warn "skipping lint/test/build gates (--skip-gates)"
else
  # Order matters: `yarn test` runs a pretest clean that wipes every dist/, so
  # the build+attw gate goes last and leaves the validated artifacts in place.
  step "Gate: yarn lint"
  yarn lint || die "lint failed"
  step "Gate: yarn test"
  yarn test || die "tests failed"
  step "Gate: yarn check:exports (build + attw)"
  yarn check:exports || die "build or attw failed"
  ok "all gates green"
fi

# --------------------------------------------------------------- publish ------

step "Publishing"

PUBLISHED=""
FAILED=""
# Feed the list on fd 3, not stdin: npm must keep the terminal so it can prompt
# for a 2FA one-time password (or run its browser auth flow). Reading the loop
# from stdin makes npm inherit the herestring instead and fail with EOTP.
while IFS=$'\t' read -r name version dir <&3; do
  [ -n "$name" ] || continue
  # --registry is redundant given the preflight check, but it pins the upload
  # target so no config layer can redirect it.
  set -- publish --access public --registry "$REGISTRY" --tag "$DIST_TAG" "./$dir"
  [ "$DRY_RUN" -eq 1 ] && set -- "$@" --dry-run
  [ -n "$OTP" ] && set -- "$@" --otp "$OTP"

  info "npm $* "
  if npm "$@"; then
    ok "$name@$version"
    PUBLISHED="$PUBLISHED$name@$version"$'\n'
  else
    FAILED="$name@$version"
    warn "$name@$version FAILED -- stopping here"
    break
  fi
done 3<<< "$TO_PUBLISH"

# ---------------------------------------------------------------- verify ------

if [ "$DRY_RUN" -eq 0 ] && [ -n "$PUBLISHED" ]; then
  step "Verifying on npm"
  # The registry's read replicas lag behind a write by up to a minute, so a
  # fresh version can 404 briefly even though it is live.
  attempt=1
  while [ "$attempt" -le 6 ]; do
    missing=""
    while IFS= read -r spec <&3; do
      [ -n "$spec" ] || continue
      npm view "$spec" version >/dev/null 2>&1 || missing="$missing$spec"$'\n'
    done 3<<< "$PUBLISHED"
    [ -z "$missing" ] && break
    info "not visible yet, retrying in 15s (attempt $attempt/6)"
    sleep 15
    attempt=$((attempt + 1))
  done
  if [ -z "$missing" ]; then ok "all published versions resolve on npm"
  else
    warn "still not visible (read-replica lag can exceed this wait):"
    printf '%s' "$missing" | while IFS= read -r spec; do [ -n "$spec" ] && warn "  $spec"; done
  fi
fi

# --------------------------------------------------------------- summary ------

step "Summary"
[ -n "$ALREADY" ] && printf '%s' "$ALREADY" | while IFS= read -r s; do [ -n "$s" ] && info "skipped (already on npm): $s"; done
[ -n "$PUBLISHED" ] && printf '%s' "$PUBLISHED" | while IFS= read -r s; do [ -n "$s" ] && ok "$([ "$DRY_RUN" -eq 1 ] && echo 'packed (dry run)' || echo published): $s"; done

if [ -n "$FAILED" ]; then
  printf '\n'
  warn "if npm reported EOTP or E403, this account requires 2FA to publish:"
  warn "  reliable -- create a Granular Access Token with 'Read and write' on the @rsocket-ts"
  warn "  scope and the rsocket-ts org (it bypasses the OTP prompt), then:"
  warn "      npm config set //registry.npmjs.org/:_authToken=npm_xxx"
  warn "  one-off -- 'yarn pub --otp <code>', but a TOTP code expires in 30s and every package"
  warn "  is rebuilt before upload, so one code will not cover all of them."
  die "$FAILED failed to publish. Fix the cause and re-run -- already-published packages are skipped automatically (add --skip-gates to go straight to publishing)."
fi

if [ "$DRY_RUN" -eq 1 ]; then
  info "dry run only -- nothing was uploaded"
else
  printf '\n'
  ok "done: $VERSION is live under dist-tag \"$DIST_TAG\""
  info "push the release tags if you have not: git push --follow-tags"
fi
