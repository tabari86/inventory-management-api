const bcrypt = require("bcrypt");

const User = require("../models/User");

const createUser = async (req, res, next) => {
  try {
    const { name, email, password, role = "viewer" } = req.body;

    const existingUser = await User.findOne({ email });

    if (existingUser) {
      return res.status(409).json({
        message: "A user with this email already exists",
      });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const user = await User.create({
      name,
      email,
      password: hashedPassword,
      role,
      status: "active",
    });

    return res.status(201).json({
      message: "User created successfully",
      data: {
        id: user._id,
        name: user.name,
        email: user.email,
        role: user.role,
        status: user.status,
      },
    });
  } catch (error) {
    if (error.code === 11000) {
      return res.status(409).json({
        message: "A user with this email already exists",
      });
    }

    error.message = "Could not create user";
    next(error);
  }
};

module.exports = {
  createUser,
};
