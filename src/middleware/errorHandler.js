const errorHandler = (error, req, res, next) => {
  const statusCode = error.statusCode || 500;
  const hideInternalDetails =
    process.env.NODE_ENV === "production" && statusCode >= 500;

  return res.status(statusCode).json({
    message: hideInternalDetails
      ? "Internal server error"
      : error.message || "Internal server error",
  });
};
module.exports = errorHandler;
