const mongoose = require("mongoose");

const withTransaction = async (callback) => {
  const session = await mongoose.startSession();
  let transactionResult;
  let transactionError;
  let transactionFailed = false;

  try {
    transactionResult = await session.withTransaction(() => callback(session));
  } catch (error) {
    transactionFailed = true;
    transactionError = error;
  }

  try {
    await session.endSession();
  } catch (cleanupError) {
    // The settled transaction outcome must not be replaced by cleanup failure.
  }

  if (transactionFailed) {
    throw transactionError;
  }

  return transactionResult;
};

module.exports = withTransaction;
