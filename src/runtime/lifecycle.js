const RUNTIME_STATES = Object.freeze({
  STARTING: "starting",
  READY: "ready",
  SHUTTING_DOWN: "shutting_down",
  STOPPED: "stopped",
  FAILED: "failed",
});

const createRuntimeLifecycle = () => {
  let state = RUNTIME_STATES.STARTING;

  return Object.freeze({
    getState: () => state,
    isAcceptingTraffic: () => state === RUNTIME_STATES.READY,
    markReady: () => {
      if (state !== RUNTIME_STATES.STARTING) return false;
      state = RUNTIME_STATES.READY;
      return true;
    },
    beginShutdown: () => {
      if (
        state === RUNTIME_STATES.SHUTTING_DOWN ||
        state === RUNTIME_STATES.STOPPED
      ) {
        return false;
      }
      state = RUNTIME_STATES.SHUTTING_DOWN;
      return true;
    },
    markStopped: () => {
      state = RUNTIME_STATES.STOPPED;
    },
    markFailed: () => {
      state = RUNTIME_STATES.FAILED;
    },
  });
};

const runtimeLifecycle = createRuntimeLifecycle();

module.exports = {
  RUNTIME_STATES,
  createRuntimeLifecycle,
  runtimeLifecycle,
};
