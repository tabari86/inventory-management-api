const mongoose = require("mongoose");

const {
  REQUEST_HASH_VERSION,
  buildCanonicalCommand,
  canonicalize,
  hashCanonicalCommand,
} = require("../src/utils/canonicalJson");

describe("canonical-json-v1", () => {
  it("sorts plain-object keys recursively while preserving array order", () => {
    const first = { z: 1, nested: { b: true, a: null }, items: [1, 2] };
    const reordered = {
      items: [1, 2],
      nested: { a: null, b: true },
      z: 1,
    };

    expect(hashCanonicalCommand(first)).toEqual(hashCanonicalCommand(reordered));
    expect(hashCanonicalCommand(first).requestHash).not.toBe(
      hashCanonicalCommand({ ...reordered, items: [2, 1] }).requestHash
    );
  });

  it("normalizes negative zero, ObjectId representation, dates, and undefined object fields", () => {
    const id = new mongoose.Types.ObjectId("64B64C6F2F0F000000000001");
    expect(canonicalize({ id, value: -0, ignored: undefined })).toBe(
      '{"id":"64b64c6f2f0f000000000001","value":0}'
    );
    expect(canonicalize(new Date("2026-07-26T10:00:00.000Z"))).toBe(
      '"2026-07-26T10:00:00.000Z"'
    );
  });

  it("hashes only the explicit normalized command DTO", () => {
    const base = buildCanonicalCommand({
      operationId: "inventory.goods-receipt.single.v1",
      pathParameters: {},
      semanticQueryParameters: {},
      normalizedBody: {
        stockId: "64b64c6f2f0f000000000001",
        quantity: 5,
        reference: "PO-5",
      },
    });
    const equal = buildCanonicalCommand({
      normalizedBody: {
        reference: "PO-5",
        quantity: 5,
        stockId: "64b64c6f2f0f000000000001",
      },
      operationId: "inventory.goods-receipt.single.v1",
    });

    expect(hashCanonicalCommand(base).requestHash).toBe(
      hashCanonicalCommand(equal).requestHash
    );
    expect(hashCanonicalCommand(base).requestHashVersion).toBe(
      REQUEST_HASH_VERSION
    );
    for (const changed of [
      { ...base, operationId: "inventory.goods-issue.single.v1" },
      { ...base, pathParameters: { id: "64b64c6f2f0f000000000002" } },
      {
        ...base,
        normalizedBody: { ...base.normalizedBody, quantity: 6 },
      },
    ]) {
      expect(hashCanonicalCommand(changed).requestHash).not.toBe(
        hashCanonicalCommand(base).requestHash
      );
    }
  });

  it.each([
    ["undefined array", [undefined]],
    ["function", { value: () => true }],
    ["symbol", { value: Symbol("x") }],
    ["bigint", { value: BigInt(1) }],
    ["NaN", { value: Number.NaN }],
    ["Infinity", { value: Infinity }],
  ])("rejects unsupported %s values", (label, value) => {
    expect(() => canonicalize(value)).toThrow("Unsupported canonical JSON value");
  });

  it("rejects circular values and does not mutate prototypes", () => {
    const circular = {};
    circular.self = circular;
    expect(() => canonicalize(circular)).toThrow("circular reference");

    const payload = JSON.parse(
      '{"__proto__":{"polluted":true},"constructor":{"safe":true},"prototype":null}'
    );
    const before = {}.polluted;
    expect(canonicalize(payload)).toContain('"__proto__"');
    expect({}.polluted).toBe(before);
  });
});
