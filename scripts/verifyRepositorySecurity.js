const { execFileSync } = require("child_process");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const repositoryRoot = path.resolve(__dirname, "..");
const PLACEHOLDER_MARKERS =
  /(?:change[_-]?this|placeholder|example|dummy|fake|test|local|development)/i;
const PRIVATE_KEY_PREFIX = ["-----", "BEGIN "].join("");
const privateKeyHeaderPattern = new RegExp(
  `${PRIVATE_KEY_PREFIX}(?:RSA |EC |OPENSSH )?PRIVATE KEY-----`
);
const jwtPattern = /\beyJ[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}\b/g;
const mongoUriPattern = /mongodb(?:\+srv)?:\/\/[^\s"'`<>]+/gi;
const JAVASCRIPT_IDENTIFIER = String.raw`[A-Za-z_$][\w$]*`;
const STATIC_PROPERTY_IDENTIFIER = String.raw`[A-Za-z_$][\w$-]*`;
const TOKEN_GAP = String.raw`(?:\s|\/\*[\s\S]*?\*\/|\/\/[^\r\n]*(?:\r?\n|$))*`;
const ASSIGNMENT_OPERATOR = String.raw`=(?![=>])`;
const credentialLiteralPatterns = [
  {
    pattern: new RegExp(
      String.raw`\b(?:const|let|var)\b${TOKEN_GAP}(${JAVASCRIPT_IDENTIFIER})${TOKEN_GAP}${ASSIGNMENT_OPERATOR}${TOKEN_GAP}(["'\`])([^"'\`\r\n]*)\2`,
      "g"
    ),
    identifierGroup: 1,
    literalGroup: 3,
  },
  {
    pattern: new RegExp(
      String.raw`\b${JAVASCRIPT_IDENTIFIER}(?:${TOKEN_GAP}\.${TOKEN_GAP}${JAVASCRIPT_IDENTIFIER})*${TOKEN_GAP}\.${TOKEN_GAP}(${JAVASCRIPT_IDENTIFIER})${TOKEN_GAP}${ASSIGNMENT_OPERATOR}${TOKEN_GAP}(["'\`])([^"'\`\r\n]*)\2`,
      "g"
    ),
    identifierGroup: 1,
    literalGroup: 3,
  },
  {
    pattern: new RegExp(
      String.raw`\b${JAVASCRIPT_IDENTIFIER}(?:${TOKEN_GAP}\.${TOKEN_GAP}${JAVASCRIPT_IDENTIFIER})*${TOKEN_GAP}\[${TOKEN_GAP}(["'])(${STATIC_PROPERTY_IDENTIFIER})\1${TOKEN_GAP}\]${TOKEN_GAP}${ASSIGNMENT_OPERATOR}${TOKEN_GAP}(["'\`])([^"'\`\r\n]*)\3`,
      "g"
    ),
    identifierGroup: 2,
    literalGroup: 4,
  },
  {
    pattern: new RegExp(
      String.raw`(?:^|[;{}\r\n])${TOKEN_GAP}(?:static\b${TOKEN_GAP})?(${JAVASCRIPT_IDENTIFIER})${TOKEN_GAP}${ASSIGNMENT_OPERATOR}${TOKEN_GAP}(["'\`])([^"'\`\r\n]*)\2`,
      "gm"
    ),
    identifierGroup: 1,
    literalGroup: 3,
  },
  {
    pattern: new RegExp(
      String.raw`(?:^|[,{;\r\n])${TOKEN_GAP}(${STATIC_PROPERTY_IDENTIFIER})${TOKEN_GAP}:${TOKEN_GAP}(["'\`])([^"'\`\r\n]*)\2`,
      "gm"
    ),
    identifierGroup: 1,
    literalGroup: 3,
  },
  {
    pattern: new RegExp(
      String.raw`(?:^|[,{;\r\n])${TOKEN_GAP}(["'])(${STATIC_PROPERTY_IDENTIFIER})\1${TOKEN_GAP}:${TOKEN_GAP}(["'\`])([^"'\`\r\n]*)\3`,
      "gm"
    ),
    identifierGroup: 2,
    literalGroup: 4,
  },
];
const CONTROLLED_CONTEXTS = Object.freeze({
  DOCUMENTATION_EXAMPLE: "documentation example",
  TEST_FIXTURE: "test fixture",
});
const CONTROLLED_CONTEXT_BY_EXACT_FILE = new Map([
  ["README.md", CONTROLLED_CONTEXTS.DOCUMENTATION_EXAMPLE],
  ["tests/apiContract.test.js", CONTROLLED_CONTEXTS.TEST_FIXTURE],
  ["tests/auditEvent.test.js", CONTROLLED_CONTEXTS.TEST_FIXTURE],
  ["tests/auth.test.js", CONTROLLED_CONTEXTS.TEST_FIXTURE],
  ["tests/authService.test.js", CONTROLLED_CONTEXTS.TEST_FIXTURE],
  ["tests/controlled.fixture.js", CONTROLLED_CONTEXTS.TEST_FIXTURE],
  ["tests/domainEventRegistry.test.js", CONTROLLED_CONTEXTS.TEST_FIXTURE],
  ["tests/environment.test.js", CONTROLLED_CONTEXTS.TEST_FIXTURE],
  ["tests/helpers/authTestHelper.js", CONTROLLED_CONTEXTS.TEST_FIXTURE],
  ["tests/seedAdmin.test.js", CONTROLLED_CONTEXTS.TEST_FIXTURE],
  ["tests/server.test.js", CONTROLLED_CONTEXTS.TEST_FIXTURE],
  ["tests/swagger.test.js", CONTROLLED_CONTEXTS.TEST_FIXTURE],
  ["tests/user.test.js", CONTROLLED_CONTEXTS.TEST_FIXTURE],
  ["tests/userService.test.js", CONTROLLED_CONTEXTS.TEST_FIXTURE],
]);
// Every non-secret fixture exemption is an exact path/name/value-hash/context
// tuple with an explicit reason. No path, identifier, value, or context alone
// grants an exemption.
const CONTROLLED_CREDENTIAL_FIXTURE_EXEMPTIONS = Object.freeze([
  {
    file: "README.md",
    identifier: "password",
    valueHash:
      "740d36d56c2689e49fd545d75f032362e3741944465734c0973e842b73e7181f",
    context: CONTROLLED_CONTEXTS.DOCUMENTATION_EXAMPLE,
    reason: "documented local login request example",
  },
  {
    file: "tests/apiContract.test.js",
    identifier: "password",
    valueHash:
      "008c70392e3abfbd0fa47bbc2ed96aa99bd49e159727fcba0f2e6abeb3a9d601",
    context: CONTROLLED_CONTEXTS.TEST_FIXTURE,
    reason: "authentication DTO compatibility fixture",
  },
  {
    file: "tests/auditEvent.test.js",
    identifier: "password",
    valueHash:
      "e09701a507adb0c20a644665d41542a60b3bbf9e61ce4bc9d150add5fb8f0f6f",
    context: CONTROLLED_CONTEXTS.TEST_FIXTURE,
    reason: "forbidden audit snapshot field fixture",
  },
  {
    file: "tests/auth.test.js",
    identifier: "password",
    valueHash:
      "008c70392e3abfbd0fa47bbc2ed96aa99bd49e159727fcba0f2e6abeb3a9d601",
    context: CONTROLLED_CONTEXTS.TEST_FIXTURE,
    reason: "authentication API success fixture",
  },
  {
    file: "tests/auth.test.js",
    identifier: "password",
    valueHash:
      "6cc1edb100c643b90ff4fbac8800412a30d98ac6ca85fcffa8b893462dcd4b90",
    context: CONTROLLED_CONTEXTS.TEST_FIXTURE,
    reason: "authentication API rejection fixture",
  },
  {
    file: "tests/authService.test.js",
    identifier: "password",
    valueHash:
      "008c70392e3abfbd0fa47bbc2ed96aa99bd49e159727fcba0f2e6abeb3a9d601",
    context: CONTROLLED_CONTEXTS.TEST_FIXTURE,
    reason: "authentication service success fixture",
  },
  {
    file: "tests/authService.test.js",
    identifier: "password",
    valueHash:
      "6cc1edb100c643b90ff4fbac8800412a30d98ac6ca85fcffa8b893462dcd4b90",
    context: CONTROLLED_CONTEXTS.TEST_FIXTURE,
    reason: "authentication service rejection fixture",
  },
  {
    file: "tests/controlled.fixture.js",
    identifier: "password",
    valueHash:
      "008c70392e3abfbd0fa47bbc2ed96aa99bd49e159727fcba0f2e6abeb3a9d601",
    context: CONTROLLED_CONTEXTS.TEST_FIXTURE,
    reason: "repository scanner exact-exemption positive fixture",
  },
  {
    file: "tests/domainEventRegistry.test.js",
    identifier: "password",
    valueHash:
      "f59dedf54338de20b4729848292fb12e2c51adc3a0effa3c22560003a5c2f639",
    context: CONTROLLED_CONTEXTS.TEST_FIXTURE,
    reason: "forbidden domain-event field fixture",
  },
  {
    file: "tests/environment.test.js",
    identifier: "jwt_access_secret",
    valueHash:
      "f8d8cf7692b55ca540a50d3fa392a5b3b3b3430803d1cc3384b83530a3c4a35d",
    context: CONTROLLED_CONTEXTS.TEST_FIXTURE,
    reason: "valid production environment fixture",
  },
  {
    file: "tests/environment.test.js",
    identifier: "password",
    valueHash:
      "f9b0078b5df596d2ea19010c001bbd009e651de2c57e8fb7e355f31eb9d3f739",
    context: CONTROLLED_CONTEXTS.TEST_FIXTURE,
    reason: "seed validation redaction fixture",
  },
  {
    file: "tests/helpers/authTestHelper.js",
    identifier: "password",
    valueHash:
      "008c70392e3abfbd0fa47bbc2ed96aa99bd49e159727fcba0f2e6abeb3a9d601",
    context: CONTROLLED_CONTEXTS.TEST_FIXTURE,
    reason: "authentication helper default fixture",
  },
  {
    file: "tests/seedAdmin.test.js",
    identifier: "admin_password",
    valueHash:
      "298b0b03031d303f5a3fd6d3b2931c2327a4ad9530e211d544306856e30a134d",
    context: CONTROLLED_CONTEXTS.TEST_FIXTURE,
    reason: "admin seed environment fixture",
  },
  {
    file: "tests/seedAdmin.test.js",
    identifier: "password",
    valueHash:
      "49a61b164c0f89fba90c615c429308dd29d7915db2ca2317e519c531bbe82108",
    context: CONTROLLED_CONTEXTS.TEST_FIXTURE,
    reason: "admin seed persistence fixture",
  },
  {
    file: "tests/server.test.js",
    identifier: "jwt_access_secret",
    valueHash:
      "7e7c35b92e8f9a91489ce4014ec37c1ca020a9905b4ba1a90ebb78e5b09d2526",
    context: CONTROLLED_CONTEXTS.TEST_FIXTURE,
    reason: "server startup configuration fixture",
  },
  {
    file: "tests/swagger.test.js",
    identifier: "password",
    valueHash:
      "6ff687e9758f24a6b2f605917096c399eb4c62e62506e218d4651a424b25ba1a",
    context: CONTROLLED_CONTEXTS.TEST_FIXTURE,
    reason: "public-document credential URL rejection fixture",
  },
  {
    file: "tests/user.test.js",
    identifier: "password",
    valueHash:
      "008c70392e3abfbd0fa47bbc2ed96aa99bd49e159727fcba0f2e6abeb3a9d601",
    context: CONTROLLED_CONTEXTS.TEST_FIXTURE,
    reason: "user API validation and persistence fixture",
  },
  {
    file: "tests/userService.test.js",
    identifier: "password",
    valueHash:
      "008c70392e3abfbd0fa47bbc2ed96aa99bd49e159727fcba0f2e6abeb3a9d601",
    context: CONTROLLED_CONTEXTS.TEST_FIXTURE,
    reason: "user service creation and duplicate fixture",
  },
]);

const violation = (file, rule, category) => ({ file, rule, category });

const normalizeIdentifier = (identifier) =>
  identifier
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/-/g, "_")
    .toLowerCase();

const isCredentialIdentifier = (identifier) =>
  /(?:^|_)(?:password|secret|client_secret|service_token|access_token|refresh_token|api_key|private_key)$/.test(
    normalizeIdentifier(identifier)
  );

const isApprovedControlledContext = ({ file, context, reason }) =>
  reason.length > 0 &&
  CONTROLLED_CONTEXT_BY_EXACT_FILE.get(file) === context;

const isControlledCredentialFixture = ({ file, identifier, value }) => {
  const normalizedFile = file.replace(/\\/g, "/");
  const normalizedIdentifier = normalizeIdentifier(identifier);
  const valueHash = crypto.createHash("sha256").update(value).digest("hex");
  return CONTROLLED_CREDENTIAL_FIXTURE_EXEMPTIONS.some(
    (fixture) =>
      isApprovedControlledContext(fixture) &&
      fixture.file === normalizedFile &&
      fixture.identifier === normalizedIdentifier &&
      fixture.valueHash === valueHash
  );
};

const isAllowedCredentialLiteral = (value, identifier, file) => {
  const normalized = value.trim();
  if (
    normalized.length === 0 ||
    normalized.length === 1 ||
    normalized.includes("${") ||
    isControlledCredentialFixture({ file, identifier, value: normalized }) ||
    /^<[^>]+>$/.test(normalized) ||
    normalizeIdentifier(normalized) === normalizeIdentifier(identifier)
  ) {
    return true;
  }

  return /(?:^|[^a-z0-9])(?:change[_-]?this|placeholder|example|dummy|fake|test|local|development|fixture|sample|mock|redacted)(?:[^a-z0-9]|$)/i.test(
    normalized
  );
};

const containsHardcodedCredentialLiteral = (content, file) => {
  for (const {
    pattern,
    identifierGroup,
    literalGroup,
  } of credentialLiteralPatterns) {
    for (const match of content.matchAll(pattern)) {
      const identifier = match[identifierGroup];
      const literal = match[literalGroup];
      if (
        isCredentialIdentifier(identifier) &&
        !isAllowedCredentialLiteral(literal, identifier, file)
      ) {
        return true;
      }
    }
  }

  return false;
};

const readTrackedFiles = ({
  root = repositoryRoot,
  listFiles = () =>
    execFileSync(
      "git",
      ["ls-files", "--cached", "--others", "--exclude-standard", "-z"],
      {
        cwd: root,
        encoding: "utf8",
      }
    )
      .split("\0")
      .filter(Boolean),
  readFile = (file) => fs.readFileSync(path.join(root, file)),
} = {}) =>
  new Map(listFiles().map((file) => [file.replace(/\\/g, "/"), readFile(file)]));

const isPlaceholderMongoUri = (uri) => {
  try {
    const parsed = new URL(uri);
    if (parsed.hostname.endsWith(".invalid")) return true;
    return (
      parsed.username.length > 0 &&
      parsed.password.length > 0 &&
      PLACEHOLDER_MARKERS.test(parsed.username) &&
      PLACEHOLDER_MARKERS.test(parsed.password)
    );
  } catch {
    return false;
  }
};

const parseEnvironmentExample = (content) =>
  Object.fromEntries(
    content
      .split(/\r?\n/)
      .filter((line) => line && !line.startsWith("#") && line.includes("="))
      .map((line) => {
        const separator = line.indexOf("=");
        return [line.slice(0, separator), line.slice(separator + 1)];
      })
  );

const findSecurityViolations = (trackedFiles) => {
  const violations = [];
  const paths = [...trackedFiles.keys()].sort();

  for (const file of paths) {
    const normalized = file.replace(/\\/g, "/");
    const baseName = path.posix.basename(normalized);
    if (
      /(^|\/)\.env(?:\.|$)/.test(normalized) &&
      baseName !== ".env.example"
    ) {
      violations.push(
        violation(normalized, "TRACKED_ENV_FILE", "tracked environment file")
      );
    }
    if (/\.(?:pem|key|p12|pfx)$/i.test(normalized)) {
      violations.push(
        violation(
          normalized,
          "TRACKED_PRIVATE_KEY_FILE",
          "tracked private-key material"
        )
      );
    }

    const buffer = trackedFiles.get(file);
    if (!Buffer.isBuffer(buffer) || buffer.includes(0)) continue;
    const content = buffer.toString("utf8");

    if (privateKeyHeaderPattern.test(content)) {
      violations.push(
        violation(normalized, "PRIVATE_KEY_HEADER", "private-key material")
      );
    }
    if (jwtPattern.test(content)) {
      violations.push(
        violation(normalized, "JWT_TOKEN_LITERAL", "JWT-like token literal")
      );
    }
    jwtPattern.lastIndex = 0;

    for (const match of content.matchAll(mongoUriPattern)) {
      const uri = match[0];
      const authority = uri.slice(uri.indexOf("//") + 2).split(/[/?#]/, 1)[0];
      if (authority.includes("@") && !isPlaceholderMongoUri(uri)) {
        violations.push(
          violation(
            normalized,
            "MONGODB_EMBEDDED_CREDENTIALS",
            "embedded MongoDB credentials"
          )
        );
        break;
      }
    }

    if (containsHardcodedCredentialLiteral(content, normalized)) {
      violations.push(
        violation(
          normalized,
          "HARDCODED_CREDENTIAL_LITERAL",
          "hardcoded credential-like literal"
        )
      );
    }
  }

  const example = trackedFiles.get(".env.example");
  if (!example) {
    violations.push(
      violation(
        ".env.example",
        "ENV_EXAMPLE_MISSING",
        "missing environment template"
      )
    );
  } else {
    const values = parseEnvironmentExample(example.toString("utf8"));
    for (const variable of ["JWT_ACCESS_SECRET", "ADMIN_PASSWORD"]) {
      if (!values[variable] || !PLACEHOLDER_MARKERS.test(values[variable])) {
        violations.push(
          violation(
            ".env.example",
            "ENV_EXAMPLE_SECRET_NOT_PLACEHOLDER",
            `${variable} is not an explicit placeholder`
          )
        );
      }
    }
  }

  return violations;
};

const main = () => {
  const violations = findSecurityViolations(readTrackedFiles());
  if (violations.length > 0) {
    for (const { file, rule, category } of violations) {
      console.error(`${file}: ${rule} (${category})`);
    }
    process.exitCode = 1;
    return;
  }
  console.log("Repository security verification passed");
};

if (require.main === module) main();

module.exports = {
  findSecurityViolations,
  parseEnvironmentExample,
  readTrackedFiles,
};
