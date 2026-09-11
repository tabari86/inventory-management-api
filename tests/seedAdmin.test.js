const { seedAdmin } = require("../scripts/seedAdmin");
const {
  EnvironmentValidationError,
} = require("../src/config/environment");

const environment = (overrides = {}) => ({
  NODE_ENV: "test",
  MONGODB_URI: "mongodb://localhost:27017/inventory",
  ADMIN_NAME: "Initial Admin",
  ADMIN_EMAIL: "admin@example.com",
  ADMIN_PASSWORD: "temporary-admin-password",
  ...overrides,
});

describe("Admin seed command", () => {
  it("validates configuration before attempting a database connection", async () => {
    const connect = jest.fn();

    await expect(
      seedAdmin({ environment: environment({ ADMIN_PASSWORD: "" }), connect })
    ).rejects.toThrow("ADMIN_PASSWORD");

    expect(connect).not.toHaveBeenCalled();
  });

  it("creates an admin from normalized validated values", async () => {
    const connect = jest.fn().mockResolvedValue();
    const UserModel = {
      findOne: jest.fn().mockResolvedValueOnce(null).mockResolvedValueOnce(null),
      create: jest.fn().mockResolvedValue(),
    };
    const hashPassword = jest.fn().mockResolvedValue("stored-password-hash");
    const writeMessage = jest.fn();

    await seedAdmin({
      environment: environment({ ADMIN_EMAIL: "Admin@Example.com" }),
      connect,
      UserModel,
      hashPassword,
      writeMessage,
    });

    expect(connect).toHaveBeenCalledWith("mongodb://localhost:27017/inventory");
    expect(hashPassword).toHaveBeenCalledWith("temporary-admin-password", 10);
    expect(UserModel.create).toHaveBeenCalledWith({
      name: "Initial Admin",
      email: "admin@example.com",
      password: "stored-password-hash",
      role: "admin",
      status: "active",
    });
    expect(writeMessage).toHaveBeenCalledWith("Admin user created successfully");
  });

  it.each([
    ["ASCII", `${"A".repeat(72)}X`],
    ["short-looking multibyte", `${"é".repeat(36)}X`],
  ])(
    "rejects a 73-byte ADMIN_PASSWORD before seed side effects (%s)",
    async (_label, password) => {
      const connect = jest.fn();
      const UserModel = {
        findOne: jest.fn(),
        create: jest.fn(),
      };
      const hashPassword = jest.fn();
      const writeMessage = jest.fn();

      expect(Buffer.byteLength(password, "utf8")).toBe(73);

      let rejection;
      try {
        await seedAdmin({
          environment: environment({ ADMIN_PASSWORD: password }),
          connect,
          UserModel,
          hashPassword,
          writeMessage,
        });
      } catch (error) {
        rejection = error;
      }

      expect(rejection).toBeInstanceOf(EnvironmentValidationError);
      expect(rejection).toMatchObject({
        issues: [
          {
            variable: "ADMIN_PASSWORD",
            rule: "must be at most 72 UTF-8 bytes",
          },
        ],
      });
      expect(rejection.message).not.toContain(password);
      expect(JSON.stringify(rejection.issues)).not.toContain(password);
      expect(connect).not.toHaveBeenCalled();
      expect(UserModel.findOne).not.toHaveBeenCalled();
      expect(hashPassword).not.toHaveBeenCalled();
      expect(UserModel.create).not.toHaveBeenCalled();
      expect(writeMessage).not.toHaveBeenCalled();
    }
  );
});
