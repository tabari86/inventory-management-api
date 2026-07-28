jest.mock("dotenv", () => ({ config: jest.fn() }));

const dotenv = require("dotenv");
const {
  main,
  requiredEnvironmentVariables,
  resolvePort,
  validateRequiredEnvironment,
} = require("../src/server");
const { createRuntimeLifecycle } = require("../src/runtime/lifecycle");

describe("Server entry point", () => {
  it("loads environment variables without dotenv console output", () => {
    expect(dotenv.config).toHaveBeenCalledWith({ quiet: true });
  });

  it("validates required startup environment without reading secret values", () => {
    expect(() =>
      validateRequiredEnvironment({ JWT_ACCESS_SECRET: "test-secret" })
    ).toThrow("MONGODB_URI");
    expect(() =>
      validateRequiredEnvironment({ MONGODB_URI: "mongodb://localhost/test" })
    ).toThrow("JWT_ACCESS_SECRET");
    expect(() =>
      validateRequiredEnvironment({
        MONGODB_URI: "mongodb://localhost/test",
        JWT_ACCESS_SECRET: "test-secret",
      })
    ).not.toThrow();
    expect(requiredEnvironmentVariables).toEqual([
      "MONGODB_URI",
      "JWT_ACCESS_SECRET",
    ]);
  });

  it("uses a safe default for invalid ports", () => {
    expect(resolvePort("8080")).toBe(8080);
    expect(resolvePort("not-a-port")).toBe(3000);
    expect(resolvePort("0")).toBe(3000);
  });

  it("reports configuration failure through an injectable non-zero exit boundary", async () => {
    const exit = jest.fn();
    const logger = { log: jest.fn(), flush: jest.fn() };
    const connectDatabaseFn = jest.fn();

    const result = await main({
      appInstance: { listen: jest.fn() },
      connectDatabaseFn,
      closeDatabaseFn: jest.fn(),
      lifecycle: createRuntimeLifecycle(),
      applicationLogger: logger,
      environment: { JWT_ACCESS_SECRET: "PRIVATE_SECRET_MARKER" },
      processRef: {},
      exit,
    });

    expect(result).toBeNull();
    expect(connectDatabaseFn).not.toHaveBeenCalled();
    expect(logger.log).toHaveBeenCalledWith("application_startup_failed", {
      exitCode: 1,
      errorCode: "STARTUP_CONFIGURATION_INVALID",
    });
    expect(JSON.stringify(logger.log.mock.calls)).not.toContain(
      "PRIVATE_SECRET_MARKER"
    );
    expect(exit).toHaveBeenCalledWith(1);
  });

  it("does not start listening or register process signals when imported", () => {
    const signalCounts = {
      SIGTERM: process.listenerCount("SIGTERM"),
      SIGINT: process.listenerCount("SIGINT"),
    };
    const app = require("../src/app");
    const listenSpy = jest.spyOn(app, "listen");
    const exitSpy = jest
      .spyOn(process, "exit")
      .mockImplementation(() => undefined);

    jest.isolateModules(() => {
      require("../src/server");
      require("../src/runtime/lifecycle");
      require("../src/runtime/shutdown");
    });

    expect(listenSpy).not.toHaveBeenCalled();
    expect(process.listenerCount("SIGTERM")).toBe(signalCounts.SIGTERM);
    expect(process.listenerCount("SIGINT")).toBe(signalCounts.SIGINT);
    expect(exitSpy).not.toHaveBeenCalled();
    listenSpy.mockRestore();
    exitSpy.mockRestore();
  });
});
