"use strict";

const http = require("http");
const mongoose = require("mongoose");

const database = require("../../src/config/database");
const { logger } = require("../../src/config/logger");
const IdempotencyRecord = require("../../src/models/IdempotencyRecord");
const { runtimeLifecycle } = require("../../src/runtime/lifecycle");

const TARGET_OPERATION = "inventory.goods-issue.single.v1";
const pauseEnabled = process.env.WP9_SCENARIO_J_PAUSE === "1";
const targetKeyHash = process.env.WP9_SCENARIO_J_KEY_HASH;

if (
  pauseEnabled &&
  (typeof targetKeyHash !== "string" || !/^[a-f0-9]{64}$/.test(targetKeyHash))
) {
  throw new Error("Scenario J pause requires a valid target key hash");
}

const sendToParent = (message) =>
  new Promise((resolve) => {
    if (!process.connected || typeof process.send !== "function") {
      resolve(false);
      return;
    }

    try {
      process.send({ ...message, pid: process.pid }, (error) => {
        resolve(!error);
      });
    } catch (_error) {
      resolve(false);
    }
  });

let releasePause;
const pauseReleased = new Promise((resolve) => {
  releasePause = resolve;
});

process.on("message", (message) => {
  if (message?.type === "release-transaction") releasePause();
});

const originalSave = IdempotencyRecord.prototype.save;
let transactionPaused = false;

IdempotencyRecord.prototype.save = async function scenarioJSave(...args) {
  const result = await Reflect.apply(originalSave, this, args);

  if (
    pauseEnabled &&
    !transactionPaused &&
    this.state === "completed" &&
    this.operationId === TARGET_OPERATION &&
    this.keyHash === targetKeyHash
  ) {
    transactionPaused = true;
    const session = args[0]?.session || this.$session();

    await sendToParent({
      type: "transaction-paused",
      operationId: this.operationId,
      recordId: this._id.toString(),
      sessionInTransaction: Boolean(session?.inTransaction?.()),
      sigtermListenerCount: process.listenerCount("SIGTERM"),
    });
    await pauseReleased;
  }

  return result;
};

const originalLog = logger.log;
logger.log = function scenarioJLog(event, fields = {}) {
  const logged = Reflect.apply(originalLog, this, [event, fields]);

  if (event === "application_ready") {
    setImmediate(() => {
      void sendToParent({
        type: "application-ready",
        databaseReadyState: mongoose.connection.readyState,
        lifecycleState: runtimeLifecycle.getState(),
        pauseArmed: pauseEnabled,
        sigtermListenerCount: process.listenerCount("SIGTERM"),
      });
    });
  }

  if (event === "application_shutdown_started") {
    void sendToParent({
      type: "shutdown-started",
      databaseReadyState: mongoose.connection.readyState,
      lifecycleState: runtimeLifecycle.getState(),
      signal: fields.signal,
      timeoutMs: fields.timeoutMs,
    });
  }

  return logged;
};

const originalServerClose = http.Server.prototype.close;
http.Server.prototype.close = function scenarioJServerClose(...args) {
  const wasListening = this.listening;
  const result = Reflect.apply(originalServerClose, this, args);

  void sendToParent({
    type: "http-close-started",
    listeningAfterCloseCall: this.listening,
    wasListening,
  });
  return result;
};

const originalCloseDatabase = database.closeDatabase;
database.closeDatabase = async function scenarioJCloseDatabase(...args) {
  await Reflect.apply(originalCloseDatabase, this, args);
  await sendToParent({
    type: "database-close-completed",
    databaseReadyState: mongoose.connection.readyState,
  });
};
