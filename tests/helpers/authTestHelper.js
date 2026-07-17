const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");

const User = require("../../src/models/User");

let userSequence = 0;

const createTestUser = async ({
  name = "Test User",
  email,
  password = "Password123",
  role = "viewer",
  status = "active",
} = {}) => {
  userSequence += 1;

  return User.create({
    name,
    email: email || `test.user.${userSequence}@example.com`,
    password: await bcrypt.hash(password, 4),
    role,
    status,
  });
};

const createAccessToken = (user) =>
  jwt.sign(
    {
      userId: user._id,
      role: user.role,
    },
    process.env.JWT_ACCESS_SECRET,
    { expiresIn: process.env.JWT_ACCESS_EXPIRES_IN || "15m" }
  );

const createRoleToken = async (role) => {
  const user = await createTestUser({
    name: `${role} Test User`,
    role,
  });

  return createAccessToken(user);
};

const createAdminToken = () => createRoleToken("admin");
const createManagerToken = () => createRoleToken("manager");
const createViewerToken = () => createRoleToken("viewer");

module.exports = {
  createTestUser,
  createAccessToken,
  createAdminToken,
  createManagerToken,
  createViewerToken,
};
