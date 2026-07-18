const mongoose = require("mongoose");

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

const connectDatabase = async () => {
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
      await mongoose.connect(process.env.MONGODB_URI);

      console.log("MongoDB connected");
      return;
    } catch (error) {
      console.error(
        `Database connection attempt ${attempt + 1} failed: ${error.message}`
      );

      if (attempt === maxRetries) {
        console.error("Database connection failed after all attempts");
        process.exit(1);
        return;
      }

      console.log(`Retrying database connection in ${retryDelayMs}ms`);
      await wait(retryDelayMs);
    }
  }
};
module.exports = connectDatabase;
