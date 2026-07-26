const DomainError = require("../errors/DomainError");
const errorCodes = require("../errors/errorCodes");
const { hashIdempotencyKey } = require("../utils/idempotencyHash");
const getSingleHeader = require("../utils/singleHeader");

const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9._:-]+$/;

const isValidIdempotencyKey = (header) =>
  header.validCardinality &&
  typeof header.value === "string" &&
  header.value.length >= 8 &&
  header.value.length <= 128 &&
  !header.value.includes(",") &&
  IDEMPOTENCY_KEY_PATTERN.test(header.value);

const bindInventoryOperation = (operationId) => {
  const inventoryOperationMiddleware = (req, res, next) => {
    const header = getSingleHeader(req, "idempotency-key");

    req.inventoryOperation = {
      operationId,
      keyHash: null,
    };

    if (!header.present) return next();

    if (!isValidIdempotencyKey(header)) {
      return next(
        new DomainError({
          code: errorCodes.INVALID_IDEMPOTENCY_KEY,
          httpStatus: 400,
          message: "Invalid Idempotency-Key header",
          retryable: false,
        })
      );
    }

    req.inventoryOperation.keyHash = hashIdempotencyKey(header.value);
    return next();
  };

  Object.defineProperty(inventoryOperationMiddleware, "inventoryOperationId", {
    value: operationId,
    enumerable: true,
  });

  return inventoryOperationMiddleware;
};

module.exports = {
  IDEMPOTENCY_KEY_PATTERN,
  bindInventoryOperation,
  isValidIdempotencyKey,
};
