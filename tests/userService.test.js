const bcrypt = require("bcrypt");

const DomainError = require("../src/errors/DomainError");
const errorCodes = require("../src/errors/errorCodes");
const User = require("../src/models/User");
const userService = require("../src/services/userService");

require("./setupTestDb");

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
