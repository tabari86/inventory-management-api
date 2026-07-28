jest.mock("mongoose", () => ({
  connect: jest.fn(),
  connection: { readyState: 0, close: jest.fn() },
}));

const mongoose = require("mongoose");
const connectDatabase = require("../src/config/database");

describe("Database startup connection", () => {
  const originalRetries = process.env.DB_CONNECT_RETRIES;
  const originalRetryDelay = process.env.DB_CONNECT_RETRY_DELAY_MS;
  const logger = { log: jest.fn() };

  afterEach(() => {
    jest.clearAllMocks();

    if (originalRetries === undefined) {
      delete process.env.DB_CONNECT_RETRIES;
    } else {
      process.env.DB_CONNECT_RETRIES = originalRetries;
    }

    if (originalRetryDelay === undefined) {
      delete process.env.DB_CONNECT_RETRY_DELAY_MS;
    } else {
      process.env.DB_CONNECT_RETRY_DELAY_MS = originalRetryDelay;
    }
  });

  it("connects on the first attempt using MONGODB_URI", async () => {
    process.env.MONGODB_URI = "mongodb://localhost/test";
    process.env.DB_CONNECT_RETRIES = "2";
    process.env.DB_CONNECT_RETRY_DELAY_MS = "0";
    mongoose.connect.mockResolvedValue();

    await connectDatabase({ logger });

    expect(mongoose.connect).toHaveBeenCalledWith("mongodb://localhost/test");
    expect(mongoose.connect).toHaveBeenCalledTimes(1);
    expect(logger.log).toHaveBeenCalledWith("database_connected", {
      attempt: 1,
    });
  });

  it("connects successfully after one bounded retry", async () => {
    process.env.MONGODB_URI = "mongodb://localhost/test";
    process.env.DB_CONNECT_RETRIES = "2";
    process.env.DB_CONNECT_RETRY_DELAY_MS = "0";
    mongoose.connect
      .mockRejectedValueOnce(new Error("temporary connection failure"))
      .mockResolvedValueOnce();

    await connectDatabase({ logger, waitFn: jest.fn().mockResolvedValue() });

    expect(mongoose.connect).toHaveBeenCalledTimes(2);
    expect(logger.log).toHaveBeenNthCalledWith(
      1,
      "database_connection_attempt_failed",
      { attempt: 1, maxAttempts: 3, retrying: true }
    );
    expect(logger.log).toHaveBeenNthCalledWith(2, "database_connected", {
      attempt: 2,
    });
  });

  it("rejects with a sanitized error after retries are exhausted", async () => {
    process.env.DB_CONNECT_RETRIES = "1";
    process.env.DB_CONNECT_RETRY_DELAY_MS = "0";
    const privateMarker = "mongodb://user:password@private-host/database";
    mongoose.connect.mockRejectedValue(new Error(privateMarker));

    await expect(
      connectDatabase({ logger, waitFn: jest.fn().mockResolvedValue() })
    ).rejects.toThrow("Database connection failed");

    expect(mongoose.connect).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(logger.log.mock.calls)).not.toContain(privateMarker);
    expect(logger.log).toHaveBeenLastCalledWith(
      "database_connection_attempt_failed",
      { attempt: 2, maxAttempts: 2, retrying: false }
    );
  });
});
