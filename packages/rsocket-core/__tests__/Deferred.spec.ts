import { Deferred } from "../src/Deferred";

describe("Deferred", () => {
  it("invokes onClose callbacks registered before close, with the error", () => {
    const deferred = new Deferred();
    const cb = jest.fn();
    deferred.onClose(cb);

    const error = new Error("boom");
    deferred.close(error);

    expect(cb).toHaveBeenCalledTimes(1);
    expect(cb).toHaveBeenCalledWith(error);
    expect(deferred.done).toBe(true);
  });

  it("invokes a callback registered after close immediately (no error)", () => {
    const deferred = new Deferred();
    deferred.close();

    const cb = jest.fn();
    deferred.onClose(cb);

    expect(cb).toHaveBeenCalledTimes(1);
    expect(cb).toHaveBeenCalledWith(undefined);
  });

  it("passes the stored error to a callback registered after close", () => {
    const deferred = new Deferred();
    const error = new Error("boom");
    deferred.close(error);

    const cb = jest.fn();
    deferred.onClose(cb);

    expect(cb).toHaveBeenCalledWith(error);
  });

  it("is idempotent: a second close does not re-invoke callbacks", () => {
    jest.spyOn(console, "warn").mockImplementation(() => {});
    const deferred = new Deferred();
    const cb = jest.fn();
    deferred.onClose(cb);

    deferred.close();
    deferred.close(new Error("ignored"));

    expect(cb).toHaveBeenCalledTimes(1);
  });

  it("releases callbacks after close so they are not retained", () => {
    const deferred = new Deferred();
    deferred.onClose(jest.fn());
    deferred.onClose(jest.fn());

    deferred.close();

    const internal = deferred as unknown as {
      onCloseCallbacks: Array<unknown>;
    };
    expect(internal.onCloseCallbacks).toHaveLength(0);
  });
});
