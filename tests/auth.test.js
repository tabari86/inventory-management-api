const request = require("supertest");

const app = require("../src/app");
const {
  createAccessToken,
  createTestUser,
} = require("./helpers/authTestHelper");

require("./setupTestDb");

describe("Auth API", () => {
  it("does not expose public user registration", async () => {
    const response = await request(app)
      .post("/api/auth/register")
      .send({
        name: "Test Admin",
        email: "test.admin@example.com",
        password: "Password123",
        role: "admin",
      });

    expect(response.statusCode).toBe(404);
  });

  it("logs in an existing active user", async () => {
    await createTestUser({
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

  it("rejects login with the wrong password", async () => {
    await createTestUser({
      email: "wrong.password@example.com",
      password: "Password123",
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

  it("rejects current-user requests without an access token", async () => {
    const response = await request(app).get("/api/auth/me");

    expect(response.statusCode).toBe(401);
    expect(response.body.message).toBe("Access token is required");
  });

  it("returns the current user for a valid access token", async () => {
    const user = await createTestUser({
      name: "Current User",
      email: "current.user@example.com",
      role: "manager",
    });
    const accessToken = createAccessToken(user);

    const response = await request(app)
      .get("/api/auth/me")
      .set("Authorization", `Bearer ${accessToken}`);

    expect(response.statusCode).toBe(200);
    expect(response.body.message).toBe("Current user retrieved successfully");
    expect(response.body.data.email).toBe("current.user@example.com");
    expect(response.body.data.role).toBe("manager");
  });

  it("rotates a valid refresh token", async () => {
    await createTestUser({
      email: "refresh.user@example.com",
      password: "Password123",
    });
    const loginResponse = await request(app)
      .post("/api/auth/login")
      .send({
        email: "refresh.user@example.com",
        password: "Password123",
      });
    const oldRefreshToken = loginResponse.body.data.refreshToken;

    const response = await request(app)
      .post("/api/auth/refresh")
      .send({ refreshToken: oldRefreshToken });

    expect(response.statusCode).toBe(200);
    expect(response.body.message).toBe("Token refreshed successfully");
    expect(response.body.data).toHaveProperty("accessToken");
    expect(response.body.data.refreshToken).not.toBe(oldRefreshToken);

    const reusedTokenResponse = await request(app)
      .post("/api/auth/refresh")
      .send({ refreshToken: oldRefreshToken });

    expect(reusedTokenResponse.statusCode).toBe(401);
    expect(reusedTokenResponse.body.message).toBe("Refresh token has been revoked");
  });

  it("revokes a refresh token on logout", async () => {
    await createTestUser({
      email: "logout.user@example.com",
      password: "Password123",
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
      .send({ refreshToken });

    expect(logoutResponse.statusCode).toBe(200);
    expect(logoutResponse.body.message).toBe("Logout successful");

    const refreshResponse = await request(app)
      .post("/api/auth/refresh")
      .send({ refreshToken });

    expect(refreshResponse.statusCode).toBe(401);
    expect(refreshResponse.body.message).toBe("Refresh token has been revoked");
  });
});
