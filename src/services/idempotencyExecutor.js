const DomainError = require("../errors/DomainError");
const errorCodes = require("../errors/errorCodes");
const IdempotencyRecord = require("../models/IdempotencyRecord");
const {
  IDEMPOTENCY_RETENTION_MS,
  IDEMPOTENCY_SCOPE_INDEX,
  MAX_IDEMPOTENCY_RESPONSE_BYTES,
} = IdempotencyRecord;
const { hashCanonicalCommand } = require("../utils/canonicalJson");
const withTransaction = require("../utils/transaction");
const { createDomainEventCollector } = require("./domainEventCollector");
const { persistAuditOutboxEvents } = require("./auditOutboxService");

const MAX_ACQUISITION_ATTEMPTS = 3;
const SHA256_PATTERN = /^[a-f0-9]{64}$/;

class IdempotencyAcquisitionConflict extends Error {
  constructor() {
    super("Idempotency scope acquisition conflict");
    this.name = "IdempotencyAcquisitionConflict";
  }
}

const defaultBackoff = (attempt) =>
  new Promise((resolve) => setTimeout(resolve, attempt * 5));

const createScope = ({ context, operationId, keyHash }) => ({
  actorType: context.actor.type,
  actorId: context.actor.id,
  operationId,
  keyHash,
});

const isScopeDuplicateError = (error) => {
  if (error?.code !== 11000) return false;
  if (error?.index === IDEMPOTENCY_SCOPE_INDEX) return true;

  const fields = Object.keys(error?.keyPattern || {});
  return (
    fields.length === 4 &&
    fields[0] === "actorType" &&
    fields[1] === "actorId" &&
    fields[2] === "operationId" &&
    fields[3] === "keyHash"
  );
};

const conflictError = () =>
  new DomainError({
    code: errorCodes.IDEMPOTENCY_CONFLICT,
    httpStatus: 409,
    message: "Idempotency key was already used with a different request",
    retryable: false,
  });

const inProgressError = () =>
  new DomainError({
    code: errorCodes.IDEMPOTENCY_IN_PROGRESS,
    httpStatus: 409,
    message: "A request with this idempotency key is still being processed",
    retryable: true,
  });

const serializeResponse = (body, responseLimitBytes) => {
  let serialized;

  try {
    serialized = JSON.stringify(body);
  } catch (cause) {
    throw new DomainError({
      code: errorCodes.TRANSACTION_FAILED,
      httpStatus: 500,
      message: "Could not serialize idempotent response",
      safeMessage: "Could not complete request",
      retryable: false,
      cause,
    });
  }

  if (serialized === undefined) {
    throw new DomainError({
      code: errorCodes.TRANSACTION_FAILED,
      httpStatus: 500,
      message: "Could not serialize idempotent response",
      safeMessage: "Could not complete request",
      retryable: false,
    });
  }

  const responseSizeBytes = Buffer.byteLength(serialized, "utf8");
  if (responseSizeBytes > responseLimitBytes) {
    throw new DomainError({
      code: errorCodes.IDEMPOTENCY_RESPONSE_TOO_LARGE,
      httpStatus: 500,
      message: "Response is too large for idempotent replay",
      retryable: false,
    });
  }

  return {
    responseBody: JSON.parse(serialized),
    responseSizeBytes,
  };
};

const resolveCompletedRecord = ({ record, requestHash, requestHashVersion }) => {
  if (!record || record.state !== "completed") return null;

  if (
    record.requestHash !== requestHash ||
    record.requestHashVersion !== requestHashVersion
  ) {
    throw conflictError();
  }

  return {
    statusCode: record.statusCode,
    body: record.responseBody,
    replayed: true,
  };
};

const executeInventoryMutation = async ({
  context,
  inventoryOperation,
  command,
  statusCode,
  execute,
  buildResponse,
  dependencies = {},
}) => {
  if (!context?.actor?.type || !context?.actor?.id) {
    throw new DomainError({
      code: errorCodes.VALIDATION_FAILED,
      httpStatus: 500,
      message: "Authenticated actor context is required",
      safeMessage: "Could not complete request",
    });
  }

  if (
    context.actor.type !== "user" ||
    context.source !== "http-api" ||
    typeof context.requestId !== "string" ||
    typeof context.correlationId !== "string" ||
    context.causationId !== context.requestId ||
    inventoryOperation?.operationId !== command?.operationId ||
    (inventoryOperation?.keyHash !== null &&
      !SHA256_PATTERN.test(inventoryOperation?.keyHash))
  ) {
    throw new DomainError({
      code: errorCodes.VALIDATION_FAILED,
      httpStatus: 500,
      message: "Invalid idempotency execution context",
      safeMessage: "Could not complete request",
    });
  }

  if (!Number.isInteger(statusCode) || statusCode < 200 || statusCode > 299) {
    throw new DomainError({
      code: errorCodes.VALIDATION_FAILED,
      httpStatus: 500,
      message: "Idempotent mutations require a successful status code",
      safeMessage: "Could not complete request",
    });
  }

  const now = dependencies.now || (() => new Date());
  const backoff = dependencies.backoff || defaultBackoff;
  const collectorFactory =
    dependencies.eventCollectorFactory || createDomainEventCollector;
  const eventPersistence =
    dependencies.eventPersistence || persistAuditOutboxEvents;
  const requestedResponseLimit = dependencies.responseLimitBytes;
  const responseLimitBytes =
    Number.isInteger(requestedResponseLimit) && requestedResponseLimit >= 0
      ? Math.min(requestedResponseLimit, MAX_IDEMPOTENCY_RESPONSE_BYTES)
      : MAX_IDEMPOTENCY_RESPONSE_BYTES;
  const requestedMaxAttempts = dependencies.maxAttempts;
  const maxAttempts =
    Number.isInteger(requestedMaxAttempts) && requestedMaxAttempts >= 1
      ? Math.min(requestedMaxAttempts, MAX_ACQUISITION_ATTEMPTS)
      : MAX_ACQUISITION_ATTEMPTS;

  const executeAttempt = async ({ session, record = null, keyed }) => {
    const eventCollector = collectorFactory();
    const result = await execute({ session, eventCollector });
    const idempotency = record
      ? {
          recordId: record._id.toString().toLowerCase(),
          keyHash: inventoryOperation.keyHash,
        }
      : null;

    await eventPersistence({
      descriptors: eventCollector.descriptors(),
      context,
      operationId: inventoryOperation.operationId,
      idempotency,
      session,
    });

    const publicBody = buildResponse(result);
    const serializedResponse = serializeResponse(
      publicBody,
      keyed ? responseLimitBytes : Number.MAX_SAFE_INTEGER
    );
    return { result, ...serializedResponse };
  };

  if (!inventoryOperation.keyHash) {
    return withTransaction(async (session) => {
      const { responseBody } = await executeAttempt({
        session,
        keyed: false,
      });
      return {
        statusCode,
        body: responseBody,
        replayed: null,
      };
    });
  }

  const { requestHash, requestHashVersion } = hashCanonicalCommand(command);
  const scope = createScope({
    context,
    operationId: inventoryOperation.operationId,
    keyHash: inventoryOperation.keyHash,
  });

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const existingRecord = await IdempotencyRecord.findOne(scope).lean();
    const replay = resolveCompletedRecord({
      record: existingRecord,
      requestHash,
      requestHashVersion,
    });
    if (replay) return replay;

    try {
      return await withTransaction(async (session) => {
        let record;

        try {
          [record] = await IdempotencyRecord.create(
            [
              {
                ...scope,
                requestHash,
                requestHashVersion,
                state: "processing",
                originalRequestId: context.requestId,
                originalCorrelationId: context.correlationId,
                source: context.source,
              },
            ],
            { session }
          );
        } catch (error) {
          if (isScopeDuplicateError(error)) {
            throw new IdempotencyAcquisitionConflict();
          }
          throw error;
        }

        const { responseBody, responseSizeBytes } = await executeAttempt({
          session,
          record,
          keyed: true,
        });
        const completedAt = new Date(now());

        record.state = "completed";
        record.statusCode = statusCode;
        record.responseBody = responseBody;
        record.responseSizeBytes = responseSizeBytes;
        record.completedAt = completedAt;
        record.expiresAt = new Date(
          completedAt.getTime() + IDEMPOTENCY_RETENTION_MS
        );
        await record.save({ session });

        return {
          statusCode,
          body: responseBody,
          replayed: false,
        };
      });
    } catch (error) {
      if (!(error instanceof IdempotencyAcquisitionConflict)) throw error;
    }

    const committedRecord = await IdempotencyRecord.findOne(scope).lean();
    const resolvedReplay = resolveCompletedRecord({
      record: committedRecord,
      requestHash,
      requestHashVersion,
    });
    if (resolvedReplay) return resolvedReplay;

    if (attempt < maxAttempts) await backoff(attempt);
  }

  throw inProgressError();
};

const sendInventoryMutation = async ({ req, res, ...options }) => {
  const outcome = await executeInventoryMutation({
    context: req.applicationContext,
    inventoryOperation: req.inventoryOperation,
    ...options,
  });

  if (outcome.replayed !== null) {
    res.setHeader("Idempotency-Replayed", String(outcome.replayed));
  }

  return res.status(outcome.statusCode).json(outcome.body);
};

module.exports = {
  MAX_ACQUISITION_ATTEMPTS,
  executeInventoryMutation,
  isScopeDuplicateError,
  sendInventoryMutation,
  serializeResponse,
};
