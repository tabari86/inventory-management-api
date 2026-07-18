const { ipKeyGenerator, rateLimit } = require("express-rate-limit");

const getLoginKey = (req) => {
  const normalizedEmail =
    typeof req.body?.email === "string"
      ? req.body.email.trim().toLowerCase()
      : "missing-email";

  return `${ipKeyGenerator(req.ip)}:${normalizedEmail}`;
};

// The default store is process-local and fits this demo/single-instance setup.
// Distributed deployments need a shared rate-limit store across all instances.
const loginRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 5,
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  keyGenerator: getLoginKey,
  message: {
    message: "Too many login attempts. Please try again later.",
  },
});

module.exports = loginRateLimiter;
