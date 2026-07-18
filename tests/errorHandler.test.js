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
});
