const request = require("supertest");

const app = require("../src/app");
const Product = require("../src/models/Product");
const Stock = require("../src/models/Stock");
const Warehouse = require("../src/models/Warehouse");
const {
  createAdminToken,
  createManagerToken,
  createViewerToken,
} = require("./helpers/authTestHelper");

require("./setupTestDb");

const captureProductAndStockState = async () => ({
  products: await Product.find({}).sort({ _id: 1 }).lean(),
  stocks: await Stock.find({}).sort({ _id: 1 }).lean(),
});

const createRelatedStocks = async (products, code) => {
  const warehouse = await Warehouse.create({
    code,
    name: `${code} Warehouse`,
  });

  return Stock.create(
    products.map((product) => ({
      productId: product._id,
      warehouseId: warehouse._id,
    }))
  );
};

const createSkuOwnershipFixture = async (prefix) => {
  const products = await Product.create([
    { sku: `${prefix}-A`, name: `${prefix} Product A` },
    { sku: `${prefix}-B`, name: `${prefix} Product B` },
  ]);
  const stocks = await createRelatedStocks(products, `${prefix}-WH`);

  return { products, stocks };
};

describe("Product API", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("allows authenticated viewers to retrieve products", async () => {
    const viewerToken = await createViewerToken();
    const response = await request(app)
      .get("/api/products")
      .set("Authorization", `Bearer ${viewerToken}`);

    expect(response.statusCode).toBe(200);
    expect(response.body.message).toBe("Products retrieved successfully");
    expect(Array.isArray(response.body.data)).toBe(true);
  });

  it("rejects unauthenticated product creation", async () => {
    const response = await request(app)
      .post("/api/products")
      .send({ sku: "UNAUTH-001", name: "Unauthorized Product" });

    expect(response.statusCode).toBe(401);
  });

  it("rejects product creation by a viewer", async () => {
    const viewerToken = await createViewerToken();
    const response = await request(app)
      .post("/api/products")
      .set("Authorization", `Bearer ${viewerToken}`)
      .send({ sku: "VIEWER-001", name: "Viewer Product" });

    expect(response.statusCode).toBe(403);
  });

  it("allows a manager to create a product", async () => {
    const managerToken = await createManagerToken();
    const response = await request(app)
      .post("/api/products")
      .set("Authorization", `Bearer ${managerToken}`)
      .send({
        sku: "TEST-PRODUCT-001",
        name: "Test Product",
        description: "Product created during automated test",
        unit: "piece",
      });

    expect(response.statusCode).toBe(201);
    expect(response.body.message).toBe("Product created successfully");
    expect(response.body.data.sku).toBe("TEST-PRODUCT-001");
    expect(response.body.data.status).toBe("active");
  });

  it("keeps validation after authorization", async () => {
    const managerToken = await createManagerToken();
    const response = await request(app)
      .post("/api/products")
      .set("Authorization", `Bearer ${managerToken}`)
      .send({});

    expect(response.statusCode).toBe(400);
    expect(response.body.message).toBe("Validation failed");
    expect(response.body.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ field: "sku", message: "SKU is required" }),
        expect.objectContaining({
          field: "name",
          message: "Product name is required",
        }),
      ])
    );
  });

  it("allows only an admin to delete an inactive product", async () => {
    const [adminToken, managerToken] = await Promise.all([
      createAdminToken(),
      createManagerToken(),
    ]);
    const product = await Product.create({
      sku: "DELETE-001",
      name: "Inactive Product",
      status: "inactive",
    });

    const managerResponse = await request(app)
      .delete(`/api/products/${product._id}`)
      .set("Authorization", `Bearer ${managerToken}`);
    expect(managerResponse.statusCode).toBe(403);

    const adminResponse = await request(app)
      .delete(`/api/products/${product._id}`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ expectedVersion: product.version });
    expect(adminResponse.statusCode).toBe(200);
    const archivedProduct = await Product.findById(product._id);
    expect(archivedProduct).not.toBeNull();
    expect(archivedProduct.status).toBe("inactive");
    expect(archivedProduct.archivedAt).toEqual(expect.any(Date));
  });

  it("keeps the legacy active Product archive conflict message", async () => {
    const adminToken = await createAdminToken();
    const product = await Product.create({
      sku: "ACTIVE-SINGLE-ARCHIVE",
      name: "Active Single Archive",
    });

    const response = await request(app)
      .delete(`/api/products/${product._id}`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ expectedVersion: product.version });

    expect(response.statusCode).toBe(409);
    expect(response.body).toEqual({
      message: "Active products must be deactivated before deletion",
    });
  });

  it("uses INVALID_RESOURCE_STATE for an active Product archive in v1", async () => {
    const adminToken = await createAdminToken();
    const product = await Product.create({
      sku: "ACTIVE-SINGLE-ARCHIVE-V1",
      name: "Active Single Archive V1",
    });

    const response = await request(app)
      .delete(`/api/v1/products/${product._id}`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ expectedVersion: product.version });

    expect(response.statusCode).toBe(409);
    expect(response.body).toMatchObject({
      title: "Invalid resource state",
      code: "INVALID_RESOURCE_STATE",
      detail: "Active products must be deactivated before deletion",
    });
  });

  it("bulk creates products for a manager", async () => {
    const managerToken = await createManagerToken();
    const response = await request(app)
      .post("/api/products/bulk")
      .set("Authorization", `Bearer ${managerToken}`)
      .send([
        { sku: "BULK-001", name: "Bulk Product One" },
        { sku: "BULK-002", name: "Bulk Product Two", unit: "kg" },
      ]);

    expect(response.statusCode).toBe(201);
    expect(response.body.data.createdCount).toBe(2);
    expect(await Product.countDocuments()).toBe(2);
  });

  it("rejects duplicate SKUs inside bulk create without partial data", async () => {
    const managerToken = await createManagerToken();
    const response = await request(app)
      .post("/api/products/bulk")
      .set("Authorization", `Bearer ${managerToken}`)
      .send([
        { sku: "DUPLICATE-001", name: "First Product" },
        { sku: "DUPLICATE-001", name: "Second Product" },
      ]);

    expect(response.statusCode).toBe(400);
    expect(await Product.countDocuments()).toBe(0);
  });

  it("rejects an existing SKU in bulk create", async () => {
    const managerToken = await createManagerToken();
    await Product.create({ sku: "EXISTING-001", name: "Existing Product" });

    const response = await request(app)
      .post("/api/products/bulk")
      .set("Authorization", `Bearer ${managerToken}`)
      .send([
        { sku: "NEW-001", name: "New Product" },
        { sku: "EXISTING-001", name: "Duplicate Product" },
      ]);

    expect(response.statusCode).toBe(409);
    expect(await Product.findOne({ sku: "NEW-001" })).toBeNull();
  });

  it("bulk updates products for a manager", async () => {
    const managerToken = await createManagerToken();
    const products = await Product.create([
      { sku: "UPDATE-001", name: "Original One" },
      { sku: "UPDATE-002", name: "Original Two" },
    ]);

    const response = await request(app)
      .patch("/api/products/bulk")
      .set("Authorization", `Bearer ${managerToken}`)
      .send([
        {
          id: products[0]._id.toString(),
          name: "Updated One",
          expectedVersion: products[0].version,
        },
        {
          id: products[1]._id.toString(),
          status: "inactive",
          expectedVersion: products[1].version,
        },
      ]);

    expect(response.statusCode).toBe(200);
    expect(response.body.message).toBe("Products updated successfully");
    expect(response.body.data.updatedCount).toBe(2);
    expect(await Product.findById(products[0]._id)).toMatchObject({
      name: "Updated One",
      version: 2,
    });
    expect(await Product.findById(products[1]._id)).toMatchObject({
      status: "inactive",
      version: 2,
    });
  });

  it("keeps duplicate explicitly submitted bulk SKUs as a 400 with no writes", async () => {
    const managerToken = await createManagerToken();
    const products = await Product.create([
      { sku: "EXPLICIT-DUPLICATE-1", name: "Explicit Duplicate One" },
      { sku: "EXPLICIT-DUPLICATE-2", name: "Explicit Duplicate Two" },
    ]);
    await createRelatedStocks(products, "EXPLICIT-DUPLICATE-WH");
    const before = await captureProductAndStockState();

    const response = await request(app)
      .patch("/api/products/bulk")
      .set("Authorization", `Bearer ${managerToken}`)
      .send([
        {
          id: products[0]._id.toString(),
          sku: "SHARED-TARGET",
          status: "inactive",
          expectedVersion: products[0].version,
        },
        {
          id: products[1]._id.toString(),
          sku: "SHARED-TARGET",
          name: "Must Not Commit",
          expectedVersion: products[1].version,
        },
      ]);

    expect(response.statusCode).toBe(400);
    expect(response.body).toEqual({
      message: "Duplicate SKUs are not allowed in the same request",
    });
    expect(await captureProductAndStockState()).toEqual(before);
  });

  it("returns the baseline 409 when a selected Product retains the requested SKU", async () => {
    const managerToken = await createManagerToken();
    const products = await Product.create([
      { sku: "RETAINED-OWNER-1", name: "Retained Owner One" },
      { sku: "RETAINED-OWNER-2", name: "Retained Owner Two" },
    ]);
    const warehouse = await Warehouse.create({
      code: "RETAINED-OWNER-WH",
      name: "Retained Owner Warehouse",
    });
    const stock = await Stock.create({
      productId: products[0]._id,
      warehouseId: warehouse._id,
    });
    const before = await captureProductAndStockState();

    const response = await request(app)
      .patch("/api/products/bulk")
      .set("Authorization", `Bearer ${managerToken}`)
      .send([
        {
          id: products[0]._id.toString(),
          sku: products[1].sku,
          status: "inactive",
          expectedVersion: products[0].version,
        },
        {
          id: products[1]._id.toString(),
          name: "Must Not Commit",
          expectedVersion: products[1].version,
        },
      ]);

    expect(response.statusCode).toBe(409);
    expect(response.body).toEqual({
      message: "One or more product SKUs already exist",
    });
    expect(await captureProductAndStockState()).toEqual(before);
    expect(await Stock.findById(stock._id)).toMatchObject({
      productLifecycleStatus: "active",
      version: 1,
    });
  });

  it("returns 409 when a bulk SKU collides with an unselected Product", async () => {
    const managerToken = await createManagerToken();
    const [selectedProduct, unselectedProduct] = await Product.create([
      { sku: "SELECTED-OWNER", name: "Selected Product" },
      { sku: "UNSELECTED-OWNER", name: "Unselected Product" },
    ]);
    await createRelatedStocks([selectedProduct], "UNSELECTED-OWNER-WH");
    const before = await captureProductAndStockState();

    const response = await request(app)
      .patch("/api/products/bulk")
      .set("Authorization", `Bearer ${managerToken}`)
      .send([
        {
          id: selectedProduct._id.toString(),
          sku: unselectedProduct.sku,
          name: "Must Not Commit",
          expectedVersion: selectedProduct.version,
        },
      ]);

    expect(response.statusCode).toBe(409);
    expect(response.body).toEqual({
      message: "One or more product SKUs already exist",
    });
    expect(await captureProductAndStockState()).toEqual(before);
  });

  it.each([
    ["taker first", ["taker", "owner"]],
    ["owner first", ["owner", "taker"]],
  ])(
    "rejects a selected-owner move-away with 409 when the %s",
    async (_scenario, order) => {
      const managerToken = await createManagerToken();
      const { products } = await createSkuOwnershipFixture("MOVE-AWAY");
      const updateByRole = {
        taker: {
          id: products[0]._id.toString(),
          sku: products[1].sku,
          status: "inactive",
          expectedVersion: products[0].version,
        },
        owner: {
          id: products[1]._id.toString(),
          sku: "MOVE-AWAY-B-NEW",
          name: "Must Not Commit",
          expectedVersion: products[1].version,
        },
      };
      const before = await captureProductAndStockState();

      const response = await request(app)
        .patch("/api/products/bulk")
        .set("Authorization", `Bearer ${managerToken}`)
        .send(order.map((role) => updateByRole[role]));

      expect(response.statusCode).toBe(409);
      expect(response.body).toEqual({
        message: "One or more product SKUs already exist",
      });
      expect(await captureProductAndStockState()).toEqual(before);
    }
  );

  it.each([
    ["A then B", ["a", "b"]],
    ["B then A", ["b", "a"]],
  ])(
    "rejects a direct SKU swap in order %s without writes",
    async (_scenario, order) => {
      const managerToken = await createManagerToken();
      const { products } = await createSkuOwnershipFixture("DIRECT-SWAP");
      const updateByRole = {
        a: {
          id: products[0]._id.toString(),
          sku: products[1].sku,
          status: "inactive",
          expectedVersion: products[0].version,
        },
        b: {
          id: products[1]._id.toString(),
          sku: products[0].sku,
          name: "Must Not Commit",
          expectedVersion: products[1].version,
        },
      };
      const before = await captureProductAndStockState();

      const response = await request(app)
        .patch("/api/products/bulk")
        .set("Authorization", `Bearer ${managerToken}`)
        .send(order.map((role) => updateByRole[role]));

      expect(response.statusCode).toBe(409);
      expect(response.body).toEqual({
        message: "One or more product SKUs already exist",
      });
      expect(await captureProductAndStockState()).toEqual(before);
    }
  );

  it("updates one Product while preserving a selected no-op Product and all Stock guards", async () => {
    const managerToken = await createManagerToken();
    const { products } = await createSkuOwnershipFixture("VALID-NOOP");
    const unchangedBefore = await Product.findById(products[1]._id).lean();
    const stocksBefore = await Stock.find({}).sort({ _id: 1 }).lean();

    const response = await request(app)
      .patch("/api/products/bulk")
      .set("Authorization", `Bearer ${managerToken}`)
      .send([
        {
          id: products[0]._id.toString(),
          sku: "VALID-NOOP-A-NEW",
          name: "Meaningfully Updated",
          expectedVersion: products[0].version,
        },
        {
          id: products[1]._id.toString(),
          sku: products[1].sku,
          name: products[1].name,
          status: products[1].status,
          expectedVersion: products[1].version,
        },
      ]);

    expect(response.statusCode).toBe(200);
    expect(response.body).toEqual({
      message: "Products updated successfully",
      data: {
        updatedCount: 2,
        products: expect.any(Array),
      },
    });
    expect(response.body.data.products).toHaveLength(2);
    expect(
      response.body.data.products.map(({ _id, version }) => ({ _id, version }))
    ).toEqual([
      { _id: products[0]._id.toString(), version: 2 },
      { _id: products[1]._id.toString(), version: 1 },
    ]);
    expect(await Product.findById(products[0]._id)).toMatchObject({
      sku: "VALID-NOOP-A-NEW",
      name: "Meaningfully Updated",
      version: 2,
    });
    expect(await Product.findById(products[1]._id).lean()).toEqual(
      unchangedBefore
    );
    expect(await Stock.find({}).sort({ _id: 1 }).lean()).toEqual(stocksBefore);
  });

  it("maps an injected duplicate-key race to atomic 409 without partial writes", async () => {
    const managerToken = await createManagerToken();
    const { products } = await createSkuOwnershipFixture("DUPLICATE-RACE");
    const before = await captureProductAndStockState();
    const duplicateError = Object.assign(new Error("E11000 duplicate key"), {
      code: 11000,
    });
    const originalFindOneAndUpdate = Product.findOneAndUpdate.bind(Product);
    let writeAttempts = 0;
    jest
      .spyOn(Product, "findOneAndUpdate")
      .mockImplementation(async (...args) => {
        writeAttempts += 1;
        if (writeAttempts === 2) throw duplicateError;
        return originalFindOneAndUpdate(...args);
      });

    const response = await request(app)
      .patch("/api/products/bulk")
      .set("Authorization", `Bearer ${managerToken}`)
      .send([
        {
          id: products[0]._id.toString(),
          name: "First Must Roll Back",
          expectedVersion: products[0].version,
        },
        {
          id: products[1]._id.toString(),
          name: "Second Must Fail",
          expectedVersion: products[1].version,
        },
      ]);

    expect(response.statusCode).toBe(409);
    expect(response.body).toEqual({
      message: "One or more product SKUs already exist",
    });
    expect(writeAttempts).toBe(2);
    expect(await captureProductAndStockState()).toEqual(before);
  });

  it("requires an admin for bulk deletion", async () => {
    const managerToken = await createManagerToken();
    const product = await Product.create({
      sku: "MANAGER-DELETE-001",
      name: "Manager Delete Product",
      status: "inactive",
    });

    const response = await request(app)
      .delete("/api/products/bulk")
      .set("Authorization", `Bearer ${managerToken}`)
      .send({ ids: [product._id.toString()] });

    expect(response.statusCode).toBe(403);
  });

  it("rejects bulk deletion when any product is active", async () => {
    const adminToken = await createAdminToken();
    const products = await Product.create([
      { sku: "ACTIVE-001", name: "Active Product" },
      { sku: "INACTIVE-001", name: "Inactive Product", status: "inactive" },
    ]);

    const response = await request(app)
      .delete("/api/products/bulk")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        items: products.map((product) => ({
          id: product._id.toString(),
          expectedVersion: product.version,
        })),
      });

    expect(response.statusCode).toBe(409);
    expect(response.body).toEqual({
      message: "Active products must be deactivated before deletion",
    });
    expect(await Product.countDocuments()).toBe(2);
  });

  it("uses INVALID_RESOURCE_STATE for an active Product in v1 bulk archive", async () => {
    const adminToken = await createAdminToken();
    const products = await Product.create([
      { sku: "ACTIVE-BULK-V1", name: "Active Bulk V1" },
      { sku: "INACTIVE-BULK-V1", name: "Inactive Bulk V1", status: "inactive" },
    ]);

    const response = await request(app)
      .delete("/api/v1/products/bulk")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        items: products.map((product) => ({
          id: product._id.toString(),
          expectedVersion: product.version,
        })),
      });

    expect(response.statusCode).toBe(409);
    expect(response.body).toMatchObject({
      title: "Invalid resource state",
      code: "INVALID_RESOURCE_STATE",
      detail: "Active products must be deactivated before deletion",
    });
    expect(await Product.countDocuments({ archivedAt: { $ne: null } })).toBe(0);
  });

  it("bulk deletes inactive products for an admin", async () => {
    const adminToken = await createAdminToken();
    const products = await Product.create([
      { sku: "INACTIVE-002", name: "Inactive Two", status: "inactive" },
      { sku: "INACTIVE-003", name: "Inactive Three", status: "inactive" },
    ]);

    const response = await request(app)
      .delete("/api/products/bulk")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        items: products.map((product) => ({
          id: product._id.toString(),
          expectedVersion: product.version,
        })),
      });

    expect(response.statusCode).toBe(200);
    expect(response.body.data.deletedCount).toBe(2);
    expect(await Product.countDocuments()).toBe(2);
    expect(await Product.countDocuments({ archivedAt: { $ne: null } })).toBe(2);
  });

  it("rejects an empty single-product update", async () => {
    const managerToken = await createManagerToken();
    const product = await Product.create({
      sku: "EMPTY-UPDATE-001",
      name: "Empty Update Product",
    });

    const response = await request(app)
      .patch(`/api/products/${product._id}`)
      .set("Authorization", `Bearer ${managerToken}`)
      .send({});

    expect(response.statusCode).toBe(400);
    expect(response.body.message).toBe("Validation failed");
  });

  it("rejects an invalid unit in a single-product update", async () => {
    const managerToken = await createManagerToken();
    const product = await Product.create({
      sku: "INVALID-UNIT-001",
      name: "Invalid Unit Product",
    });

    const response = await request(app)
      .patch(`/api/products/${product._id}`)
      .set("Authorization", `Bearer ${managerToken}`)
      .send({ unit: "box", expectedVersion: product.version });

    expect(response.statusCode).toBe(400);
    expect(response.body.message).toBe("Validation failed");
  });

  it("rejects a whitespace-only SKU when creating a product", async () => {
    const managerToken = await createManagerToken();

    const response = await request(app)
      .post("/api/products")
      .set("Authorization", `Bearer ${managerToken}`)
      .send({ sku: "   ", name: "Valid Name" });

    expect(response.statusCode).toBe(400);
    expect(await Product.countDocuments()).toBe(0);
  });

  it("rejects a whitespace-only name when creating a product", async () => {
    const managerToken = await createManagerToken();

    const response = await request(app)
      .post("/api/products")
      .set("Authorization", `Bearer ${managerToken}`)
      .send({ sku: "VALID-SKU-001", name: "   " });

    expect(response.statusCode).toBe(400);
    expect(await Product.countDocuments()).toBe(0);
  });

  it("rejects whitespace-only required values in bulk product creation", async () => {
    const managerToken = await createManagerToken();

    const response = await request(app)
      .post("/api/products/bulk")
      .set("Authorization", `Bearer ${managerToken}`)
      .send([
        { sku: "BULK-VALID-001", name: "Valid Bulk Product" },
        { sku: "   ", name: "Invalid Bulk Product" },
      ]);

    expect(response.statusCode).toBe(400);
    expect(await Product.countDocuments()).toBe(0);
  });

  it("rejects a whitespace-only name in bulk product update", async () => {
    const managerToken = await createManagerToken();
    const product = await Product.create({
      sku: "BULK-NAME-001",
      name: "Original Bulk Name",
    });

    const response = await request(app)
      .patch("/api/products/bulk")
      .set("Authorization", `Bearer ${managerToken}`)
      .send([
        {
          id: product._id.toString(),
          name: "   ",
          expectedVersion: product.version,
        },
      ]);

    expect(response.statusCode).toBe(400);
    expect((await Product.findById(product._id)).name).toBe("Original Bulk Name");
  });

  it("rejects a non-string product description", async () => {
    const managerToken = await createManagerToken();

    const response = await request(app)
      .post("/api/products")
      .set("Authorization", `Bearer ${managerToken}`)
      .send({
        sku: "DESCRIPTION-001",
        name: "Description Validation Product",
        description: { text: "invalid" },
      });

    expect(response.statusCode).toBe(400);
  });

  it("normalizes a product SKU to uppercase on create", async () => {
    const managerToken = await createManagerToken();

    const response = await request(app)
      .post("/api/products")
      .set("Authorization", `Bearer ${managerToken}`)
      .send({ sku: "lowercase-001", name: "Normalized Product" });

    expect(response.statusCode).toBe(201);
    expect(response.body.data.sku).toBe("LOWERCASE-001");
  });

  it("normalizes product SKUs to uppercase in bulk create", async () => {
    const managerToken = await createManagerToken();

    const response = await request(app)
      .post("/api/products/bulk")
      .set("Authorization", `Bearer ${managerToken}`)
      .send([
        { sku: "bulk-lower-001", name: "Bulk Lower One" },
        { sku: "bulk-lower-002", name: "Bulk Lower Two" },
      ]);

    expect(response.statusCode).toBe(201);
    expect(response.body.data.products.map((product) => product.sku)).toEqual([
      "BULK-LOWER-001",
      "BULK-LOWER-002",
    ]);
  });

  it("detects SKU conflicts regardless of letter case", async () => {
    const managerToken = await createManagerToken();
    await Product.create({
      sku: "CASE-CONFLICT-001",
      name: "Existing Case Product",
    });

    const response = await request(app)
      .post("/api/products")
      .set("Authorization", `Bearer ${managerToken}`)
      .send({ sku: "case-conflict-001", name: "Duplicate Case Product" });

    expect(response.statusCode).toBe(409);
  });

  it("rejects a product SKU containing unsupported characters", async () => {
    const managerToken = await createManagerToken();

    const response = await request(app)
      .post("/api/products")
      .set("Authorization", `Bearer ${managerToken}`)
      .send({ sku: "INVALID SKU!", name: "Invalid SKU Product" });

    expect(response.statusCode).toBe(400);
    expect(await Product.countDocuments()).toBe(0);
  });

  it("rejects a product SKU longer than 64 characters", async () => {
    const managerToken = await createManagerToken();

    const response = await request(app)
      .post("/api/products")
      .set("Authorization", `Bearer ${managerToken}`)
      .send({ sku: "A".repeat(65), name: "Long SKU Product" });

    expect(response.statusCode).toBe(400);
    expect(await Product.countDocuments()).toBe(0);
  });
});
