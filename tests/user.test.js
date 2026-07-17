const request = require("supertest");

const app = require("../src/app");
const User = require("../src/models/User");
const {
  createAdminToken,
  createManagerToken,
} = require("./helpers/authTestHelper");

require("./setupTestDb");

describe("User API", () => {
  it("allows an admin to create a manager without returning the password", async () => {
    const adminToken = await createAdminToken();

    const response = await request(app)
      .post("/api/users")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        name: "Manager User",
        email: "manager@example.com",
        password: "Password123",
        role: "manager",
      });

    expect(response.statusCode).toBe(201);
    expect(response.body.message).toBe("User created successfully");
    expect(response.body.data.role).toBe("manager");
    expect(response.body.data.status).toBe("active");
    expect(response.body.data).not.toHaveProperty("password");
  });

  it("defaults an admin-created user to the viewer role", async () => {
    const adminToken = await createAdminToken();

    const response = await request(app)
      .post("/api/users")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        name: "Viewer User",
        email: "viewer@example.com",
        password: "Password123",
      });

    expect(response.statusCode).toBe(201);
    expect(response.body.data.role).toBe("viewer");
  });

  it("rejects unauthenticated user creation", async () => {
    const response = await request(app)
      .post("/api/users")
      .send({
        name: "Viewer User",
        email: "viewer@example.com",
        password: "Password123",
      });

    expect(response.statusCode).toBe(401);
  });

  it("rejects user creation by a non-admin", async () => {
    const managerToken = await createManagerToken();

    const response = await request(app)
      .post("/api/users")
      .set("Authorization", `Bearer ${managerToken}`)
      .send({
        name: "Viewer User",
        email: "viewer@example.com",
        password: "Password123",
      });

    expect(response.statusCode).toBe(403);
  });

  it("rejects admin creation through the users endpoint", async () => {
    const adminToken = await createAdminToken();

    const response = await request(app)
      .post("/api/users")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        name: "Second Admin",
        email: "second.admin@example.com",
        password: "Password123",
        role: "admin",
      });

    expect(response.statusCode).toBe(400);
    expect(response.body.message).toBe("Validation failed");
    expect(await User.findOne({ email: "second.admin@example.com" })).toBeNull();
  });

  it("rejects duplicate email addresses", async () => {
    const adminToken = await createAdminToken();
    const user = {
      name: "Duplicate User",
      email: "duplicate@example.com",
      password: "Password123",
      role: "viewer",
    };

    await request(app)
      .post("/api/users")
      .set("Authorization", `Bearer ${adminToken}`)
      .send(user);

    const response = await request(app)
      .post("/api/users")
      .set("Authorization", `Bearer ${adminToken}`)
      .send(user);

    expect(response.statusCode).toBe(409);
    expect(response.body.message).toBe("A user with this email already exists");
  });

  it("rejects an admin-created user with a whitespace-only name", async () => {
    const adminToken = await createAdminToken();

    const response = await request(app)
      .post("/api/users")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        name: "   ",
        email: "blank.name@example.com",
        password: "Password123",
        role: "viewer",
      });

    expect(response.statusCode).toBe(400);
    expect(await User.findOne({ email: "blank.name@example.com" })).toBeNull();
  });
});
