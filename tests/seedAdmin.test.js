const { seedAdmin } = require("../scripts/seedAdmin");

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
});
