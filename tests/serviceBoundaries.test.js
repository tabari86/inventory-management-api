const fs = require("fs");
const path = require("path");

const authService = require("../src/services/authService");
const { executeInventoryMutation } = require("../src/services/idempotencyExecutor");
const userService = require("../src/services/userService");

const readSource = (relativePath) =>
  fs.readFileSync(path.resolve(__dirname, "..", relativePath), "utf8");

describe("Service and HTTP boundaries", () => {
  it("keeps authentication and user controllers free of persistence concerns", () => {
    const authController = readSource("src/controllers/authController.js");
    const userController = readSource("src/controllers/userController.js");

    for (const forbidden of [
      "models/User",
      "models/RefreshToken",
      "bcrypt",
      "crypto",
      "jsonwebtoken",
      "mongoose",
      "utils/transaction",
    ]) {
      expect(authController).not.toContain(forbidden);
    }
    for (const forbidden of ["models/User", "bcrypt", "mongoose"]) {
      expect(userController).not.toContain(forbidden);
    }
  });

  it("keeps the idempotency executor HTTP-independent and the wrapper under src/http", () => {
    const executor = readSource("src/services/idempotencyExecutor.js");
    const wrapper = readSource("src/http/sendInventoryMutation.js");

    expect(executor).not.toContain("../http/contract");
    expect(executor).not.toContain("sendInventoryMutation");
    expect(executor).not.toMatch(/\breq\b|\bres\b/);
    expect(wrapper).toContain("../services/idempotencyExecutor");
    expect(wrapper).toContain("./contract");
    expect(wrapper).toContain("const sendInventoryMutation");
  });

  it("exposes plain service functions and preserves the executor contract", async () => {
    expect(authService).toEqual(
      expect.objectContaining({
        login: expect.any(Function),
        logout: expect.any(Function),
        rotateRefreshToken: expect.any(Function),
      })
    );
    expect(userService.createUser).toEqual(expect.any(Function));

    await expect(executeInventoryMutation({})).rejects.toMatchObject({
      code: "VALIDATION_FAILED",
      httpStatus: 500,
    });
  });
});
