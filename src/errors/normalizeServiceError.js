const mongoose = require("mongoose");

const DomainError = require("./DomainError");
const errorCodes = require("./errorCodes");

const MAX_VALIDATION_DETAILS = 20;
const MAX_VALIDATION_FIELD_LENGTH = 128;
const MAX_VALIDATION_MESSAGE_LENGTH = 160;

const own = (value, key) =>
  Object.prototype.hasOwnProperty.call(value, key);

const recognizedValidationDetails = (error, validationPaths) => {
  if (!(error instanceof mongoose.Error.ValidationError)) return null;

  const childErrors = Object.values(error.errors || {});
  if (childErrors.length === 0) return null;

  const details = [];
  for (const childError of childErrors) {
    const field = childError?.path;
    const kind = childError?.kind;
    if (
      typeof field !== "string" ||
      typeof kind !== "string" ||
      !own(validationPaths, field) ||
      !own(validationPaths[field], kind) ||
      typeof validationPaths[field][kind] !== "string"
    ) {
      return null;
    }

    if (details.length < MAX_VALIDATION_DETAILS) {
      details.push({
        field: field.slice(0, MAX_VALIDATION_FIELD_LENGTH),
        message: validationPaths[field][kind].slice(
          0,
          MAX_VALIDATION_MESSAGE_LENGTH
        ),
      });
    }
  }

  return details;
};

const normalizeServiceError = (
  error,
  { safeMessage, validationPaths = {} }
) => {
  if (error instanceof DomainError) return error;

  const validationDetails = recognizedValidationDetails(
    error,
    validationPaths
  );
  if (validationDetails) {
    return new DomainError({
      code: errorCodes.VALIDATION_FAILED,
      httpStatus: 400,
      message: "Validation failed",
      safeMessage: "Validation failed",
      retryable: false,
      errors: validationDetails,
      cause: error,
    });
  }

  return new DomainError({
    code: errorCodes.INTERNAL_ERROR,
    httpStatus: 500,
    message: safeMessage,
    safeMessage,
    retryable: false,
    cause: error,
  });
};

module.exports = normalizeServiceError;
module.exports.MAX_VALIDATION_DETAILS = MAX_VALIDATION_DETAILS;
module.exports.MAX_VALIDATION_FIELD_LENGTH = MAX_VALIDATION_FIELD_LENGTH;
module.exports.MAX_VALIDATION_MESSAGE_LENGTH = MAX_VALIDATION_MESSAGE_LENGTH;
