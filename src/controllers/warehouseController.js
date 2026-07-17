const Warehouse = require("../models/Warehouse");
const mongoose = require("mongoose");

const createWarehouse = async (req, res, next) => {
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
    error.message = "Could not create warehouse";
    next(error);
  }
};

const createWarehousesBulk = async (req, res, next) => {
  try {
    const warehousesToCreate = req.body.map((warehouse) => ({
      ...warehouse,
      code: warehouse.code.toUpperCase(),
    }));
    const codes = warehousesToCreate.map((warehouse) => warehouse.code);

    if (new Set(codes).size !== codes.length) {
      return res.status(400).json({
        message: "Duplicate warehouse codes are not allowed in the same request",
      });
    }

    const existingWarehouse = await Warehouse.findOne({ code: { $in: codes } });

    if (existingWarehouse) {
      return res.status(409).json({
        message: "One or more warehouse codes already exist",
      });
    }

    const warehouses = await Warehouse.insertMany(warehousesToCreate);

    return res.status(201).json({
      message: "Warehouses created successfully",
      data: {
        createdCount: warehouses.length,
        warehouses,
      },
    });
  } catch (error) {
    if (error.code === 11000) {
      return res.status(409).json({
        message: "One or more warehouse codes already exist",
      });
    }

    error.message = "Could not create warehouses";
    next(error);
  }
};

const updateWarehousesBulk = async (req, res, next) => {
  try {
    const updates = req.body;
    const ids = updates.map((warehouse) => warehouse.id);

    if (new Set(ids).size !== ids.length) {
      return res.status(400).json({
        message: "Duplicate warehouse IDs are not allowed in the same request",
      });
    }

    const warehouses = await Warehouse.find({ _id: { $in: ids } });

    if (warehouses.length !== ids.length) {
      return res.status(404).json({
        message: "One or more warehouses were not found",
      });
    }

    const updatableFields = ["name", "description", "status"];
    const operations = updates.map(({ id, ...update }) => {
      const fieldsToUpdate = {};

      for (const field of updatableFields) {
        if (Object.prototype.hasOwnProperty.call(update, field)) {
          fieldsToUpdate[field] = update[field];
        }
      }

      return {
        updateOne: {
          filter: { _id: id },
          update: { $set: fieldsToUpdate },
        },
      };
    });

    await Warehouse.bulkWrite(operations);

    const updatedWarehouses = await Warehouse.find({ _id: { $in: ids } });
    const warehouseById = new Map(
      updatedWarehouses.map((warehouse) => [warehouse._id.toString(), warehouse])
    );

    return res.status(200).json({
      message: "Warehouses updated successfully",
      data: {
        updatedCount: updatedWarehouses.length,
        warehouses: ids.map((id) => warehouseById.get(id)),
      },
    });
  } catch (error) {
    error.message = "Could not update warehouses";
    next(error);
  }
};

const getWarehouses = async (req, res, next) => {
  try {
    const warehouses = await Warehouse.find().sort({ createdAt: -1 });

    return res.status(200).json({
      message: "Warehouses retrieved successfully",
      data: warehouses,
    });
  } catch (error) {
    error.message = "Could not retrieve warehouses";
    next(error);
  }
};

const getWarehouseById = async (req, res, next) => {
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
    error.message = "Could not retrieve warehouse";
    next(error);
  }
};

const updateWarehouse = async (req, res, next) => {
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
    error.message = "Could not update warehouse";
    next(error);
  }
};

const deactivateWarehouse = async (req, res, next) => {
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
    error.message = "Could not deactivate warehouse";
    next(error);
  }
};

module.exports = {
  createWarehouse,
  createWarehousesBulk,
  updateWarehousesBulk,
  getWarehouses,
  getWarehouseById,
  updateWarehouse,
  deactivateWarehouse,
};
