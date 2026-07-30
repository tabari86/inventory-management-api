const bcrypt = require("bcrypt");

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
});
