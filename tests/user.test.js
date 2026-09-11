const bcrypt = require("bcrypt");
const request = require("supertest");

const app = require("../src/app");
const User = require("../src/models/User");
const {
  createAdminToken,
  createManagerToken,
} = require("./helpers/authTestHelper");

require("./setupTestDb");

const PASSWORD_BYTE_LIMIT_MESSAGE =
  "Password must be at most 72 UTF-8 bytes";
const ACCEPTED_PASSWORD_BOUNDARIES = [
  ["ASCII at exactly 72 UTF-8 bytes", "A".repeat(72), "ascii-72"],
  ["multibyte at exactly 72 UTF-8 bytes", "é".repeat(36), "utf8-72"],
];
const REJECTED_PASSWORD_BOUNDARIES = [
  ["ASCII above 72 UTF-8 bytes", "A".repeat(73), "ascii-73"],
  [
    "short-looking multibyte above 72 UTF-8 bytes",
    `${"é".repeat(36)}X`,
    "utf8-73",
  ],
];
const USER_CREATION_ROUTES = [
  ["canonical", "/api/v1/users", "v1"],
  ["legacy", "/api/users", "legacy"],
];

describe("User API", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

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

  describe.each(USER_CREATION_ROUTES)(
    "%s password byte boundary",
    (contract, path, routeKey) => {
      it.each(ACCEPTED_PASSWORD_BOUNDARIES)(
        "accepts %s",
        async (_caseName, password, caseKey) => {
          const adminToken = await createAdminToken();
          const email = `${routeKey}.${caseKey}@example.com`;

          expect(Buffer.byteLength(password, "utf8")).toBe(72);

          const response = await request(app)
            .post(path)
            .set("Authorization", `Bearer ${adminToken}`)
            .send({
              name: `${contract} Boundary User`,
              email,
              password,
              role: "viewer",
            });

          expect(response.statusCode).toBe(201);
          if (contract === "canonical") {
            expect(response.body).toMatchObject({
              data: { email, role: "viewer", status: "active" },
              meta: { schemaVersion: "1.0" },
            });
            expect(response.body).not.toHaveProperty("message");
          } else {
            expect(response.body).toMatchObject({
              message: "User created successfully",
              data: { email, role: "viewer", status: "active" },
            });
            expect(response.body).not.toHaveProperty("meta");
          }
          expect(JSON.stringify(response.body)).not.toContain(password);

          const stored = await User.findOne({ email }).select("+password");
          expect(stored).not.toBeNull();
          expect(stored.password).not.toBe(password);
          expect(await bcrypt.compare(password, stored.password)).toBe(true);
        }
      );

      it.each(REJECTED_PASSWORD_BOUNDARIES)(
        "rejects %s before hashing or persistence",
        async (_caseName, password, caseKey) => {
          const adminToken = await createAdminToken();
          const email = `${routeKey}.${caseKey}@example.com`;
          const hashSpy = jest.spyOn(bcrypt, "hash");
          const createSpy = jest.spyOn(User, "create");

          expect(Buffer.byteLength(password, "utf8")).toBe(73);

          const response = await request(app)
            .post(path)
            .set("Authorization", `Bearer ${adminToken}`)
            .send({
              name: `${contract} Rejected Boundary User`,
              email,
              password,
              role: "viewer",
            });

          expect(response.statusCode).toBe(400);
          if (contract === "canonical") {
            expect(response.body).toMatchObject({
              type: "inventory-error",
              title: "Validation failed",
              status: 400,
              code: "VALIDATION_FAILED",
              detail: "Validation failed",
              retryable: false,
              errors: [
                {
                  field: "password",
                  message: PASSWORD_BYTE_LIMIT_MESSAGE,
                },
              ],
            });
          } else {
            expect(response.body).toEqual({
              message: "Validation failed",
              errors: [
                {
                  field: "password",
                  message: PASSWORD_BYTE_LIMIT_MESSAGE,
                },
              ],
            });
          }
          expect(JSON.stringify(response.body)).not.toContain(password);
          expect(hashSpy).not.toHaveBeenCalled();
          expect(createSpy).not.toHaveBeenCalled();
          expect(await User.collection.findOne({ email })).toBeNull();
        }
      );
    }
  );
});
