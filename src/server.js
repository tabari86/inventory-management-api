require("dotenv").config({ quiet: true });

const app = require("./app");
const connectDatabase = require("./config/database");
const { closeDatabase } = require("./config/database");
const { logger } = require("./config/logger");
const { runtimeLifecycle } = require("./runtime/lifecycle");
const { startApplication } = require("./runtime/startup");
const {
  createShutdownOrchestrator,
  registerSignalHandlers,
} = require("./runtime/shutdown");

const requiredEnvironmentVariables = ["MONGODB_URI", "JWT_ACCESS_SECRET"];

const validateRequiredEnvironment = (environment = process.env) => {
  const missing = requiredEnvironmentVariables.filter(
    (name) => !environment[name]
  );
  if (missing.length > 0) {
    throw new Error(
      `Missing required environment variables: ${missing.join(", ")}`
    );
  }
};

const resolvePort = (value) => {
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 3000;
};

const main = async ({
  appInstance = app,
  connectDatabaseFn = () => connectDatabase({ logger }),
  closeDatabaseFn = closeDatabase,
  lifecycle = runtimeLifecycle,
  applicationLogger = logger,
  environment = process.env,
  processRef = process,
  exit = (code) => {
    processRef.exit(code);
  },
} = {}) => {
  const port = resolvePort(environment.PORT);

  try {
    validateRequiredEnvironment(environment);
  } catch (_error) {
    lifecycle.markFailed();
    applicationLogger.log("application_startup_failed", {
      exitCode: 1,
      errorCode: "STARTUP_CONFIGURATION_INVALID",
    });
    applicationLogger.flush();
    exit(1);
    return null;
  }

  const server = await startApplication({
    app: appInstance,
    connectDatabase: connectDatabaseFn,
    closeDatabase: closeDatabaseFn,
    lifecycle,
    logger: applicationLogger,
    port,
    exit,
  });
  if (!server) return null;

  const shutdown = createShutdownOrchestrator({
    server,
    closeDatabase: closeDatabaseFn,
    lifecycle,
    logger: applicationLogger,
    exit,
  });
  const unregisterSignals = registerSignalHandlers({ processRef, shutdown });

  return { server, shutdown, unregisterSignals };
};

if (require.main === module) {
  void main();
}

module.exports = {
  main,
  requiredEnvironmentVariables,
  resolvePort,
  validateRequiredEnvironment,
};
