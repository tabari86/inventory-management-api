const { createHash } = require("crypto");

const sha256 = (value) => createHash("sha256").update(value).digest("hex");

const hashIdempotencyKey = (rawKey) => sha256(rawKey);

module.exports = {
  hashIdempotencyKey,
  sha256,
};
