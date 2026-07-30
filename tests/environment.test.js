const {
  EnvironmentValidationError,
  parseEnvironment,
  parseSeedAdminEnvironment,
} = require("../src/config/environment");

const validEnvironment = (overrides = {}) => ({
  NODE_ENV: "development",
  MONGODB_URI: "mongodb://localhost:27017/inventory",
  JWT_ACCESS_SECRET: "development-placeholder",
  ...overrides,
});

describe("Environment validation", () => {
  it("reports missing runtime requirements by variable name only", () => {
    expect(() => parseEnvironment({ NODE_ENV: "test" })).toThrow(
      EnvironmentValidationError
    );

    try {
      parseEnvironment({ NODE_ENV: "test" });
    } catch (error) {
      expect(error.code).toBe("STARTUP_CONFIGURATION_INVALID");
      expect(error.issues).toEqual(
        expect.arrayContaining([
          { variable: "MONGODB_URI", rule: "is required" },
          { variable: "JWT_ACCESS_SECRET", rule: "is required" },
        ])
      );
    }
  });

  it.each([
    ["NODE_ENV", "staging"],
    ["NODE_ENV", "PRODUCTION"],
    ["PORT", "3000x"],
    ["PORT", "0"],
    ["PORT", "65536"],
    ["MONGODB_URI", "https://database.example.com/inventory"],
    ["JWT_ACCESS_EXPIRES_IN", "15"],
    ["JWT_ACCESS_EXPIRES_IN", "15M"],
    ["JWT_ACCESS_EXPIRES_IN", "2d"],
    ["DB_CONNECT_RETRIES", "-1"],
    ["DB_CONNECT_RETRIES", "11"],
    ["DB_CONNECT_RETRY_DELAY_MS", "1000ms"],
    ["DB_CONNECT_RETRY_DELAY_MS", "60001"],
    ["SWAGGER_PRODUCTION_URL", "inventory.example.com"],
  ])("rejects malformed explicit %s values", (variable, value) => {
    expect(() =>
      parseEnvironment(validEnvironment({ [variable]: value }))
    ).toThrow(variable);
  });

  it.each(["0m", "00m", "000s"])(
    "rejects the zero JWT lifetime %s without exposing the literal",
    (lifetime) => {
      expect.assertions(4);
      try {
        parseEnvironment(
          validEnvironment({ JWT_ACCESS_EXPIRES_IN: lifetime })
        );
      } catch (error) {
        expect(error).toBeInstanceOf(EnvironmentValidationError);
        expect(error.message).toContain("JWT_ACCESS_EXPIRES_IN");
        expect(error.message).not.toContain(lifetime);
        expect(JSON.stringify(error.issues)).not.toContain(lifetime);
      }
    }
  );

  it("accepts and normalizes a positive JWT lifetime", () => {
    expect(
      parseEnvironment(
        validEnvironment({ JWT_ACCESS_EXPIRES_IN: "01m" })
      ).jwtAccessExpiresIn
    ).toBe("1m");
  });

  it.each(["secret", "changeme", "change_this_access_token_secret", "docker_local_access_token_secret"])(
    "rejects the production JWT placeholder %s without echoing it",
    (secret) => {
      expect.assertions(3);
      try {
        parseEnvironment(
          validEnvironment({
            NODE_ENV: "production",
            JWT_ACCESS_SECRET: secret,
          })
        );
      } catch (error) {
        expect(error.message).toContain("JWT_ACCESS_SECRET");
        expect(error.message).toContain("known placeholder");
        expect(JSON.stringify(error)).not.toContain(secret);
      }
    }
  );

  it("rejects short production JWT secrets without echoing the value", () => {
    const marker = "private-short-value";
    try {
      parseEnvironment(
        validEnvironment({
          NODE_ENV: "production",
          JWT_ACCESS_SECRET: marker,
        })
      );
      throw new Error("Expected validation to fail");
    } catch (error) {
      expect(error.message).toContain("at least 32 characters");
      expect(error.message).not.toContain(marker);
      expect(JSON.stringify(error.issues)).not.toContain(marker);
    }
  });

  it.each(["development", "test"])(
    "preserves %s compatibility and applies bounded defaults",
    (nodeEnv) => {
      const configuration = parseEnvironment(
        validEnvironment({ NODE_ENV: nodeEnv })
      );

      expect(configuration).toMatchObject({
        nodeEnv,
        port: 3000,
        jwtAccessExpiresIn: "15m",
        dbConnectRetries: 2,
        dbConnectRetryDelayMs: 1000,
      });
    }
  );

  it("returns normalized valid production configuration", () => {
    const configuration = parseEnvironment(
      validEnvironment({
        NODE_ENV: "production",
        PORT: "8443",
        MONGODB_URI: "mongodb+srv://cluster.example.com/inventory",
        JWT_ACCESS_SECRET: "a-secure-deployment-value-with-at-least-32-characters",
        JWT_ACCESS_EXPIRES_IN: "15m",
        DB_CONNECT_RETRIES: "4",
        DB_CONNECT_RETRY_DELAY_MS: "2500",
        SWAGGER_PRODUCTION_URL: "https://inventory.example.com/",
      })
    );

    expect(configuration).toEqual({
      nodeEnv: "production",
      port: 8443,
      mongodbUri: "mongodb+srv://cluster.example.com/inventory",
      jwtAccessSecret: "a-secure-deployment-value-with-at-least-32-characters",
      jwtAccessExpiresIn: "15m",
      dbConnectRetries: 4,
      dbConnectRetryDelayMs: 2500,
      swaggerProductionUrl: "https://inventory.example.com",
    });
    expect(Object.isFrozen(configuration)).toBe(true);
  });

  it("requires HTTPS for an explicitly configured production Swagger URL", () => {
    expect(() =>
      parseEnvironment(
        validEnvironment({
          NODE_ENV: "production",
          JWT_ACCESS_SECRET: "a-secure-deployment-value-with-at-least-32-characters",
          SWAGGER_PRODUCTION_URL: "http://inventory.example.com",
        })
      )
    ).toThrow("SWAGGER_PRODUCTION_URL");
  });
});

describe("Admin seed environment validation", () => {
  const validSeedEnvironment = (overrides = {}) => ({
    NODE_ENV: "development",
    MONGODB_URI: "mongodb://localhost:27017/inventory",
    ADMIN_NAME: "Initial Admin",
    ADMIN_EMAIL: "Admin@Example.com",
    ADMIN_PASSWORD: "local-placeholder-password",
    ...overrides,
  });

  it("normalizes valid seed configuration separately from API startup", () => {
    expect(parseSeedAdminEnvironment(validSeedEnvironment())).toEqual({
      nodeEnv: "development",
      mongodbUri: "mongodb://localhost:27017/inventory",
      adminName: "Initial Admin",
      adminEmail: "admin@example.com",
      adminPassword: "local-placeholder-password",
    });
  });

  it("rejects invalid seed email and password without leaking the password", () => {
    const password = "short";
    try {
      parseSeedAdminEnvironment(
        validSeedEnvironment({ ADMIN_EMAIL: "invalid", ADMIN_PASSWORD: password })
      );
      throw new Error("Expected validation to fail");
    } catch (error) {
      expect(error.message).toContain("ADMIN_EMAIL");
      expect(error.message).toContain("ADMIN_PASSWORD");
      expect(error.message).not.toContain(password);
    }
  });

  it("rejects the example admin password in production", () => {
    expect(() =>
      parseSeedAdminEnvironment(
        validSeedEnvironment({
          NODE_ENV: "production",
          ADMIN_PASSWORD: "change_this_admin_password",
        })
      )
    ).toThrow("known placeholder");
  });
});
