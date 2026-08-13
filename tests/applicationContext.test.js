const fs = require("fs");
const path = require("path");

const {
  ACTOR_TYPES,
  CONTEXT_ID_PATTERN,
  CONTEXT_SOURCES,
  MAX_CONTEXT_ID_LENGTH,
  SUPPORTED_CONTEXT_PAIRS,
  assertApplicationContext,
  isValidContextId,
} = require("../src/utils/applicationContext");

const buildContext = (overrides = {}) => ({
  requestId: "internal-action-001",
  correlationId: "internal-action-001",
  causationId: "internal-action-001",
  source: "internal",
  actor: {
    type: "service",
    id: "inventory-maintenance",
  },
  ...overrides,
});

describe("transport-neutral application context", () => {
  it("exports frozen exact actor, source, and pair constants", () => {
    expect(ACTOR_TYPES).toEqual({ USER: "user", SERVICE: "service" });
    expect(CONTEXT_SOURCES).toEqual({ HTTP_API: "http-api", INTERNAL: "internal" });
    expect(SUPPORTED_CONTEXT_PAIRS).toEqual([
      "http-api/user",
      "internal/service",
    ]);
    expect(Object.isFrozen(ACTOR_TYPES)).toBe(true);
    expect(Object.isFrozen(CONTEXT_SOURCES)).toBe(true);
    expect(Object.isFrozen(SUPPORTED_CONTEXT_PAIRS)).toBe(true);
    expect(CONTEXT_ID_PATTERN).toEqual(/^[A-Za-z0-9._:-]+$/);
    expect(MAX_CONTEXT_ID_LENGTH).toBe(128);
  });

  it.each([
    [
      "http-api/user",
      buildContext({
        source: "http-api",
        actor: { type: "user", id: "64b64c6f2f0f000000000001" },
      }),
    ],
    ["internal/service", buildContext()],
  ])("accepts the exact %s pair", (_label, context) => {
    expect(assertApplicationContext(context)).toBe(context);
  });

  it.each([
    ["http-api/service", { source: "http-api", actor: { type: "service", id: "svc" } }],
    ["internal/user", { source: "internal", actor: { type: "user", id: "user" } }],
    ["arbitrary actor", { source: "internal", actor: { type: "robot", id: "robot" } }],
    ["arbitrary source", { source: "queue", actor: { type: "service", id: "svc" } }],
  ])("rejects the unsupported %s context", (_label, override) => {
    expect(() => assertApplicationContext(buildContext(override))).toThrow(
      "Invalid application context"
    );
  });

  it.each([
    ["missing requestId", { requestId: undefined }],
    ["malformed requestId", { requestId: "request id", causationId: "request id" }],
    ["overlong requestId", { requestId: "r".repeat(129), causationId: "r".repeat(129) }],
    ["malformed correlationId", { correlationId: "correlation id" }],
    ["malformed causationId", { causationId: "causation id" }],
    ["malformed actor.id", { actor: { type: "service", id: "service id" } }],
  ])("rejects %s", (_label, override) => {
    expect(() => assertApplicationContext(buildContext(override))).toThrow(
      "Invalid application context"
    );
  });

  it("accepts one-character identity boundaries", () => {
    const context = buildContext({
      requestId: "r",
      correlationId: "c",
      causationId: "r",
      actor: { type: "service", id: "s" },
    });
    expect(assertApplicationContext(context)).toBe(context);
  });

  it("accepts 128-character identity boundaries", () => {
    const requestId = "r".repeat(128);
    const context = buildContext({
      requestId,
      correlationId: "c".repeat(128),
      causationId: requestId,
      actor: { type: "service", id: "s".repeat(128) },
    });
    expect(assertApplicationContext(context)).toBe(context);
  });

  it("rejects a distinct causation ID", () => {
    expect(() =>
      assertApplicationContext(buildContext({ causationId: "another-action" }))
    ).toThrow("Invalid application context");
  });

  it.each([
    ["extra top-level key", { debug: true }],
    ["metadata", { metadata: { token: "must-not-enter-context" } }],
    [
      "extra actor key",
      { actor: { type: "service", id: "inventory-maintenance", role: "admin" } },
    ],
  ])("rejects %s", (_label, override) => {
    expect(() => assertApplicationContext(buildContext(override))).toThrow(
      "Invalid application context"
    );
  });

  it.each([
    ["array", []],
    ["null", null],
    ["non-plain object", new (class ApplicationContext {})()],
  ])("rejects a %s context", (_label, context) => {
    expect(() => assertApplicationContext(context)).toThrow(
      "Invalid application context"
    );
  });

  it("rejects inherited and accessor-controlled fields", () => {
    const inherited = Object.assign(Object.create({ metadata: true }), buildContext());
    expect(() => assertApplicationContext(inherited)).toThrow(
      "Invalid application context"
    );

    const accessor = buildContext();
    Object.defineProperty(accessor, "requestId", {
      enumerable: true,
      get: () => "internal-action-001",
    });
    expect(() => assertApplicationContext(accessor)).toThrow(
      "Invalid application context"
    );
  });

  it("validates scalar IDs independently", () => {
    expect(isValidContextId("x")).toBe(true);
    expect(isValidContextId("x".repeat(128))).toBe(true);
    for (const value of ["", "x".repeat(129), "has space", "unicode-☃", [], {}]) {
      expect(isValidContextId(value)).toBe(false);
    }
  });

  it("has no Express, middleware, HTTP response, model, or logger dependency", () => {
    const source = fs.readFileSync(
      path.resolve(__dirname, "../src/utils/applicationContext.js"),
      "utf8"
    );
    expect(source).not.toMatch(/require\(["']express["']\)/);
    expect(source).not.toMatch(/require\(["'][^"']*middleware/);
    expect(source).not.toMatch(/require\(["'][^"']*controllers/);
    expect(source).not.toMatch(/require\(["'][^"']*http[\\/]contract/);
    expect(source).not.toMatch(/require\(["'][^"']*models/);
    expect(source).not.toMatch(/require\(["'][^"']*logger/);
  });
});
