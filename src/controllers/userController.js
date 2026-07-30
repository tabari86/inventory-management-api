const { sendSuccess } = require("../http/contract");
const userService = require("../services/userService");

const createUser = async (req, res, next) => {
  try {
    const user = await userService.createUser({
      name: req.body.name,
      email: req.body.email,
      password: req.body.password,
      role: req.body.role,
    });

    return sendSuccess(req, res, {
      statusCode: 201,
      message: "User created successfully",
      data: user,
    });
  } catch (error) {
    return next(error);
  }
};

module.exports = {
  createUser,
};
