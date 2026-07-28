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

const productRoutes = require("./routes/productRoutes");
const warehouseRoutes = require("./routes/warehouseRoutes");
const stockRoutes = require("./routes/stockRoutes");
const stockMovementRoutes = require("./routes/stockMovementRoutes");
const goodsReceiptRoutes = require("./routes/goodsReceiptRoutes");
const goodsIssueRoutes = require("./routes/goodsIssueRoutes");
const authRoutes = require("./routes/authRoutes");
const userRoutes = require("./routes/userRoutes");

const createApp = ({
  lifecycle = runtimeLifecycle,
  databaseConnection = mongoose.connection,
  logger = defaultLogger,
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
  app.use(express.json());

  app.get("/", (_req, res) => {
    res.json({
      message: "Inventory Management API is running",
    });
  });

  app.use(createHealthRouter({ lifecycle, databaseConnection }));

  // Swagger UI is intentionally public for portfolio and demo visibility.
  app.use("/api-docs", swaggerUi.serve, swaggerUi.setup(swaggerSpec));

  app.use("/api/auth", authRoutes);
  app.use("/api/users", userRoutes);
  app.use("/api/products", productRoutes);
  app.use("/api/warehouses", warehouseRoutes);
  app.use("/api/stocks", stockRoutes);
  app.use("/api/stock-movements", stockMovementRoutes);
  app.use("/api/goods-receipts", goodsReceiptRoutes);
  app.use("/api/goods-issues", goodsIssueRoutes);

  app.use(createErrorHandler(logger));

  return app;
};

const app = createApp();

module.exports = app;
module.exports.createApp = createApp;
