const SwaggerParser = require("@apidevtools/swagger-parser");

const swaggerSpec = require("../src/config/swagger");

const jwtPattern = /\beyJ[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}\b/;
const privateKeyPrefix = ["-----", "BEGIN "].join("");
const httpUrlPattern = /https?:\/\/[^\s"'`<>]+/gi;
const internalHostnameSuffixes = [".internal", ".local", ".lan", ".corp"];

const collectStrings = (value, strings = []) => {
  if (typeof value === "string") strings.push(value);
  else if (Array.isArray(value)) {
    for (const entry of value) collectStrings(entry, strings);
  } else if (value && typeof value === "object") {
    for (const entry of Object.values(value)) collectStrings(entry, strings);
  }
  return strings;
};

const isPrivateOrLinkLocalIpv4 = (hostname) => {
  const octets = hostname.split(".").map(Number);
  if (
    octets.length !== 4 ||
    octets.some(
      (octet, index) =>
        !/^\d+$/.test(hostname.split(".")[index]) ||
        !Number.isInteger(octet) ||
        octet < 0 ||
        octet > 255
    )
  ) {
    return false;
  }

  return (
    octets[0] === 10 ||
    (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31) ||
    (octets[0] === 192 && octets[1] === 168) ||
    (octets[0] === 169 && octets[1] === 254)
  );
};

const inspectPublicHttpUrl = (candidate, addError) => {
  let parsed;
  try {
    parsed = new URL(candidate.replace(/[),.;!?]+$/, ""));
  } catch {
    return;
  }

  if (!['http:', 'https:'].includes(parsed.protocol)) return;
  if (parsed.username || parsed.password) {
    addError("The OpenAPI document contains an HTTP(S) URL with credentials");
  }

  const hostname = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, "").replace(/\.$/, "");
  if (["localhost", "127.0.0.1", "::1"].includes(hostname)) return;
  if (internalHostnameSuffixes.some((suffix) => hostname.endsWith(suffix))) {
    addError("The OpenAPI document contains an internal-only hostname");
  }
  if (isPrivateOrLinkLocalIpv4(hostname)) {
    addError("The OpenAPI document contains a private or link-local IPv4 host");
  }
};

const validatePublicContent = (document) => {
  const errors = [];
  const addError = (message) => {
    if (!errors.includes(message)) errors.push(message);
  };
  const productionServer = document.servers.find(({ description }) =>
    /production/i.test(description)
  );
  if (!productionServer) {
    errors.push("A production server URL is required");
  } else {
    try {
      const url = new URL(productionServer.url);
      if (url.protocol !== "https:" || url.username || url.password) {
        errors.push(
          "The production server URL must use HTTPS without credentials"
        );
      }
    } catch {
      errors.push("The production server URL must be absolute");
    }
  }

  if (!document.servers.some(({ url }) => url === "http://localhost:3000")) {
    errors.push("The local development server URL is missing");
  }
  if (!document.components?.securitySchemes?.bearerAuth) {
    errors.push("Bearer authentication is not documented");
  }
  if (!Object.keys(document.paths).some((path) => path.startsWith("/api/v1/"))) {
    errors.push("Canonical /api/v1 paths are missing");
  }

  for (const value of collectStrings(document)) {
    if (/mongodb(?:\+srv)?:\/\//i.test(value)) {
      addError("The OpenAPI document contains a MongoDB URI");
    }
    if (jwtPattern.test(value)) {
      addError("The OpenAPI document contains a JWT-like token");
    }
    if (value.includes(privateKeyPrefix)) {
      addError("The OpenAPI document contains private-key material");
    }
    for (const match of value.matchAll(httpUrlPattern)) {
      inspectPublicHttpUrl(match[0], addError);
    }
    httpUrlPattern.lastIndex = 0;
  }
  return errors;
};

const validateOpenApi = async (document = swaggerSpec) => {
  await SwaggerParser.validate(document);
  const contentErrors = validatePublicContent(document);
  if (contentErrors.length > 0) {
    throw new Error(
      `OpenAPI public-content validation failed: ${contentErrors.join("; ")}`
    );
  }
  return document;
};

const main = async () => {
  try {
    await validateOpenApi();
    console.log("OpenAPI validation passed");
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
};

if (require.main === module) void main();

module.exports = {
  collectStrings,
  inspectPublicHttpUrl,
  isPrivateOrLinkLocalIpv4,
  validateOpenApi,
  validatePublicContent,
};
