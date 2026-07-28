const waitForListening = ({ app, port, onServer = () => {} }) =>
  new Promise((resolve, reject) => {
    let server;
    const cleanup = () => {
      server?.removeListener?.("error", onError);
      server?.removeListener?.("listening", onListening);
    };
    const onError = (error) => {
      cleanup();
      reject(error);
    };
    const onListening = () => {
      cleanup();
      resolve(server);
    };

    try {
      server = app.listen(port);
      onServer(server);
      server?.once?.("error", onError);
      if (server?.listening) onListening();
      else server?.once?.("listening", onListening);
    } catch (error) {
      reject(error);
    }
  });

const closeStartedServer = (server) =>
  new Promise((resolve) => {
    if (!server?.close || server.listening === false) {
      resolve();
      return;
    }
    server.close(() => resolve());
  });

const startApplication = async ({
  app,
  connectDatabase,
  closeDatabase,
  lifecycle,
  logger,
  port,
  exit,
}) => {
  let server;
  logger.log("application_starting", { port });

  try {
    await connectDatabase();
    server = await waitForListening({
      app,
      port,
      onServer: (startedServer) => {
        server = startedServer;
      },
    });
    logger.log("application_listening", { port });
    lifecycle.markReady();
    logger.log("application_ready", { port });
    return server;
  } catch (_error) {
    lifecycle.markFailed();
    await closeStartedServer(server);
    try {
      await closeDatabase();
    } catch {}
    logger.log("application_startup_failed", {
      exitCode: 1,
      errorCode: "STARTUP_FAILED",
    });
    logger.flush();
    exit(1);
    return null;
  }
};

module.exports = {
  closeStartedServer,
  startApplication,
  waitForListening,
};
