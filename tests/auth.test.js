const request = require("supertest");
const crypto = require("crypto");

const app = require("../src/app");
const { logger } = require("../src/config/logger");
const RefreshToken = require("../src/models/RefreshToken");
const User = require("../src/models/User");
const authService = require("../src/services/authService");
const {
  createAccessToken,
  createTestUser,
} = require("./helpers/authTestHelper");

require("./setupTestDb");

const MALFORMED_INPUT_MARKER = ["V802", "STRUCTURAL", "MARKER"].join("_");
const ASCII_PASSWORD_72 = "P".repeat(72);
const ASCII_PASSWORD_73 = `${ASCII_PASSWORD_72}X`;
const MULTIBYTE_PASSWORD_72 = "é".repeat(36);
const MULTIBYTE_PASSWORD_73 = `${MULTIBYTE_PASSWORD_72}X`;
const PASSWORD_BOUNDARY_CASES = [
  ["ASCII", ASCII_PASSWORD_72],
  ["multibyte", MULTIBYTE_PASSWORD_72],
];
const OVERLIMIT_PASSWORD_CASES = [
  ["ASCII", ASCII_PASSWORD_73],
  ["multibyte", MULTIBYTE_PASSWORD_73],
];
const MALFORMED_SCALAR_CASES = [
  ["object", (value = MALFORMED_INPUT_MARKER) => ({ probe: value })],
  ["array", (value = MALFORMED_INPUT_MARKER) => [value]],
  ["number", () => 173],
  ["boolean", () => true],
  ["null", () => null],
];
const V1_ERROR_KEYS = [
  "code",
  "correlationId",
  "detail",
  "errors",
  "requestId",
  "retryable",
  "status",
  "title",
  "type",
].sort();

const expectV1Error = (response, { status, code, title, detail, field }) => {
  expect(response.statusCode).toBe(status);
  expect(response.headers["content-type"]).toMatch(/application\/json/);
  expect(Object.keys(response.body).sort()).toEqual(V1_ERROR_KEYS);
  expect(response.body).toMatchObject({
    type: "inventory-error",
    title,
    status,
    code,
    detail,
    retryable: false,
    requestId: expect.any(String),
    correlationId: expect.any(String),
    errors: expect.any(Array),
  });
  expect(response.body).not.toHaveProperty("stack");
  for (const error of response.body.errors) {
    expect(Object.keys(error).sort()).toEqual(["field", "message"]);
  }
  if (field) {
    expect(response.body.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ field, message: expect.any(String) }),
      ])
    );
  }
};

const expectValidationError = (response, field) => {
  const words = field.replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase();
  const expectedMessage = `${words[0].toUpperCase()}${words.slice(1)} must be a string`;

  expectV1Error(response, {
    status: 400,
    code: "VALIDATION_FAILED",
    title: "Validation failed",
    detail: "Validation failed",
    field,
  });
  expect(response.body.errors).toEqual([
    { field, message: expectedMessage },
  ]);
};

const expectPasswordByteLimitError = (response) => {
  expectV1Error(response, {
    status: 400,
    code: "VALIDATION_FAILED",
    title: "Validation failed",
    detail: "Validation failed",
    field: "password",
  });
  expect(response.body.errors).toEqual([
    {
      field: "password",
      message: "Password must be at most 72 UTF-8 bytes",
    },
  ]);
};

const securityFields = (response) => ({
  status: response.statusCode,
  title: response.body.title,
  code: response.body.code,
  detail: response.body.detail,
  retryable: response.body.retryable,
});

const expectNoUnsafeDisclosure = (responses, logSpy) => {
  const serialized = JSON.stringify({
    responses: responses.map((response) => response.body),
    logs: logSpy.mock.calls,
  });

  expect(serialized).not.toContain(MALFORMED_INPUT_MARKER);
  expect(serialized).not.toMatch(
    /ERR_INVALID_ARG_TYPE|data and hash must be strings|TypeError|bcrypt|crypto/i
  );
};

const readUserState = async (userId) => {
  const user = await User.findById(userId).lean();

  return {
    id: String(user._id),
    name: user.name,
    email: user.email,
    role: user.role,
    status: user.status,
    createdAt: user.createdAt.toISOString(),
    updatedAt: user.updatedAt.toISOString(),
  };
};

const createControlledRefreshToken = (user) =>
  RefreshToken.create({
    userId: user._id,
    tokenHash: crypto
      .createHash("sha256")
      .update(crypto.randomBytes(32))
      .digest("hex"),
    expiresAt: new Date(Date.now() + 60_000),
  });

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

describe("Auth API", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

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

  it.each(PASSWORD_BOUNDARY_CASES)(
    "allows a %s password at exactly 72 UTF-8 bytes to authenticate normally",
    async (label, password) => {
      expect(Buffer.byteLength(password, "utf8")).toBe(72);
      const user = await createTestUser({
        email: `boundary.${label.toLowerCase()}@example.com`,
        password,
      });

      const response = await request(app).post("/api/v1/auth/login").send({
        email: user.email,
        password,
      });

      expect(response.statusCode).toBe(200);
      expect(response.body.data).toMatchObject({
        accessToken: expect.any(String),
        refreshToken: expect.any(String),
      });
      expect(
        await RefreshToken.countDocuments({ userId: user._id })
      ).toBe(1);
    }
  );

  it.each(OVERLIMIT_PASSWORD_CASES)(
    "rejects a %s 73-byte password account-independently before authentication",
    async (label, password) => {
      expect(Buffer.byteLength(password, "utf8")).toBe(73);
      const activeUser = await createTestUser({
        email: `overlimit.${label.toLowerCase()}.active@example.com`,
        password: "Password123",
      });
      const inactiveUser = await createTestUser({
        email: `overlimit.${label.toLowerCase()}.inactive@example.com`,
        password: "Password123",
        status: "inactive",
      });
      const usersBefore = await Promise.all([
        readUserState(activeUser._id),
        readUserState(inactiveUser._id),
      ]);
      const logSpy = jest.spyOn(logger, "log");
      const loginSpy = jest.spyOn(authService, "login");

      const responses = [];
      for (const email of [
        activeUser.email,
        inactiveUser.email,
        `overlimit.${label.toLowerCase()}.unknown@example.com`,
      ]) {
        responses.push(
          await request(app)
            .post("/api/v1/auth/login")
            .send({ email, password })
        );
      }

      expect(responses.map(securityFields)).toEqual(
        Array.from({ length: 3 }, () => ({
          status: 400,
          title: "Validation failed",
          code: "VALIDATION_FAILED",
          detail: "Validation failed",
          retryable: false,
        }))
      );
      for (const response of responses) {
        expectPasswordByteLimitError(response);
        expect(response.body).not.toHaveProperty("data");
      }
      expect(loginSpy).not.toHaveBeenCalled();
      expect(
        JSON.stringify({
          responses: responses.map((response) => response.body),
          logs: logSpy.mock.calls,
        })
      ).not.toContain(password);
      expect(await RefreshToken.countDocuments()).toBe(0);
      expect(
        await Promise.all([
          readUserState(activeUser._id),
          readUserState(inactiveUser._id),
        ])
      ).toEqual(usersBefore);
    }
  );

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

  it("rejects an object password uniformly before account lookup", async () => {
    const activeUser = await createTestUser({
      email: "structural.active@example.com",
      password: "Password123",
    });
    const inactiveUser = await createTestUser({
      email: "structural.inactive@example.com",
      password: "Password123",
      status: "inactive",
    });
    const usersBefore = await Promise.all([
      readUserState(activeUser._id),
      readUserState(inactiveUser._id),
    ]);
    const logSpy = jest.spyOn(logger, "log");
    const loginSpy = jest.spyOn(authService, "login");
    const malformedPassword = { probe: MALFORMED_INPUT_MARKER };

    const responses = [];
    for (const email of [
      "structural.active@example.com",
      "structural.inactive@example.com",
      "structural.unknown@example.com",
    ]) {
      responses.push(
        await request(app)
          .post("/api/v1/auth/login")
          .send({ email, password: malformedPassword })
      );
    }

    expect(responses.map(securityFields)).toEqual(
      Array.from({ length: 3 }, () => ({
        status: 400,
        title: "Validation failed",
        code: "VALIDATION_FAILED",
        detail: "Validation failed",
        retryable: false,
      }))
    );
    for (const response of responses) {
      expectValidationError(response, "password");
    }
    expect(loginSpy).not.toHaveBeenCalled();
    expect(
      logSpy.mock.calls.filter(
        ([event, fields]) =>
          event === "http_request_completed" &&
          fields.statusCode === 400 &&
          fields.errorCode === "VALIDATION_FAILED"
      )
    ).toHaveLength(3);
    expectNoUnsafeDisclosure(responses, logSpy);
    expect(await RefreshToken.countDocuments()).toBe(0);
    expect(
      await Promise.all([
        readUserState(activeUser._id),
        readUserState(inactiveUser._id),
      ])
    ).toEqual(usersBefore);
  });

  it.each(MALFORMED_SCALAR_CASES.slice(1))(
    "rejects a %s login password as structural validation",
    async (label, makeValue) => {
      const email = `structural.password.${label}@example.com`;
      const user = await createTestUser({
        email,
        password: "Password123",
      });
      const userBefore = await readUserState(user._id);
      const logSpy = jest.spyOn(logger, "log");
      const loginSpy = jest.spyOn(authService, "login");

      const response = await request(app)
        .post("/api/v1/auth/login")
        .send({ email, password: makeValue() });

      expectValidationError(response, "password");
      expect(loginSpy).not.toHaveBeenCalled();
      expectNoUnsafeDisclosure([response], logSpy);
      expect(await RefreshToken.countDocuments()).toBe(0);
      expect(await readUserState(user._id)).toEqual(userBefore);
    }
  );

  it.each(
    MALFORMED_SCALAR_CASES.map(([label, makeValue], index) => [
      label,
      makeValue,
      `203.0.113.${index + 1}`,
    ])
  )(
    "rejects a %s email instead of coercing it",
    async (_label, makeValue, testIp) => {
      const email = `structural.email.${crypto.randomUUID()}@example.com`;
      const user = await createTestUser({
        email,
        password: "Password123",
      });
      const userBefore = await readUserState(user._id);
      const logSpy = jest.spyOn(logger, "log");
      const loginSpy = jest.spyOn(authService, "login");

      const response = await request(app)
        .post("/api/v1/auth/login")
        .set("X-Forwarded-For", testIp)
        .send({ email: makeValue(email), password: "Password123" });

      expectValidationError(response, "email");
      expect(loginSpy).not.toHaveBeenCalled();
      expectNoUnsafeDisclosure([response], logSpy);
      expect(JSON.stringify(response.body)).not.toContain(email);
      expect(JSON.stringify(logSpy.mock.calls)).not.toContain(email);
      expect(await RefreshToken.countDocuments()).toBe(0);
      expect(await readUserState(user._id)).toEqual(userBefore);
    }
  );

  it.each(MALFORMED_SCALAR_CASES)(
    "rejects %s refresh and logout tokens at the HTTP boundary",
    async (_label, makeValue) => {
      const user = await createTestUser({
        email: `structural.token.${crypto.randomUUID()}@example.com`,
        password: "Password123",
      });
      const storedToken = await createControlledRefreshToken(user);
      const userBefore = await readUserState(user._id);
      const tokenBefore = await readRefreshTokenState(storedToken._id);
      const logSpy = jest.spyOn(logger, "log");
      const refreshSpy = jest.spyOn(authService, "rotateRefreshToken");
      const logoutSpy = jest.spyOn(authService, "logout");
      const malformedToken = makeValue();

      const refreshResponse = await request(app)
        .post("/api/v1/auth/refresh")
        .send({ refreshToken: malformedToken });
      const logoutResponse = await request(app)
        .post("/api/v1/auth/logout")
        .send({ refreshToken: malformedToken });
      const responses = [refreshResponse, logoutResponse];

      for (const response of responses) {
        expectValidationError(response, "refreshToken");
      }
      expect(refreshSpy).not.toHaveBeenCalled();
      expect(logoutSpy).not.toHaveBeenCalled();
      expect(
        logSpy.mock.calls.filter(
          ([event, fields]) =>
            event === "http_request_completed" &&
            fields.statusCode === 400 &&
            fields.errorCode === "VALIDATION_FAILED"
        )
      ).toHaveLength(2);
      expectNoUnsafeDisclosure(responses, logSpy);
      expect(await RefreshToken.countDocuments({ userId: user._id })).toBe(1);
      expect(await readRefreshTokenState(storedToken._id)).toEqual(tokenBefore);
      expect(await readUserState(user._id)).toEqual(userBefore);
    }
  );

  it("does not reveal inactive status for an incorrect string password", async () => {
    const activeUser = await createTestUser({
      email: "oracle.active@example.com",
      password: "Password123",
    });
    const inactiveUser = await createTestUser({
      email: "oracle.inactive@example.com",
      password: "Password123",
      status: "inactive",
    });
    const existingInactiveToken = await createControlledRefreshToken(
      inactiveUser
    );
    const usersBefore = await Promise.all([
      readUserState(activeUser._id),
      readUserState(inactiveUser._id),
    ]);
    const inactiveTokenBefore = await readRefreshTokenState(
      existingInactiveToken._id
    );

    const responses = [];
    for (const email of [
      "oracle.active@example.com",
      "oracle.inactive@example.com",
      "oracle.unknown@example.com",
    ]) {
      responses.push(
        await request(app)
          .post("/api/v1/auth/login")
          .send({ email, password: "WrongPassword123" })
      );
    }

    expect(responses.map(securityFields)).toEqual(
      Array.from({ length: 3 }, () => ({
        status: 401,
        title: "Authentication failed",
        code: "AUTHENTICATION_FAILED",
        detail: "Invalid email or password",
        retryable: false,
      }))
    );
    for (const response of responses) {
      expectV1Error(response, {
        status: 401,
        code: "AUTHENTICATION_FAILED",
        title: "Authentication failed",
        detail: "Invalid email or password",
      });
      expect(response.body.errors).toEqual([]);
    }
    expect(
      await Promise.all([
        readUserState(activeUser._id),
        readUserState(inactiveUser._id),
      ])
    ).toEqual(usersBefore);
    expect(
      await RefreshToken.countDocuments({ userId: activeUser._id })
    ).toBe(0);
    expect(
      await RefreshToken.countDocuments({ userId: inactiveUser._id })
    ).toBe(1);
    expect(await readRefreshTokenState(existingInactiveToken._id)).toEqual(
      inactiveTokenBefore
    );
  });

  it("preserves active success and correct inactive-account denial", async () => {
    const activeUser = await createTestUser({
      email: "oracle.correct.active@example.com",
      password: "Password123",
    });
    const inactiveUser = await createTestUser({
      email: "oracle.correct.inactive@example.com",
      password: "Password123",
      status: "inactive",
    });
    const existingInactiveToken = await createControlledRefreshToken(
      inactiveUser
    );
    const usersBefore = await Promise.all([
      readUserState(activeUser._id),
      readUserState(inactiveUser._id),
    ]);
    const inactiveTokenBefore = await readRefreshTokenState(
      existingInactiveToken._id
    );

    const activeResponse = await request(app)
      .post("/api/v1/auth/login")
      .send({
        email: "oracle.correct.active@example.com",
        password: "Password123",
      });
    const inactiveResponse = await request(app)
      .post("/api/v1/auth/login")
      .send({
        email: "oracle.correct.inactive@example.com",
        password: "Password123",
      });

    expect(activeResponse.statusCode).toBe(200);
    expect(activeResponse.body.data).toMatchObject({
      accessToken: expect.any(String),
      refreshToken: expect.any(String),
    });
    expectV1Error(inactiveResponse, {
      status: 403,
      code: "ACCESS_DENIED",
      title: "Access denied",
      detail: "User account is inactive",
    });
    expect(inactiveResponse.body.errors).toEqual([]);
    expect(
      await RefreshToken.countDocuments({ userId: activeUser._id })
    ).toBe(1);
    expect(
      await RefreshToken.countDocuments({ userId: inactiveUser._id })
    ).toBe(1);
    expect(await readRefreshTokenState(existingInactiveToken._id)).toEqual(
      inactiveTokenBefore
    );
    expect(
      await Promise.all([
        readUserState(activeUser._id),
        readUserState(inactiveUser._id),
      ])
    ).toEqual(usersBefore);
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
    expect(reusedTokenResponse.body.message).toBe("Invalid refresh token");
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
    const repeatedLogoutResponse = await request(app)
      .post("/api/auth/logout")
      .send({ refreshToken });

    expect(logoutResponse.statusCode).toBe(200);
    expect(logoutResponse.body.message).toBe("Logout successful");
    expect(repeatedLogoutResponse.statusCode).toBe(200);
    expect(repeatedLogoutResponse.body.message).toBe("Logout successful");

    const refreshResponse = await request(app)
      .post("/api/auth/refresh")
      .send({ refreshToken });

    expect(refreshResponse.statusCode).toBe(401);
    expect(refreshResponse.body.message).toBe("Invalid refresh token");
  });

  it("preserves bounded legacy authentication semantics", async () => {
    await createTestUser({
      email: "legacy.structural@example.com",
      password: "Password123",
    });
    await createTestUser({
      email: "legacy.inactive@example.com",
      password: "Password123",
      status: "inactive",
    });
    const logSpy = jest.spyOn(logger, "log");
    const malformedValue = { probe: MALFORMED_INPUT_MARKER };

    const malformedLogin = await request(app)
      .post("/api/auth/login")
      .send({
        email: "legacy.structural@example.com",
        password: malformedValue,
      });
    const inactiveWrongPassword = await request(app)
      .post("/api/auth/login")
      .send({
        email: "legacy.inactive@example.com",
        password: "WrongPassword123",
      });
    const inactiveCorrectPassword = await request(app)
      .post("/api/auth/login")
      .send({
        email: "legacy.inactive@example.com",
        password: "Password123",
      });
    const malformedRefresh = await request(app)
      .post("/api/auth/refresh")
      .send({ refreshToken: malformedValue });
    const responses = [
      malformedLogin,
      inactiveWrongPassword,
      inactiveCorrectPassword,
      malformedRefresh,
    ];

    expect(malformedLogin.statusCode).toBe(400);
    expect(malformedLogin.body).toMatchObject({
      message: "Validation failed",
      errors: expect.arrayContaining([
        expect.objectContaining({ field: "password" }),
      ]),
    });
    expect(Object.keys(malformedLogin.body).sort()).toEqual([
      "errors",
      "message",
    ]);
    expect(inactiveWrongPassword.statusCode).toBe(401);
    expect(inactiveWrongPassword.body).toEqual({
      message: "Invalid email or password",
    });
    expect(inactiveCorrectPassword.statusCode).toBe(403);
    expect(inactiveCorrectPassword.body).toEqual({
      message: "User account is inactive",
    });
    expect(malformedRefresh.statusCode).toBe(400);
    expect(malformedRefresh.body).toMatchObject({
      message: "Validation failed",
      errors: expect.arrayContaining([
        expect.objectContaining({ field: "refreshToken" }),
      ]),
    });
    expect(Object.keys(malformedRefresh.body).sort()).toEqual([
      "errors",
      "message",
    ]);
    for (const response of responses) {
      expect(response.headers["content-type"]).toMatch(/application\/json/);
      expect(response.text.trimStart().startsWith("{")).toBe(true);
      expect(response.body).not.toHaveProperty("stack");
      expect(response.body).not.toHaveProperty("code");
    }
    expectNoUnsafeDisclosure(responses, logSpy);
    expect(await RefreshToken.countDocuments()).toBe(0);
  });

  it("revokes older sessions when the same user logs in again", async () => {
    const credentials = {
      email: "session.hygiene@example.com",
      password: "Password123",
    };
    await createTestUser(credentials);

    const firstLogin = await request(app)
      .post("/api/auth/login")
      .send(credentials);
    const secondLogin = await request(app)
      .post("/api/auth/login")
      .send(credentials);

    const oldTokenResponse = await request(app)
      .post("/api/auth/refresh")
      .send({ refreshToken: firstLogin.body.data.refreshToken });
    const latestTokenResponse = await request(app)
      .post("/api/auth/refresh")
      .send({ refreshToken: secondLogin.body.data.refreshToken });

    expect(firstLogin.statusCode).toBe(200);
    expect(secondLogin.statusCode).toBe(200);
    expect(oldTokenResponse.statusCode).toBe(401);
    expect(oldTokenResponse.body.message).toBe("Invalid refresh token");
    expect(latestTokenResponse.statusCode).toBe(200);
  });

  it("uses one atomic refresh-token consumer across canonical and legacy routes", async () => {
    const credentials = {
      email: "refresh.contracts@example.com",
      password: "Password123",
    };
    await createTestUser(credentials);
    const loginResponse = await request(app)
      .post("/api/auth/login")
      .send(credentials);
    const originalToken = loginResponse.body.data.refreshToken;

    const legacySuccess = await request(app)
      .post("/api/auth/refresh")
      .send({ refreshToken: originalToken });
    const canonicalReuse = await request(app)
      .post("/api/v1/auth/refresh")
      .send({ refreshToken: originalToken });
    const canonicalSuccess = await request(app)
      .post("/api/v1/auth/refresh")
      .send({ refreshToken: legacySuccess.body.data.refreshToken });
    const legacyReuse = await request(app)
      .post("/api/auth/refresh")
      .send({ refreshToken: legacySuccess.body.data.refreshToken });

    expect(legacySuccess.statusCode).toBe(200);
    expect(canonicalReuse.statusCode).toBe(401);
    expect(canonicalReuse.body).toMatchObject({
      code: "INVALID_REFRESH_TOKEN",
      retryable: false,
    });
    expect(canonicalSuccess.statusCode).toBe(200);
    expect(canonicalSuccess.body.data).toHaveProperty("accessToken");
    expect(legacyReuse.statusCode).toBe(401);
    expect(legacyReuse.body.message).toBe("Invalid refresh token");
    expect(
      await RefreshToken.countDocuments({ isRevoked: false })
    ).toBe(1);
  });

  it("allows exactly one of 20 concurrent refreshes for five rounds", async () => {
    for (let round = 0; round < 5; round += 1) {
      const credentials = {
        email: `refresh.concurrent.${round}@example.com`,
        password: "Password123",
      };
      const user = await createTestUser(credentials);
      const loginResponse = await request(app)
        .post("/api/auth/login")
        .send(credentials);
      const originalToken = loginResponse.body.data.refreshToken;
      const originalTokenHash = crypto
        .createHash("sha256")
        .update(originalToken)
        .digest("hex");

      const responses = await Promise.all(
        Array.from({ length: 20 }, () =>
          request(app)
            .post("/api/v1/auth/refresh")
            .send({ refreshToken: originalToken })
        )
      );
      const successes = responses.filter(
        (response) => response.statusCode === 200
      );
      const failures = responses.filter(
        (response) => response.statusCode !== 200
      );

      expect(successes).toHaveLength(1);
      expect(failures).toHaveLength(19);
      for (const response of failures) {
        expect(response.statusCode).toBe(401);
        expect(response.body).toMatchObject({
          code: "INVALID_REFRESH_TOKEN",
          retryable: false,
        });
      }

      const originalRecord = await RefreshToken.findOne({
        tokenHash: originalTokenHash,
      });
      expect(originalRecord.isRevoked).toBe(true);
      expect(
        await RefreshToken.countDocuments({
          userId: user._id,
          isRevoked: false,
        })
      ).toBe(1);
      expect(
        await RefreshToken.countDocuments({ userId: user._id })
      ).toBe(2);
    }
  });

  it("rolls back old-token consumption when successor creation fails", async () => {
    const credentials = {
      email: "refresh.rollback@example.com",
      password: "Password123",
    };
    const user = await createTestUser(credentials);
    const loginResponse = await request(app)
      .post("/api/auth/login")
      .send(credentials);
    const originalToken = loginResponse.body.data.refreshToken;
    const originalTokenHash = crypto
      .createHash("sha256")
      .update(originalToken)
      .digest("hex");
    const createSpy = jest
      .spyOn(RefreshToken, "create")
      .mockRejectedValueOnce(new Error("controlled successor creation failure"));

    const failedResponse = await request(app)
      .post("/api/v1/auth/refresh")
      .send({ refreshToken: originalToken });
    createSpy.mockRestore();

    expect(failedResponse.statusCode).toBe(500);
    expect(failedResponse.body).toMatchObject({
      code: "INTERNAL_ERROR",
      retryable: false,
    });
    expect(JSON.stringify(failedResponse.body)).not.toContain(
      "controlled successor creation failure"
    );

    const rolledBackOriginal = await RefreshToken.findOne({
      tokenHash: originalTokenHash,
    });
    expect(rolledBackOriginal.isRevoked).toBe(false);
    expect(
      await RefreshToken.countDocuments({ userId: user._id })
    ).toBe(1);

    const retryResponse = await request(app)
      .post("/api/v1/auth/refresh")
      .send({ refreshToken: originalToken });

    expect(retryResponse.statusCode).toBe(200);
    expect(
      await RefreshToken.countDocuments({
        userId: user._id,
        isRevoked: false,
      })
    ).toBe(1);
    expect(
      await RefreshToken.countDocuments({ userId: user._id })
    ).toBe(2);
  });

  it("does not revoke an existing session when new refresh token creation fails", async () => {
    const credentials = {
      email: "token.creation.failure@example.com",
      password: "Password123",
    };
    await createTestUser(credentials);

    const firstLogin = await request(app)
      .post("/api/auth/login")
      .send(credentials);
    const createSpy = jest
      .spyOn(RefreshToken, "create")
      .mockRejectedValueOnce(new Error("simulated token storage failure"));

    const failedLogin = await request(app)
      .post("/api/auth/login")
      .send(credentials);

    createSpy.mockRestore();

    const existingTokenResponse = await request(app)
      .post("/api/auth/refresh")
      .send({ refreshToken: firstLogin.body.data.refreshToken });

    expect(firstLogin.statusCode).toBe(200);
    expect(failedLogin.statusCode).toBe(500);
    expect(existingTokenResponse.statusCode).toBe(200);
  });

  it("keeps the newly created session usable when old-session cleanup fails", async () => {
    const credentials = {
      email: "token.cleanup.failure@example.com",
      password: "Password123",
    };
    await createTestUser(credentials);
    const logSpy = jest.spyOn(logger, "log");
    jest
      .spyOn(RefreshToken, "updateMany")
      .mockRejectedValueOnce(new Error("PRIVATE_CLEANUP_FAILURE_MARKER"));

    const loginResponse = await request(app)
      .post("/api/auth/login")
      .send(credentials);
    const refreshResponse = await request(app)
      .post("/api/auth/refresh")
      .send({ refreshToken: loginResponse.body.data.refreshToken });

    expect(loginResponse.statusCode).toBe(200);
    expect(refreshResponse.statusCode).toBe(200);
    expect(logSpy).toHaveBeenCalledWith(
      "application_error",
      expect.objectContaining({
        requestId: expect.any(String),
        correlationId: expect.any(String),
        statusCode: 500,
        errorCode: "REFRESH_TOKEN_REVOCATION_FAILED",
        retryable: true,
      })
    );
    expect(JSON.stringify(logSpy.mock.calls)).not.toContain(
      "PRIVATE_CLEANUP_FAILURE_MARKER"
    );
  });

  it("allows a correct login below the failed-attempt limit", async () => {
    const credentials = {
      email: "below.limit@example.com",
      password: "Password123",
    };
    await createTestUser(credentials);

    for (let attempt = 0; attempt < 4; attempt += 1) {
      const failedResponse = await request(app)
        .post("/api/auth/login")
        .send({ ...credentials, password: "WrongPassword123" });

      expect(failedResponse.statusCode).toBe(401);
    }

    const successResponse = await request(app)
      .post("/api/auth/login")
      .send(credentials);

    expect(successResponse.statusCode).toBe(200);
  });

  it("counts inactive wrong-password failures without exposing account status", async () => {
    const user = await createTestUser({
      email: "inactive.rate.limit@example.com",
      password: "Password123",
      status: "inactive",
    });
    const userBefore = await readUserState(user._id);
    const responses = [];

    for (let attempt = 0; attempt < 6; attempt += 1) {
      responses.push(
        await request(app)
          .post("/api/v1/auth/login")
          .send({
            email: "inactive.rate.limit@example.com",
            password: "WrongPassword123",
          })
      );
    }

    expect(responses.map((response) => response.statusCode)).toEqual([
      401, 401, 401, 401, 401, 429,
    ]);
    for (const response of responses.slice(0, 5)) {
      expect(response.body).toMatchObject({
        code: "AUTHENTICATION_FAILED",
        detail: "Invalid email or password",
        retryable: false,
      });
    }
    expect(responses[5].body).toMatchObject({
      code: "RATE_LIMITED",
      retryable: false,
    });
    expect(await RefreshToken.countDocuments({ userId: user._id })).toBe(0);
    expect(await readUserState(user._id)).toEqual(userBefore);
  });

  it("rate limits repeated failed login attempts", async () => {
    let throttledResponse;

    for (let attempt = 0; attempt < 6; attempt += 1) {
      const response = await request(app)
        .post("/api/auth/login")
        .send({
          email:
            attempt % 2 === 0
              ? "Rate.Limit@Example.com"
              : "rate.limit@example.com",
          password: "WrongPassword123",
        });

      if (response.statusCode === 429) {
        throttledResponse = response;
        break;
      }
    }

    expect(throttledResponse).toBeDefined();
    expect(throttledResponse.body.message).toBe(
      "Too many login attempts. Please try again later."
    );
  });
});
