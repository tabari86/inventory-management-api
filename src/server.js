const express = require("express");
require("dotenv").config();

const connectDatabase = require("./config/database");
const productRoutes = require("./routes/productRoutes");
const warehouseRoutes = require("./routes/warehouseRoutes");
const stockRoutes = require("./routes/stockRoutes");

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

connectDatabase();

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});