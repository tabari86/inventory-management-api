const {
  findSecurityViolations,
  readTrackedFiles,
} = require("../scripts/verifyRepositorySecurity");

const asFiles = (entries) =>
  new Map(
    Object.entries(entries).map(([file, content]) => [file, Buffer.from(content)])
  );

const safeExample = [
  "NODE_ENV=development",
  "JWT_ACCESS_SECRET=change_this_access_token_secret",
  "ADMIN_PASSWORD=change_this_admin_password",
].join("\n");

describe("Repository security verification", () => {
  it("accepts explicit examples", () => {
    const violations = findSecurityViolations(
      asFiles({
        ".env.example": safeExample,
      })
    );

    expect(violations).toEqual([]);
  });

  it("rejects real-looking embedded MongoDB credentials under tests", () => {
    const username = "account-user";
    const password = "credential-value";
    const credentialUri = [
      `mongodb://${username}:`,
      `${password}@database.example.com/inventory`,
    ].join("");
    const violations = findSecurityViolations(
      asFiles({
        ".env.example": safeExample,
        "tests/database.fixture.js": credentialUri,
      })
    );

    expect(violations).toEqual([
      {
        file: "tests/database.fixture.js",
        rule: "MONGODB_EMBEDDED_CREDENTIALS",
        category: "embedded MongoDB credentials",
      },
    ]);
  });

  it("accepts an explicit .invalid MongoDB credential fixture", () => {
    const violations = findSecurityViolations(
      asFiles({
        ".env.example": safeExample,
        "tests/database.fixture.js":
          "mongodb://test-user:test-password@database.invalid/inventory",
      })
    );

    expect(violations).toEqual([]);
  });

  it("accepts a credential-free local MongoDB URI", () => {
    const violations = findSecurityViolations(
      asFiles({
        ".env.example": safeExample,
        "docker-compose.yml":
          "MONGODB_URI: mongodb://mongo:27017/inventory?replicaSet=rs0",
      })
    );

    expect(violations).toEqual([]);
  });

  it("reports high-confidence categories without returning secret values", () => {
    const privateHeader = ["-----", "BEGIN PRIVATE KEY-----"].join("");
    const credentialUri = [
      "mongodb://live-user:",
      "private-value@database.internal/inventory",
    ].join("");
    const violations = findSecurityViolations(
      asFiles({
        ".env.example": safeExample,
        ".env.production": "JWT_ACCESS_SECRET=private-value",
        "src/private.js": `${privateHeader}\n${credentialUri}`,
      })
    );
    const serialized = JSON.stringify(violations);

    expect(violations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ rule: "TRACKED_ENV_FILE" }),
        expect.objectContaining({ rule: "PRIVATE_KEY_HEADER" }),
        expect.objectContaining({ rule: "MONGODB_EMBEDDED_CREDENTIALS" }),
      ])
    );
    expect(serialized).not.toContain("private-value");
    expect(serialized).not.toContain("live-user");
    for (const result of violations) {
      expect(Object.keys(result)).toEqual(["file", "rule", "category"]);
    }
  });

  it("passes against the current repository files", () => {
    expect(findSecurityViolations(readTrackedFiles())).toEqual([]);
  });
});
