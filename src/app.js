const express = require("express");
const helmet = require("helmet");
const swaggerUi = require("swagger-ui-express");

const swaggerSpec = require("./config/swagger");
const errorHandler = require("./middleware/errorHandler");
const { requestContext } = require("./middleware/requestContext");

const productRoutes = require("./routes/productRoutes");
const warehouseRoutes = require("./routes/warehouseRoutes");
const stockRoutes = require("./routes/stockRoutes");
const stockMovementRoutes = require("./routes/stockMovementRoutes");
const goodsReceiptRoutes = require("./routes/goodsReceiptRoutes");
const goodsIssueRoutes = require("./routes/goodsIssueRoutes");
const authRoutes = require("./routes/authRoutes");
const userRoutes = require("./routes/userRoutes");

const app = express();

app.set("trust proxy", 1);
app.disable("x-powered-by");
app.use(requestContext);
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

app.get("/", (req, res) => {
  res.json({
    message: "Inventory Management API is running",
  });
});

app.get("/health", (req, res) => {
  res.json({
    status: "ok",
    service: "inventory-management-api",
  });
});

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

app.use(errorHandler);

module.exports = app;
