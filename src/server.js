const express = require("express");
require("dotenv").config();

const connectDatabase = require("./config/database");
const productRoutes = require("./routes/productRoutes");
const warehouseRoutes = require("./routes/warehouseRoutes");

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

connectDatabase();

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});