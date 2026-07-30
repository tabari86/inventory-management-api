const bcrypt = require("bcrypt");
const mongoose = require("mongoose");

const User = require("../src/models/User");
const {
  EnvironmentValidationError,
  parseSeedAdminEnvironment,
} = require("../src/config/environment");

const seedAdmin = async ({
  environment = process.env,
  connect = mongoose.connect.bind(mongoose),
  UserModel = User,
  hashPassword = bcrypt.hash,
  writeMessage = console.log,
} = {}) => {
  const configuration = parseSeedAdminEnvironment(environment);

  await connect(configuration.mongodbUri);

  const userWithAdminEmail = await UserModel.findOne({
    email: configuration.adminEmail,
  });

  if (userWithAdminEmail && userWithAdminEmail.role !== "admin") {
    throw new Error(
      "A non-admin user already exists with ADMIN_EMAIL; no changes were made"
    );
  }

  const existingAdmin = await UserModel.findOne({ role: "admin" });

  if (existingAdmin) {
    writeMessage("An admin user already exists; no new admin was created");
    return;
  }

  const hashedPassword = await hashPassword(configuration.adminPassword, 10);

  await UserModel.create({
    name: configuration.adminName,
    email: configuration.adminEmail,
    password: hashedPassword,
    role: "admin",
    status: "active",
  });

  writeMessage("Admin user created successfully");
};

const main = async () => {
  require("dotenv").config({ quiet: true });
  try {
    await seedAdmin();
  } catch (error) {
    const errorCode =
      error instanceof EnvironmentValidationError
        ? "SEED_CONFIGURATION_INVALID"
        : "SEED_ADMIN_FAILED";
    console.error(`Could not seed admin (${errorCode})`);
    process.exitCode = 1;
  } finally {
    if (mongoose.connection.readyState !== 0) {
      await mongoose.disconnect();
    }
  }
};

if (require.main === module) {
  void main();
}

module.exports = { main, seedAdmin };
