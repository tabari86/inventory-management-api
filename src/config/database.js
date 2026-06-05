const mongoose = require("mongoose");

const connectDatabase = async () => {
  try {
    await mongoose.connect(process.env.MONGODB_URI);

    console.log("MongoDB connected");
  } catch (error) {
    console.error("Database connection failed");
    console.error(error.message);

    process.exit(1);
  }
};

module.exports = connectDatabase;