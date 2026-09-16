"use strict";

const bcrypt = require("bcrypt");
const { fork } = require("child_process");
const { EventEmitter } = require("events");
const http = require("http");
const jwt = require("jsonwebtoken");
const mongoose = require("mongoose");
const { MongoMemoryReplSet } = require("mongodb-memory-server");
const net = require("net");
const path = require("path");

const AuditEvent = require("../src/models/AuditEvent");
const IdempotencyRecord = require("../src/models/IdempotencyRecord");
const OutboxEvent = require("../src/models/OutboxEvent");
const Product = require("../src/models/Product");
const Stock = require("../src/models/Stock");
const StockMovement = require("../src/models/StockMovement");
const User = require("../src/models/User");
const Warehouse = require("../src/models/Warehouse");
const { operations } = require("../src/services/inventoryOperationRegistry");
const { hashIdempotencyKey } = require("../src/utils/idempotencyHash");

const DATABASE_NAME = "wp9_scenario_j";
const JWT_SECRET = "wp9-scenario-j-test-secret-with-more-than-32-characters";
const REPOSITORY_ROOT = path.resolve(__dirname, "..");
const SERVER_ENTRY = path.join(REPOSITORY_ROOT, "src", "server.js");
const PAUSE_FIXTURE = path.join(
  REPOSITORY_ROOT,
  "tests",
  "fixtures",
  "scenarioJPause.js"
);
const SHUTDOWN_TIMEOUT_MS = 10_000;
const TARGET_OPERATION = operations.GOODS_ISSUE_SINGLE;

jest.setTimeout(150_000);

const describeWithRealSignals =
  process.platform === "win32" ? describe.skip : describe;

const waitWithin = (promise, timeoutMs, describeFailure) =>
  new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error(describeFailure()));
    }, timeoutMs);

    Promise.resolve(promise).then(
      (value) => {
        clearTimeout(timeout);
        resolve(value);
      },
      (error) => {
        clearTimeout(timeout);
        reject(error);
      }
    );
  });

const reservePort = () =>
  new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      server.close((error) => {
        if (error) reject(error);
        else resolve(port);
      });
    });
  });

const requestJson = ({
  port,
  path: requestPath,
  method = "GET",
  headers = {},
  body,
  timeoutMs = 20_000,
}) =>
  new Promise((resolve, reject) => {
    const serializedBody = body === undefined ? null : JSON.stringify(body);
    const request = http.request(
      {
        agent: false,
        headers: {
          Connection: "close",
          ...(serializedBody === null
            ? {}
            : {
                "Content-Length": Buffer.byteLength(serializedBody),
                "Content-Type": "application/json",
              }),
          ...headers,
        },
        host: "127.0.0.1",
        method,
        path: requestPath,
        port,
      },
      (response) => {
        const chunks = [];
        response.on("data", (chunk) => chunks.push(chunk));
        response.once("error", reject);
        response.on("end", () => {
          const text = Buffer.concat(chunks).toString("utf8");
          let parsedBody = null;
          if (text) {
            try {
              parsedBody = JSON.parse(text);
            } catch (_error) {
              parsedBody = text;
            }
          }
          resolve({
            body: parsedBody,
            headers: response.headers,
            statusCode: response.statusCode,
          });
        });
      }
    );

    request.setTimeout(timeoutMs, () => {
      request.destroy(new Error(`HTTP request exceeded ${timeoutMs}ms`));
    });
    request.once("error", reject);
    request.end(serializedBody || undefined);
  });

const settled = (promise) =>
  promise.then(
    (value) => ({ kind: "response", value }),
    (error) => ({ error, kind: "error" })
  );

const childDiagnostics = (harness) =>
  JSON.stringify({
    exit: harness.exit,
    label: harness.label,
    messages: harness.messages,
    stderr: harness.stderr,
    stdout: harness.stdout,
  });

const activeHarnesses = new Set();

const createChildHarness = ({ databaseUri, keyHash, label, pause, port }) => {
  const events = new EventEmitter();
  const child = fork(SERVER_ENTRY, [], {
    cwd: REPOSITORY_ROOT,
    env: {
      ...process.env,
      DB_CONNECT_RETRIES: "0",
      DB_CONNECT_RETRY_DELAY_MS: "0",
      JWT_ACCESS_EXPIRES_IN: "15m",
      JWT_ACCESS_SECRET: JWT_SECRET,
      MONGODB_URI: databaseUri,
      NODE_ENV: "development",
      PORT: String(port),
      WP9_SCENARIO_J_KEY_HASH: keyHash,
      WP9_SCENARIO_J_PAUSE: pause ? "1" : "0",
    },
    execArgv: ["--require", PAUSE_FIXTURE],
    execPath: process.execPath,
    stdio: ["ignore", "pipe", "pipe", "ipc"],
    windowsHide: true,
  });
  const harness = {
    child,
    events,
    exit: null,
    label,
    messages: [],
    port,
    settled: false,
    stderr: "",
    stdout: "",
  };

  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk) => {
    harness.stdout += chunk;
  });
  child.stderr.on("data", (chunk) => {
    harness.stderr += chunk;
  });
  child.on("message", (message) => {
    harness.messages.push(message);
    events.emit("message", message);
  });
  child.once("error", (error) => {
    events.emit("spawn-error", error);
  });
  harness.closed = new Promise((resolve) => {
    child.once("close", (code, signal) => {
      harness.exit = { code, signal };
      harness.settled = true;
      activeHarnesses.delete(harness);
      events.emit("closed", harness.exit);
      resolve(harness.exit);
    });
  });
  activeHarnesses.add(harness);
  return harness;
};

const waitForChildMessage = (
  harness,
  type,
  timeoutMs = 15_000
) => {
  const existing = harness.messages.find((message) => message?.type === type);
  if (existing) return Promise.resolve(existing);
  if (harness.settled) {
    return Promise.reject(
      new Error(`Child exited before ${type}: ${childDiagnostics(harness)}`)
    );
  }

  const pending = new Promise((resolve, reject) => {
    const cleanup = () => {
      harness.events.removeListener("message", onMessage);
      harness.events.removeListener("closed", onClosed);
      harness.events.removeListener("spawn-error", onSpawnError);
    };
    const onMessage = (message) => {
      if (message?.type !== type) return;
      cleanup();
      resolve(message);
    };
    const onClosed = () => {
      cleanup();
      reject(
        new Error(`Child exited before ${type}: ${childDiagnostics(harness)}`)
      );
    };
    const onSpawnError = (error) => {
      cleanup();
      reject(error);
    };

    harness.events.on("message", onMessage);
    harness.events.once("closed", onClosed);
    harness.events.once("spawn-error", onSpawnError);
  });

  return waitWithin(
    pending,
    timeoutMs,
    () => `Timed out waiting for ${type}: ${childDiagnostics(harness)}`
  );
};

const waitForChildClose = (harness, timeoutMs = 15_000) =>
  waitWithin(
    harness.closed,
    timeoutMs,
    () => `Timed out waiting for child exit: ${childDiagnostics(harness)}`
  );

const sendToChild = (harness, message) =>
  new Promise((resolve, reject) => {
    if (!harness.child.connected) {
      reject(new Error(`Child IPC is closed: ${childDiagnostics(harness)}`));
      return;
    }
    harness.child.send(message, (error) => {
      if (error) reject(error);
      else resolve();
    });
  });

const launchApplication = async ({ databaseUri, keyHash, label, pause }) => {
  const port = await reservePort();
  const harness = createChildHarness({
    databaseUri,
    keyHash,
    label,
    pause,
    port,
  });
  harness.ready = await waitForChildMessage(harness, "application-ready");
  return harness;
};

const assertApplicationReady = async (harness) => {
  expect(harness.ready).toMatchObject({
    databaseReadyState: 1,
    lifecycleState: "ready",
  });
  expect(harness.ready.sigtermListenerCount).toBeGreaterThanOrEqual(1);

  const readiness = await requestJson({
    path: "/health/ready",
    port: harness.port,
  });
  expect(readiness).toMatchObject({
    body: { status: "ready" },
    statusCode: 200,
  });
};

const productionLogEvents = (harness) =>
  harness.stdout
    .split(/\r?\n/)
    .filter(Boolean)
    .flatMap((line) => {
      try {
        return [JSON.parse(line)];
      } catch (_error) {
        return [];
      }
    });

const expectShutdownLogs = (harness, terminalEvent, exitCode) => {
  const events = productionLogEvents(harness);
  expect(events).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        event: "application_shutdown_started",
        signal: "SIGTERM",
        timeoutMs: SHUTDOWN_TIMEOUT_MS,
      }),
      expect.objectContaining({
        event: terminalEvent,
        exitCode,
        signal: "SIGTERM",
      }),
    ])
  );
  return events;
};

const probeNewTraffic = async (port) => {
  try {
    const response = await requestJson({
      path: "/health/ready",
      port,
      timeoutMs: 2_000,
    });
    return { kind: "http", statusCode: response.statusCode };
  } catch (error) {
    return {
      code: error.code || error.name,
      kind: "transport-error",
    };
  }
};

const expectTrafficRejected = (outcome) => {
  expect(outcome.kind === "http" && outcome.statusCode === 200).toBe(false);
};

const stopRestartedApplication = async (harness) => {
  const databaseClosed = waitForChildMessage(
    harness,
    "database-close-completed"
  );
  const shutdownStarted = waitForChildMessage(harness, "shutdown-started");
  const childClosed = waitForChildClose(harness);

  expect(harness.child.kill("SIGTERM")).toBe(true);
  const [shutdown, database, exit] = await Promise.all([
    shutdownStarted,
    databaseClosed,
    childClosed,
  ]);

  expect(shutdown).toMatchObject({
    lifecycleState: "shutting_down",
    signal: "SIGTERM",
    timeoutMs: SHUTDOWN_TIMEOUT_MS,
  });
  expect(database.databaseReadyState).toBe(0);
  expect(exit).toEqual({ code: 0, signal: null });
  expectShutdownLogs(harness, "application_shutdown_completed", 0);
  return exit;
};

const createInventoryFixture = async ({ key, quantity, tag }) => {
  const user = await User.create({
    email: `wp9-scenario-j-${tag.toLowerCase()}@example.com`,
    name: `WP9 Scenario J ${tag}`,
    password: await bcrypt.hash("ScenarioJPassword123!", 4),
    role: "manager",
    status: "active",
  });
  const product = await Product.create({
    name: `Scenario J ${tag} product`,
    sku: `WP9-J-${tag}-PRODUCT`,
    status: "active",
    unit: "piece",
    version: 1,
  });
  const warehouse = await Warehouse.create({
    code: `WP9-J-${tag}-WAREHOUSE`,
    name: `Scenario J ${tag} warehouse`,
    status: "active",
    version: 1,
  });
  const stock = await Stock.create({
    productId: product._id,
    productLifecycleStatus: "active",
    quantity,
    status: "active",
    version: 1,
    warehouseId: warehouse._id,
    warehouseLifecycleStatus: "active",
  });
  const token = jwt.sign(
    { role: user.role, userId: user._id.toString() },
    JWT_SECRET,
    { expiresIn: "15m" }
  );
  const payload = {
    quantity: 4,
    reason: `Scenario J ${tag} graceful shutdown proof`,
    reference: `WP9-J-${tag}`,
    stockId: stock._id.toString(),
  };

  return {
    initialQuantity: quantity,
    key,
    keyHash: hashIdempotencyKey(key),
    payload,
    stock,
    token,
    user,
  };
};

const issueGoods = (harness, fixture, { timeoutMs = 20_000 } = {}) =>
  requestJson({
    body: fixture.payload,
    headers: {
      Authorization: `Bearer ${fixture.token}`,
      "Idempotency-Key": fixture.key,
    },
    method: "POST",
    path: "/api/v1/goods-issues",
    port: harness.port,
    timeoutMs,
  });

const persistenceSnapshot = async (fixture) => {
  const stockId = fixture.stock._id.toString();
  const scope = {
    actorId: fixture.user._id.toString(),
    actorType: "user",
    keyHash: fixture.keyHash,
    operationId: TARGET_OPERATION,
  };
  const [
    stock,
    movement,
    audit,
    outbox,
    idempotency,
    movementCount,
    auditCount,
    outboxCount,
    idempotencyCount,
    processingCount,
  ] = await Promise.all([
    Stock.findById(stockId).lean(),
    StockMovement.findOne({ stockId, type: "GOODS_ISSUE" }).lean(),
    AuditEvent.findOne({
      action: TARGET_OPERATION,
      "resource.id": stockId,
      "resource.type": "Stock",
    }).lean(),
    OutboxEvent.findOne({
      "aggregate.id": stockId,
      "aggregate.type": "Stock",
      eventType: "inventory.stock.issued",
    }).lean(),
    IdempotencyRecord.findOne(scope).lean(),
    StockMovement.countDocuments(),
    AuditEvent.countDocuments(),
    OutboxEvent.countDocuments(),
    IdempotencyRecord.countDocuments(),
    IdempotencyRecord.countDocuments({ state: "processing" }),
  ]);

  return {
    audit,
    counts: {
      audit: auditCount,
      idempotency: idempotencyCount,
      movement: movementCount,
      outbox: outboxCount,
      processingIdempotency: processingCount,
    },
    idempotency,
    movement,
    outbox,
    stock,
  };
};

const expectPersistence = (snapshot, fixture, { count, quantity, version }) => {
  expect(snapshot.stock).toMatchObject({ quantity, version });
  expect(snapshot.counts).toEqual({
    audit: count,
    idempotency: count,
    movement: count,
    outbox: count,
    processingIdempotency: 0,
  });

  if (count === 0) {
    expect(snapshot.movement).toBeNull();
    expect(snapshot.audit).toBeNull();
    expect(snapshot.outbox).toBeNull();
    expect(snapshot.idempotency).toBeNull();
    return;
  }

  expect(snapshot.movement).toMatchObject({
    aggregateVersion: version,
    quantity: fixture.payload.quantity,
    quantityAfter: quantity,
    quantityBefore: fixture.initialQuantity,
    type: "GOODS_ISSUE",
  });
  expect(snapshot.idempotency).toMatchObject({
    actorId: fixture.user._id.toString(),
    actorType: "user",
    keyHash: fixture.keyHash,
    operationId: TARGET_OPERATION,
    state: "completed",
    statusCode: 201,
  });
  expect(snapshot.audit).toMatchObject({
    action: TARGET_OPERATION,
    idempotency: {
      keyHash: fixture.keyHash,
      recordId: snapshot.idempotency._id.toString(),
    },
    outcome: "succeeded",
    resource: {
      aggregateVersion: version,
      id: fixture.stock._id.toString(),
      type: "Stock",
    },
  });
  expect(snapshot.outbox).toMatchObject({
    aggregate: {
      id: fixture.stock._id.toString(),
      type: "Stock",
      version,
    },
    eventType: "inventory.stock.issued",
    idempotency: {
      keyHash: fixture.keyHash,
      recordId: snapshot.idempotency._id.toString(),
    },
  });
};

const clearDatabase = async () => {
  const collections = await mongoose.connection.db.collections();
  for (const collection of collections) {
    if (!collection.collectionName.startsWith("system.")) {
      await collection.deleteMany({});
    }
  }
};

const cleanupChildren = async () => {
  await Promise.all(
    [...activeHarnesses].map(async (harness) => {
      if (!harness.settled) harness.child.kill("SIGKILL");
      await waitForChildClose(harness, 5_000).catch(() => {});
    })
  );
};

describeWithRealSignals(
  "WP9 Scenario J process-level graceful shutdown",
  () => {
    let databaseUri;
    let replicaSet;

    beforeAll(async () => {
      replicaSet = await MongoMemoryReplSet.create({
        replSet: { count: 1, storageEngine: "wiredTiger" },
      });
      databaseUri = replicaSet.getUri(DATABASE_NAME);
      await mongoose.connect(databaseUri, { autoIndex: false });
      await Promise.all([
        User.createIndexes(),
        Product.createIndexes(),
        Warehouse.createIndexes(),
        Stock.createIndexes(),
        StockMovement.createIndexes(),
        IdempotencyRecord.createIndexes(),
        AuditEvent.createIndexes(),
        OutboxEvent.createIndexes(),
      ]);
    }, 45_000);

    beforeEach(async () => {
      await clearDatabase();
    });

    afterEach(async () => {
      await cleanupChildren();
    });

    afterAll(async () => {
      await cleanupChildren();
      if (mongoose.connection.readyState !== 0) await mongoose.disconnect();
      if (replicaSet) await replicaSet.stop();
    }, 20_000);

    it("finishes and replays a keyed transaction released before the deadline", async () => {
      const fixture = await createInventoryFixture({
        key: "wp9.scenario-j.complete.0001",
        quantity: 10,
        tag: "COMPLETE",
      });
      const application = await launchApplication({
        databaseUri,
        keyHash: fixture.keyHash,
        label: "branch-1-original",
        pause: true,
      });
      expect(application.ready.pauseArmed).toBe(true);
      await assertApplicationReady(application);

      const transactionPaused = waitForChildMessage(
        application,
        "transaction-paused"
      );
      const originalRequest = settled(issueGoods(application, fixture));
      const paused = await transactionPaused;
      expect(paused).toMatchObject({
        operationId: TARGET_OPERATION,
        sessionInTransaction: true,
      });
      expect(paused.sigtermListenerCount).toBeGreaterThanOrEqual(1);

      const whilePaused = await persistenceSnapshot(fixture);
      expectPersistence(whilePaused, fixture, {
        count: 0,
        quantity: 10,
        version: 1,
      });

      const shutdownStarted = waitForChildMessage(
        application,
        "shutdown-started"
      );
      const httpCloseStarted = waitForChildMessage(
        application,
        "http-close-started"
      );
      const databaseClosed = waitForChildMessage(
        application,
        "database-close-completed"
      );
      const childClosed = waitForChildClose(application);
      const signalAt = Date.now();
      expect(application.child.kill("SIGTERM")).toBe(true);

      const [shutdown, httpClose] = await Promise.all([
        shutdownStarted,
        httpCloseStarted,
      ]);
      expect(shutdown).toMatchObject({
        databaseReadyState: 1,
        lifecycleState: "shutting_down",
        signal: "SIGTERM",
        timeoutMs: SHUTDOWN_TIMEOUT_MS,
      });
      expect(httpClose).toMatchObject({
        listeningAfterCloseCall: false,
        wasListening: true,
      });

      const newTraffic = await probeNewTraffic(application.port);
      expectTrafficRejected(newTraffic);
      const releaseAfterMs = Date.now() - signalAt;
      expect(releaseAfterMs).toBeLessThan(9_000);
      await sendToChild(application, { type: "release-transaction" });

      const requestOutcome = await originalRequest;
      expect(requestOutcome.kind).toBe("response");
      expect(requestOutcome.value).toMatchObject({ statusCode: 201 });
      expect(requestOutcome.value.headers["idempotency-replayed"]).toBe(
        "false"
      );

      const [database, exit] = await Promise.all([
        databaseClosed,
        childClosed,
      ]);
      expect(database.databaseReadyState).toBe(0);
      expect(exit).toEqual({ code: 0, signal: null });
      const branchLogs = expectShutdownLogs(
        application,
        "application_shutdown_completed",
        0
      );
      expect(
        branchLogs.some(
          ({ event }) => event === "application_shutdown_timeout"
        )
      ).toBe(false);

      const committed = await persistenceSnapshot(fixture);
      expectPersistence(committed, fixture, {
        count: 1,
        quantity: 6,
        version: 2,
      });

      const restarted = await launchApplication({
        databaseUri,
        keyHash: fixture.keyHash,
        label: "branch-1-restart",
        pause: false,
      });
      expect(restarted.ready.pauseArmed).toBe(false);
      await assertApplicationReady(restarted);
      const replay = await issueGoods(restarted, fixture);
      expect(replay.statusCode).toBe(201);
      expect(replay.headers["idempotency-replayed"]).toBe("true");
      expect(replay.body.data).toEqual(requestOutcome.value.body.data);

      const afterReplay = await persistenceSnapshot(fixture);
      expectPersistence(afterReplay, fixture, {
        count: 1,
        quantity: 6,
        version: 2,
      });
      const restartExit = await stopRestartedApplication(restarted);

      console.log(
        `WP9_SCENARIO_J_BRANCH_1 ${JSON.stringify({
          childExit: exit,
          counts: committed.counts,
          databaseClosedState: database.databaseReadyState,
          newTraffic,
          releaseAfterMs,
          requestStatus: requestOutcome.value.statusCode,
          restartExit,
          replayed: replay.headers["idempotency-replayed"],
          signal: "SIGTERM",
          stock: {
            quantity: afterReplay.stock.quantity,
            version: afterReplay.stock.version,
          },
        })}`
      );
    });

    it("times out, aborts, and safely retries the same key after restart", async () => {
      const fixture = await createInventoryFixture({
        key: "wp9.scenario-j.timeout.0001",
        quantity: 11,
        tag: "TIMEOUT",
      });
      const application = await launchApplication({
        databaseUri,
        keyHash: fixture.keyHash,
        label: "branch-2-original",
        pause: true,
      });
      expect(application.ready.pauseArmed).toBe(true);
      await assertApplicationReady(application);

      const transactionPaused = waitForChildMessage(
        application,
        "transaction-paused"
      );
      const originalRequest = settled(issueGoods(application, fixture));
      const paused = await transactionPaused;
      expect(paused).toMatchObject({
        operationId: TARGET_OPERATION,
        sessionInTransaction: true,
      });
      expect(paused.sigtermListenerCount).toBeGreaterThanOrEqual(1);

      const whilePaused = await persistenceSnapshot(fixture);
      expectPersistence(whilePaused, fixture, {
        count: 0,
        quantity: 11,
        version: 1,
      });

      const shutdownStarted = waitForChildMessage(
        application,
        "shutdown-started"
      );
      const httpCloseStarted = waitForChildMessage(
        application,
        "http-close-started"
      );
      const childClosed = waitForChildClose(application, 20_000);
      const signalAt = Date.now();
      expect(application.child.kill("SIGTERM")).toBe(true);

      const [shutdown, httpClose] = await Promise.all([
        shutdownStarted,
        httpCloseStarted,
      ]);
      expect(shutdown).toMatchObject({
        databaseReadyState: 1,
        lifecycleState: "shutting_down",
        signal: "SIGTERM",
        timeoutMs: SHUTDOWN_TIMEOUT_MS,
      });
      expect(httpClose).toMatchObject({
        listeningAfterCloseCall: false,
        wasListening: true,
      });
      const newTraffic = await probeNewTraffic(application.port);
      expectTrafficRejected(newTraffic);

      const exit = await childClosed;
      const timeoutDurationMs = Date.now() - signalAt;
      expect(timeoutDurationMs).toBeGreaterThanOrEqual(9_500);
      expect(timeoutDurationMs).toBeLessThan(20_000);
      expect(exit).toEqual({ code: 1, signal: null });

      const requestOutcome = await originalRequest;
      if (requestOutcome.kind === "response") {
        expect(requestOutcome.value.statusCode).not.toBe(201);
      }
      const branchLogs = expectShutdownLogs(
        application,
        "application_shutdown_timeout",
        1
      );
      expect(
        branchLogs.some(
          ({ event }) => event === "application_shutdown_completed"
        )
      ).toBe(false);

      const restarted = await launchApplication({
        databaseUri,
        keyHash: fixture.keyHash,
        label: "branch-2-restart",
        pause: false,
      });
      expect(restarted.ready.pauseArmed).toBe(false);
      await assertApplicationReady(restarted);

      const afterAbort = await persistenceSnapshot(fixture);
      expectPersistence(afterAbort, fixture, {
        count: 0,
        quantity: 11,
        version: 1,
      });

      const retryStartedAt = Date.now();
      const retry = await issueGoods(restarted, fixture, {
        timeoutMs: 120_000,
      });
      const retryDurationMs = Date.now() - retryStartedAt;
      expect(retry.statusCode).toBe(201);
      expect(retry.headers["idempotency-replayed"]).toBe("false");
      const afterRetry = await persistenceSnapshot(fixture);
      expectPersistence(afterRetry, fixture, {
        count: 1,
        quantity: 7,
        version: 2,
      });
      const restartExit = await stopRestartedApplication(restarted);

      console.log(
        `WP9_SCENARIO_J_BRANCH_2 ${JSON.stringify({
          abortedRequest: {
            code: requestOutcome.error?.code,
            kind: requestOutcome.kind,
            statusCode: requestOutcome.value?.statusCode,
          },
          childExit: exit,
          countsAfterAbort: afterAbort.counts,
          finalCounts: afterRetry.counts,
          finalStock: {
            quantity: afterRetry.stock.quantity,
            version: afterRetry.stock.version,
          },
          newTraffic,
          restartExit,
          retryReplayed: retry.headers["idempotency-replayed"],
          retryDurationMs,
          retryStatus: retry.statusCode,
          signal: "SIGTERM",
          timeoutDurationMs,
        })}`
      );
    });
  }
);
