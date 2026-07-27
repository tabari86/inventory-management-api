const Warehouse = require("../models/Warehouse");
const mongoose = require("mongoose");
const { sendInventoryMutation } = require("../services/idempotencyExecutor");
const warehouseService = require("../services/warehouseService");
const { buildCanonicalCommand } = require("../utils/canonicalJson");

const normalizeId = (id) => String(id).toLowerCase();
const commandFor = (req, normalizedBody, pathParameters = {}) =>
  buildCanonicalCommand({
    operationId: req.inventoryOperation.operationId,
    pathParameters,
    semanticQueryParameters: {},
    normalizedBody,
  });

const createWarehouse = async (req, res, next) => {
  try {
    const { code, name, description, status } = req.body;

    if (!code || !name) {
      return res.status(400).json({
        message: "Warehouse code and name are required",
      });
    }

    const input = {
      code: code.toUpperCase(),
      name,
      description,
      status,
    };

    return sendInventoryMutation({
      req,
      res,
      statusCode: 201,
      command: commandFor(req, input),
      execute: ({ session, eventCollector }) =>
        warehouseService.createWarehouse({
          ...input,
          session,
          eventCollector,
          context: req.applicationContext,
        }),
      buildResponse: (warehouse) => ({
        message: "Warehouse created successfully",
        data: warehouse,
      }),
    });
  } catch (error) {
    error.message = "Could not create warehouse";
    next(error);
  }
};

const createWarehousesBulk = async (req, res, next) => {
  try {
    const warehousesToCreate = req.body.map(
      ({ code, name, description, status }) => ({
        code: code.toUpperCase(),
        name,
        description,
        status,
      })
    );
    return sendInventoryMutation({
      req,
      res,
      statusCode: 201,
      command: commandFor(req, warehousesToCreate),
      execute: ({ session, eventCollector }) =>
        warehouseService.createWarehousesBulk({
          warehouses: warehousesToCreate,
          session,
          eventCollector,
          context: req.applicationContext,
        }),
      buildResponse: (data) => ({
        message: "Warehouses created successfully",
        data,
      }),
    });
  } catch (error) {
    error.clientMessage = "Could not create warehouses";
    next(error);
  }
};

const updateWarehousesBulk = async (req, res, next) => {
  try {
    const updates = req.body.map(
      ({ id, name, description, status, expectedVersion, deactivationReason }) =>
        ({
          id,
          name,
          description,
          status,
          expectedVersion,
          deactivationReason,
        })
    );
    return sendInventoryMutation({
      req,
      res,
      statusCode: 200,
      command: commandFor(
        req,
        updates.map((update) => ({ ...update, id: normalizeId(update.id) }))
      ),
      execute: ({ session, eventCollector }) =>
        warehouseService.updateWarehousesBulk({
          updates,
          actorId: req.user.id,
          session,
          eventCollector,
          context: req.applicationContext,
        }),
      buildResponse: (data) => ({
        message: "Warehouses updated successfully",
        data,
      }),
    });
  } catch (error) {
    error.clientMessage = "Could not update warehouses";
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
    const {
      name,
      description,
      status,
      expectedVersion,
      deactivationReason,
    } = req.body;
    const update = {
      name,
      description,
      status,
      expectedVersion,
      deactivationReason,
    };
    return sendInventoryMutation({
      req,
      res,
      statusCode: 200,
      command: commandFor(req, update, { id: normalizeId(id) }),
      execute: ({ session, eventCollector }) =>
        warehouseService.updateWarehouse({
          warehouseId: id,
          actorId: req.user.id,
          update,
          session,
          eventCollector,
          context: req.applicationContext,
        }),
      buildResponse: (updatedWarehouse) => ({
        message: "Warehouse updated successfully",
        data: updatedWarehouse,
      }),
    });
  } catch (error) {
    error.clientMessage = "Could not update warehouse";
    next(error);
  }
};

const deactivateWarehouse = async (req, res, next) => {
  try {
    const body = req.body || {};
    const input = {
      expectedVersion: body.expectedVersion,
      deactivationReason: body.deactivationReason,
    };
    return sendInventoryMutation({
      req,
      res,
      statusCode: 200,
      command: commandFor(req, input, { id: normalizeId(req.params.id) }),
      execute: ({ session, eventCollector }) =>
        warehouseService.deactivateWarehouse({
          warehouseId: req.params.id,
          actorId: req.user.id,
          ...input,
          session,
          eventCollector,
          context: req.applicationContext,
        }),
      buildResponse: (updatedWarehouse) => ({
        message: "Warehouse deactivated successfully",
        data: updatedWarehouse,
      }),
    });
  } catch (error) {
    error.clientMessage = "Could not deactivate warehouse";
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
