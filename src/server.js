require("dotenv").config();

const requiredEnvironmentVariables = ["MONGODB_URI", "JWT_ACCESS_SECRET"];
const missingEnvironmentVariables = requiredEnvironmentVariables.filter(
  (name) => !process.env[name]
);

if (missingEnvironmentVariables.length > 0) {
  throw new Error(
    `Missing required environment variables: ${missingEnvironmentVariables.join(
      ", "
    )}`
  );
}

const app = require("./app");
const connectDatabase = require("./config/database");

const PORT = process.env.PORT || 3000;

connectDatabase();

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});