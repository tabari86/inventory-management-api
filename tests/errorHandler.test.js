const mongoose = require("mongoose");

const { createLogger } = require("../src/config/logger");
const DomainError = require("../src/errors/DomainError");
const errorCodes = require("../src/errors/errorCodes");
const errorHandler = require("../src/middleware/errorHandler");
const { createErrorHandler } = require("../src/middleware/errorHandler");

const createCapture = () => {
  const output = [];
  return {
    output,
    destination: {
      write(chunk) {
        output.push(String(chunk));
      },
    },
  };
};

describe("Global error handler", () => {
  const originalNodeEnv = process.env.NODE_ENV;
  const createResponse = () => ({
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
  });

  afterEach(() => {
    process.env.NODE_ENV = originalNodeEnv;
  });

  it("returns useful non-production errors without a stack trace", () => {
    process.env.NODE_ENV = "test";
    const response = createResponse();

    errorHandler(new Error("Unexpected failure"), {}, response, jest.fn());

    expect(response.status).toHaveBeenCalledWith(500);
    expect(response.json).toHaveBeenCalledWith({
      message: "Unexpected failure",
    });
    expect(response.json.mock.calls[0][0]).not.toHaveProperty("stack");
  });

  it("hides internal server details in production", () => {
    process.env.NODE_ENV = "production";
    const response = createResponse();

    errorHandler(new Error("database host and credentials"), {}, response, jest.fn());

    expect(response.status).toHaveBeenCalledWith(500);
    expect(response.json).toHaveBeenCalledWith({
      message: "Internal server error",
    });
  });

  it.each([400, 401, 403, 404])(
    "preserves a clear %i operational error message in production",
    (statusCode) => {
      process.env.NODE_ENV = "production";
      const response = createResponse();
      const error = new Error("Clear client-facing error");
      error.statusCode = statusCode;

      errorHandler(error, {}, response, jest.fn());

      expect(response.status).toHaveBeenCalledWith(statusCode);
      expect(response.json).toHaveBeenCalledWith({
        message: "Clear client-facing error",
      });
    }
  );

  it("preserves typed DomainError fields and native cause internally", () => {
    const cause = new Error("internal database detail");
    const error = new DomainError({
      code: errorCodes.INSUFFICIENT_STOCK,
      httpStatus: 409,
      message: "Not enough stock available",
      retryable: true,
      cause,
    });

    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe("DomainError");
    expect(error.code).toBe(errorCodes.INSUFFICIENT_STOCK);
    expect(error.httpStatus).toBe(409);
    expect(error.retryable).toBe(true);
    expect(error.cause).toBe(cause);
  });

  it("maps DomainError without exposing typed fields or its cause", () => {
    process.env.NODE_ENV = "test";
    const response = createResponse();
    const error = new DomainError({
      code: errorCodes.RESOURCE_NOT_FOUND,
      httpStatus: 404,
      message: "Stock record not found",
      cause: new Error("internal database detail"),
    });

    errorHandler(error, {}, response, jest.fn());

    expect(response.status).toHaveBeenCalledWith(404);
    expect(response.json).toHaveBeenCalledWith({
      message: "Stock record not found",
    });
    expect(response.json.mock.calls[0][0]).not.toHaveProperty("code");
    expect(response.json.mock.calls[0][0]).not.toHaveProperty("retryable");
    expect(response.json.mock.calls[0][0]).not.toHaveProperty("cause");
  });

  it("passes only safe typed error context to structured logging", () => {
    process.env.NODE_ENV = "production";
    const response = createResponse();
    const logger = { log: jest.fn() };
    const handler = createErrorHandler(logger);
    const privateMarker = "mongodb://user:password@private-host.invalid/database";
    const error = new DomainError({
      code: errorCodes.DEPENDENCY_UNAVAILABLE,
      httpStatus: 503,
      message: "Inventory dependency is unavailable",
      retryable: true,
      cause: new Error(privateMarker),
    });

    handler(
      error,
      {
        applicationContext: {
          requestId: "request-004",
          correlationId: "correlation-004",
        },
      },
      response,
      jest.fn()
    );

    expect(logger.log).toHaveBeenCalledWith("application_error", {
      requestId: "request-004",
      correlationId: "correlation-004",
      statusCode: 503,
      errorCode: errorCodes.DEPENDENCY_UNAVAILABLE,
      retryable: true,
    });
    expect(JSON.stringify(logger.log.mock.calls)).not.toContain(privateMarker);
    expect(response.json).toHaveBeenCalledWith({
      message: "Internal server error",
    });
  });

  it("safely distinguishes database operational failures from application failures", () => {
    process.env.NODE_ENV = "production";
    const { output, destination } = createCapture();
    const logger = createLogger({
      destination,
      environment: "production",
      level: "info",
    });
    const handler = createErrorHandler(logger);
    const privateUri = [
      "mongodb://user",
      "password@private-host.invalid/database",
    ].join(":");
    const databaseFailure = new mongoose.mongo.MongoNetworkError(
      [
        "DATABASE_SECRET_V605",
        privateUri,
        "DATABASE_PASSWORD_V605@DATABASE_HOST_V605",
        "DATABASE_TOKEN_V605",
        "STACK_SECRET_V605",
      ].join(":")
    );
    const applicationFailure = new Error(
      "APPLICATION_SECRET_V605 STACK_SECRET_V605"
    );
    const cyclicApplicationFailure = new Error("CYCLE_SECRET_V605");
    cyclicApplicationFailure.cause = cyclicApplicationFailure;
    const validationFailure = new mongoose.Error.ValidationError();
    const castFailure = new mongoose.Error.CastError(
      "ObjectId",
      "private-cast-value",
      "id"
    );
    const internalError = (cause) =>
      new DomainError({
        code: errorCodes.INTERNAL_ERROR,
        httpStatus: 500,
        message: "Could not complete operation",
        cause,
      });
    const failureCases = [
      ["v605-direct-database", databaseFailure, "DATABASE"],
      ["v605-wrapped-database", internalError(databaseFailure), "DATABASE"],
      ["v605-direct-application", applicationFailure, "APPLICATION"],
      ["v605-wrapped-application", internalError(applicationFailure), "APPLICATION"],
      ["v605-cyclic-application", cyclicApplicationFailure, "APPLICATION"],
      ["v605-mongoose-validation", validationFailure, "APPLICATION"],
      ["v605-mongoose-cast", castFailure, "APPLICATION"],
    ];
    const typedCases = [
      ["v605-domain-stock", errorCodes.INSUFFICIENT_STOCK, 409, databaseFailure],
      ["v605-domain-missing", errorCodes.RESOURCE_NOT_FOUND, 404, databaseFailure],
      ["v605-domain-stale", errorCodes.STALE_VERSION, 409, databaseFailure],
      ["v605-domain-validation", errorCodes.VALIDATION_FAILED, 400, validationFailure],
    ];
    const emit = (requestId, error) =>
      handler(
        error,
        {
          applicationContext: {
            requestId,
            correlationId: `${requestId}-correlation`,
          },
        },
        createResponse(),
        jest.fn()
      );
    for (const [requestId, error] of failureCases) emit(requestId, error);
    for (const [requestId, code, httpStatus, cause] of typedCases) {
      emit(
        requestId,
        new DomainError({
          code,
          httpStatus,
          message: "Safe typed failure",
          cause,
        })
      );
    }
    logger.log("application_error", {
      requestId: "v605-invalid-class",
      correlationId: "v605-invalid-class-correlation",
      statusCode: 500,
      errorCode: errorCodes.INTERNAL_ERROR,
      retryable: false,
      failureClass: "UNBOUNDED_FAILURE_CLASS_V605",
    });
    logger.flush();

    const rawOutput = output.join("");
    const records = rawOutput
      .split(/\r?\n/)
      .filter(Boolean)
      .map(JSON.parse);
    for (const [requestId, _error, failureClass] of failureCases) {
      expect(
        records.find((record) => record.requestId === requestId)
      ).toMatchObject({
        event: "application_error",
        requestId,
        correlationId: `${requestId}-correlation`,
        statusCode: 500,
        errorCode: errorCodes.INTERNAL_ERROR,
        retryable: false,
        failureClass,
      });
    }
    for (const [requestId] of typedCases) {
      expect(
        records.find((record) => record.requestId === requestId)
      ).not.toHaveProperty("failureClass");
    }
    expect(
      records.find(({ requestId }) => requestId === "v605-invalid-class")
    ).not.toHaveProperty("failureClass");
    for (const marker of [
      "DATABASE_SECRET_V605",
      "APPLICATION_SECRET_V605",
      privateUri,
      "DATABASE_PASSWORD_V605",
      "DATABASE_HOST_V605",
      "DATABASE_TOKEN_V605",
      "STACK_SECRET_V605",
      "CYCLE_SECRET_V605",
      "UNBOUNDED_FAILURE_CLASS_V605",
    ]) {
      expect(rawOutput).not.toContain(marker);
    }
  });
});
