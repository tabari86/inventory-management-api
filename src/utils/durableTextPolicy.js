const CREDENTIAL_MARKER_PATTERNS = Object.freeze([
  /\bbearer\s+\S/i,
  /\b(?:authorization|password|apiKey|api_key|x-api-key|refreshToken|refresh_token|secret)\s*[:=]/i,
]);

const containsExplicitCredentialMaterial = (value) =>
  typeof value === "string" &&
  CREDENTIAL_MARKER_PATTERNS.some((pattern) => pattern.test(value));

module.exports = { containsExplicitCredentialMaterial };
