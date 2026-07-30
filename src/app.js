const express = require("express");
const helmet = require("helmet");
const mongoose = require("mongoose");
const swaggerUi = require("swagger-ui-express");

const { logger: defaultLogger } = require("./config/logger");
const swaggerSpec = require("./config/swagger");
const { createErrorHandler } = require("./middleware/errorHandler");
const { createHttpLogger } = require("./middleware/httpLogger");
const { requestContext } = require("./middleware/requestContext");
const { runtimeLifecycle } = require("./runtime/lifecycle");
const { createHealthRouter } = require("./routes/healthRoutes");
const apiRouter = require("./routes/apiRouter");
const errorCodes = require("./errors/errorCodes");
const {
  API_CONTRACT_LEGACY,
  API_CONTRACT_V1,
  sendError,
  setApiContractVersion,
} = require("./http/contract");

const createApp = ({
  lifecycle = runtimeLifecycle,
  databaseConnection = mongoose.connection,
  logger = defaultLogger,
  swaggerDocument = swaggerSpec,
} = {}) => {
  const app = express();

  app.set("trust proxy", 1);
  app.disable("x-powered-by");
  app.use(requestContext);
  app.use(createHttpLogger({ logger }));
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'", "'unsafe-inline'"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          imgSrc: ["'self'", "data:"],
          objectSrc: ["'none'"],
          baseUri: ["'self'"],
          frameAncestors: ["'none'"],
        },
      },
    })
  );
  // Version context must be known before JSON parsing can reject a request.
  app.use("/api/v1", setApiContractVersion(API_CONTRACT_V1));
  app.use(express.json());

  app.get("/", (_req, res) => {
    res.json({
      message: "Inventory Management API is running",
    });
  });

  app.use(createHealthRouter({ lifecycle, databaseConnection }));

  // Swagger UI is intentionally public for portfolio and demo visibility.
  app.use("/api-docs", swaggerUi.serve, swaggerUi.setup(swaggerDocument));

  app.use("/api/v1", apiRouter);
  app.use("/api/v1", (req, res) =>
    sendError(req, res, {
      statusCode: 404,
      code: errorCodes.RESOURCE_NOT_FOUND,
      detail: "API route not found",
    })
  );

  app.use("/api", setApiContractVersion(API_CONTRACT_LEGACY), apiRouter);

  app.use(createErrorHandler(logger));

  return app;
};

const app = createApp();

module.exports = app;
module.exports.createApp = createApp;
