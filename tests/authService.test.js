const bcrypt = require("bcrypt");
const crypto = require("crypto");

const authService = require("../src/services/authService");
const DomainError = require("../src/errors/DomainError");
const RefreshToken = require("../src/models/RefreshToken");
const User = require("../src/models/User");
const { createTestUser } = require("./helpers/authTestHelper");

require("./setupTestDb");

const hashToken = (token) =>
  crypto.createHash("sha256").update(token).digest("hex");

const MALFORMED_INPUT_MARKER = ["V802", "SERVICE", "MARKER"].join("_");
const MALFORMED_SCALAR_CASES = [
  ["object", () => ({ probe: MALFORMED_INPUT_MARKER })],
  ["array", () => [MALFORMED_INPUT_MARKER]],
  ["number", () => 173],
  ["boolean", () => true],
  ["null", () => null],
];

const expectServiceValidationError = async (operation, field) => {
  let caughtError;

  try {
    await operation();
  } catch (error) {
    caughtError = error;
  }

  expect(caughtError).toBeInstanceOf(DomainError);
  expect(caughtError).toMatchObject({
    code: "VALIDATION_FAILED",
    httpStatus: 400,
    message: "Validation failed",
    safeMessage: "Validation failed",
    retryable: false,
    errors: [
      {
        field,
        message: expect.any(String),
      },
    ],
  });
  expect(Object.keys(caughtError.errors[0]).sort()).toEqual([
    "field",
    "message",
  ]);
  expect(
    JSON.stringify({
      message: caughtError.message,
      safeMessage: caughtError.safeMessage,
      errors: caughtError.errors,
    })
  ).not.toContain(MALFORMED_INPUT_MARKER);
};

const readRefreshTokenState = async (tokenId) => {
  const token = await RefreshToken.findById(tokenId).lean();

  return {
    id: String(token._id),
    userId: String(token.userId),
    tokenHash: token.tokenHash,
    expiresAt: token.expiresAt.toISOString(),
    isRevoked: token.isRevoked,
    createdAt: token.createdAt.toISOString(),
    updatedAt: token.updatedAt.toISOString(),
  };
};

const createControlledRefreshToken = (user) =>
  RefreshToken.create({
    userId: user._id,
    tokenHash: hashToken(crypto.randomBytes(32)),
    expiresAt: new Date(Date.now() + 60_000),
  });

describe("Authentication service", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

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

  it.each(MALFORMED_SCALAR_CASES)(
    "rejects a %s password before database and bcrypt work",
    async (label, makeValue) => {
      const email = `service.structural.password.${label}@example.com`;
      await createTestUser({ email, password: "Password123" });
      const findUserSpy = jest.spyOn(User, "findOne");
      const compareSpy = jest.spyOn(bcrypt, "compare");

      await expectServiceValidationError(
        () => authService.login({ email, password: makeValue() }),
        "password"
      );

      expect(findUserSpy).not.toHaveBeenCalled();
      expect(compareSpy).not.toHaveBeenCalled();
      expect(await RefreshToken.countDocuments()).toBe(0);
    }
  );

  it("rejects a non-string email before database and bcrypt work", async () => {
    const email = "service.structural.email@example.com";
    await createTestUser({ email, password: "Password123" });
    const findUserSpy = jest.spyOn(User, "findOne");
    const compareSpy = jest.spyOn(bcrypt, "compare");

    await expectServiceValidationError(
      () =>
        authService.login({
          email: [email],
          password: "Password123",
        }),
      "email"
    );

    expect(findUserSpy).not.toHaveBeenCalled();
    expect(compareSpy).not.toHaveBeenCalled();
    expect(await RefreshToken.countDocuments()).toBe(0);
  });

  it("reveals inactive status only after the password is proven", async () => {
    await createTestUser({
      email: "service.inactive-login@example.com",
      password: "Password123",
      status: "inactive",
    });

    await expect(
      authService.login({
        email: "service.inactive-login@example.com",
        password: "WrongPassword123",
      })
    ).rejects.toMatchObject({
      code: "AUTHENTICATION_FAILED",
      httpStatus: 401,
      retryable: false,
    });
    expect(await RefreshToken.countDocuments()).toBe(0);

    await expect(
      authService.login({
        email: "service.inactive-login@example.com",
        password: "Password123",
      })
    ).rejects.toMatchObject({
      code: "ACCESS_DENIED",
      httpStatus: 403,
      retryable: false,
    });
    expect(await RefreshToken.countDocuments()).toBe(0);
  });

  it("rejects a non-string refresh token before hashing or persistence", async () => {
    const user = await createTestUser({
      email: "service.structural.refresh@example.com",
      password: "Password123",
    });
    const storedToken = await createControlledRefreshToken(user);
    const tokenBefore = await readRefreshTokenState(storedToken._id);
    const hashSpy = jest.spyOn(crypto, "createHash");
    const consumeSpy = jest.spyOn(RefreshToken, "findOneAndUpdate");

    await expectServiceValidationError(
      () =>
        authService.rotateRefreshToken({
          refreshToken: { probe: MALFORMED_INPUT_MARKER },
        }),
      "refreshToken"
    );

    expect(hashSpy).not.toHaveBeenCalled();
    expect(consumeSpy).not.toHaveBeenCalled();
    expect(await RefreshToken.countDocuments({ userId: user._id })).toBe(1);
    expect(await readRefreshTokenState(storedToken._id)).toEqual(tokenBefore);
  });

  it("rejects a non-string logout token before hashing or persistence", async () => {
    const user = await createTestUser({
      email: "service.structural.logout@example.com",
      password: "Password123",
    });
    const storedToken = await createControlledRefreshToken(user);
    const tokenBefore = await readRefreshTokenState(storedToken._id);
    const hashSpy = jest.spyOn(crypto, "createHash");
    const revokeSpy = jest.spyOn(RefreshToken, "updateOne");

    await expectServiceValidationError(
      () =>
        authService.logout({
          refreshToken: { probe: MALFORMED_INPUT_MARKER },
        }),
      "refreshToken"
    );

    expect(hashSpy).not.toHaveBeenCalled();
    expect(revokeSpy).not.toHaveBeenCalled();
    expect(await RefreshToken.countDocuments({ userId: user._id })).toBe(1);
    expect(await readRefreshTokenState(storedToken._id)).toEqual(tokenBefore);
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
