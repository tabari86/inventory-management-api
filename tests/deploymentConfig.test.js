const fs = require("fs");
const path = require("path");

const repositoryRoot = path.resolve(__dirname, "..");
const readRepositoryFile = (fileName) =>
  fs.readFileSync(path.join(repositoryRoot, fileName), "utf8");

describe("Deployment configuration", () => {
  it("copies the admin seed script into the production image", () => {
    const dockerfile = readRepositoryFile("Dockerfile");

    expect(dockerfile).toContain(
      "COPY scripts/seedAdmin.js ./scripts/seedAdmin.js"
    );
  });

  it("keeps Docker image construction in CI", () => {
    const workflow = readRepositoryFile(".github/workflows/ci.yml");

    expect(workflow).toContain(
      "docker build --tag inventory-management-api:ci ."
    );
  });

  it("enforces the WP8 CI security and release gates", () => {
    const workflow = readRepositoryFile(".github/workflows/ci.yml");

    expect(workflow).toContain("contents: read");
    expect(workflow).toContain("timeout-minutes:");
    expect(workflow).toContain("npm audit --omit=dev --audit-level=high");
    expect(workflow).toContain("npm run verify:security");
    expect(workflow).toContain("npm run validate:openapi");
    expect(workflow).toContain("docker compose config --quiet");
    expect(workflow).toContain("npm run verify:docker");
  });

  it("provides an explicit compose profile for admin seeding", () => {
    const compose = readRepositoryFile("docker-compose.yml");

    expect(compose).toContain("seed-admin:");
    expect(compose).toContain('profiles: ["seed"]');
    expect(compose).toContain("command: npm run seed:admin");
    expect(compose).toContain("condition: service_healthy");
  });

  it("configures local MongoDB as a persistent single-node replica set", () => {
    const compose = readRepositoryFile("docker-compose.yml");

    expect(compose).toContain('command: ["mongod", "--replSet", "rs0"');
    expect(compose).toContain("replicaSet=rs0");
    expect(compose).toContain("rs.initiate");
    expect(compose).toContain("mongo_data:/data/db");
  });

  it("classifies Compose as local development without weakening image defaults", () => {
    const compose = readRepositoryFile("docker-compose.yml");
    const dockerfile = readRepositoryFile("Dockerfile");

    expect(compose).toContain("NODE_ENV: development");
    expect(compose).not.toContain("container_name:");
    expect(compose).toContain("${API_HOST_PORT:-3000}:3000");
    expect(compose).toContain("${MONGO_HOST_PORT:-27017}:27017");
    expect(dockerfile).toContain("ENV NODE_ENV=production");
    expect(dockerfile).toContain("USER node");
  });

  it("keeps existing Render and Compose liveness paths compatible", () => {
    const render = readRepositoryFile("render.yaml");
    const compose = readRepositoryFile("docker-compose.yml");

    expect(render).toContain("healthCheckPath: /health");
    expect(compose).toContain("http://localhost:3000/health");
  });
});
