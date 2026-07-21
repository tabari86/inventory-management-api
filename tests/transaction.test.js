const mongoose = require("mongoose");

const DomainError = require("../src/errors/DomainError");
const errorCodes = require("../src/errors/errorCodes");
const Product = require("../src/models/Product");
const withTransaction = require("../src/utils/transaction");

require("./setupTestDb");

describe("Transaction helper", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("commits a real session-bound write and returns the callback result", async () => {
    let session;

    const productId = await withTransaction(async (currentSession) => {
      session = currentSession;

      expect(currentSession.constructor.name).toBe("ClientSession");
      expect(currentSession.inTransaction()).toBe(true);

      const [product] = await Product.create(
        [
          {
            sku: "TRANSACTION-COMMIT-001",
            name: "Committed Product",
          },
        ],
        { session: currentSession }
      );

      return product._id;
    });

    expect(session.hasEnded).toBe(true);
    expect(await Product.findById(productId)).not.toBeNull();
  });

  it("returns a committed result when real session cleanup subsequently fails", async () => {
    const cleanupError = new Error("simulated cleanup failure after commit");
    let callbackInvocations = 0;
    let committedProductId;
    let session;

    const result = await withTransaction(async (currentSession) => {
      callbackInvocations += 1;
      session = currentSession;

      const originalEndSession = currentSession.endSession.bind(currentSession);
      jest
        .spyOn(currentSession, "endSession")
        .mockImplementationOnce(async () => {
          await originalEndSession();
          throw cleanupError;
        });

      const [product] = await Product.create(
        [
          {
            sku: "TRANSACTION-CLEANUP-001",
            name: "Committed Before Cleanup Failure",
          },
        ],
        { session: currentSession }
      );
      committedProductId = product._id;

      return "committed-result";
    });

    expect(result).toBe("committed-result");
    expect(callbackInvocations).toBe(1);
    expect(session.endSession).toHaveBeenCalledTimes(1);
    expect(session.hasEnded).toBe(true);
    expect(await Product.findById(committedProductId)).not.toBeNull();
  });

  it("aborts writes, preserves the original error, and ends the session", async () => {
    const callbackError = new Error("simulated callback failure");
    let callbackInvocations = 0;
    let session;

    await expect(
      withTransaction(async (currentSession) => {
        callbackInvocations += 1;
        session = currentSession;

        await Product.create(
          [
            {
              sku: "TRANSACTION-ABORT-001",
              name: "Aborted Product",
            },
          ],
          { session: currentSession }
        );

        throw callbackError;
      })
    ).rejects.toBe(callbackError);

    expect(callbackInvocations).toBe(1);
    expect(session.hasEnded).toBe(true);
    expect(await Product.countDocuments()).toBe(0);
  });

  it("preserves DomainError identity while aborting the transaction", async () => {
    const domainError = new DomainError({
      code: errorCodes.RESOURCE_NOT_FOUND,
      httpStatus: 404,
      message: "Transaction test resource not found",
    });
    let session;

    await expect(
      withTransaction(async (currentSession) => {
        session = currentSession;

        await Product.create(
          [
            {
              sku: "TRANSACTION-DOMAIN-001",
              name: "Domain Error Product",
            },
          ],
          { session: currentSession }
        );

        throw domainError;
      })
    ).rejects.toBe(domainError);

    expect(session.hasEnded).toBe(true);
    expect(domainError).toMatchObject({
      code: errorCodes.RESOURCE_NOT_FOUND,
      httpStatus: 404,
      safeMessage: "Transaction test resource not found",
    });
    expect(await Product.countDocuments()).toBe(0);
  });

  it("does not replace a callback error if session cleanup also fails", async () => {
    const callbackError = new Error("original callback error");
    const session = {
      withTransaction: (callback) => callback(),
      endSession: jest.fn().mockRejectedValue(new Error("cleanup failure")),
    };
    jest.spyOn(mongoose, "startSession").mockResolvedValueOnce(session);

    await expect(
      withTransaction(async () => {
        throw callbackError;
      })
    ).rejects.toBe(callbackError);

    expect(session.endSession).toHaveBeenCalledTimes(1);
  });
});
