const SUPPORTED_ENVIRONMENTS = Object.freeze([
  "development",
  "test",
  "production",
]);

const DEFAULTS = Object.freeze({
  nodeEnv: "development",
  port: 3000,
  jwtAccessExpiresIn: "15m",
  dbConnectRetries: 2,
  dbConnectRetryDelayMs: 1000,
});

const LIMITS = Object.freeze({
  dbConnectRetries: 10,
  dbConnectRetryDelayMs: 60000,
  jwtAccessLifetimeMs: 24 * 60 * 60 * 1000,
});

const PRODUCTION_JWT_PLACEHOLDERS = new Set([
  "secret",
  "changeme",
  "password",
  "change_this_access_token_secret",
  "docker_local_access_token_secret",
  "test_access_token_secret",
]);

const PRODUCTION_ADMIN_PASSWORD_PLACEHOLDERS = new Set([
  "secret",
  "changeme",
  "password",
  "change_this_admin_password",
  "change_this_local_admin_password",
]);

class EnvironmentValidationError extends Error {
  constructor(issues) {
    const summary = issues
      .map(({ variable, rule }) => `${variable} (${rule})`)
      .join(", ");
    super(`Invalid environment configuration: ${summary}`);
    this.name = "EnvironmentValidationError";
    this.code = "STARTUP_CONFIGURATION_INVALID";
    this.issues = issues.map(({ variable, rule }) => ({ variable, rule }));
  }
}

const hasOwn = (environment, variable) =>
  Object.prototype.hasOwnProperty.call(environment, variable);

const readOptionalString = (environment, variable, issues) => {
  if (!hasOwn(environment, variable)) return undefined;
  const value = environment[variable];
  if (typeof value !== "string" || value.length === 0 || value.trim() !== value) {
    issues.push({ variable, rule: "must be a non-empty trimmed string" });
    return undefined;
  }
  return value;
};

const readRequiredString = (environment, variable, issues) => {
  const value = readOptionalString(environment, variable, issues);
  if (value === undefined && !hasOwn(environment, variable)) {
    issues.push({ variable, rule: "is required" });
  }
  return value;
};

const parseInteger = ({
  environment,
  variable,
  fallback,
  minimum,
  maximum,
  issues,
}) => {
  if (!hasOwn(environment, variable)) return fallback;
  const value = environment[variable];
  if (typeof value !== "string" || !/^(0|[1-9]\d*)$/.test(value)) {
    issues.push({
      variable,
      rule: `must be an integer from ${minimum} to ${maximum}`,
    });
    return fallback;
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    issues.push({
      variable,
      rule: `must be an integer from ${minimum} to ${maximum}`,
    });
    return fallback;
  }
  return parsed;
};

const parseNodeEnvironment = (environment, issues) => {
  if (!hasOwn(environment, "NODE_ENV")) return DEFAULTS.nodeEnv;
  const value = readOptionalString(environment, "NODE_ENV", issues);
  if (value === undefined) return DEFAULTS.nodeEnv;
  if (!SUPPORTED_ENVIRONMENTS.includes(value)) {
    issues.push({
      variable: "NODE_ENV",
      rule: `must be one of ${SUPPORTED_ENVIRONMENTS.join(", ")}`,
    });
    return DEFAULTS.nodeEnv;
  }
  return value;
};

const parseMongoUri = (environment, issues) => {
  const value = readRequiredString(environment, "MONGODB_URI", issues);
  if (value === undefined) return undefined;

  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    issues.push({
      variable: "MONGODB_URI",
      rule: "must be a valid mongodb:// or mongodb+srv:// URI",
    });
    return undefined;
  }

  if (
    !["mongodb:", "mongodb+srv:"].includes(parsed.protocol) ||
    !parsed.hostname
  ) {
    issues.push({
      variable: "MONGODB_URI",
      rule: "must be a valid mongodb:// or mongodb+srv:// URI",
    });
    return undefined;
  }
  return value;
};

const durationToMilliseconds = (amount, unit) => {
  const multipliers = {
    s: 1000,
    m: 60 * 1000,
    h: 60 * 60 * 1000,
    d: 24 * 60 * 60 * 1000,
  };
  return amount * multipliers[unit];
};

const parseAccessTokenLifetime = (environment, issues) => {
  if (!hasOwn(environment, "JWT_ACCESS_EXPIRES_IN")) {
    return DEFAULTS.jwtAccessExpiresIn;
  }
  const value = readOptionalString(
    environment,
    "JWT_ACCESS_EXPIRES_IN",
    issues
  );
  if (value === undefined) return DEFAULTS.jwtAccessExpiresIn;
  const match = /^(\d+)(s|m|h|d)$/.exec(value);
  if (!match) {
    issues.push({
      variable: "JWT_ACCESS_EXPIRES_IN",
      rule: "must be a positive duration using s, m, h, or d",
    });
    return DEFAULTS.jwtAccessExpiresIn;
  }

  const amount = Number(match[1]);
  const unit = match[2];
  const milliseconds = durationToMilliseconds(amount, unit);
  if (!Number.isSafeInteger(amount) || amount <= 0) {
    issues.push({
      variable: "JWT_ACCESS_EXPIRES_IN",
      rule: "must be a positive duration using s, m, h, or d",
    });
    return DEFAULTS.jwtAccessExpiresIn;
  }
  if (
    !Number.isSafeInteger(milliseconds) ||
    milliseconds > LIMITS.jwtAccessLifetimeMs
  ) {
    issues.push({
      variable: "JWT_ACCESS_EXPIRES_IN",
      rule: "must not exceed 24 hours",
    });
    return DEFAULTS.jwtAccessExpiresIn;
  }
  return `${amount}${unit}`;
};

const parseHttpUrl = (environment, nodeEnv, issues) => {
  const value = readOptionalString(
    environment,
    "SWAGGER_PRODUCTION_URL",
    issues
  );
  if (value === undefined) return undefined;

  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    issues.push({
      variable: "SWAGGER_PRODUCTION_URL",
      rule: "must be an absolute HTTP or HTTPS URL",
    });
    return undefined;
  }

  if (
    !["http:", "https:"].includes(parsed.protocol) ||
    !parsed.hostname ||
    parsed.username ||
    parsed.password
  ) {
    issues.push({
      variable: "SWAGGER_PRODUCTION_URL",
      rule: "must be an absolute HTTP or HTTPS URL without credentials",
    });
    return undefined;
  }
  if (nodeEnv === "production" && parsed.protocol !== "https:") {
    issues.push({
      variable: "SWAGGER_PRODUCTION_URL",
      rule: "must use HTTPS in production",
    });
    return undefined;
  }
  return parsed.toString().replace(/\/$/, "");
};

const isPlaceholder = (value, placeholders) =>
  placeholders.has(value.toLowerCase());

const parseEnvironment = (environment = process.env) => {
  const issues = [];
  const nodeEnv = parseNodeEnvironment(environment, issues);
  const mongodbUri = parseMongoUri(environment, issues);
  const jwtAccessSecret = readRequiredString(
    environment,
    "JWT_ACCESS_SECRET",
    issues
  );
  const jwtAccessExpiresIn = parseAccessTokenLifetime(environment, issues);
  const port = parseInteger({
    environment,
    variable: "PORT",
    fallback: DEFAULTS.port,
    minimum: 1,
    maximum: 65535,
    issues,
  });
  const dbConnectRetries = parseInteger({
    environment,
    variable: "DB_CONNECT_RETRIES",
    fallback: DEFAULTS.dbConnectRetries,
    minimum: 0,
    maximum: LIMITS.dbConnectRetries,
    issues,
  });
  const dbConnectRetryDelayMs = parseInteger({
    environment,
    variable: "DB_CONNECT_RETRY_DELAY_MS",
    fallback: DEFAULTS.dbConnectRetryDelayMs,
    minimum: 0,
    maximum: LIMITS.dbConnectRetryDelayMs,
    issues,
  });
  const swaggerProductionUrl = parseHttpUrl(environment, nodeEnv, issues);

  if (nodeEnv === "production" && jwtAccessSecret !== undefined) {
    if (jwtAccessSecret.length < 32) {
      issues.push({
        variable: "JWT_ACCESS_SECRET",
        rule: "must be at least 32 characters in production",
      });
    }
    if (isPlaceholder(jwtAccessSecret, PRODUCTION_JWT_PLACEHOLDERS)) {
      issues.push({
        variable: "JWT_ACCESS_SECRET",
        rule: "must not use a known placeholder in production",
      });
    }
  }

  if (issues.length > 0) throw new EnvironmentValidationError(issues);

  return Object.freeze({
    nodeEnv,
    port,
    mongodbUri,
    jwtAccessSecret,
    jwtAccessExpiresIn,
    dbConnectRetries,
    dbConnectRetryDelayMs,
    swaggerProductionUrl,
  });
};

const parseSeedAdminEnvironment = (environment = process.env) => {
  const issues = [];
  const nodeEnv = parseNodeEnvironment(environment, issues);
  const mongodbUri = parseMongoUri(environment, issues);
  const adminName = readRequiredString(environment, "ADMIN_NAME", issues);
  const adminEmail = readRequiredString(environment, "ADMIN_EMAIL", issues);
  const adminPassword = readRequiredString(
    environment,
    "ADMIN_PASSWORD",
    issues
  );

  if (
    adminName !== undefined &&
    (adminName.length < 2 || adminName.length > 120)
  ) {
    issues.push({
      variable: "ADMIN_NAME",
      rule: "must contain 2 to 120 characters",
    });
  }
  if (
    adminEmail !== undefined &&
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(adminEmail)
  ) {
    issues.push({
      variable: "ADMIN_EMAIL",
      rule: "must be a valid email address",
    });
  }
  if (adminPassword !== undefined && adminPassword.length < 8) {
    issues.push({
      variable: "ADMIN_PASSWORD",
      rule: "must contain at least 8 characters",
    });
  }
  if (nodeEnv === "production" && adminPassword !== undefined) {
    if (adminPassword.length < 12) {
      issues.push({
        variable: "ADMIN_PASSWORD",
        rule: "must contain at least 12 characters in production",
      });
    }
    if (isPlaceholder(adminPassword, PRODUCTION_ADMIN_PASSWORD_PLACEHOLDERS)) {
      issues.push({
        variable: "ADMIN_PASSWORD",
        rule: "must not use a known placeholder in production",
      });
    }
  }

  if (issues.length > 0) throw new EnvironmentValidationError(issues);

  return Object.freeze({
    nodeEnv,
    mongodbUri,
    adminName,
    adminEmail: adminEmail.toLowerCase(),
    adminPassword,
  });
};

module.exports = {
  DEFAULTS,
  EnvironmentValidationError,
  LIMITS,
  PRODUCTION_ADMIN_PASSWORD_PLACEHOLDERS,
  PRODUCTION_JWT_PLACEHOLDERS,
  SUPPORTED_ENVIRONMENTS,
  parseEnvironment,
  parseSeedAdminEnvironment,
};
