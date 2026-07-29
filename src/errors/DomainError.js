class DomainError extends Error {
  constructor({
    code,
    httpStatus,
    message,
    safeMessage = message,
    retryable = false,
    errors = [],
    title,
    cause,
  }) {
    super(message, cause === undefined ? {} : { cause });

    this.name = "DomainError";
    this.code = code;
    this.httpStatus = httpStatus;
    this.retryable = retryable;
    this.safeMessage = safeMessage;
    this.errors = Array.isArray(errors) ? errors : [];
    this.title = title;
  }
}

module.exports = DomainError;
