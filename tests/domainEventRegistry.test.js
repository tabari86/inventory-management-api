const {
  EVENT_VERSION,
  MAX_OUTBOX_PAYLOAD_BYTES,
  PAYLOAD_SCHEMA_VERSION,
  getEventDefinition,
  listEventDefinitions,
} = require("../src/services/domainEventRegistry");
const mongoose = require("mongoose");
const Product = require("../src/models/Product");
const { normalizePlainJson } = require("../src/utils/boundedJson");

const expectedTypes = [
  "catalog.product.created",
  "catalog.product.updated",
  "catalog.product.reactivated",
  "catalog.product.deactivated",
  "catalog.product.archived",
  "catalog.product.stock-linked",
  "warehouse.created",
  "warehouse.updated",
  "warehouse.reactivated",
  "warehouse.deactivated",
  "warehouse.stock-linked",
  "inventory.stock.created",
  "inventory.stock.received",
  "inventory.stock.issued",
  "inventory.stock.availability-guard-changed",
];

describe("domain event registry", () => {
  it("contains every unique approved event with fixed versions and builders", () => {
    const definitions = listEventDefinitions();
    expect(definitions.map(({ eventType }) => eventType).sort()).toEqual(
      [...expectedTypes].sort()
    );
    expect(new Set(definitions.map(({ eventType }) => eventType)).size).toBe(
      expectedTypes.length
    );
    for (const definition of definitions) {
      expect(definition.eventVersion).toBe(EVENT_VERSION);
      expect(definition.payloadSchemaVersion).toBe(PAYLOAD_SCHEMA_VERSION);
      expect(definition.eventVersion).toBeGreaterThan(0);
      expect(definition.payloadSchemaVersion).toBeGreaterThan(0);
      expect(definition.maxPayloadBytes).toBe(MAX_OUTBOX_PAYLOAD_BYTES);
      expect(["Product", "Warehouse", "Stock"]).toContain(
        definition.aggregateType
      );
      expect(definition.snapshotBuilder).toEqual(expect.any(Function));
      expect(definition.payloadBuilder).toEqual(expect.any(Function));
    }
  });

  it("rejects unknown types, missing fields, extra fields, and wrong signed deltas", () => {
    expect(() => getEventDefinition("inventory.stock.received.v1")).toThrow(
      expect.objectContaining({ code: "EVENT_DESCRIPTOR_INVALID" })
    );
    const created = getEventDefinition("catalog.product.created");
    expect(() =>
      created.payloadBuilder({
        productId: "64b64c6f2f0f000000000001",
        sku: "P-1",
        status: "active",
      })
    ).toThrow("aggregateVersion");
    expect(() =>
      created.payloadBuilder({
        productId: "64b64c6f2f0f000000000001",
        sku: "P-1",
        status: "active",
        aggregateVersion: 1,
        password: "not-allowed",
      })
    ).toThrow("unsupported field");
    const received = getEventDefinition("inventory.stock.received");
    expect(() =>
      received.payloadBuilder({
        stockId: "64b64c6f2f0f000000000001",
        productId: "64b64c6f2f0f000000000002",
        warehouseId: "64b64c6f2f0f000000000003",
        stockMovementId: "64b64c6f2f0f000000000004",
        signedDelta: -1,
        beforeQuantity: 0,
        afterQuantity: 1,
        reference: null,
        reasonCode: "GOODS_RECEIPT",
        aggregateVersion: 2,
      })
    ).toThrow("movement transition is invalid");
  });

  it("enforces lifecycle, quantity, movement, and deterministic-list invariants", () => {
    const productId = "64b64c6f2f0f000000000001";
    expect(() =>
      getEventDefinition("catalog.product.reactivated").payloadBuilder({
        productId,
        sku: "P-1",
        previousStatus: "active",
        status: "inactive",
        aggregateVersion: 2,
      })
    ).toThrow("lifecycle transition is invalid");
    expect(() =>
      getEventDefinition("inventory.stock.created").payloadBuilder({
        stockId: productId,
        productId,
        warehouseId: "64b64c6f2f0f000000000002",
        quantity: 1,
        aggregateVersion: 1,
      })
    ).toThrow("zero initial quantity");
    expect(() =>
      getEventDefinition("inventory.stock.received").payloadBuilder({
        stockId: productId,
        productId,
        warehouseId: "64b64c6f2f0f000000000002",
        stockMovementId: "64b64c6f2f0f000000000003",
        signedDelta: 2,
        beforeQuantity: 5,
        afterQuantity: 8,
        reference: null,
        reasonCode: "GOODS_RECEIPT",
        aggregateVersion: 2,
      })
    ).toThrow("movement transition is invalid");
    expect(() =>
      getEventDefinition("catalog.product.stock-linked").payloadBuilder({
        productId,
        sku: "P-1",
        linkedStockIds: [
          "64b64c6f2f0f000000000003",
          "64b64c6f2f0f000000000002",
        ],
        linkedCount: 2,
        aggregateVersion: 2,
      })
    ).toThrow("canonical IDs");
    expect(() =>
      getEventDefinition("catalog.product.updated").payloadBuilder({
        productId,
        sku: "P-1",
        changedFields: ["unit", "name"],
        aggregateVersion: 2,
      })
    ).toThrow("unique and deterministic");
  });

  it("builds new plain payloads without secrets, PII, or unsupported objects", () => {
    const payload = getEventDefinition("catalog.product.updated").payloadBuilder({
      productId: "64b64c6f2f0f000000000001",
      sku: "P-1",
      changedFields: ["name"],
      aggregateVersion: 2,
    });
    expect(Object.getPrototypeOf(payload)).toBe(Object.prototype);
    expect(payload).toEqual({
      productId: "64b64c6f2f0f000000000001",
      sku: "P-1",
      changedFields: ["name"],
      aggregateVersion: 2,
    });
    expect(JSON.stringify(payload)).not.toMatch(
      /password|token|authorization|cookie|email|role/i
    );
  });

  it("enforces plain JSON safety while canonicalizing ObjectIds", () => {
    const objectId = new mongoose.Types.ObjectId();
    expect(normalizePlainJson({ objectId, value: null })).toEqual({
      objectId: objectId.toString(),
      value: null,
    });
    const circular = {};
    circular.self = circular;
    class Unsafe {}
    const symbolKey = { safe: true };
    symbolKey[Symbol("unsafe")] = true;
    const accessor = {};
    Object.defineProperty(accessor, "unsafe", {
      enumerable: true,
      get: () => "value",
    });
    for (const value of [
      circular,
      { value: () => true },
      { value: Symbol("unsafe") },
      { value: 1n },
      { value: new Error("unsafe") },
      { value: new Unsafe() },
      { value: Number.POSITIVE_INFINITY },
      { value: new Date() },
      { value: new Product({ sku: "DOC-1", name: "Document" }) },
      { value: [undefined] },
      symbolKey,
      accessor,
      JSON.parse('{"__proto__":{"polluted":true}}'),
    ]) {
      expect(() => normalizePlainJson(value)).toThrow();
    }
    expect({}.polluted).toBeUndefined();
  });
});
