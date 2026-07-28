const { EventEmitter } = require("events");

const { createRuntimeLifecycle } = require("../src/runtime/lifecycle");
const { startApplication } = require("../src/runtime/startup");

const deferred = () => {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
};

const createLogger = () => ({ log: jest.fn(), flush: jest.fn() });

describe("Application startup", () => {
  it("awaits the database and confirmed listener before becoming ready", async () => {
    const database = deferred();
    const lifecycle = createRuntimeLifecycle();
    const logger = createLogger();
    const exit = jest.fn();
    const server = new EventEmitter();
    server.listening = false;
    server.close = jest.fn((callback) => callback());
    const app = { listen: jest.fn(() => server) };

    const startup = startApplication({
      app,
      connectDatabase: () => database.promise,
      closeDatabase: jest.fn(),
      lifecycle,
      logger,
      port: 3000,
      exit,
    });

    expect(app.listen).not.toHaveBeenCalled();
    expect(lifecycle.isAcceptingTraffic()).toBe(false);

    database.resolve();
    await database.promise;
    await Promise.resolve();

    expect(app.listen).toHaveBeenCalledWith(3000);
    expect(lifecycle.isAcceptingTraffic()).toBe(false);

    server.listening = true;
    server.emit("listening");
    await expect(startup).resolves.toBe(server);

    expect(lifecycle.isAcceptingTraffic()).toBe(true);
    expect(logger.log.mock.calls.map(([event]) => event)).toEqual([
      "application_starting",
      "application_listening",
      "application_ready",
    ]);
    expect(exit).not.toHaveBeenCalled();
  });

  it("does not listen and exits non-zero after a sanitized database failure", async () => {
    const lifecycle = createRuntimeLifecycle();
    const logger = createLogger();
    const exit = jest.fn();
    const closeDatabase = jest.fn().mockResolvedValue();
    const privateMarker = "mongodb://user:password@private-host/database";
    const app = { listen: jest.fn() };

    const result = await startApplication({
      app,
      connectDatabase: jest.fn().mockRejectedValue(new Error(privateMarker)),
      closeDatabase,
      lifecycle,
      logger,
      port: 3000,
      exit,
    });

    expect(result).toBeNull();
    expect(app.listen).not.toHaveBeenCalled();
    expect(lifecycle.getState()).toBe("failed");
    expect(closeDatabase).toHaveBeenCalledTimes(1);
    expect(exit).toHaveBeenCalledWith(1);
    expect(logger.log).toHaveBeenLastCalledWith(
      "application_startup_failed",
      { exitCode: 1, errorCode: "STARTUP_FAILED" }
    );
    expect(JSON.stringify(logger.log.mock.calls)).not.toContain(privateMarker);
  });

  it("closes a partially started listener when listen fails", async () => {
    const lifecycle = createRuntimeLifecycle();
    const logger = createLogger();
    const server = new EventEmitter();
    server.listening = false;
    server.close = jest.fn((callback) => {
      server.listening = false;
      callback();
    });
    const app = { listen: jest.fn(() => server) };

    const startup = startApplication({
      app,
      connectDatabase: jest.fn().mockResolvedValue(),
      closeDatabase: jest.fn().mockResolvedValue(),
      lifecycle,
      logger,
      port: 3000,
      exit: jest.fn(),
    });
    await Promise.resolve();
    await Promise.resolve();
    expect(app.listen).toHaveBeenCalledTimes(1);
    server.listening = true;
    server.emit("error", new Error("listener failed"));

    await expect(startup).resolves.toBeNull();
    expect(server.close).toHaveBeenCalledTimes(1);
    expect(lifecycle.getState()).toBe("failed");
  });
});
