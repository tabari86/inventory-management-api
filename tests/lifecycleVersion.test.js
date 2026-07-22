const mongoose = require("mongoose");
const request = require("supertest");

const app = require("../src/app");
const Product = require("../src/models/Product");
const Stock = require("../src/models/Stock");
const StockMovement = require("../src/models/StockMovement");
const Warehouse = require("../src/models/Warehouse");
const inventoryService = require("../src/services/inventoryService");
const productService = require("../src/services/productService");
const stockService = require("../src/services/stockService");
const warehouseService = require("../src/services/warehouseService");
const {
  createAdminToken,
  createManagerToken,
} = require("./helpers/authTestHelper");

require("./setupTestDb");

let sequence = 0;

const createInventory = async ({ quantity = 10 } = {}) => {
  sequence += 1;
  const product = await Product.create({
    sku: `LIFECYCLE-${sequence}`,
    name: `Lifecycle Product ${sequence}`,
  });
  const warehouse = await Warehouse.create({
    code: `LIFE-WH-${sequence}`,
    name: `Lifecycle Warehouse ${sequence}`,
  });
  const stock = await Stock.create({
    productId: product._id,
    warehouseId: warehouse._id,
    quantity,
  });

  return { product, warehouse, stock };
};

describe("Lifecycle and explicit aggregate versions", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("starts aggregates at version 1 and avoids false Product revisions", async () => {
    const { product } = await createInventory();
    expect(product.version).toBe(1);

    const updated = await productService.updateProduct({
      productId: product._id,
      update: { name: "Meaningfully Updated" },
    });
    expect(updated.version).toBe(2);

    const unchanged = await productService.updateProduct({
      productId: product._id,
      update: { name: "Meaningfully Updated", expectedVersion: 2 },
    });
    expect(unchanged.version).toBe(2);
    expect((await Product.findById(product._id)).version).toBe(2);
  });

  it("deactivates and reactivates Product with metadata and synchronized guards", async () => {
    const { product, stock } = await createInventory();
    const actorId = new mongoose.Types.ObjectId();

    const deactivated = await productService.deactivateProduct({
      productId: product._id,
      actorId,
      expectedVersion: 1,
      deactivationReason: "  lifecycle test  ",
    });
    expect(deactivated).toMatchObject({
      status: "inactive",
      version: 2,
      deactivationReason: "lifecycle test",
    });
    expect(deactivated.deactivatedAt).toEqual(expect.any(Date));
    expect(deactivated.deactivatedBy).toEqual(actorId);

    let guardedStock = await Stock.findById(stock._id);
    expect(guardedStock).toMatchObject({
      status: "active",
      productLifecycleStatus: "inactive",
      version: 2,
    });

    const repeated = await productService.deactivateProduct({
      productId: product._id,
      actorId,
      expectedVersion: 2,
      deactivationReason: "ignored no-op reason",
    });
    expect(repeated.version).toBe(2);
    expect((await Stock.findById(stock._id)).version).toBe(2);

    const reactivated = await productService.updateProduct({
      productId: product._id,
      actorId,
      update: { status: "active", expectedVersion: 2 },
    });
    expect(reactivated.status).toBe("active");
    expect(reactivated.version).toBe(3);
    expect(reactivated.deactivatedAt).toBeUndefined();
    expect(reactivated.deactivatedBy).toBeUndefined();
    expect(reactivated.deactivationReason).toBeUndefined();

    guardedStock = await Stock.findById(stock._id);
    expect(guardedStock).toMatchObject({
      status: "active",
      productLifecycleStatus: "active",
      version: 3,
    });
  });

  it("uses legacy Product DELETE as archive while preserving references and contract", async () => {
    const adminToken = await createAdminToken();
    const { product, warehouse, stock } = await createInventory();

    await inventoryService.createGoodsReceipt({
      stockId: stock._id.toString(),
      quantity: 2,
      reference: "ARCHIVE-HISTORY",
    });
    const deactivated = await productService.deactivateProduct({
      productId: product._id,
      expectedVersion: 1,
    });

    const response = await request(app)
      .delete(`/api/products/${product._id}`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ expectedVersion: deactivated.version, archiveReason: "Obsolete" });

    expect(response.statusCode).toBe(200);
    expect(response.body).toEqual({ message: "Product deleted successfully" });

    const archived = await Product.findById(product._id);
    expect(archived).toMatchObject({
      status: "inactive",
      archiveReason: "Obsolete",
      version: 3,
    });
    expect(archived.archivedAt).toEqual(expect.any(Date));
    expect(archived.archivedBy).toBeDefined();

    const normalGet = await request(app)
      .get(`/api/products/${product._id}`)
      .set("Authorization", `Bearer ${adminToken}`);
    expect(normalGet.statusCode).toBe(404);
    const normalList = await request(app)
      .get("/api/products")
      .set("Authorization", `Bearer ${adminToken}`);
    expect(
      normalList.body.data.some(({ _id }) => _id === product._id.toString())
    ).toBe(false);

    const populatedStock = await Stock.findById(stock._id).populate("productId");
    expect(populatedStock.productId._id).toEqual(product._id);
    expect(populatedStock.productLifecycleStatus).toBe("archived");
    expect(populatedStock.status).toBe("active");

    const movement = await StockMovement.findOne({ stockId: stock._id });
    expect(movement.productId).toEqual(product._id);
    expect(movement.warehouseId).toEqual(warehouse._id);
    expect(movement.productSnapshot.name).toBe(product.name);

    const duplicateSku = await request(app)
      .post("/api/products")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ sku: product.sku, name: "Attempted Reuse" });
    expect(duplicateSku.statusCode).toBe(409);

    const updateArchived = await request(app)
      .patch(`/api/products/${product._id}`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ status: "active" });
    expect(updateArchived.statusCode).toBe(404);
  });

  it("archives a Product bulk atomically and keeps deletedCount as compatibility data", async () => {
    const adminToken = await createAdminToken();
    const products = await Product.create([
      { sku: "BULK-ARCHIVE-1", name: "Bulk Archive One", status: "inactive" },
      { sku: "BULK-ARCHIVE-2", name: "Bulk Archive Two", status: "inactive" },
    ]);

    const missingId = new mongoose.Types.ObjectId();
    const rejected = await request(app)
      .delete("/api/products/bulk")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ ids: [products[0]._id.toString(), missingId.toString()] });
    expect(rejected.statusCode).toBe(404);
    expect(await Product.countDocuments({ archivedAt: { $ne: null } })).toBe(0);

    const accepted = await request(app)
      .delete("/api/products/bulk")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ ids: products.map((product) => product._id.toString()) });
    expect(accepted.statusCode).toBe(200);
    expect(accepted.body.data).toEqual({ deletedCount: 2 });
    expect(await Product.countDocuments()).toBe(2);
    expect(await Product.countDocuments({ archivedAt: { $ne: null } })).toBe(2);
  });

  it("does not invoke Product physical-delete APIs for legacy DELETE", async () => {
    const adminToken = await createAdminToken();
    const product = await Product.create({
      sku: "NO-PHYSICAL-DELETE",
      name: "No Physical Delete",
      status: "inactive",
    });
    const deleteManySpy = jest.spyOn(Product, "deleteMany");
    const documentDeleteSpy = jest.spyOn(Product.prototype, "deleteOne");

    const response = await request(app)
      .delete(`/api/products/${product._id}`)
      .set("Authorization", `Bearer ${adminToken}`);

    expect(response.statusCode).toBe(200);
    expect(deleteManySpy).not.toHaveBeenCalled();
    expect(documentDeleteSpy).not.toHaveBeenCalled();
    expect(await Product.findById(product._id)).not.toBeNull();
    deleteManySpy.mockRestore();
    documentDeleteSpy.mockRestore();
  });

  it("returns a stable 409 for stale Product versions without committing changes", async () => {
    const managerToken = await createManagerToken();
    const { product, stock } = await createInventory();

    const response = await request(app)
      .patch(`/api/products/${product._id}`)
      .set("Authorization", `Bearer ${managerToken}`)
      .send({ name: "Must Not Commit", expectedVersion: 99 });

    expect(response.statusCode).toBe(409);
    expect(response.body).toEqual({ message: "Resource version conflict" });
    expect(await Product.findById(product._id)).toMatchObject({
      name: product.name,
      version: 1,
    });
    expect((await Stock.findById(stock._id)).version).toBe(1);
  });

  it("rolls back an entire bulk Product update when one expectedVersion is stale", async () => {
    const products = await Product.create([
      { sku: "CAS-BULK-1", name: "Original One" },
      { sku: "CAS-BULK-2", name: "Original Two" },
    ]);

    await expect(
      productService.updateProductsBulk({
        updates: [
          { id: products[0]._id.toString(), name: "Changed", expectedVersion: 1 },
          { id: products[1]._id.toString(), name: "Rejected", expectedVersion: 9 },
        ],
      })
    ).rejects.toMatchObject({
      code: "STALE_VERSION",
      httpStatus: 409,
      message: "Resource version conflict",
    });

    const persisted = await Product.find({}).sort({ sku: 1 });
    expect(persisted.map(({ name, version }) => ({ name, version }))).toEqual([
      { name: "Original One", version: 1 },
      { name: "Original Two", version: 1 },
    ]);
  });

  it("versions Warehouse lifecycle transitions and preserves its own Stock status", async () => {
    const { warehouse, stock } = await createInventory();
    const actorId = new mongoose.Types.ObjectId();

    const updated = await warehouseService.updateWarehouse({
      warehouseId: warehouse._id,
      update: { name: "Updated Warehouse", expectedVersion: 1 },
    });
    expect(updated.version).toBe(2);

    const deactivated = await warehouseService.deactivateWarehouse({
      warehouseId: warehouse._id,
      actorId,
      expectedVersion: 2,
      deactivationReason: "Maintenance",
    });
    expect(deactivated).toMatchObject({
      status: "inactive",
      version: 3,
      deactivationReason: "Maintenance",
    });
    expect(deactivated.deactivatedAt).toEqual(expect.any(Date));

    const repeated = await warehouseService.deactivateWarehouse({
      warehouseId: warehouse._id,
      expectedVersion: 3,
    });
    expect(repeated.version).toBe(3);

    const reactivated = await warehouseService.updateWarehouse({
      warehouseId: warehouse._id,
      update: { status: "active", expectedVersion: 3 },
    });
    expect(reactivated.version).toBe(4);
    expect(reactivated.deactivatedAt).toBeUndefined();

    const guardedStock = await Stock.findById(stock._id);
    expect(guardedStock).toMatchObject({
      status: "active",
      warehouseLifecycleStatus: "active",
      version: 3,
    });
  });

  it("supports matching and stale expectedVersion on legacy Warehouse PATCH", async () => {
    const managerToken = await createManagerToken();
    const { warehouse } = await createInventory();

    const accepted = await request(app)
      .patch(`/api/warehouses/${warehouse._id}`)
      .set("Authorization", `Bearer ${managerToken}`)
      .send({ name: "Versioned Warehouse", expectedVersion: 1 });
    expect(accepted.statusCode).toBe(200);
    expect(accepted.body.data.version).toBe(2);

    const rejected = await request(app)
      .patch(`/api/warehouses/${warehouse._id}`)
      .set("Authorization", `Bearer ${managerToken}`)
      .send({ name: "Must Not Commit", expectedVersion: 1 });
    expect(rejected.statusCode).toBe(409);
    expect(rejected.body).toEqual({ message: "Resource version conflict" });
    expect(await Warehouse.findById(warehouse._id)).toMatchObject({
      name: "Versioned Warehouse",
      version: 2,
    });
  });

  it.each(["Product", "Warehouse"])(
    "rolls back %s lifecycle and versions when Stock guard propagation fails",
    async (parentType) => {
      const { product, warehouse, stock } = await createInventory();
      const propagationError = new Error("simulated guard propagation failure");
      jest.spyOn(Stock, "updateMany").mockRejectedValueOnce(propagationError);

      const lifecycleMutation =
        parentType === "Product"
          ? productService.deactivateProduct({ productId: product._id })
          : warehouseService.deactivateWarehouse({ warehouseId: warehouse._id });

      await expect(lifecycleMutation).rejects.toBe(propagationError);

      const parent =
        parentType === "Product"
          ? await Product.findById(product._id)
          : await Warehouse.findById(warehouse._id);
      const persistedStock = await Stock.findById(stock._id);
      expect(parent).toMatchObject({ status: "active", version: 1 });
      expect(persistedStock).toMatchObject({
        version: 1,
        productLifecycleStatus: "active",
        warehouseLifecycleStatus: "active",
      });
    }
  );

  it.each([
    ["Product", "receipt"],
    ["Product", "issue"],
    ["Warehouse", "receipt"],
    ["Warehouse", "issue"],
  ])(
    "keeps final state consistent when %s deactivation races with %s",
    async (parentType, operation) => {
      const { product, warehouse, stock } = await createInventory();
      const inventoryMutation =
        operation === "receipt"
          ? inventoryService.createGoodsReceipt({
              stockId: stock._id.toString(),
              quantity: 2,
              reference: `${parentType}-${operation}`,
            })
          : inventoryService.createGoodsIssue({
              stockId: stock._id.toString(),
              quantity: 2,
              reference: `${parentType}-${operation}`,
            });
      const lifecycleMutation =
        parentType === "Product"
          ? productService.deactivateProduct({ productId: product._id })
          : warehouseService.deactivateWarehouse({ warehouseId: warehouse._id });

      const [inventoryResult] = await Promise.allSettled([
        inventoryMutation,
        lifecycleMutation,
      ]);
      const finalStock = await Stock.findById(stock._id);
      const movementCount = await StockMovement.countDocuments({
        stockId: stock._id,
      });

      expect(
        parentType === "Product"
          ? finalStock.productLifecycleStatus
          : finalStock.warehouseLifecycleStatus
      ).toBe("inactive");
      expect(finalStock.quantity).toBe(
        inventoryResult.status === "fulfilled"
          ? operation === "receipt"
            ? 12
            : 8
          : 10
      );
      expect(movementCount).toBe(inventoryResult.status === "fulfilled" ? 1 : 0);
      expect(finalStock.quantity).toBeGreaterThanOrEqual(0);
    }
  );

  it.each(["Product", "Warehouse"])(
    "keeps Stock creation consistent when %s deactivation races",
    async (parentType) => {
      sequence += 1;
      const product = await Product.create({
        sku: `CREATE-RACE-${sequence}`,
        name: "Create Race Product",
      });
      const warehouse = await Warehouse.create({
        code: `CREATE-RACE-WH-${sequence}`,
        name: "Create Race Warehouse",
      });

      const createResult = stockService.createStock({
        productId: product._id,
        warehouseId: warehouse._id,
      });
      const lifecycleResult =
        parentType === "Product"
          ? productService.deactivateProduct({ productId: product._id })
          : warehouseService.deactivateWarehouse({ warehouseId: warehouse._id });

      await Promise.allSettled([createResult, lifecycleResult]);

      const finalStock = await Stock.findOne({
        productId: product._id,
        warehouseId: warehouse._id,
      });
      const finalParent =
        parentType === "Product"
          ? await Product.findById(product._id)
          : await Warehouse.findById(warehouse._id);

      expect(finalParent.status).toBe("inactive");
      if (finalStock) {
        expect(
          parentType === "Product"
            ? finalStock.productLifecycleStatus
            : finalStock.warehouseLifecycleStatus
        ).toBe("inactive");
      }
    }
  );
});
