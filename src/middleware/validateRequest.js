const { validationResult } = require("express-validator");
const errorCodes = require("../errors/errorCodes");
const { sendError } = require("../http/contract");

const validateRequest = (req, res, next) => {
  const errors = validationResult(req);

  if (!errors.isEmpty()) {
    return sendError(req, res, {
      statusCode: 400,
      code: errorCodes.VALIDATION_FAILED,
      detail: "Validation failed",
      errors: errors.array().map((error) => ({
        field: error.path,
        message: error.msg,
      })),
    });
  }

  next();
};

module.exports = validateRequest;
