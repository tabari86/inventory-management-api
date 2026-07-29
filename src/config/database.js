const mongoose = require("mongoose");

const { logger: defaultLogger } = require("./logger");

const parseNonNegativeInteger = (value, fallback) => {
  const parsedValue = Number.parseInt(value, 10);

  return Number.isInteger(parsedValue) && parsedValue >= 0
    ? parsedValue
    : fallback;
};

const wait = (delayMs) =>
  new Promise((resolve) => {
    setTimeout(resolve, delayMs);
  });

const connectDatabase = async ({
  logger = defaultLogger,
  connect = mongoose.connect.bind(mongoose),
  waitFn = wait,
} = {}) => {
  const maxRetries = parseNonNegativeInteger(
    process.env.DB_CONNECT_RETRIES,
    2
  );
  const retryDelayMs = parseNonNegativeInteger(
    process.env.DB_CONNECT_RETRY_DELAY_MS,
    1000
  );

  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    try {
      await connect(process.env.MONGODB_URI, {
        autoIndex: process.env.NODE_ENV !== "production",
      });

      logger.log("database_connected", { attempt: attempt + 1 });
      return mongoose.connection;
    } catch (_error) {
      const retrying = attempt < maxRetries;
      logger.log("database_connection_attempt_failed", {
        attempt: attempt + 1,
        maxAttempts: maxRetries + 1,
        retrying,
      });

      if (attempt === maxRetries) {
        throw new Error("Database connection failed");
      }

      await waitFn(retryDelayMs);
    }
  }
};

const closeDatabase = async () => {
  if (mongoose.connection.readyState === 0) return;
  await mongoose.connection.close();
};

module.exports = connectDatabase;
module.exports.closeDatabase = closeDatabase;
module.exports.parseNonNegativeInteger = parseNonNegativeInteger;
