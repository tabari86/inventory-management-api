class DomainError extends Error {
  constructor({
    code,
    httpStatus,
    message,
    safeMessage = message,
    retryable = false,
    cause,
  }) {
    super(message, cause === undefined ? {} : { cause });

    this.name = "DomainError";
    this.code = code;
    this.httpStatus = httpStatus;
    this.retryable = retryable;
    this.safeMessage = safeMessage;
  }
}

module.exports = DomainError;
