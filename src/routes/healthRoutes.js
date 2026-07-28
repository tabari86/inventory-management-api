const express = require("express");

const SERVICE_NAME = "inventory-management-api";
const MONGOOSE_CONNECTED_STATE = 1;

const createHealthHandlers = ({ lifecycle, databaseConnection }) => {
  const live = (_req, res) =>
    res.status(200).json({
      status: "ok",
      service: SERVICE_NAME,
    });

  const ready = (_req, res) => {
    const isReady =
      lifecycle.isAcceptingTraffic() &&
      databaseConnection.readyState === MONGOOSE_CONNECTED_STATE;

    return res.status(isReady ? 200 : 503).json({
      status: isReady ? "ready" : "unavailable",
      service: SERVICE_NAME,
    });
  };

  return { live, ready };
};

const createHealthRouter = (dependencies) => {
  const router = express.Router();
  const { live, ready } = createHealthHandlers(dependencies);

  /**
   * @swagger
   * /health/live:
   *   get:
   *     summary: Check process liveness
   *     tags: [Operations]
   *     responses:
   *       200:
   *         description: The HTTP process is alive
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/LivenessResponse'
   */
  router.get("/health/live", live);

  /**
   * @swagger
   * /health:
   *   get:
   *     summary: Check process liveness (legacy alias)
   *     deprecated: false
   *     tags: [Operations]
   *     responses:
   *       200:
   *         description: The HTTP process is alive
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/LivenessResponse'
   */
  router.get("/health", live);

  /**
   * @swagger
   * /health/ready:
   *   get:
   *     summary: Check application readiness
   *     tags: [Operations]
   *     responses:
   *       200:
   *         description: Startup is complete, MongoDB is connected, and traffic is accepted
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/ReadinessResponse'
   *       503:
   *         description: The application is not ready to accept traffic
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/ReadinessResponse'
   */
  router.get("/health/ready", ready);

  /**
   * @swagger
   * /api/ready:
   *   get:
   *     summary: Check application readiness (WP6 compatibility alias)
   *     deprecated: false
   *     tags: [Operations]
   *     responses:
   *       200:
   *         description: Startup is complete, MongoDB is connected, and traffic is accepted
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/ReadinessResponse'
   *       503:
   *         description: The application is not ready to accept traffic
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/ReadinessResponse'
   */
  router.get("/api/ready", ready);

  return router;
};

module.exports = {
  MONGOOSE_CONNECTED_STATE,
  SERVICE_NAME,
  createHealthHandlers,
  createHealthRouter,
};
