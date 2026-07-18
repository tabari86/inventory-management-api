jest.mock("mongoose", () => ({ connect: jest.fn() }));

const mongoose = require("mongoose");
const connectDatabase = require("../src/config/database");

describe("Database startup connection", () => {
  const originalRetries = process.env.DB_CONNECT_RETRIES;
  const originalRetryDelay = process.env.DB_CONNECT_RETRY_DELAY_MS;

  afterEach(() => {
    jest.restoreAllMocks();
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
    jest.spyOn(console, "log").mockImplementation(() => {});

    await connectDatabase();

    expect(mongoose.connect).toHaveBeenCalledWith("mongodb://localhost/test");
    expect(mongoose.connect).toHaveBeenCalledTimes(1);
  });

  it("connects successfully after one retry", async () => {
    process.env.MONGODB_URI = "mongodb://localhost/test";
    process.env.DB_CONNECT_RETRIES = "2";
    process.env.DB_CONNECT_RETRY_DELAY_MS = "0";
    mongoose.connect
      .mockRejectedValueOnce(new Error("temporary connection failure"))
      .mockResolvedValueOnce();
    jest.spyOn(console, "error").mockImplementation(() => {});
    jest.spyOn(console, "log").mockImplementation(() => {});
    const exitSpy = jest.spyOn(process, "exit").mockImplementation(() => {});

    await connectDatabase();

    expect(mongoose.connect).toHaveBeenCalledTimes(2);
    expect(exitSpy).not.toHaveBeenCalled();
  });

  it("exits with a non-zero code after retries are exhausted", async () => {
    process.env.DB_CONNECT_RETRIES = "1";
    process.env.DB_CONNECT_RETRY_DELAY_MS = "0";
    const connectionError = new Error("connection refused");
    mongoose.connect.mockRejectedValue(connectionError);
    const errorSpy = jest.spyOn(console, "error").mockImplementation(() => {});
    jest.spyOn(console, "log").mockImplementation(() => {});
    const exitSpy = jest.spyOn(process, "exit").mockImplementation(() => {});

    await connectDatabase();

    expect(mongoose.connect).toHaveBeenCalledTimes(2);
    expect(errorSpy).toHaveBeenCalledWith(
      "Database connection failed after all attempts"
    );
    expect(exitSpy).toHaveBeenCalledWith(1);
  });
});
