require("dotenv").config();

const bcrypt = require("bcrypt");
const mongoose = require("mongoose");

const User = require("../src/models/User");

const seedAdmin = async () => {
  const { ADMIN_NAME, ADMIN_EMAIL, ADMIN_PASSWORD, MONGODB_URI } = process.env;

  if (!ADMIN_NAME || !ADMIN_EMAIL || !ADMIN_PASSWORD) {
    throw new Error(
      "ADMIN_NAME, ADMIN_EMAIL and ADMIN_PASSWORD must all be provided"
    );
  }

  if (!MONGODB_URI) {
    throw new Error("MONGODB_URI must be provided");
  }

  await mongoose.connect(MONGODB_URI);

  const userWithAdminEmail = await User.findOne({ email: ADMIN_EMAIL });

  if (userWithAdminEmail && userWithAdminEmail.role !== "admin") {
    throw new Error(
      "A non-admin user already exists with ADMIN_EMAIL; no changes were made"
    );
  }

  const existingAdmin = await User.findOne({ role: "admin" });

  if (existingAdmin) {
    console.log("An admin user already exists; no new admin was created");
    return;
  }

  const hashedPassword = await bcrypt.hash(ADMIN_PASSWORD, 10);

  await User.create({
    name: ADMIN_NAME,
    email: ADMIN_EMAIL,
    password: hashedPassword,
    role: "admin",
    status: "active",
  });

  console.log("Admin user created successfully");
};

seedAdmin()
  .catch((error) => {
    console.error(`Could not seed admin: ${error.message}`);
    process.exitCode = 1;
  })
  .finally(async () => {
    if (mongoose.connection.readyState !== 0) {
      await mongoose.disconnect();
    }
  });
