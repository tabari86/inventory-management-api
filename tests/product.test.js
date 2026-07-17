const request = require("supertest");

const app = require("../src/app");
const Product = require("../src/models/Product");
const {
  createAdminToken,
  createManagerToken,
  createViewerToken,
} = require("./helpers/authTestHelper");

require("./setupTestDb");

describe("Product API", () => {
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
      .set("Authorization", `Bearer ${adminToken}`);
    expect(adminResponse.statusCode).toBe(200);
    expect(await Product.findById(product._id)).toBeNull();
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
        { id: products[0]._id.toString(), name: "Updated One" },
        { id: products[1]._id.toString(), status: "inactive" },
      ]);

    expect(response.statusCode).toBe(200);
    expect(response.body.data.updatedCount).toBe(2);
    expect((await Product.findById(products[0]._id)).name).toBe("Updated One");
    expect((await Product.findById(products[1]._id)).status).toBe("inactive");
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
      .send({ ids: products.map((product) => product._id.toString()) });

    expect(response.statusCode).toBe(409);
    expect(await Product.countDocuments()).toBe(2);
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
      .send({ ids: products.map((product) => product._id.toString()) });

    expect(response.statusCode).toBe(200);
    expect(response.body.data.deletedCount).toBe(2);
    expect(await Product.countDocuments()).toBe(0);
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
      .send({ unit: "box" });

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
      .send([{ id: product._id.toString(), name: "   " }]);

    expect(response.statusCode).toBe(400);
    expect((await Product.findById(product._id)).name).toBe("Original Bulk Name");
  });
});
