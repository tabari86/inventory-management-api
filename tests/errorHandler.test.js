const DomainError = require("../src/errors/DomainError");
const errorCodes = require("../src/errors/errorCodes");
const errorHandler = require("../src/middleware/errorHandler");

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
});
