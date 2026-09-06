const { performance } = require("perf_hooks");

const {
  API_CONTRACT_LEGACY,
  API_CONTRACT_V1,
} = require("../http/contract");

const UNRESOLVED_REQUEST_PATH = "/unresolved";
const SAFE_ROUTE_BASE = Symbol("safeRouteBase");
const SAFE_STATIC_MOUNT_PATTERN = /^\/[a-z0-9-]+$/;
const API_BASE_PATHS = Object.freeze({
  [API_CONTRACT_V1]: "/api/v1",
  [API_CONTRACT_LEGACY]: "/api",
});

const createRouteMountContext = (mountPath) => {
  if (!SAFE_STATIC_MOUNT_PATTERN.test(mountPath)) {
    throw new TypeError("Route mount path must be a safe static path");
  }

  return function routeMountContext(req, _res, next) {
    const apiBasePath = API_BASE_PATHS[req.apiContractVersion];
    if (apiBasePath) req[SAFE_ROUTE_BASE] = `${apiBasePath}${mountPath}`;
    return next();
  };
};

const safeRequestPath = (req) => {
  if (req.route?.path) {
    const routePath = Array.isArray(req.route.path)
      ? req.route.path[0]
      : req.route.path;
    const routeBase = req[SAFE_ROUTE_BASE] || req.baseUrl || "";
    return `${routeBase}${routePath}` || "/";
  }

  return UNRESOLVED_REQUEST_PATH;
};

const createHttpLogger = ({ logger, now = () => performance.now() }) =>
  function httpLogger(req, res, next) {
    const startedAt = now();
    let terminalLogged = false;
    let finished = false;

    const logTerminal = (event) => {
      if (terminalLogged) return;
      terminalLogged = true;
      const error = res.locals?.applicationError;
      const fields = {
        requestId: req.applicationContext?.requestId,
        correlationId: req.applicationContext?.correlationId,
        method: req.method,
        path: safeRequestPath(req),
        durationMs: Math.max(0, Number((now() - startedAt).toFixed(3))),
        actor: req.applicationContext?.actor,
        idempotencyKeyPresent: req.headers?.["idempotency-key"] !== undefined,
      };
      if (event === "http_request_completed") {
        fields.statusCode = res.statusCode;
        fields.errorCode = error?.code;
        fields.retryable = error?.retryable;
      }
      logger.log(event, fields);
    };

    res.once("finish", () => {
      finished = true;
      logTerminal("http_request_completed");
    });
    res.once("close", () => {
      if (!finished) logTerminal("http_request_aborted");
    });
    next();
  };

module.exports = {
  createHttpLogger,
  createRouteMountContext,
  safeRequestPath,
};
