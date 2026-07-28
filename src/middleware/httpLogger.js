const { performance } = require("perf_hooks");

const safeRequestPath = (req) => {
  if (req.route?.path) {
    const routePath = Array.isArray(req.route.path)
      ? req.route.path[0]
      : req.route.path;
    return `${req.baseUrl || ""}${routePath}` || "/";
  }

  try {
    return new URL(req.originalUrl || req.url || "/", "http://localhost")
      .pathname;
  } catch (_error) {
    return "/";
  }
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
  safeRequestPath,
};
