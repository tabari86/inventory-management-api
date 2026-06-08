const request = require("supertest");

const app = require("../src/app");

require("./setupTestDb");

describe("Auth API", () => {
  it("should register a new user", async () => {
    const response = await request(app)
      .post("/api/auth/register")
      .send({
        name: "Test Admin",
        email: "test.admin@example.com",
        password: "Password123",
        role: "admin",
      });

    expect(response.statusCode).toBe(201);
    expect(response.body.message).toBe("User registered successfully");
    expect(response.body.data).toHaveProperty("id");
    expect(response.body.data.email).toBe("test.admin@example.com");
    expect(response.body.data.role).toBe("admin");
    expect(response.body.data).not.toHaveProperty("password");
  });

  it("should reject duplicate user registration", async () => {
    await request(app)
      .post("/api/auth/register")
      .send({
        name: "Duplicate User",
        email: "duplicate@example.com",
        password: "Password123",
        role: "admin",
      });

    const response = await request(app)
      .post("/api/auth/register")
      .send({
        name: "Duplicate User Again",
        email: "duplicate@example.com",
        password: "Password123",
        role: "admin",
      });

    expect(response.statusCode).toBe(409);
    expect(response.body.message).toBe("A user with this email already exists");
  });

  it("should login a registered user", async () => {
    await request(app)
      .post("/api/auth/register")
      .send({
        name: "Login User",
        email: "login.user@example.com",
        password: "Password123",
        role: "admin",
      });

    const response = await request(app)
      .post("/api/auth/login")
      .send({
        email: "login.user@example.com",
        password: "Password123",
      });

    expect(response.statusCode).toBe(200);
    expect(response.body.message).toBe("Login successful");
    expect(response.body.data).toHaveProperty("accessToken");
    expect(response.body.data).toHaveProperty("refreshToken");
    expect(response.body.data.user.email).toBe("login.user@example.com");
    expect(response.body.data.user.role).toBe("admin");
  });

  it("should reject login with wrong password", async () => {
    await request(app)
      .post("/api/auth/register")
      .send({
        name: "Wrong Password User",
        email: "wrong.password@example.com",
        password: "Password123",
        role: "admin",
      });

    const response = await request(app)
      .post("/api/auth/login")
      .send({
        email: "wrong.password@example.com",
        password: "WrongPassword123",
      });

    expect(response.statusCode).toBe(401);
    expect(response.body.message).toBe("Invalid email or password");
  });

  it("should reject current user request without access token", async () => {
    const response = await request(app).get("/api/auth/me");

    expect(response.statusCode).toBe(401);
    expect(response.body.message).toBe("Access token is required");
  });

  it("should return current user with valid access token", async () => {
    await request(app)
      .post("/api/auth/register")
      .send({
        name: "Current User",
        email: "current.user@example.com",
        password: "Password123",
        role: "manager",
      });

    const loginResponse = await request(app)
      .post("/api/auth/login")
      .send({
        email: "current.user@example.com",
        password: "Password123",
      });

    const accessToken = loginResponse.body.data.accessToken;

    const response = await request(app)
      .get("/api/auth/me")
      .set("Authorization", `Bearer ${accessToken}`);

    expect(response.statusCode).toBe(200);
    expect(response.body.message).toBe("Current user retrieved successfully");
    expect(response.body.data.email).toBe("current.user@example.com");
    expect(response.body.data.role).toBe("manager");
  });

  it("should refresh access token with a valid refresh token", async () => {
    await request(app)
      .post("/api/auth/register")
      .send({
        name: "Refresh User",
        email: "refresh.user@example.com",
        password: "Password123",
        role: "admin",
      });

    const loginResponse = await request(app)
      .post("/api/auth/login")
      .send({
        email: "refresh.user@example.com",
        password: "Password123",
      });

    const refreshToken = loginResponse.body.data.refreshToken;

    const response = await request(app)
      .post("/api/auth/refresh")
      .send({
        refreshToken,
      });

    expect(response.statusCode).toBe(200);
    expect(response.body.message).toBe("Token refreshed successfully");
    expect(response.body.data).toHaveProperty("accessToken");
    expect(response.body.data).toHaveProperty("refreshToken");
  });

  it("should reject a refresh token after it has been rotated", async () => {
    await request(app)
      .post("/api/auth/register")
      .send({
        name: "Rotation User",
        email: "rotation.user@example.com",
        password: "Password123",
        role: "admin",
      });

    const loginResponse = await request(app)
      .post("/api/auth/login")
      .send({
        email: "rotation.user@example.com",
        password: "Password123",
      });

    const oldRefreshToken = loginResponse.body.data.refreshToken;

    await request(app)
      .post("/api/auth/refresh")
      .send({
        refreshToken: oldRefreshToken,
      });

    const response = await request(app)
      .post("/api/auth/refresh")
      .send({
        refreshToken: oldRefreshToken,
      });

    expect(response.statusCode).toBe(401);
    expect(response.body.message).toBe("Refresh token has been revoked");
  });

  it("should revoke refresh token on logout", async () => {
    await request(app)
      .post("/api/auth/register")
      .send({
        name: "Logout User",
        email: "logout.user@example.com",
        password: "Password123",
        role: "admin",
      });

    const loginResponse = await request(app)
      .post("/api/auth/login")
      .send({
        email: "logout.user@example.com",
        password: "Password123",
      });

    const refreshToken = loginResponse.body.data.refreshToken;

    const logoutResponse = await request(app)
      .post("/api/auth/logout")
      .send({
        refreshToken,
      });

    expect(logoutResponse.statusCode).toBe(200);
    expect(logoutResponse.body.message).toBe("Logout successful");

    const refreshResponse = await request(app)
      .post("/api/auth/refresh")
      .send({
        refreshToken,
      });

    expect(refreshResponse.statusCode).toBe(401);
    expect(refreshResponse.body.message).toBe("Refresh token has been revoked");
  });
});