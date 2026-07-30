require("dotenv").config({ quiet: true });

const { createApp } = require("./app");
const connectDatabase = require("./config/database");
const { closeDatabase } = require("./config/database");
const { parseEnvironment } = require("./config/environment");
const { logger } = require("./config/logger");
const swaggerSpec = require("./config/swagger");
const { runtimeLifecycle } = require("./runtime/lifecycle");
const { startApplication } = require("./runtime/startup");
const {
  createShutdownOrchestrator,
  registerSignalHandlers,
} = require("./runtime/shutdown");

const main = async ({
  appInstance,
  connectDatabaseFn,
  closeDatabaseFn = closeDatabase,
  lifecycle = runtimeLifecycle,
  applicationLogger = logger,
  environment = process.env,
  processRef = process,
  exit = (code) => {
    processRef.exit(code);
  },
} = {}) => {
  let configuration;

  try {
    configuration = parseEnvironment(environment);
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

  const application =
    appInstance ||
    createApp({
      swaggerDocument: swaggerSpec.createSwaggerSpec({
        productionServerUrl: configuration.swaggerProductionUrl,
      }),
    });
  const databaseConnector =
    connectDatabaseFn ||
    (() =>
      connectDatabase({
        logger: applicationLogger,
        configuration: {
          mongodbUri: configuration.mongodbUri,
          nodeEnv: configuration.nodeEnv,
          dbConnectRetries: configuration.dbConnectRetries,
          dbConnectRetryDelayMs: configuration.dbConnectRetryDelayMs,
        },
      }));

  const server = await startApplication({
    app: application,
    connectDatabase: databaseConnector,
    closeDatabase: closeDatabaseFn,
    lifecycle,
    logger: applicationLogger,
    port: configuration.port,
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
};
