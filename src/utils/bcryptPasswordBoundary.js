const MAX_BCRYPT_PASSWORD_BYTES = 72;
const PASSWORD_BYTE_LIMIT_MESSAGE =
  "Password must be at most 72 UTF-8 bytes";

const isPasswordWithinBcryptLimit = (password) =>
  Buffer.byteLength(password, "utf8") <= MAX_BCRYPT_PASSWORD_BYTES;

module.exports = {
  MAX_BCRYPT_PASSWORD_BYTES,
  PASSWORD_BYTE_LIMIT_MESSAGE,
  isPasswordWithinBcryptLimit,
};
