const Warehouse = require("../models/Warehouse");
const mongoose = require("mongoose");

const createWarehouse = async (req, res) => {
  try {
    const { code, name, description, status } = req.body;

    if (!code || !name) {
      return res.status(400).json({
        message: "Warehouse code and name are required",
      });
    }

    const existingWarehouse = await Warehouse.findOne({ code: code.toUpperCase() });

    if (existingWarehouse) {
      return res.status(409).json({
        message: "A warehouse with this code already exists",
      });
    }

   const warehouse = await Warehouse.create({
    code: code.toUpperCase(),
    name,
    description,
    status,
    });

    return res.status(201).json({
      message: "Warehouse created successfully",
      data: warehouse,
    });
  } catch (error) {
    return res.status(500).json({
      message: "Could not create warehouse",
    });
  }
};

const getWarehouses = async (req, res) => {
  try {
    const warehouses = await Warehouse.find().sort({ createdAt: -1 });

    return res.status(200).json({
      message: "Warehouses retrieved successfully",
      data: warehouses,
    });
  } catch (error) {
    return res.status(500).json({
      message: "Could not retrieve warehouses",
    });
  }
};

const getWarehouseById = async (req, res) => {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        message: "Invalid warehouse ID",
      });
    }

    const warehouse = await Warehouse.findById(id);

    if (!warehouse) {
      return res.status(404).json({
        message: "Warehouse not found",
      });
    }

    return res.status(200).json({
      message: "Warehouse retrieved successfully",
      data: warehouse,
    });
  } catch (error) {
    return res.status(500).json({
      message: "Could not retrieve warehouse",
    });
  }
};

const updateWarehouse = async (req, res) => {
  try {
    const { id } = req.params;
    const { name, description, status } = req.body;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        message: "Invalid warehouse ID",
      });
    }

    const warehouse = await Warehouse.findById(id);

    if (!warehouse) {
      return res.status(404).json({
        message: "Warehouse not found",
      });
    }

    if (name !== undefined) warehouse.name = name;
    if (description !== undefined) warehouse.description = description;
    if (status !== undefined) warehouse.status = status;

    const updatedWarehouse = await warehouse.save();

    return res.status(200).json({
      message: "Warehouse updated successfully",
      data: updatedWarehouse,
    });
  } catch (error) {
    return res.status(500).json({
      message: "Could not update warehouse",
    });
  }
};

const deactivateWarehouse = async (req, res) => {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        message: "Invalid warehouse ID",
      });
    }

    const warehouse = await Warehouse.findById(id);

    if (!warehouse) {
      return res.status(404).json({
        message: "Warehouse not found",
      });
    }

    warehouse.status = "inactive";

    const updatedWarehouse = await warehouse.save();

    return res.status(200).json({
      message: "Warehouse deactivated successfully",
      data: updatedWarehouse,
    });
  } catch (error) {
    return res.status(500).json({
      message: "Could not deactivate warehouse",
    });
  }
};

module.exports = {
  createWarehouse,
  getWarehouses,
  getWarehouseById,
  updateWarehouse,
  deactivateWarehouse,
};