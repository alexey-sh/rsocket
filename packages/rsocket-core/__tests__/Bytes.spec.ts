import * as Bytes from "../src/Bytes";

// Node's Buffer is used purely as the reference oracle here: every Bytes helper
// must produce/interpret bytes identically to the equivalent Buffer method, so
// the Uint8Array-based codec is wire-compatible with the old Buffer-based one.

describe("Bytes big-endian reads", () => {
  const cases: Array<[string, number[], number]> = [
    ["readUInt8", [0x00, 0x7f, 0x80, 0xff], 1],
    ["readInt8", [0x00, 0x7f, 0x80, 0xff], 1],
    ["readUInt16BE", [0x00, 0x00, 0x80, 0x00, 0xbe, 0xef, 0xff, 0xff], 2],
    ["readUInt24BE", [0x00, 0x00, 0x00, 0xab, 0xcd, 0xef, 0xff, 0xff, 0xff], 3],
    ["readUInt32BE", [0x00, 0x00, 0x00, 0x00, 0xde, 0xad, 0xbe, 0xef], 4],
    ["readInt16BE", [0x80, 0x00, 0xff, 0xff, 0x7f, 0xff], 2],
    ["readInt32BE", [0x80, 0x00, 0x00, 0x00, 0xff, 0xff, 0xff, 0xff], 4],
  ];

  it.each(cases)("%s matches Buffer", (name, bytes, size) => {
    const buffer = Buffer.from(bytes);
    for (let offset = 0; offset + size <= bytes.length; offset += size) {
      // Buffer has no readUInt24BE method; use the generic readUIntBE(_, 3).
      const oracle =
        name === "readUInt24BE"
          ? buffer.readUIntBE(offset, 3)
          : (buffer as any)[name](offset);
      expect((Bytes as any)[name](buffer, offset)).toBe(oracle);
    }
  });

  it("readUInt64BE matches Buffer.readBigUInt64BE for < 2^53 values", () => {
    const values = [0, 1, 0xffffffff, 1234567890123, Number.MAX_SAFE_INTEGER];
    for (const value of values) {
      const buffer = Buffer.alloc(8);
      buffer.writeBigUInt64BE(BigInt(value));
      expect(Bytes.readUInt64BE(buffer, 0)).toBe(value);
    }
  });
});

describe("Bytes big-endian writes", () => {
  it("writeUInt8/16/24/32 produce Buffer-identical bytes and return the next offset", () => {
    const specs: Array<[keyof typeof Bytes, number, number]> = [
      ["writeUInt8", 0xab, 1],
      ["writeUInt16BE", 0xbeef, 2],
      ["writeUInt24BE", 0xabcdef, 3],
      ["writeUInt32BE", 0xdeadbeef, 4],
    ];
    for (const [name, value, size] of specs) {
      const mine = new Uint8Array(size + 1);
      const oracle = Buffer.alloc(size + 1);
      // start at offset 1 to prove offset handling
      const next = (Bytes as any)[name](mine, value, 1);
      // Buffer has no writeUInt24BE method; use the generic writeUIntBE(_, _, 3).
      if (name === "writeUInt24BE") {
        oracle.writeUIntBE(value, 1, 3);
      } else {
        (oracle as any)[name](value, 1);
      }
      expect(next).toBe(1 + size);
      expect([...mine]).toEqual([...oracle]);
    }
  });

  it("writeInt32BE matches Buffer.writeInt32BE for negative values", () => {
    for (const value of [-1, -2147483648, 2147483647, 0]) {
      const mine = new Uint8Array(4);
      const oracle = Buffer.alloc(4);
      expect(Bytes.writeInt32BE(mine, value, 0)).toBe(4);
      oracle.writeInt32BE(value, 0);
      expect([...mine]).toEqual([...oracle]);
    }
  });

  it("writeUInt64BE matches Buffer.writeBigUInt64BE", () => {
    const value = 1234567890123;
    const mine = new Uint8Array(8);
    const oracle = Buffer.alloc(8);
    expect(Bytes.writeUInt64BE(mine, value, 0)).toBe(8);
    oracle.writeBigUInt64BE(BigInt(value));
    expect([...mine]).toEqual([...oracle]);
  });
});

describe("Bytes allocation and copying", () => {
  it("alloc returns a zero-filled buffer", () => {
    expect([...Bytes.alloc(3)]).toEqual([0, 0, 0]);
  });

  it("concat matches Buffer.concat", () => {
    const a = Uint8Array.from([1, 2]);
    const b = Uint8Array.from([3, 4, 5]);
    expect([...Bytes.concat([a, b])]).toEqual([...Buffer.concat([a, b])]);
    expect([...Bytes.concat([])]).toEqual([]);
  });

  it("copy writes at the offset and returns the next offset", () => {
    const target = new Uint8Array(5);
    const next = Bytes.copy(Uint8Array.from([9, 8, 7]), target, 1);
    expect(next).toBe(4);
    expect([...target]).toEqual([0, 9, 8, 7, 0]);
  });
});

describe("Bytes string encoding", () => {
  it("utf8 round-trips and lengths match Buffer", () => {
    const value = "héllo · rsocket";
    expect(Bytes.utf8Length(value)).toBe(Buffer.byteLength(value, "utf8"));
    const target = new Uint8Array(Bytes.utf8Length(value));
    const next = Bytes.writeUtf8(target, value, 0);
    expect(next).toBe(target.length);
    expect([...target]).toEqual([...Buffer.from(value, "utf8")]);
    expect(Bytes.readUtf8(target, 0, target.length)).toBe(value);
    expect([...Bytes.fromUtf8(value)]).toEqual([...Buffer.from(value, "utf8")]);
  });

  it("ascii round-trips MIME-type strings and matches Buffer", () => {
    const value = "application/octet-stream";
    expect(Bytes.asciiLength(value)).toBe(Buffer.byteLength(value, "ascii"));
    const target = new Uint8Array(Bytes.asciiLength(value) + 2);
    const next = Bytes.writeAscii(target, value, 2);
    expect(next).toBe(2 + value.length);
    expect([...target.subarray(2)]).toEqual([...Buffer.from(value, "ascii")]);
    expect(Bytes.readAscii(target, 2, target.length)).toBe(value);
  });
});
