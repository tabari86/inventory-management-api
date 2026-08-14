const request = require("supertest");
const jwt = require("jsonwebtoken");

const app = require("../src/app");
const { authenticateUser } = require("../src/middleware/authMiddleware");
const validateRequest = require("../src/middleware/validateRequest");
const IdempotencyRecord = require("../src/models/IdempotencyRecord");
const AuditEvent = require("../src/models/AuditEvent");
const OutboxEvent = require("../src/models/OutboxEvent");
const Product = require("../src/models/Product");
const Stock = require("../src/models/Stock");
const StockMovement = require("../src/models/StockMovement");
const Warehouse = require("../src/models/Warehouse");
const goodsIssueRoutes = require("../src/routes/goodsIssueRoutes");
const goodsReceiptRoutes = require("../src/routes/goodsReceiptRoutes");
const productRoutes = require("../src/routes/productRoutes");
const stockRoutes = require("../src/routes/stockRoutes");
const warehouseRoutes = require("../src/routes/warehouseRoutes");
const {
  mutationOperationRegistry,
} = require("../src/services/inventoryOperationRegistry");
const {
  createAdminToken,
  createManagerToken,
  createViewerToken,
} = require("./helpers/authTestHelper");

require("./setupTestDb");

const mutationMethods = new Set(["post", "patch", "put", "delete"]);
const inventoryRouters = [
  { basePath: "/api/products", router: productRoutes },
  { basePath: "/api/warehouses", router: warehouseRoutes },
  { basePath: "/api/stocks", router: stockRoutes },
  { basePath: "/api/goods-receipts", router: goodsReceiptRoutes },
  { basePath: "/api/goods-issues", router: goodsIssueRoutes },
];

const routeKey = ({ method, path }) => `${method} ${path}`;

const discoverInventoryRoutes = () =>
  inventoryRouters.flatMap(({ basePath, router }) =>
    router.stack
      .filter(({ route }) => route)
      .flatMap(({ route }) => {
        const suffix = route.path === "/" ? "" : route.path;
        const path = `${basePath}${suffix}`.replace(
          /:([^/]+)/g,
          (_, parameter) => `{${parameter}}`
        );
        const handlers = route.stack.map(({ handle }) => handle);

        return Object.entries(route.methods)
          .filter(([, enabled]) => enabled)
          .map(([method]) => ({ method, path, handlers }));
      })
  );

const hasOperationBinding = (handler) =>
  Object.prototype.hasOwnProperty.call(handler, "inventoryOperationId");

const product = (suffix, overrides = {}) =>
  Product.create({
    sku: `COVER-P-${suffix}`,
    name: `Coverage product ${suffix}`,
    ...overrides,
  });

const warehouse = (suffix, overrides = {}) =>
  Warehouse.create({
    code: `COVER-W-${suffix}`,
    name: `Coverage warehouse ${suffix}`,
    ...overrides,
  });

const inventory = async (suffix, quantity = 0) => {
  const currentProduct = await product(suffix);
  const currentWarehouse = await warehouse(suffix);
  const currentStock = await Stock.create({
    productId: currentProduct._id,
    warehouseId: currentWarehouse._id,
    quantity,
  });
  return {
    product: currentProduct,
    warehouse: currentWarehouse,
    stock: currentStock,
  };
};

const clearInventoryCore = async () => {
  await OutboxEvent.deleteMany({});
  await AuditEvent.collection.deleteMany({});
  await StockMovement.deleteMany({});
  await Stock.deleteMany({});
  await Product.deleteMany({});
  await Warehouse.deleteMany({});
};

const expectedEventTypes = (name) =>
  ({
    "Product bulk create": [
      "catalog.product.created",
      "catalog.product.created",
    ],
    "Product bulk update": [
      "catalog.product.updated",
      "catalog.product.updated",
    ],
    "Product bulk archive": [
      "catalog.product.archived",
      "catalog.product.archived",
    ],
    "Product create": ["catalog.product.created"],
    "Product update/reactivate": ["catalog.product.reactivated"],
    "Product deactivate": ["catalog.product.deactivated"],
    "Product archive": ["catalog.product.archived"],
    "Warehouse bulk create": ["warehouse.created", "warehouse.created"],
    "Warehouse bulk update": ["warehouse.updated", "warehouse.updated"],
    "Warehouse create": ["warehouse.created"],
    "Warehouse update/reactivate": ["warehouse.reactivated"],
    "Warehouse deactivate": ["warehouse.deactivated"],
    "Stock bulk create": [
      "inventory.stock.created",
      "inventory.stock.created",
      "catalog.product.stock-linked",
      "catalog.product.stock-linked",
      "warehouse.stock-linked",
    ],
    "Stock create": [
      "inventory.stock.created",
      "catalog.product.stock-linked",
      "warehouse.stock-linked",
    ],
    "Goods Receipt bulk": [
      "inventory.stock.received",
      "inventory.stock.received",
    ],
    "Goods Receipt single": ["inventory.stock.received"],
    "Goods Issue bulk": [
      "inventory.stock.issued",
      "inventory.stock.issued",
    ],
    "Goods Issue single": ["inventory.stock.issued"],
  })[name];

const assertPersistedEventSet = async ({
  expectedTypes,
  requestId,
  actorId,
  idempotency,
}) => {
  const audits = await AuditEvent.find({}).sort({ _id: 1 }).lean();
  const outboxes = await OutboxEvent.find({}).sort({ _id: 1 }).lean();
  expect(audits).toHaveLength(expectedTypes.length);
  expect(outboxes).toHaveLength(expectedTypes.length);
  expect(outboxes.map(({ eventType }) => eventType)).toEqual(expectedTypes);

  for (const audit of audits) {
    const matches = outboxes.filter(
      ({ aggregate }) =>
        aggregate.type === audit.resource.type &&
        aggregate.id === audit.resource.id &&
        aggregate.version === audit.resource.aggregateVersion
    );
    expect(matches).toHaveLength(1);
    expect(audit).toMatchObject({
      actor: { type: "user", id: actorId },
      outcome: "succeeded",
      requestId,
      correlationId: requestId,
      causationId: requestId,
      source: "http-api",
      idempotency,
    });
    expect(matches[0]).toMatchObject({
      requestId,
      correlationId: requestId,
      causationId: requestId,
      source: "http-api",
      idempotency,
    });
    expect(matches[0].occurredAt).toEqual(audit.occurredAt);
  }

  return { audits, outboxes };
};

const buildConflictingBody = (body) => {
  if (Array.isArray(body)) {
    if (Object.prototype.hasOwnProperty.call(body[0], "expectedVersion")) {
      return [
        { ...body[0], expectedVersion: body[0].expectedVersion + 1 },
        ...body.slice(1),
      ];
    }
    if (Object.prototype.hasOwnProperty.call(body[0], "quantity")) {
      return [{ ...body[0], quantity: body[0].quantity + 1 }, ...body.slice(1)];
    }
    if (Object.prototype.hasOwnProperty.call(body[0], "name")) {
      return [{ ...body[0], name: `${body[0].name} changed` }, ...body.slice(1)];
    }
    return [...body].reverse();
  }

  if (Array.isArray(body.items)) {
    return {
      ...body,
      items: [
        { ...body.items[0], expectedVersion: body.items[0].expectedVersion + 1 },
        ...body.items.slice(1),
      ],
    };
  }
  if (Object.prototype.hasOwnProperty.call(body, "quantity")) {
    return { ...body, quantity: body.quantity + 1 };
  }
  if (Object.prototype.hasOwnProperty.call(body, "archiveReason")) {
    return { ...body, archiveReason: `${body.archiveReason} changed` };
  }
  if (Object.prototype.hasOwnProperty.call(body, "deactivationReason")) {
    return { ...body, deactivationReason: `${body.deactivationReason} changed` };
  }
  if (Object.prototype.hasOwnProperty.call(body, "name")) {
    return { ...body, name: `${body.name} changed` };
  }
  if (Object.prototype.hasOwnProperty.call(body, "expectedVersion")) {
    return { ...body, expectedVersion: body.expectedVersion + 1 };
  }
  return { ...body, productId: "64b64c6f2f0f000000000099" };
};

const cases = [
  {
    name: "Product bulk create",
    method: "post",
    path: "/api/products/bulk",
    operationId: "catalog.product.bulk-create.v1",
    status: 201,
    prepare: async () => ({
      body: [
        { sku: "COVER-P-BC-1", name: "Bulk one" },
        { sku: "COVER-P-BC-2", name: "Bulk two" },
      ],
      verify: async () => expect(await Product.countDocuments()).toBe(2),
    }),
  },
  {
    name: "Product bulk update",
    method: "patch",
    path: "/api/products/bulk",
    operationId: "catalog.product.bulk-update.v1",
    status: 200,
    prepare: async () => {
      const products = await Product.create([
        { sku: "COVER-P-BU-1", name: "Before one" },
        { sku: "COVER-P-BU-2", name: "Before two" },
      ]);
      return {
        body: products.map((item, index) => ({
          id: item._id.toString(),
          name: `After ${index + 1}`,
          expectedVersion: item.version,
        })),
        verify: async () => {
          const updated = await Product.find({}).sort({ sku: 1 }).lean();
          expect(updated.map(({ version }) => version)).toEqual([2, 2]);
        },
      };
    },
  },
  {
    name: "Product bulk archive",
    method: "delete",
    path: "/api/products/bulk",
    operationId: "catalog.product.bulk-archive.v1",
    status: 200,
    admin: true,
    prepare: async () => {
      const products = await Product.create([
        { sku: "COVER-P-BA-1", name: "Archive one", status: "inactive" },
        { sku: "COVER-P-BA-2", name: "Archive two", status: "inactive" },
      ]);
      return {
        body: {
          items: products.map(({ _id, version }) => ({
            id: _id.toString(),
            expectedVersion: version,
          })),
        },
        verify: async (response) => {
          expect(response.body.data.deletedCount).toBe(2);
          expect(await Product.countDocuments({ archivedAt: { $ne: null } })).toBe(2);
        },
      };
    },
  },
  {
    name: "Product create",
    method: "post",
    path: "/api/products",
    operationId: "catalog.product.create.v1",
    status: 201,
    prepare: async () => ({
      body: { sku: "COVER-P-C-1", name: "Create" },
      verify: async () => expect(await Product.countDocuments()).toBe(1),
    }),
  },
  {
    name: "Product update/reactivate",
    method: "patch",
    path: ({ product: current }) => `/api/products/${current._id}`,
    operationId: "catalog.product.update.v1",
    status: 200,
    prepare: async () => {
      const current = await product("U-1", { status: "inactive" });
      return {
        context: { product: current },
        body: { status: "active", expectedVersion: 1 },
        verify: async () =>
          expect(await Product.findById(current._id).lean()).toMatchObject({
            status: "active",
            version: 2,
          }),
      };
    },
  },
  {
    name: "Product deactivate",
    method: "patch",
    path: ({ product: current }) => `/api/products/${current._id}/deactivate`,
    operationId: "catalog.product.deactivate.v1",
    status: 200,
    prepare: async () => {
      const current = await product("D-1");
      return {
        context: { product: current },
        body: { expectedVersion: 1, deactivationReason: "  lifecycle  " },
        verify: async () =>
          expect(await Product.findById(current._id).lean()).toMatchObject({
            status: "inactive",
            version: 2,
            deactivationReason: "lifecycle",
          }),
      };
    },
  },
  {
    name: "Product archive",
    method: "delete",
    path: ({ product: current }) => `/api/products/${current._id}`,
    operationId: "catalog.product.archive.v1",
    status: 200,
    admin: true,
    prepare: async () => {
      const current = await product("A-1", { status: "inactive" });
      return {
        context: { product: current },
        body: { expectedVersion: 1, archiveReason: "  retired  " },
        verify: async () => {
          const archived = await Product.findById(current._id).lean();
          expect(archived.version).toBe(2);
          expect(archived.archiveReason).toBe("retired");
          expect(archived.archivedAt).toEqual(expect.any(Date));
        },
      };
    },
  },
  {
    name: "Warehouse bulk create",
    method: "post",
    path: "/api/warehouses/bulk",
    operationId: "warehouse.bulk-create.v1",
    status: 201,
    prepare: async () => ({
      body: [
        { code: "COVER-W-BC-1", name: "Bulk one" },
        { code: "COVER-W-BC-2", name: "Bulk two" },
      ],
      verify: async () => expect(await Warehouse.countDocuments()).toBe(2),
    }),
  },
  {
    name: "Warehouse bulk update",
    method: "patch",
    path: "/api/warehouses/bulk",
    operationId: "warehouse.bulk-update.v1",
    status: 200,
    prepare: async () => {
      const warehouses = await Warehouse.create([
        { code: "COVER-W-BU-1", name: "Before one" },
        { code: "COVER-W-BU-2", name: "Before two" },
      ]);
      return {
        body: warehouses.map((item, index) => ({
          id: item._id.toString(),
          name: `After ${index + 1}`,
          expectedVersion: item.version,
        })),
        verify: async () => {
          const updated = await Warehouse.find({}).sort({ code: 1 }).lean();
          expect(updated.map(({ version }) => version)).toEqual([2, 2]);
        },
      };
    },
  },
  {
    name: "Warehouse create",
    method: "post",
    path: "/api/warehouses",
    operationId: "warehouse.create.v1",
    status: 201,
    prepare: async () => ({
      body: { code: "COVER-W-C-1", name: "Create" },
      verify: async () => expect(await Warehouse.countDocuments()).toBe(1),
    }),
  },
  {
    name: "Warehouse update/reactivate",
    method: "patch",
    path: ({ warehouse: current }) => `/api/warehouses/${current._id}`,
    operationId: "warehouse.update.v1",
    status: 200,
    prepare: async () => {
      const current = await warehouse("U-1", { status: "inactive" });
      return {
        context: { warehouse: current },
        body: { status: "active", expectedVersion: 1 },
        verify: async () =>
          expect(await Warehouse.findById(current._id).lean()).toMatchObject({
            status: "active",
            version: 2,
          }),
      };
    },
  },
  {
    name: "Warehouse deactivate",
    method: "patch",
    path: ({ warehouse: current }) => `/api/warehouses/${current._id}/deactivate`,
    operationId: "warehouse.deactivate.v1",
    status: 200,
    prepare: async () => {
      const current = await warehouse("D-1");
      return {
        context: { warehouse: current },
        body: { expectedVersion: 1, deactivationReason: "  lifecycle  " },
        verify: async () =>
          expect(await Warehouse.findById(current._id).lean()).toMatchObject({
            status: "inactive",
            version: 2,
            deactivationReason: "lifecycle",
          }),
      };
    },
  },
  {
    name: "Stock bulk create",
    method: "post",
    path: "/api/stocks/bulk",
    operationId: "inventory.stock.bulk-create.v1",
    status: 201,
    prepare: async () => {
      const products = await Product.create([
        { sku: "COVER-S-BC-1", name: "One" },
        { sku: "COVER-S-BC-2", name: "Two" },
      ]);
      const currentWarehouse = await warehouse("S-BC");
      return {
        body: products.map(({ _id }) => ({
          productId: _id.toString(),
          warehouseId: currentWarehouse._id.toString(),
        })),
        verify: async () => {
          expect(await Stock.countDocuments()).toBe(2);
          expect((await Warehouse.findById(currentWarehouse._id)).version).toBe(2);
        },
      };
    },
  },
  {
    name: "Stock create",
    method: "post",
    path: "/api/stocks",
    operationId: "inventory.stock.create.v1",
    status: 201,
    prepare: async () => {
      const currentProduct = await product("S-C");
      const currentWarehouse = await warehouse("S-C");
      return {
        body: {
          productId: currentProduct._id.toString(),
          warehouseId: currentWarehouse._id.toString(),
        },
        verify: async () => {
          expect(await Stock.countDocuments()).toBe(1);
          expect((await Product.findById(currentProduct._id)).version).toBe(2);
          expect((await Warehouse.findById(currentWarehouse._id)).version).toBe(2);
        },
      };
    },
  },
  {
    name: "Goods Receipt bulk",
    method: "post",
    path: "/api/goods-receipts/bulk",
    operationId: "inventory.goods-receipt.bulk.v1",
    status: 201,
    prepare: async () => {
      const { stock } = await inventory("GR-B");
      return {
        body: [
          { stockId: stock._id.toString(), quantity: 2, reference: "A" },
          { stockId: stock._id.toString(), quantity: 3, reference: "B" },
        ],
        verify: async () => {
          expect((await Stock.findById(stock._id)).quantity).toBe(5);
          expect(await StockMovement.countDocuments()).toBe(2);
        },
      };
    },
  },
  {
    name: "Goods Receipt single",
    method: "post",
    path: "/api/goods-receipts",
    operationId: "inventory.goods-receipt.single.v1",
    status: 201,
    prepare: async () => {
      const { stock } = await inventory("GR-S");
      return {
        body: { stockId: stock._id.toString(), quantity: 5, reference: "PO-5" },
        verify: async () => {
          expect((await Stock.findById(stock._id)).quantity).toBe(5);
          expect(await StockMovement.countDocuments()).toBe(1);
        },
      };
    },
  },
  {
    name: "Goods Issue bulk",
    method: "post",
    path: "/api/goods-issues/bulk",
    operationId: "inventory.goods-issue.bulk.v1",
    status: 201,
    prepare: async () => {
      const { stock } = await inventory("GI-B", 10);
      return {
        body: [
          { stockId: stock._id.toString(), quantity: 2, reference: "A" },
          { stockId: stock._id.toString(), quantity: 3, reference: "B" },
        ],
        verify: async () => {
          expect((await Stock.findById(stock._id)).quantity).toBe(5);
          expect(await StockMovement.countDocuments()).toBe(2);
        },
      };
    },
  },
  {
    name: "Goods Issue single",
    method: "post",
    path: "/api/goods-issues",
    operationId: "inventory.goods-issue.single.v1",
    status: 201,
    prepare: async () => {
      const { stock } = await inventory("GI-S", 10);
      return {
        body: { stockId: stock._id.toString(), quantity: 4, reference: "SO-4" },
        verify: async () => {
          expect((await Stock.findById(stock._id)).quantity).toBe(6);
          expect(await StockMovement.countDocuments()).toBe(1);
        },
      };
    },
  },
];

describe("idempotency mutation coverage", () => {
  beforeEach(async () => {
    await IdempotencyRecord.createIndexes();
  });

  it("binds every actual Inventory Core mutation exactly once and maps no nonexistent route", () => {
    const discovered = discoverInventoryRoutes();
    const mutations = discovered.filter(({ method }) =>
      mutationMethods.has(method)
    );
    const registryByRoute = new Map(
      mutationOperationRegistry.map((entry) => [routeKey(entry), entry])
    );
    const mutationKeys = mutations.map(routeKey);
    const registryKeys = mutationOperationRegistry.map(routeKey);

    expect(new Set(mutationKeys).size).toBe(mutations.length);
    expect(registryByRoute.size).toBe(mutationOperationRegistry.length);
    expect([...mutationKeys].sort()).toEqual([...registryKeys].sort());

    const discoveredOperationIds = [];
    for (const mutation of mutations) {
      const bindings = mutation.handlers.filter(hasOperationBinding);
      const registryEntry = registryByRoute.get(routeKey(mutation));

      expect(bindings).toHaveLength(1);
      expect(registryEntry).toBeDefined();
      expect(bindings[0].inventoryOperationId).toBe(registryEntry.operationId);
      expect(Object.getOwnPropertyDescriptor(bindings[0], "inventoryOperationId"))
        .toMatchObject({
          value: registryEntry.operationId,
          writable: false,
          configurable: false,
          enumerable: true,
        });
      discoveredOperationIds.push(bindings[0].inventoryOperationId);
    }

    expect(new Set(discoveredOperationIds).size).toBe(mutations.length);
    expect(new Set(mutationOperationRegistry.map(({ operationId }) => operationId)).size)
      .toBe(mutationOperationRegistry.length);

    for (const route of discovered.filter(({ method }) => method === "get")) {
      expect(route.handlers.filter(hasOperationBinding)).toHaveLength(0);
    }

    const caseEntries = cases.map(({ method, path, operationId }) => ({
      method,
      path:
        typeof path === "string"
          ? path
          : path({
              product: { _id: "{id}" },
              warehouse: { _id: "{id}" },
            }),
      operationId,
    }));
    expect(caseEntries.map(routeKey).sort()).toEqual([...mutationKeys].sort());
    for (const entry of caseEntries) {
      expect(registryByRoute.get(routeKey(entry)).operationId).toBe(
        entry.operationId
      );
    }
  });

  it("keeps authorization, validation, binding, and controller order on every mutation", () => {
    const mutations = discoverInventoryRoutes().filter(({ method }) =>
      mutationMethods.has(method)
    );

    for (const { handlers } of mutations) {
      const bindingIndex = handlers.findIndex(hasOperationBinding);
      const validateRequestIndexes = handlers
        .map((handler, index) => (handler === validateRequest ? index : -1))
        .filter((index) => index >= 0);
      const response = {
        status: jest.fn(),
        json: jest.fn(),
      };
      response.status.mockReturnValue(response);
      const next = jest.fn();

      expect(handlers[0]).toBe(authenticateUser);
      handlers[1]({ user: { role: "viewer" } }, response, next);
      expect(response.status).toHaveBeenCalledWith(403);
      expect(response.json).toHaveBeenCalledWith({ message: "Access denied" });
      expect(next).not.toHaveBeenCalled();
      expect(validateRequestIndexes).toHaveLength(1);
      expect(validateRequestIndexes[0]).toBeGreaterThan(2);
      expect(bindingIndex).toBe(validateRequestIndexes[0] + 1);
      expect(bindingIndex).toBe(handlers.length - 2);
      expect(hasOperationBinding(handlers.at(-1))).toBe(false);
    }
  });

  it.each(cases)(
    "$name preserves the first response and replays without another mutation",
    async ({ name, method, path, operationId, status, admin, prepare }) => {
      const token = admin ? await createAdminToken() : await createManagerToken();
      const baselineFixture = await prepare();
      const baselinePath =
        typeof path === "function" ? path(baselineFixture.context) : path;
      const baseline = await request(app)
        [method](baselinePath)
        .set("Authorization", `Bearer ${token}`)
        .send(baselineFixture.body);

      expect(baseline.status).toBe(status);
      expect(baseline.headers["idempotency-replayed"]).toBeUndefined();
      expect(await IdempotencyRecord.countDocuments()).toBe(0);
      const actorId = jwt.decode(token).userId.toString();
      await assertPersistedEventSet({
        expectedTypes: expectedEventTypes(name),
        requestId: baseline.headers["x-request-id"],
        actorId,
        idempotency: null,
      });
      expect(JSON.stringify(baseline.body)).not.toMatch(
        /auditEventId|eventId|eventType|payloadSchemaVersion/
      );
      await baselineFixture.verify(baseline);
      await clearInventoryCore();

      const fixture = await prepare();
      const requestPath = typeof path === "function" ? path(fixture.context) : path;
      const key = `coverage.${operationId}`;

      const original = await request(app)
        [method](requestPath)
        .set("Authorization", `Bearer ${token}`)
        .set("Idempotency-Key", key)
        .send(fixture.body);
      const replay = await request(app)
        [method](requestPath)
        .set("Authorization", `Bearer ${token}`)
        .set("Idempotency-Key", key)
        .send(fixture.body);
      const conflict = await request(app)
        [method](requestPath)
        .set("Authorization", `Bearer ${token}`)
        .set("Idempotency-Key", key)
        .send(buildConflictingBody(fixture.body));
      const viewerToken = await createViewerToken();
      const deniedReplay = await request(app)
        [method](requestPath)
        .set("Authorization", `Bearer ${viewerToken}`)
        .set("Idempotency-Key", key)
        .send(fixture.body);

      expect(original.status).toBe(status);
      const committedEventTypes = expectedEventTypes(name);
      const committedEventCount = committedEventTypes.length;
      const idempotencyRecord = await IdempotencyRecord.findOne({ operationId })
        .lean();
      const eventSet = await assertPersistedEventSet({
        expectedTypes: committedEventTypes,
        requestId: original.headers["x-request-id"],
        actorId,
        idempotency: {
          recordId: idempotencyRecord._id.toString(),
          keyHash: idempotencyRecord.keyHash,
        },
      });
      expect(JSON.stringify(eventSet)).not.toContain(key);
      expect(JSON.stringify(original.body)).not.toMatch(
        /auditEventId|eventId|eventType|payloadSchemaVersion/
      );
      expect(original.body.message).toBe(baseline.body.message);
      expect(replay.status).toBe(status);
      expect(original.headers["idempotency-replayed"]).toBe("false");
      expect(replay.headers["idempotency-replayed"]).toBe("true");
      expect(replay.body).toEqual(original.body);
      expect(conflict.status).toBe(409);
      expect(conflict.body).toEqual({
        message: "Idempotency key was already used with a different request",
      });
      expect(deniedReplay.status).toBe(403);
      expect(deniedReplay.headers["idempotency-replayed"]).toBeUndefined();
      expect(await IdempotencyRecord.countDocuments({ operationId })).toBe(1);
      expect(await IdempotencyRecord.countDocuments({ state: "processing" })).toBe(0);
      expect(await AuditEvent.countDocuments()).toBe(committedEventCount);
      expect(await OutboxEvent.countDocuments()).toBe(committedEventCount);
      await fixture.verify(original);
    }
  );
});
