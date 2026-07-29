const { ipKeyGenerator, rateLimit } = require("express-rate-limit");
const errorCodes = require("../errors/errorCodes");
const { sendError } = require("../http/contract");

const getLoginKey = (req) => {
  const normalizedEmail =
    typeof req.body?.email === "string"
      ? req.body.email.trim().toLowerCase()
      : "missing-email";

  return `${ipKeyGenerator(req.ip)}:${normalizedEmail}`;
};

// The default store is process-local and fits this demo/single-instance setup.
// Distributed deployments need a shared rate-limit store across all instances.
const createLoginRateLimiter = (overrides = {}) =>
  rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 5,
    standardHeaders: true,
    legacyHeaders: false,
    skipSuccessfulRequests: true,
    keyGenerator: getLoginKey,
    handler: (req, res) =>
      sendError(req, res, {
        statusCode: 429,
        code: errorCodes.RATE_LIMITED,
        detail: "Too many login attempts. Please try again later.",
      }),
    ...overrides,
  });

const loginRateLimiter = createLoginRateLimiter();

module.exports = loginRateLimiter;
module.exports.createLoginRateLimiter = createLoginRateLimiter;
module.exports.getLoginKey = getLoginKey;
