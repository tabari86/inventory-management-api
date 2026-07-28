const DEFAULT_SHUTDOWN_TIMEOUT_MS = 10000;

const closeHttpServer = (server) =>
  new Promise((resolve, reject) => {
    if (!server?.close || server.listening === false) {
      resolve();
      return;
    }

    server.close((error) => {
      if (error) reject(error);
      else resolve();
    });
  });

const createShutdownOrchestrator = ({
  server,
  closeDatabase,
  lifecycle,
  logger,
  exit,
  timeoutMs = DEFAULT_SHUTDOWN_TIMEOUT_MS,
  setTimeoutFn = setTimeout,
  clearTimeoutFn = clearTimeout,
}) => {
  let shutdownPromise;
  let databaseClosePromise;

  const closeDatabaseOnce = () => {
    databaseClosePromise ||= Promise.resolve().then(closeDatabase);
    return databaseClosePromise;
  };

  return function shutdown(signal) {
    if (shutdownPromise) return shutdownPromise;

    shutdownPromise = (async () => {
      lifecycle.beginShutdown();
      logger.log("application_shutdown_started", { signal, timeoutMs });

      let timeoutHandle;
      const gracefulShutdown = (async () => {
        await closeHttpServer(server);
        await closeDatabaseOnce();
        return "completed";
      })();
      const timeout = new Promise((resolve) => {
        timeoutHandle = setTimeoutFn(() => resolve("timeout"), timeoutMs);
        timeoutHandle?.unref?.();
      });

      try {
        const result = await Promise.race([gracefulShutdown, timeout]);
        clearTimeoutFn(timeoutHandle);

        if (result === "timeout") {
          server?.closeAllConnections?.();
          void closeDatabaseOnce().catch(() => {});
          lifecycle.markFailed();
          logger.log("application_shutdown_timeout", {
            signal,
            timeoutMs,
            exitCode: 1,
          });
          logger.flush();
          exit(1);
          return { timedOut: true, exitCode: 1 };
        }

        lifecycle.markStopped();
        logger.log("application_shutdown_completed", {
          signal,
          exitCode: 0,
        });
        logger.flush();
        exit(0);
        return { timedOut: false, exitCode: 0 };
      } catch (_error) {
        clearTimeoutFn(timeoutHandle);
        server?.closeAllConnections?.();
        void closeDatabaseOnce().catch(() => {});
        lifecycle.markFailed();
        logger.log("application_shutdown_failed", {
          signal,
          exitCode: 1,
          errorCode: "SHUTDOWN_FAILED",
        });
        logger.flush();
        exit(1);
        return { timedOut: false, exitCode: 1 };
      }
    })();

    return shutdownPromise;
  };
};

const registerSignalHandlers = ({ processRef = process, shutdown }) => {
  const onSigterm = () => void shutdown("SIGTERM");
  const onSigint = () => void shutdown("SIGINT");

  processRef.on("SIGTERM", onSigterm);
  processRef.on("SIGINT", onSigint);

  return () => {
    processRef.removeListener("SIGTERM", onSigterm);
    processRef.removeListener("SIGINT", onSigint);
  };
};

module.exports = {
  DEFAULT_SHUTDOWN_TIMEOUT_MS,
  closeHttpServer,
  createShutdownOrchestrator,
  registerSignalHandlers,
};
