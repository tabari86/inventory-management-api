const { execFileSync } = require("child_process");
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

const violation = (file, rule, category) => ({ file, rule, category });

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
