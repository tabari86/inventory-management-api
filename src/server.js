const express = require("express");
require("dotenv").config();

const connectDatabase = require("./config/database");
const errorHandler = require("./middleware/errorHandler");
const productRoutes = require("./routes/productRoutes");
const warehouseRoutes = require("./routes/warehouseRoutes");
const stockRoutes = require("./routes/stockRoutes");
const stockMovementRoutes = require("./routes/stockMovementRoutes");
const goodsReceiptRoutes = require("./routes/goodsReceiptRoutes");
const goodsIssueRoutes = require("./routes/goodsIssueRoutes");
const app = express();

const PORT = process.env.PORT || 3000;

app.use(express.json());

app.get("/", (req, res) => {
  res.json({
    message: "Inventory Management API is running",
  });
});

app.use("/api/products", productRoutes);
app.use("/api/warehouses", warehouseRoutes);
app.use("/api/stocks", stockRoutes);
app.use("/api/stock-movements", stockMovementRoutes);
app.use("/api/goods-receipts", goodsReceiptRoutes);
app.use("/api/goods-issues", goodsIssueRoutes);
app.use(errorHandler);

connectDatabase();

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});