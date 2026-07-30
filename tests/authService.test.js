const crypto = require("crypto");

const authService = require("../src/services/authService");
const RefreshToken = require("../src/models/RefreshToken");
const User = require("../src/models/User");
const { createTestUser } = require("./helpers/authTestHelper");

require("./setupTestDb");

const hashToken = (token) =>
  crypto.createHash("sha256").update(token).digest("hex");

describe("Authentication service", () => {
  it("logs in with plain inputs and returns a public result", async () => {
    await createTestUser({
      email: "service.login@example.com",
      password: "Password123",
      role: "manager",
    });

    const result = await authService.login({
      email: "service.login@example.com",
      password: "Password123",
      applicationContext: {
        requestId: "service-login-request",
        correlationId: "service-login-correlation",
      },
    });

    expect(result.accessToken).toEqual(expect.any(String));
    expect(result.refreshToken).toEqual(expect.any(String));
    expect(result.user).toMatchObject({
      email: "service.login@example.com",
      role: "manager",
      status: "active",
    });
    expect(result.user).not.toHaveProperty("password");
    expect(
      await RefreshToken.findOne({ tokenHash: hashToken(result.refreshToken) })
    ).not.toBeNull();
  });

  it("rejects a wrong password with the stable domain error", async () => {
    await createTestUser({
      email: "service.wrong-password@example.com",
      password: "Password123",
    });

    await expect(
      authService.login({
        email: "service.wrong-password@example.com",
        password: "WrongPassword123",
      })
    ).rejects.toMatchObject({
      code: "AUTHENTICATION_FAILED",
      httpStatus: 401,
      retryable: false,
    });
  });

  it("rejects login for an inactive user", async () => {
    await createTestUser({
      email: "service.inactive-login@example.com",
      password: "Password123",
      status: "inactive",
    });

    await expect(
      authService.login({
        email: "service.inactive-login@example.com",
        password: "Password123",
      })
    ).rejects.toMatchObject({
      code: "ACCESS_DENIED",
      httpStatus: 403,
    });
  });

  it("rotates a valid refresh token and rejects sequential reuse", async () => {
    await createTestUser({
      email: "service.rotate@example.com",
      password: "Password123",
    });
    const login = await authService.login({
      email: "service.rotate@example.com",
      password: "Password123",
    });

    const rotated = await authService.rotateRefreshToken({
      refreshToken: login.refreshToken,
    });

    expect(rotated.accessToken).toEqual(expect.any(String));
    expect(rotated.refreshToken).not.toBe(login.refreshToken);
    await expect(
      authService.rotateRefreshToken({ refreshToken: login.refreshToken })
    ).rejects.toMatchObject({
      code: "INVALID_REFRESH_TOKEN",
      httpStatus: 401,
      retryable: false,
    });
  });

  it("rejects an expired refresh token", async () => {
    await createTestUser({
      email: "service.expired@example.com",
      password: "Password123",
    });
    const login = await authService.login({
      email: "service.expired@example.com",
      password: "Password123",
    });
    await RefreshToken.updateOne(
      { tokenHash: hashToken(login.refreshToken) },
      { $set: { expiresAt: new Date(Date.now() - 1000) } }
    );

    await expect(
      authService.rotateRefreshToken({ refreshToken: login.refreshToken })
    ).rejects.toMatchObject({
      code: "INVALID_REFRESH_TOKEN",
      httpStatus: 401,
    });
  });

  it("rejects a nonexistent refresh token", async () => {
    const unknownToken = crypto.randomBytes(64).toString("hex");

    await expect(
      authService.rotateRefreshToken({ refreshToken: unknownToken })
    ).rejects.toMatchObject({
      code: "INVALID_REFRESH_TOKEN",
      httpStatus: 401,
    });
  });

  it("rejects an inactive user during refresh without consuming the token", async () => {
    const user = await createTestUser({
      email: "service.inactive-refresh@example.com",
      password: "Password123",
    });
    const login = await authService.login({
      email: "service.inactive-refresh@example.com",
      password: "Password123",
    });
    await User.updateOne({ _id: user._id }, { $set: { status: "inactive" } });

    await expect(
      authService.rotateRefreshToken({ refreshToken: login.refreshToken })
    ).rejects.toMatchObject({
      code: "ACCESS_DENIED",
      httpStatus: 403,
    });
    expect(
      await RefreshToken.findOne({ tokenHash: hashToken(login.refreshToken) })
    ).toMatchObject({ isRevoked: false });
    expect(await RefreshToken.countDocuments({ userId: user._id })).toBe(1);
  });

  it("logs out and keeps repeated logout idempotently successful", async () => {
    await createTestUser({
      email: "service.logout@example.com",
      password: "Password123",
    });
    const login = await authService.login({
      email: "service.logout@example.com",
      password: "Password123",
    });

    await expect(
      authService.logout({ refreshToken: login.refreshToken })
    ).resolves.toBeUndefined();
    await expect(
      authService.logout({ refreshToken: login.refreshToken })
    ).resolves.toBeUndefined();
    expect(
      await RefreshToken.findOne({ tokenHash: hashToken(login.refreshToken) })
    ).toMatchObject({ isRevoked: true });
  });
});
