const request = require("supertest");

const { createApp } = require("../src/app");
const { createRuntimeLifecycle } = require("../src/runtime/lifecycle");

const silentLogger = () => ({ log: jest.fn(), flush: jest.fn() });

const buildApp = ({ lifecycle, databaseConnection }) =>
  createApp({
    lifecycle,
    databaseConnection,
    logger: silentLogger(),
  });

describe("Operational health endpoints", () => {
  it.each(["/health/live", "/health"])(
    "%s is an unauthenticated database-independent liveness check",
    async (path) => {
      let readinessReads = 0;
      const databaseConnection = {};
      Object.defineProperty(databaseConnection, "readyState", {
        get() {
          readinessReads += 1;
          return 0;
        },
      });
      const app = buildApp({
        lifecycle: createRuntimeLifecycle(),
        databaseConnection,
      });

      const response = await request(app).get(path);

      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        status: "ok",
        service: "inventory-management-api",
      });
      expect(readinessReads).toBe(0);
      expect(response.headers["x-request-id"]).toBeDefined();
      expect(response.headers["x-correlation-id"]).toBeDefined();
      expect(JSON.stringify(response.body)).not.toContain("mongodb://");
    }
  );

  it.each(["/health/ready", "/api/ready"])(
    "%s returns 200 only when lifecycle and MongoDB are ready",
    async (path) => {
      const lifecycle = createRuntimeLifecycle();
      const databaseConnection = { readyState: 1 };
      const app = buildApp({ lifecycle, databaseConnection });

      const starting = await request(app).get(path);
      lifecycle.markReady();
      const ready = await request(app).get(path);
      databaseConnection.readyState = 0;
      const disconnected = await request(app).get(path);
      databaseConnection.readyState = 1;
      lifecycle.beginShutdown();
      const shuttingDown = await request(app).get(path);

      expect(starting.status).toBe(503);
      expect(ready.status).toBe(200);
      expect(disconnected.status).toBe(503);
      expect(shuttingDown.status).toBe(503);
      expect(ready.body).toEqual({
        status: "ready",
        service: "inventory-management-api",
      });
      for (const response of [starting, ready, disconnected, shuttingDown]) {
        expect(response.headers["x-request-id"]).toBeDefined();
        expect(response.headers["x-correlation-id"]).toBeDefined();
        expect(JSON.stringify(response.body)).not.toContain("private-host");
      }
    }
  );
});
