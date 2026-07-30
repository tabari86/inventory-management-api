const { executeInventoryMutation } = require("../services/idempotencyExecutor");
const { isV1Request, sendSuccess } = require("./contract");

const sendInventoryMutation = async ({
  req,
  res,
  presentV1Data,
  ...options
}) => {
  const outcome = await executeInventoryMutation({
    context: req.applicationContext,
    inventoryOperation: req.inventoryOperation,
    ...options,
  });

  if (outcome.replayed !== null) {
    res.setHeader("Idempotency-Replayed", String(outcome.replayed));
  }

  const data =
    isV1Request(req) && typeof presentV1Data === "function"
      ? presentV1Data(outcome.body.data)
      : outcome.body.data;

  return sendSuccess(req, res, {
    statusCode: outcome.statusCode,
    message: outcome.body.message,
    data,
  });
};

module.exports = sendInventoryMutation;
