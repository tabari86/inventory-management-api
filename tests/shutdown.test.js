const { EventEmitter } = require("events");

const { createRuntimeLifecycle } = require("../src/runtime/lifecycle");
const {
  createShutdownOrchestrator,
  registerSignalHandlers,
} = require("../src/runtime/shutdown");

const createLogger = () => ({ log: jest.fn(), flush: jest.fn() });

describe("Graceful shutdown", () => {
  it("marks unready first, closes HTTP before MongoDB, and is idempotent", async () => {
    const lifecycle = createRuntimeLifecycle();
    lifecycle.markReady();
    const order = [];
    const server = {
      listening: true,
      close: jest.fn((callback) => {
        order.push(`http:${lifecycle.getState()}`);
        server.listening = false;
        callback();
      }),
    };
    const closeDatabase = jest.fn(async () => order.push("database"));
    const logger = createLogger();
    const exit = jest.fn();
    const timeoutHandle = { unref: jest.fn() };
    const clearTimeoutFn = jest.fn();
    const shutdown = createShutdownOrchestrator({
      server,
      closeDatabase,
      lifecycle,
      logger,
      exit,
      setTimeoutFn: jest.fn(() => timeoutHandle),
      clearTimeoutFn,
    });

    const first = shutdown("SIGTERM");
    const second = shutdown("SIGINT");

    expect(second).toBe(first);
    await expect(first).resolves.toEqual({ timedOut: false, exitCode: 0 });
    expect(order).toEqual(["http:shutting_down", "database"]);
    expect(server.close).toHaveBeenCalledTimes(1);
    expect(closeDatabase).toHaveBeenCalledTimes(1);
    expect(clearTimeoutFn).toHaveBeenCalledWith(timeoutHandle);
    expect(lifecycle.getState()).toBe("stopped");
    expect(exit).toHaveBeenCalledWith(0);
  });

  it("forces connections closed and exits non-zero on timeout", async () => {
    const lifecycle = createRuntimeLifecycle();
    lifecycle.markReady();
    let expire;
    const timeoutHandle = { unref: jest.fn() };
    const server = {
      listening: true,
      close: jest.fn(),
      closeAllConnections: jest.fn(),
    };
    const closeDatabase = jest.fn().mockResolvedValue();
    const logger = createLogger();
    const exit = jest.fn();
    const clearTimeoutFn = jest.fn();
    const shutdown = createShutdownOrchestrator({
      server,
      closeDatabase,
      lifecycle,
      logger,
      exit,
      timeoutMs: 25,
      setTimeoutFn: jest.fn((callback) => {
        expire = callback;
        return timeoutHandle;
      }),
      clearTimeoutFn,
    });

    const result = shutdown("SIGINT");
    await Promise.resolve();
    expire();
    await expect(result).resolves.toEqual({ timedOut: true, exitCode: 1 });
    await Promise.resolve();

    expect(server.close).toHaveBeenCalledTimes(1);
    expect(server.closeAllConnections).toHaveBeenCalledTimes(1);
    expect(closeDatabase).toHaveBeenCalledTimes(1);
    expect(clearTimeoutFn).toHaveBeenCalledWith(timeoutHandle);
    expect(lifecycle.getState()).toBe("failed");
    expect(logger.log).toHaveBeenCalledWith(
      "application_shutdown_timeout",
      { signal: "SIGINT", timeoutMs: 25, exitCode: 1 }
    );
    expect(exit).toHaveBeenCalledWith(1);
  });

  it("fails safely when database close rejects without closing resources twice", async () => {
    const lifecycle = createRuntimeLifecycle();
    lifecycle.markReady();
    const privateMarker = "mongodb://user:password@private-host.invalid/database";
    const server = {
      listening: true,
      close: jest.fn((callback) => {
        server.listening = false;
        callback();
      }),
      closeAllConnections: jest.fn(),
    };
    const closeDatabase = jest
      .fn()
      .mockRejectedValue(new Error(privateMarker));
    const logger = createLogger();
    const exit = jest.fn();
    const timeoutHandle = { unref: jest.fn() };
    const clearTimeoutFn = jest.fn();
    const shutdown = createShutdownOrchestrator({
      server,
      closeDatabase,
      lifecycle,
      logger,
      exit,
      setTimeoutFn: jest.fn(() => timeoutHandle),
      clearTimeoutFn,
    });

    await expect(shutdown("SIGTERM")).resolves.toEqual({
      timedOut: false,
      exitCode: 1,
    });
    await Promise.resolve();

    expect(lifecycle.getState()).toBe("failed");
    expect(server.close).toHaveBeenCalledTimes(1);
    expect(server.closeAllConnections).toHaveBeenCalledTimes(1);
    expect(closeDatabase).toHaveBeenCalledTimes(1);
    expect(clearTimeoutFn).toHaveBeenCalledWith(timeoutHandle);
    expect(logger.log).toHaveBeenCalledWith(
      "application_shutdown_failed",
      {
        signal: "SIGTERM",
        exitCode: 1,
        errorCode: "SHUTDOWN_FAILED",
      }
    );
    expect(JSON.stringify(logger.log.mock.calls)).not.toContain(privateMarker);
    expect(exit).toHaveBeenCalledTimes(1);
    expect(exit).toHaveBeenCalledWith(1);
  });

  it.each(["SIGTERM", "SIGINT"])(
    "keeps the %s handler registered until explicit unregistration",
    async (signal) => {
      const processRef = new EventEmitter();
      const shutdown = jest.fn().mockResolvedValue();
      const unregister = registerSignalHandlers({ processRef, shutdown });

      processRef.emit(signal);
      processRef.emit(signal);
      await Promise.resolve();

      expect(shutdown.mock.calls).toEqual([[signal], [signal]]);

      unregister();
      processRef.emit(signal);

      expect(shutdown).toHaveBeenCalledTimes(2);
      expect(processRef.listenerCount("SIGTERM")).toBe(0);
      expect(processRef.listenerCount("SIGINT")).toBe(0);
    }
  );

  it("routes mixed signals through the same orchestrator", async () => {
    const processRef = new EventEmitter();
    const shutdown = jest.fn().mockResolvedValue();
    const unregister = registerSignalHandlers({ processRef, shutdown });

    processRef.emit("SIGTERM");
    processRef.emit("SIGINT");
    processRef.emit("SIGTERM");
    processRef.emit("SIGINT");
    await Promise.resolve();

    expect(shutdown.mock.calls).toEqual([
      ["SIGTERM"],
      ["SIGINT"],
      ["SIGTERM"],
      ["SIGINT"],
    ]);
    unregister();
    expect(processRef.listenerCount("SIGTERM")).toBe(0);
    expect(processRef.listenerCount("SIGINT")).toBe(0);
  });

  it("reuses one active shutdown for repeated registered signals", async () => {
    const processRef = new EventEmitter();
    const lifecycle = createRuntimeLifecycle();
    lifecycle.markReady();
    let finishHttpClose;
    const server = {
      listening: true,
      close: jest.fn((callback) => {
        finishHttpClose = () => {
          server.listening = false;
          callback();
        };
      }),
    };
    const closeDatabase = jest.fn().mockResolvedValue();
    const logger = createLogger();
    const exit = jest.fn();
    const timeoutHandle = { unref: jest.fn() };
    const shutdown = createShutdownOrchestrator({
      server,
      closeDatabase,
      lifecycle,
      logger,
      exit,
      setTimeoutFn: jest.fn(() => timeoutHandle),
      clearTimeoutFn: jest.fn(),
    });
    const trackedShutdown = jest.fn((signal) => shutdown(signal));
    const unregister = registerSignalHandlers({
      processRef,
      shutdown: trackedShutdown,
    });

    processRef.emit("SIGTERM");
    processRef.emit("SIGTERM");
    processRef.emit("SIGINT");

    expect(trackedShutdown).toHaveBeenCalledTimes(3);
    const activeShutdown = trackedShutdown.mock.results[0].value;
    expect(trackedShutdown.mock.results[1].value).toBe(activeShutdown);
    expect(trackedShutdown.mock.results[2].value).toBe(activeShutdown);
    expect(server.close).toHaveBeenCalledTimes(1);

    finishHttpClose();
    await expect(activeShutdown).resolves.toEqual({
      timedOut: false,
      exitCode: 0,
    });

    expect(closeDatabase).toHaveBeenCalledTimes(1);
    expect(exit).toHaveBeenCalledTimes(1);
    expect(exit).toHaveBeenCalledWith(0);

    unregister();
    processRef.emit("SIGTERM");
    processRef.emit("SIGINT");

    expect(trackedShutdown).toHaveBeenCalledTimes(3);
    expect(processRef.listenerCount("SIGTERM")).toBe(0);
    expect(processRef.listenerCount("SIGINT")).toBe(0);
  });
});
