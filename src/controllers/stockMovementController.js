const readService = require("../services/readService");
const errorCodes = require("../errors/errorCodes");
const { sendError, sendPaginatedResult, sendSuccess } = require("../http/contract");

const getStockMovements = async (req, res, next) => {
  try {
    const page = await readService.listStockMovements(req.query);
    return sendPaginatedResult(req, res, {
      statusCode: 200,
      message: "Stock movements retrieved successfully",
      ...page,
    });
  } catch (error) {
    error.message = "Could not retrieve stock movements";
    next(error);
  }
};

const getStockMovementById = async (req, res, next) => {
  try {
    const stockMovement = await readService.getStockMovementById(req.params.id);

    if (!stockMovement) {
      return sendError(req, res, {
        statusCode: 404,
        code: errorCodes.RESOURCE_NOT_FOUND,
        detail: "Stock movement not found",
      });
    }

    return sendSuccess(req, res, {
      statusCode: 200,
      message: "Stock movement retrieved successfully",
      data: stockMovement,
    });
  } catch (error) {
    error.message = "Could not retrieve stock movement";
    next(error);
  }
};

module.exports = {
  getStockMovements,
  getStockMovementById,
};
