const mongoose = require("mongoose");
const request = require("supertest");

const app = require("../src/app");
const Product = require("../src/models/Product");
const Stock = require("../src/models/Stock");
const StockMovement = require("../src/models/StockMovement");
const Warehouse = require("../src/models/Warehouse");
const {
  CURSOR_VERSION,
  MAX_CURSOR_LENGTH,
  PRODUCT_SKU_MAX_LENGTH,
  WAREHOUSE_CODE_MAX_LENGTH,
  decodeCursor,
  encodeCursor,
  fingerprintQuery,
  parseCollectionQuery,
} = require("../src/utils/cursorPagination");
const { createViewerToken } = require("./helpers/authTestHelper");

require("./setupTestDb");

const fixedCreatedAt = new Date("2026-01-15T10:00:00.000Z");

const createFixtures = async (resource, count) => {
  if (resource === "products") {
    return Product.insertMany(
      Array.from({ length: count }, (_, index) => ({
        sku: `PAGE-P-${String(index).padStart(3, "0")}`,
        name: `Product ${index}`,
        status: index % 2 ? "inactive" : "active",
        createdAt: fixedCreatedAt,
        updatedAt: fixedCreatedAt,
      }))
    );
  }
  if (resource === "warehouses") {
    return Warehouse.insertMany(
      Array.from({ length: count }, (_, index) => ({
        code: `PAGE-W-${String(index).padStart(3, "0")}`,
        name: `Warehouse ${index}`,
        status: index % 2 ? "inactive" : "active",
        createdAt: fixedCreatedAt,
        updatedAt: fixedCreatedAt,
      }))
    );
  }

  const products = await Product.insertMany(
    Array.from({ length: resource === "stocks" ? count : 1 }, (_, index) => ({
      sku: `PAGE-SP-${String(index).padStart(3, "0")}`,
      name: `Stock Product ${index}`,
    }))
  );
  const warehouse = await Warehouse.create({
    code: "PAGE-STOCK-WH",
    name: "Stock Warehouse",
  });
  if (resource === "stocks") {
    return Stock.insertMany(
      products.map((product, index) => ({
        productId: product._id,
        warehouseId: warehouse._id,
        status: index % 2 ? "inactive" : "active",
        createdAt: fixedCreatedAt,
        updatedAt: fixedCreatedAt,
      }))
    );
  }

  const stock = await Stock.create({
    productId: products[0]._id,
    warehouseId: warehouse._id,
  });
  return StockMovement.insertMany(
    Array.from({ length: count }, (_, index) => ({
      stockId: stock._id,
      productId: products[0]._id,
      warehouseId: warehouse._id,
      type: index % 2 ? "GOODS_ISSUE" : "GOODS_RECEIPT",
      quantity: index + 1,
      reference: `PAGE-REF-${index}`,
      createdAt: fixedCreatedAt,
      updatedAt: fixedCreatedAt,
    }))
  );
};

const getPage = (token, resource, query = "") =>
  request(app)
    .get(`/api/v1/${resource}${query}`)
    .set("Authorization", `Bearer ${token}`);

const expectValidation = (response) => {
  expect(response.statusCode).toBe(400);
  expect(response.body.code).toBe("VALIDATION_FAILED");
  expect(response.body.errors).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ field: expect.any(String), message: expect.any(String) }),
    ])
  );
};

describe.each(["products", "warehouses", "stocks", "stock-movements"])(
  "%s cursor pagination",
  (resource) => {
    it("enforces default/max bounds and traverses duplicate timestamps without gaps", async () => {
      const token = await createViewerToken();
      const records = await createFixtures(resource, 105);

      const defaultPage = await getPage(token, resource);
      expect(defaultPage.statusCode).toBe(200);
      expect(defaultPage.body.data).toHaveLength(50);
      expect(defaultPage.body.meta).toMatchObject({
        limit: 50,
        nextCursor: expect.any(String),
        schemaVersion: "1.0",
      });
      expect(defaultPage.body.meta).not.toHaveProperty("total");
      expect(defaultPage.body.meta).not.toHaveProperty("page");

      const maximumPage = await getPage(token, resource, "?limit=100");
      expect(maximumPage.body.data).toHaveLength(100);
      expect(maximumPage.body.meta.limit).toBe(100);

      const collected = [];
      let cursor = null;
      let pageCount = 0;
      do {
        const query = `?limit=37&order=desc${
          cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""
        }`;
        const page = await getPage(token, resource, query);
        expect(page.statusCode).toBe(200);
        expect(page.body.data.length).toBeLessThanOrEqual(37);
        collected.push(...page.body.data.map(({ _id }) => _id));
        cursor = page.body.meta.nextCursor;
        pageCount += 1;
      } while (cursor);

      expect(pageCount).toBe(3);
      expect(collected).toHaveLength(records.length);
      expect(new Set(collected).size).toBe(records.length);

      const ascending = await getPage(token, resource, "?limit=100&order=asc");
      const ascendingNext = await getPage(
        token,
        resource,
        `?limit=100&order=asc&cursor=${encodeURIComponent(
          ascending.body.meta.nextCursor
        )}`
      );
      const ascendingIds = [...ascending.body.data, ...ascendingNext.body.data].map(
        ({ _id }) => _id
      );
      expect(ascendingIds).toEqual([...collected].reverse());
      expect(ascendingNext.body.meta.nextCursor).toBeNull();
    });

    it.each(["0", "-1", "1.5", "101", "abc"])(
      "rejects invalid limit %s",
      async (limit) => {
        const token = await createViewerToken();
        expectValidation(await getPage(token, resource, `?limit=${limit}`));
      }
    );

    it("keeps the legacy list shape and cursor header equivalent to v1", async () => {
      const token = await createViewerToken();
      await createFixtures(resource, 3);
      const legacy = await request(app)
        .get(`/api/${resource}?limit=2&order=asc`)
        .set("Authorization", `Bearer ${token}`);
      const v1 = await getPage(token, resource, "?limit=2&order=asc");

      expect(legacy.body.message).toEqual(expect.any(String));
      expect(legacy.body.data.map(({ _id }) => _id)).toEqual(
        v1.body.data.map(({ _id }) => _id)
      );
      expect(legacy.headers["x-next-cursor"]).toBe(v1.body.meta.nextCursor);
      const finalLegacy = await request(app)
        .get(
          `/api/${resource}?limit=2&order=asc&cursor=${encodeURIComponent(
            legacy.headers["x-next-cursor"]
          )}`
        )
        .set("Authorization", `Bearer ${token}`);
      expect(finalLegacy.body.data).toHaveLength(1);
      expect(finalLegacy.headers["x-next-cursor"]).toBeUndefined();
      expect(finalLegacy.body.meta).toBeUndefined();
    });
  }
);

describe("Cursor validation and query allowlists", () => {
  const filters = { status: "active" };
  const fingerprint = fingerprintQuery({
    resource: "products",
    sort: "createdAt",
    order: "desc",
    filters,
  });
  const boundary = {
    _id: new mongoose.Types.ObjectId("507f1f77bcf86cd799439011"),
    createdAt: fixedCreatedAt,
  };
  const validCursor = encodeCursor({
    resource: "products",
    order: "desc",
    fingerprint,
    item: boundary,
  });
  const encodePayload = (payload) =>
    Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  const validPayload = {
    v: CURSOR_VERSION,
    r: "products",
    s: "createdAt",
    o: "desc",
    t: fixedCreatedAt.toISOString(),
    i: boundary._id.toString(),
    q: fingerprint,
  };

  it("decodes only the exact supported cursor structure", () => {
    expect(
      decodeCursor(validCursor, {
        resource: "products",
        order: "desc",
        fingerprint,
      })
    ).toMatchObject({ createdAt: fixedCreatedAt, id: boundary._id });
  });

  it.each([
    ["malformed base64", "%%%"],
    ["malformed JSON", Buffer.from("not-json").toString("base64url")],
    ["version", encodePayload({ ...validPayload, v: 2 })],
    ["resource", encodePayload({ ...validPayload, r: "warehouses" })],
    ["sort", encodePayload({ ...validPayload, s: "name" })],
    ["direction", encodePayload({ ...validPayload, o: "asc" })],
    ["timestamp", encodePayload({ ...validPayload, t: "not-a-date" })],
    ["ObjectId", encodePayload({ ...validPayload, i: "not-an-id" })],
    ["fingerprint", encodePayload({ ...validPayload, q: "0".repeat(64) })],
    ["unexpected field", encodePayload({ ...validPayload, extra: true })],
    ["too long", "a".repeat(MAX_CURSOR_LENGTH + 1)],
  ])("rejects %s", (_caseName, cursor) => {
    expect(() =>
      decodeCursor(cursor, {
        resource: "products",
        order: "desc",
        fingerprint,
      })
    ).toThrow(expect.objectContaining({ code: "INVALID_CURSOR" }));
  });

  it("binds cursors to normalized filters, resource, and direction", () => {
    for (const expected of [
      { resource: "products", order: "desc", fingerprint: "0".repeat(64) },
      { resource: "warehouses", order: "desc", fingerprint },
      { resource: "products", order: "asc", fingerprint },
    ]) {
      expect(() => decodeCursor(validCursor, expected)).toThrow(
        expect.objectContaining({ code: "INVALID_CURSOR" })
      );
    }
  });

  it.each([
    ["unknown", { projection: "password" }],
    ["array", { status: ["active", "inactive"] }],
    ["object", { status: { $ne: "active" } }],
    ["operator", { $where: "true" }],
    ["sort", { sort: "name" }],
    ["multi-sort", { sort: "createdAt,_id" }],
  ])("rejects %s query behavior", (_caseName, query) => {
    expect(() => parseCollectionQuery("products", query)).toThrow(
      expect.objectContaining({ code: "VALIDATION_FAILED" })
    );
  });

  it("rejects filter changes and never reflects a raw cursor", async () => {
    const token = await createViewerToken();
    await createFixtures("products", 3);
    const first = await getPage(token, "products", "?limit=1&status=active");
    const rawCursor = first.body.meta.nextCursor;
    const invalid = await getPage(
      token,
      "products",
      `?limit=1&status=inactive&cursor=${encodeURIComponent(rawCursor)}`
    );
    expect(invalid.statusCode).toBe(400);
    expect(invalid.body.code).toBe("INVALID_CURSOR");
    expect(JSON.stringify(invalid.body)).not.toContain(rawCursor);
  });
});

describe("Resource filters and bounded projections", () => {
  it("accepts the maximum SKU length and rejects longer values before Product.find", async () => {
    const token = await createViewerToken();
    const maximumSku = "S".repeat(PRODUCT_SKU_MAX_LENGTH);
    await Product.create({ sku: maximumSku, name: "Maximum SKU" });

    const accepted = await getPage(token, "products", `?sku=${maximumSku}`);
    expect(accepted.statusCode).toBe(200);
    expect(accepted.body.data).toHaveLength(1);

    const findSpy = jest.spyOn(Product, "find");
    const rawOverlong = "S".repeat(PRODUCT_SKU_MAX_LENGTH + 1);
    const rejected = await getPage(token, "products", `?sku=${rawOverlong}`);
    expectValidation(rejected);
    expect(findSpy).not.toHaveBeenCalled();
    expect(JSON.stringify(rejected.body)).not.toContain(rawOverlong);
    findSpy.mockRestore();
  });

  it("accepts the maximum code length and rejects longer values before Warehouse.find", async () => {
    const token = await createViewerToken();
    const maximumCode = "W".repeat(WAREHOUSE_CODE_MAX_LENGTH);
    await Warehouse.create({ code: maximumCode, name: "Maximum code" });

    const accepted = await getPage(
      token,
      "warehouses",
      `?code=${maximumCode}`
    );
    expect(accepted.statusCode).toBe(200);
    expect(accepted.body.data).toHaveLength(1);

    const findSpy = jest.spyOn(Warehouse, "find");
    const rawOverlong = "W".repeat(WAREHOUSE_CODE_MAX_LENGTH + 1);
    const rejected = await getPage(
      token,
      "warehouses",
      `?code=${rawOverlong}`
    );
    expectValidation(rejected);
    expect(findSpy).not.toHaveBeenCalled();
    expect(JSON.stringify(rejected.body)).not.toContain(rawOverlong);
    findSpy.mockRestore();
  });

  it("normalizes Product filters and excludes archived products", async () => {
    const token = await createViewerToken();
    await Product.create([
      { sku: "FILTER-P", name: "Active", status: "active" },
      { sku: "FILTER-I", name: "Inactive", status: "inactive" },
      {
        sku: "FILTER-ARCHIVED",
        name: "Archived",
        status: "inactive",
        archivedAt: new Date(),
      },
    ]);
    const exact = await getPage(token, "products", "?sku=%20filter-p%20");
    expect(exact.body.data.map(({ sku }) => sku)).toEqual(["FILTER-P"]);
    const inactive = await getPage(token, "products", "?status=inactive");
    expect(inactive.body.data.map(({ sku }) => sku)).toEqual(["FILTER-I"]);
  });

  it("normalizes Warehouse code and status filters", async () => {
    const token = await createViewerToken();
    await Warehouse.create([
      { code: "FILTER-W-A", name: "Active", status: "active" },
      { code: "FILTER-W-I", name: "Inactive", status: "inactive" },
    ]);
    const exact = await getPage(token, "warehouses", "?code=%20filter-w-a%20");
    expect(exact.body.data.map(({ code }) => code)).toEqual(["FILTER-W-A"]);
    const inactive = await getPage(token, "warehouses", "?status=inactive");
    expect(inactive.body.data.map(({ code }) => code)).toEqual(["FILTER-W-I"]);
  });

  it("supports Stock product, warehouse, combined, and status filters", async () => {
    const token = await createViewerToken();
    const products = await Product.create([
      { sku: "FILTER-S-1", name: "One" },
      { sku: "FILTER-S-2", name: "Two" },
    ]);
    const warehouses = await Warehouse.create([
      { code: "FILTER-S-W1", name: "One" },
      { code: "FILTER-S-W2", name: "Two" },
    ]);
    await Stock.create([
      { productId: products[0]._id, warehouseId: warehouses[0]._id },
      {
        productId: products[1]._id,
        warehouseId: warehouses[1]._id,
        status: "inactive",
      },
    ]);
    const query = `?productId=${products[0]._id}&warehouseId=${warehouses[0]._id}&status=active`;
    const combined = await getPage(token, "stocks", query);
    expect(combined.body.data).toHaveLength(1);
    expect(combined.body.data[0].productId.sku).toBe("FILTER-S-1");
    expectValidation(await getPage(token, "stocks", "?productId=bad"));
  });

  it("supports all StockMovement exact and inclusive date filters", async () => {
    const token = await createViewerToken();
    const product = await Product.create({ sku: "FILTER-M", name: "Movement" });
    const warehouse = await Warehouse.create({ code: "FILTER-M-W", name: "Movement" });
    const stock = await Stock.create({ productId: product._id, warehouseId: warehouse._id });
    const firstAt = new Date("2026-02-01T00:00:00.000Z");
    const secondAt = new Date("2026-02-02T00:00:00.000Z");
    await StockMovement.create([
      {
        stockId: stock._id,
        productId: product._id,
        warehouseId: warehouse._id,
        type: "GOODS_RECEIPT",
        quantity: 2,
        reference: "FILTER-REFERENCE",
        createdAt: firstAt,
        updatedAt: firstAt,
      },
      {
        stockId: stock._id,
        productId: product._id,
        warehouseId: warehouse._id,
        type: "GOODS_ISSUE",
        quantity: 1,
        reference: "OTHER",
        createdAt: secondAt,
        updatedAt: secondAt,
      },
    ]);
    const common = `stockId=${stock._id}&productId=${product._id}&warehouseId=${warehouse._id}`;
    const filtered = await getPage(
      token,
      "stock-movements",
      `?${common}&type=GOODS_RECEIPT&reference=%20FILTER-REFERENCE%20&from=${encodeURIComponent(
        firstAt.toISOString()
      )}&to=${encodeURIComponent(firstAt.toISOString())}`
    );
    expect(filtered.body.data).toHaveLength(1);
    expect(filtered.body.data[0].reference).toBe("FILTER-REFERENCE");
    expectValidation(
      await getPage(
        token,
        "stock-movements",
        `?from=${encodeURIComponent(secondAt.toISOString())}&to=${encodeURIComponent(
          firstAt.toISOString()
        )}`
      )
    );
  });

  it("returns only explicit top-level and populated fields and never counts totals", async () => {
    const token = await createViewerToken();
    const product = await Product.create({ sku: "PROJECTION", name: "Projection" });
    const warehouse = await Warehouse.create({ code: "PROJECTION", name: "Projection" });
    const stock = await Stock.create({ productId: product._id, warehouseId: warehouse._id });
    await StockMovement.create({
      stockId: stock._id,
      productId: product._id,
      warehouseId: warehouse._id,
      type: "GOODS_RECEIPT",
      quantity: 1,
    });
    const productCountSpy = jest.spyOn(Product, "countDocuments");

    for (const resource of ["products", "warehouses", "stocks", "stock-movements"]) {
      const response = await getPage(token, resource, "?expand=private");
      expectValidation(response);
      const valid = await getPage(token, resource);
      expect(valid.body.data[0]).not.toHaveProperty("__v");
      expect(valid.body.data[0]).not.toHaveProperty("password");
      expect(valid.body.data[0]).not.toHaveProperty("tokenHash");
    }
    const stocks = await getPage(token, "stocks");
    expect(Object.keys(stocks.body.data[0].productId).sort()).toEqual(
      ["_id", "sku", "name", "unit", "status", "archivedAt"].filter(
        (key) => stocks.body.data[0].productId[key] !== undefined
      ).sort()
    );
    expect(Object.keys(stocks.body.data[0].warehouseId).sort()).toEqual(
      ["_id", "code", "name", "status"].sort()
    );
    expect(productCountSpy).not.toHaveBeenCalled();
    productCountSpy.mockRestore();
  });
});
