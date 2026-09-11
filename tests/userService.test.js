const bcrypt = require("bcrypt");

const DomainError = require("../src/errors/DomainError");
const errorCodes = require("../src/errors/errorCodes");
const User = require("../src/models/User");
const userService = require("../src/services/userService");

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

describe("User service", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("creates a safe user result from plain values", async () => {
    const result = await userService.createUser({
      name: "Service User",
      email: "user.service@example.com",
      password: "Password123",
    });
    const stored = await User.findById(result.id).select("+password");

    expect(result).toMatchObject({
      name: "Service User",
      email: "user.service@example.com",
      role: "viewer",
      status: "active",
    });
    expect(result).not.toHaveProperty("password");
    expect(await bcrypt.compare("Password123", stored.password)).toBe(true);
  });

  it("maps duplicate prechecks to the stable domain error", async () => {
    const command = {
      name: "Duplicate Service User",
      email: "duplicate.service@example.com",
      password: "Password123",
    };
    await userService.createUser(command);

    await expect(userService.createUser(command)).rejects.toMatchObject({
      code: "DUPLICATE_RESOURCE",
      httpStatus: 409,
      retryable: false,
    });
  });

  it("maps a duplicate-key race without exposing database details", async () => {
    jest.spyOn(User, "findOne").mockResolvedValueOnce(null);
    jest.spyOn(User, "create").mockRejectedValueOnce({ code: 11000 });

    await expect(
      userService.createUser({
        name: "Racing User",
        email: "race.service@example.com",
        password: "Password123",
      })
    ).rejects.toMatchObject({
      code: "DUPLICATE_RESOURCE",
      httpStatus: 409,
      safeMessage: "A user with this email already exists",
    });
  });

  it("validates caller input before bcrypt without exposing the password", async () => {
    const submittedValue = "private-input-marker".slice(0, 7);
    const hashSpy = jest.spyOn(bcrypt, "hash");
    const failure = await userService
      .createUser({
        name: "Invalid Password User",
        email: "invalid.password@example.com",
        password: submittedValue,
      })
      .catch((error) => error);

    expect(failure).toBeInstanceOf(DomainError);
    expect(failure).toMatchObject({
      code: errorCodes.VALIDATION_FAILED,
      httpStatus: 400,
      retryable: false,
      errors: [
        {
          field: "password",
          message: "Password must be at least 8 characters long",
        },
      ],
    });
    expect(JSON.stringify(failure.errors)).not.toContain(submittedValue);
    expect(hashSpy).not.toHaveBeenCalled();
  });

  it.each(ACCEPTED_PASSWORD_BOUNDARIES)(
    "accepts %s",
    async (_caseName, password, caseKey) => {
      const email = `service.${caseKey}@example.com`;

      expect(Buffer.byteLength(password, "utf8")).toBe(72);

      const result = await userService.createUser({
        name: "Service Boundary User",
        email,
        password,
      });
      const stored = await User.findById(result.id).select("+password");

      expect(result).toMatchObject({
        email,
        role: "viewer",
        status: "active",
      });
      expect(result).not.toHaveProperty("password");
      expect(stored.password).not.toBe(password);
      expect(await bcrypt.compare(password, stored.password)).toBe(true);
    }
  );

  it.each(REJECTED_PASSWORD_BOUNDARIES)(
    "rejects %s before lookup, hashing, or persistence",
    async (_caseName, password, caseKey) => {
      const email = `service.${caseKey}@example.com`;
      const findOneSpy = jest.spyOn(User, "findOne");
      const hashSpy = jest.spyOn(bcrypt, "hash");
      const createSpy = jest.spyOn(User, "create");

      expect(Buffer.byteLength(password, "utf8")).toBe(73);

      const failure = await userService
        .createUser({
          name: "Rejected Service Boundary User",
          email,
          password,
        })
        .catch((error) => error);

      expect(failure).toBeInstanceOf(DomainError);
      expect(failure).toMatchObject({
        code: errorCodes.VALIDATION_FAILED,
        httpStatus: 400,
        message: PASSWORD_BYTE_LIMIT_MESSAGE,
        safeMessage: PASSWORD_BYTE_LIMIT_MESSAGE,
        retryable: false,
        errors: [
          {
            field: "password",
            message: PASSWORD_BYTE_LIMIT_MESSAGE,
          },
        ],
      });
      expect(JSON.stringify(failure.errors)).not.toContain(password);
      expect(findOneSpy).not.toHaveBeenCalled();
      expect(hashSpy).not.toHaveBeenCalled();
      expect(createSpy).not.toHaveBeenCalled();
      expect(await User.collection.findOne({ email })).toBeNull();
    }
  );

  it("types an unexpected bcrypt failure with a safe message and native cause", async () => {
    const rawError = new Error("private bcrypt marker");
    jest.spyOn(User, "findOne").mockResolvedValueOnce(null);
    jest.spyOn(bcrypt, "hash").mockRejectedValueOnce(rawError);

    const failure = await userService
      .createUser({
        name: "Bcrypt Failure User",
        email: "bcrypt.failure@example.com",
        password: "Password123",
      })
      .catch((error) => error);

    expect(failure).toBeInstanceOf(DomainError);
    expect(failure).toMatchObject({
      code: errorCodes.INTERNAL_ERROR,
      httpStatus: 500,
      retryable: false,
      safeMessage: "Could not create user",
      cause: rawError,
    });
    expect(failure.safeMessage).not.toContain("private bcrypt marker");
  });
});
