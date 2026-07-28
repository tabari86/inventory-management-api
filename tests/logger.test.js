const { EventEmitter } = require("events");
const pino = require("pino");

const { createLogger } = require("../src/config/logger");
const { createHttpLogger } = require("../src/middleware/httpLogger");

const createCapture = () => {
  const output = [];
  return {
    output,
    destination: {
      write(chunk) {
        output.push(String(chunk));
      },
    },
  };
};

describe("Structured logging", () => {
  it("writes machine-parseable allowlisted JSON and excludes nested secrets", () => {
    const { output, destination } = createCapture();
    const logger = createLogger({
      destination,
      environment: "production",
      level: "info",
    });
    const secretMarkers = [
      "AUTHORIZATION_MARKER",
      "COOKIE_MARKER",
      "PASSWORD_MARKER",
      "PASSWORD_HASH_MARKER",
      "ACCESS_TOKEN_MARKER",
      "REFRESH_TOKEN_MARKER",
      "JWT_MARKER",
      "SECRET_MARKER",
      "MONGODB_URI_MARKER",
      "IDEMPOTENCY_KEY_MARKER",
      "REQUEST_BODY_MARKER",
      "RESPONSE_BODY_MARKER",
      "EMAIL_MARKER",
      "ROLE_MARKER",
      "STACK_MARKER",
      "SET_COOKIE_MARKER",
      "TOKEN_MARKER",
      "CLIENT_SECRET_MARKER",
      "MONGODB_URI_CAMEL_MARKER",
      "IDEMPOTENCY_HEADER_MARKER",
      "HEADERS_MARKER",
      "NAME_MARKER",
    ];

    logger.log("http_request_completed", {
      requestId: "request-001",
      correlationId: "correlation-001",
      method: "POST",
      path: "/api/products/:id",
      statusCode: 201,
      durationMs: 12.5,
      actor: {
        type: "user",
        id: "507f1f77bcf86cd799439011",
        email: secretMarkers[12],
        role: secretMarkers[13],
        name: secretMarkers[21],
      },
      authorization: secretMarkers[0],
      cookie: secretMarkers[1],
      "set-cookie": secretMarkers[15],
      password: secretMarkers[2],
      passwordHash: secretMarkers[3],
      accessToken: secretMarkers[4],
      refreshToken: secretMarkers[5],
      token: secretMarkers[16],
      jwt: secretMarkers[6],
      secret: secretMarkers[7],
      clientSecret: secretMarkers[17],
      MONGODB_URI: secretMarkers[8],
      mongodbUri: secretMarkers[18],
      idempotencyKey: secretMarkers[9],
      "Idempotency-Key": secretMarkers[19],
      requestBody: { nested: { password: secretMarkers[10] } },
      responseBody: { token: secretMarkers[11] },
      headers: { authorization: secretMarkers[20] },
      error: { stack: secretMarkers[14] },
    });
    logger.flush();

    expect(output).toHaveLength(1);
    const serialized = output[0];
    const record = JSON.parse(serialized);
    expect(record).toMatchObject({
      level: "info",
      service: "inventory-management-api",
      environment: "production",
      event: "http_request_completed",
      msg: "HTTP request completed",
      requestId: "request-001",
      correlationId: "correlation-001",
      method: "POST",
      path: "/api/products/:id",
      statusCode: 201,
      durationMs: 12.5,
      actor: { type: "user", id: "507f1f77bcf86cd799439011" },
    });
    expect(record.timestamp).toEqual(expect.any(String));
    expect(record.actor).toEqual({
      type: "user",
      id: "507f1f77bcf86cd799439011",
    });
    for (const marker of secretMarkers) expect(serialized).not.toContain(marker);
  });

  it("logs one completion for finish and close without query or header values", () => {
    const { output, destination } = createCapture();
    const logger = createLogger({
      destination,
      environment: "production",
      level: "info",
    });
    const req = {
      applicationContext: {
        requestId: "request-002",
        correlationId: "correlation-002",
        actor: {
          type: "user",
          id: "507f1f77bcf86cd799439012",
          email: "EMAIL_MARKER",
          role: "ROLE_MARKER",
        },
      },
      method: "GET",
      originalUrl: "/api/products/secret-id?password=QUERY_MARKER",
      baseUrl: "/api/products",
      route: { path: "/:id" },
      headers: {
        authorization: "Bearer JWT_MARKER",
        cookie: "COOKIE_MARKER",
        "idempotency-key": "IDEMPOTENCY_KEY_MARKER",
      },
    };
    const res = new EventEmitter();
    res.locals = {};
    res.statusCode = 200;
    const times = [10, 17.25];
    const middleware = createHttpLogger({
      logger,
      now: () => times.shift() ?? 17.25,
    });

    middleware(req, res, jest.fn());
    res.emit("finish");
    res.emit("close");
    logger.flush();

    expect(output).toHaveLength(1);
    const record = JSON.parse(output[0]);
    expect(record).toMatchObject({
      event: "http_request_completed",
      requestId: "request-002",
      correlationId: "correlation-002",
      method: "GET",
      path: "/api/products/:id",
      statusCode: 200,
      durationMs: 7.25,
      actor: { type: "user", id: "507f1f77bcf86cd799439012" },
      idempotencyKeyPresent: true,
    });
    for (const marker of [
      "secret-id",
      "QUERY_MARKER",
      "JWT_MARKER",
      "COOKIE_MARKER",
      "IDEMPOTENCY_KEY_MARKER",
      "EMAIL_MARKER",
      "ROLE_MARKER",
    ]) {
      expect(output[0]).not.toContain(marker);
    }
  });

  it("logs one safe aborted event when close occurs before finish", () => {
    const { output, destination } = createCapture();
    const logger = createLogger({
      destination,
      environment: "production",
      level: "info",
    });
    const req = {
      applicationContext: {
        requestId: "request-aborted-001",
        correlationId: "correlation-aborted-001",
        actor: {
          type: "user",
          id: "507f1f77bcf86cd799439013",
          email: "ABORTED_EMAIL_MARKER",
          role: "ABORTED_ROLE_MARKER",
        },
      },
      method: "POST",
      originalUrl: "/api/products/private-id?token=ABORTED_QUERY_MARKER",
      baseUrl: "/api/products",
      route: { path: "/:id" },
      headers: {
        authorization: "Bearer ABORTED_TOKEN_MARKER",
        cookie: "ABORTED_COOKIE_MARKER",
        "idempotency-key": "ABORTED_IDEMPOTENCY_MARKER",
      },
    };
    const res = new EventEmitter();
    res.locals = {};
    res.statusCode = 200;
    const times = [20, 24.5];
    const middleware = createHttpLogger({
      logger,
      now: () => times.shift() ?? 24.5,
    });

    middleware(req, res, jest.fn());
    res.emit("close");
    res.emit("close");
    res.emit("finish");
    logger.flush();

    expect(output).toHaveLength(1);
    const record = JSON.parse(output[0]);
    expect(record).toMatchObject({
      event: "http_request_aborted",
      requestId: "request-aborted-001",
      correlationId: "correlation-aborted-001",
      method: "POST",
      path: "/api/products/:id",
      durationMs: 4.5,
      actor: { type: "user", id: "507f1f77bcf86cd799439013" },
      idempotencyKeyPresent: true,
    });
    expect(record.event).not.toBe("http_request_completed");
    expect(record).not.toHaveProperty("statusCode");
    for (const marker of [
      "private-id",
      "ABORTED_QUERY_MARKER",
      "ABORTED_TOKEN_MARKER",
      "ABORTED_COOKIE_MARKER",
      "ABORTED_IDEMPOTENCY_MARKER",
      "ABORTED_EMAIL_MARKER",
      "ABORTED_ROLE_MARKER",
    ]) {
      expect(output[0]).not.toContain(marker);
    }
  });

  it("constructs the default production destination and emits valid JSON", () => {
    const { output, destination } = createCapture();
    const destinationSpy = jest
      .spyOn(pino, "destination")
      .mockReturnValue(destination);

    const logger = createLogger({
      environment: "production",
      level: "info",
    });
    logger.log("application_ready", { port: 3000 });
    logger.flush();

    expect(destinationSpy).toHaveBeenCalledWith({ dest: 1, sync: true });
    expect(output).toHaveLength(1);
    expect(JSON.parse(output[0])).toMatchObject({
      event: "application_ready",
      service: "inventory-management-api",
      environment: "production",
      port: 3000,
    });
    destinationSpy.mockRestore();
  });

  it("logs safe error metadata without production stack or raw Error fields", () => {
    const { output, destination } = createCapture();
    const logger = createLogger({
      destination,
      environment: "production",
      level: "info",
    });

    logger.log("application_error", {
      requestId: "request-003",
      correlationId: "correlation-003",
      statusCode: 409,
      errorCode: "INSUFFICIENT_STOCK",
      retryable: false,
      error: new Error("STACK_AND_DATABASE_MARKER"),
    });
    logger.flush();

    const record = JSON.parse(output[0]);
    expect(record).toMatchObject({
      event: "application_error",
      statusCode: 409,
      errorCode: "INSUFFICIENT_STOCK",
      retryable: false,
    });
    expect(output[0]).not.toContain("STACK_AND_DATABASE_MARKER");
    expect(record).not.toHaveProperty("stack");
    expect(record).not.toHaveProperty("error");
  });
});
