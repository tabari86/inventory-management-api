const { spawnSync } = require("child_process");
const net = require("net");

const projectName = `inventory-api-smoke-${process.pid}`;

const run = (args, environment, { allowFailure = false } = {}) => {
  const result = spawnSync("docker", args, {
    encoding: "utf8",
    env: environment,
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (result.error) throw result.error;
  if (result.status !== 0 && !allowFailure) {
    const detail = (result.stderr || result.stdout || "Docker command failed")
      .trim()
      .split(/\r?\n/)
      .slice(-8)
      .join("\n");
    throw new Error(detail);
  }
  return (result.stdout || "").trim();
};

const getAvailablePort = () =>
  new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });

const readJsonEndpoint = async (url) => {
  const response = await fetch(url, { signal: AbortSignal.timeout(5000) });
  if (!response.ok) throw new Error(`${url} returned HTTP ${response.status}`);
  return response.json();
};

const main = async () => {
  const [apiPort, mongoPort] = await Promise.all([
    getAvailablePort(),
    getAvailablePort(),
  ]);
  const environment = {
    ...process.env,
    API_HOST_PORT: String(apiPort),
    MONGO_HOST_PORT: String(mongoPort),
    JWT_ACCESS_SECRET: "local_docker_smoke_secret_not_for_production_use",
    ADMIN_PASSWORD: "local_docker_smoke_admin_placeholder",
  };
  const compose = ["compose", "--project-name", projectName];
  let primaryError;

  try {
    run([...compose, "config", "--quiet"], environment);
    run(
      [
        ...compose,
        "up",
        "--detach",
        "--build",
        "--wait",
        "--wait-timeout",
        "180",
        "api",
      ],
      environment
    );

    const liveness = await readJsonEndpoint(
      `http://127.0.0.1:${apiPort}/health`
    );
    const readiness = await readJsonEndpoint(
      `http://127.0.0.1:${apiPort}/health/ready`
    );
    if (liveness.status !== "ok" || readiness.status !== "ready") {
      throw new Error("Docker health or readiness contract was not satisfied");
    }

    const containerId = run([...compose, "ps", "--quiet", "api"], environment);
    if (!containerId) throw new Error("The API container is not running");
    const [health, configuredUser] = run(
      [
        "inspect",
        "--format",
        "{{.State.Health.Status}}|{{.Config.User}}",
        containerId,
      ],
      environment
    ).split("|");
    const runtimeUserId = run(
      [...compose, "exec", "-T", "api", "id", "-u"],
      environment
    );
    if (health !== "healthy") {
      throw new Error("The API container is not healthy");
    }
    if (configuredUser !== "node" || runtimeUserId === "0") {
      throw new Error("The API process is not running as the non-root node user");
    }

    console.log("Docker runtime verification passed");
  } catch (error) {
    primaryError = error;
  } finally {
    const cleanup = spawnSync(
      "docker",
      [
        ...compose,
        "down",
        "--volumes",
        "--remove-orphans",
        "--timeout",
        "10",
      ],
      {
        encoding: "utf8",
        env: environment,
        stdio: ["ignore", "pipe", "pipe"],
      }
    );
    if (!primaryError && (cleanup.error || cleanup.status !== 0)) {
      primaryError = cleanup.error || new Error("Docker cleanup failed");
    }
  }

  if (primaryError) throw primaryError;
};

if (require.main === module) {
  void main().catch((error) => {
    console.error(`Docker runtime verification failed: ${error.message}`);
    process.exitCode = 1;
  });
}

module.exports = { getAvailablePort, readJsonEndpoint, run };
