const {
  findSecurityViolations,
  readTrackedFiles,
} = require("../scripts/verifyRepositorySecurity");

const asFiles = (entries) =>
  new Map(
    Object.entries(entries).map(([file, content]) => [file, Buffer.from(content)])
  );

const safeExample = [
  "NODE_ENV=development",
  "JWT_ACCESS_SECRET=change_this_access_token_secret",
  "ADMIN_PASSWORD=change_this_admin_password",
].join("\n");

const literalAssignment = (identifierParts, valueParts) =>
  [
    "const ",
    identifierParts.join(""),
    " = ",
    '"',
    valueParts.join(""),
    '"',
    ";",
  ].join("");

const directLiteralAssignment = (
  targetParts,
  valueParts,
  beforeEquals = " ",
  afterEquals = " "
) =>
  [
    targetParts.join(""),
    beforeEquals,
    "=",
    afterEquals,
    '"',
    valueParts.join(""),
    '"',
    ";",
  ].join("");

const literalProperty = (identifierParts, valueParts) =>
  ["{ ", identifierParts.join(""), ": ", '"', valueParts.join(""), '"', " }"]
    .join("");

const quotedLiteralProperty = (identifierParts, valueParts) =>
  [
    '{ "',
    identifierParts.join(""),
    '": "',
    valueParts.join(""),
    '" }',
  ].join("");

const syntheticCredentialParts = ["S3cure", "-Material", "-2026", "-Value"];
const approvedPasswordParts = ["Password", "123"];
const approvedWrongPasswordParts = ["Wrong", "Password", "123"];
const documentedPasswordParts = ["ChangeMe", "_Strong", "_123!"];

const expectedHardcodedCredentialViolation = (file) => [
  {
    file,
    rule: "HARDCODED_CREDENTIAL_LITERAL",
    category: "hardcoded credential-like literal",
  },
];

describe("Repository security verification", () => {
  it("accepts explicit examples", () => {
    const violations = findSecurityViolations(
      asFiles({
        ".env.example": safeExample,
      })
    );

    expect(violations).toEqual([]);
  });

  it("rejects real-looking embedded MongoDB credentials under tests", () => {
    const username = "account-user";
    const password = ["credential", "value"].join("-");
    const credentialUri = [
      `mongodb://${username}:`,
      `${password}@database.example.com/inventory`,
    ].join("");
    const violations = findSecurityViolations(
      asFiles({
        ".env.example": safeExample,
        "tests/database.fixture.js": credentialUri,
      })
    );

    expect(violations).toEqual([
      {
        file: "tests/database.fixture.js",
        rule: "MONGODB_EMBEDDED_CREDENTIALS",
        category: "embedded MongoDB credentials",
      },
    ]);
  });

  it("accepts an explicit .invalid MongoDB credential fixture", () => {
    const violations = findSecurityViolations(
      asFiles({
        ".env.example": safeExample,
        "tests/database.fixture.js":
          "mongodb://test-user:test-password@database.invalid/inventory",
      })
    );

    expect(violations).toEqual([]);
  });

  it("accepts a credential-free local MongoDB URI", () => {
    const violations = findSecurityViolations(
      asFiles({
        ".env.example": safeExample,
        "docker-compose.yml":
          "MONGODB_URI: mongodb://mongo:27017/inventory?replicaSet=rs0",
      })
    );

    expect(violations).toEqual([]);
  });

  it("reports high-confidence categories without returning secret values", () => {
    const privateHeader = ["-----", "BEGIN PRIVATE KEY-----"].join("");
    const credentialUri = [
      "mongodb://live-user:",
      "private-value@database.internal/inventory",
    ].join("");
    const violations = findSecurityViolations(
      asFiles({
        ".env.example": safeExample,
        ".env.production": "JWT_ACCESS_SECRET=private-value",
        "src/private.js": `${privateHeader}\n${credentialUri}`,
      })
    );
    const serialized = JSON.stringify(violations);

    expect(violations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ rule: "TRACKED_ENV_FILE" }),
        expect.objectContaining({ rule: "PRIVATE_KEY_HEADER" }),
        expect.objectContaining({ rule: "MONGODB_EMBEDDED_CREDENTIALS" }),
      ])
    );
    expect(serialized).not.toContain("private-value");
    expect(serialized).not.toContain("live-user");
    for (const result of violations) {
      expect(Object.keys(result)).toEqual(["file", "rule", "category"]);
    }
  });

  it.each([
    ["password", ["pass", "word"]],
    ["productionPassword", ["production", "Password"]],
    ["adminPassword", ["admin", "Password"]],
    ["secret", ["sec", "ret"]],
    ["serviceToken", ["service", "Token"]],
    ["clientSecret", ["client", "Secret"]],
    ["jwtAccessSecret", ["jwt", "Access", "Secret"]],
    ["accessToken", ["access", "Token"]],
    ["refreshToken", ["refresh", "Token"]],
    ["apiKey", ["api", "Key"]],
    ["privateKey", ["private", "Key"]],
  ])("rejects a hardcoded %s literal", (_label, identifierParts) => {
    const source = literalAssignment(
      identifierParts,
      syntheticCredentialParts
    );
    const violations = findSecurityViolations(
      asFiles({
        ".env.example": safeExample,
        "tests/credential.fixture.js": source,
      })
    );

    expect(violations).toEqual(
      expectedHardcodedCredentialViolation("tests/credential.fixture.js")
    );
  });

  it("rejects a bare credential identifier assignment", () => {
    const file = "src/config/bare-assignment.fixture.js";
    const violations = findSecurityViolations(
      asFiles({
        ".env.example": safeExample,
        [file]: directLiteralAssignment(
          ["production", "Password"],
          syntheticCredentialParts
        ),
      })
    );

    expect(violations).toEqual(expectedHardcodedCredentialViolation(file));
  });

  it.each([
    ["dot member", ["config", ".", "api", "Key"]],
    [
      "nested dot member",
      ["runtime", ".", "credentials", ".", "service", "Token"],
    ],
    ["this member", ["this", ".", "client", "Secret"]],
  ])("rejects a hardcoded %s assignment", (_label, targetParts) => {
    const file = "src/config/member-assignment.fixture.js";
    const violations = findSecurityViolations(
      asFiles({
        ".env.example": safeExample,
        [file]: directLiteralAssignment(targetParts, syntheticCredentialParts),
      })
    );

    expect(violations).toEqual(expectedHardcodedCredentialViolation(file));
  });

  it.each([
    ["double-quoted", ["settings", '["', "api", "Key", '"]']],
    ["single-quoted", ["settings", "['", "client", "Secret", "']"]],
  ])("rejects a hardcoded %s bracket-member assignment", (_label, targetParts) => {
    const file = "src/config/bracket-assignment.fixture.js";
    const violations = findSecurityViolations(
      asFiles({
        ".env.example": safeExample,
        [file]: directLiteralAssignment(targetParts, syntheticCredentialParts),
      })
    );

    expect(violations).toEqual(expectedHardcodedCredentialViolation(file));
  });

  it("rejects a hardcoded class-field assignment", () => {
    const file = "src/config/class-field.fixture.js";
    const source = [
      "class RuntimeConfig {\n  ",
      directLiteralAssignment(["private", "Key"], syntheticCredentialParts),
      "\n}",
    ].join("");
    const violations = findSecurityViolations(
      asFiles({
        ".env.example": safeExample,
        [file]: source,
      })
    );

    expect(violations).toEqual(expectedHardcodedCredentialViolation(file));
  });

  it.each([
    ["const", ["production", "Password"]],
    ["let", ["client", "Secret"]],
  ])(
    "rejects a %s declaration with a block comment and multiline whitespace",
    (keyword, identifierParts) => {
      const file = "src/config/commented-declaration.fixture.js";
      const source = directLiteralAssignment(
        [keyword, " ", ...identifierParts],
        syntheticCredentialParts,
        " /* controlled-looking comment */\n  "
      );
      const violations = findSecurityViolations(
        asFiles({
          ".env.example": safeExample,
          [file]: source,
        })
      );

      expect(violations).toEqual(expectedHardcodedCredentialViolation(file));
    }
  );

  it.each([
    [
      ["config", ".", "production", "Password"],
      approvedPasswordParts,
    ],
    [
      ["config", ".", "client", "Secret"],
      approvedWrongPasswordParts,
    ],
  ])(
    "rejects an original controlled value in an unapproved member assignment",
    (targetParts, valueParts) => {
      const file = "src/config/original-value-member.fixture.js";
      const violations = findSecurityViolations(
        asFiles({
          ".env.example": safeExample,
          [file]: directLiteralAssignment(targetParts, valueParts),
        })
      );

      expect(violations).toEqual(expectedHardcodedCredentialViolation(file));
    }
  );

  it.each([
    [
      "environment member",
      ["config", ".", "api", "Key", " = process.env.API_KEY;"],
    ],
    [
      "provider member",
      [
        "this",
        ".",
        "client",
        "Secret",
        " = secretProvider.get();",
      ],
    ],
    [
      "request bare assignment",
      ["production", "Password", " = request.body.password;"],
    ],
    [
      "generated bracket member",
      [
        "settings",
        '["',
        "service",
        "Token",
        '"] = generateToken();',
      ],
    ],
    [
      "signed declaration",
      ["const ", "access", "Token", " = jwt.sign(payload);"],
    ],
  ])("accepts a dynamic %s", (_label, sourceParts) => {
    expect(
      findSecurityViolations(
        asFiles({
          ".env.example": safeExample,
          "src/config/dynamic-assignment.fixture.js": sourceParts.join(""),
        })
      )
    ).toEqual([]);
  });

  it("does not classify equality or inequality comparisons as assignments", () => {
    const identifier = ["pass", "word"].join("");
    const source = ["==", "===", "!=", "!=="]
      .map((operator) => `${identifier} ${operator} "value";`)
      .join("\n");

    expect(
      findSecurityViolations(
        asFiles({
          ".env.example": safeExample,
          "src/config/comparison.fixture.js": source,
        })
      )
    ).toEqual([]);
  });

  it("does not classify an arrow function as a credential assignment", () => {
    const source = [
      "const ",
      ["pass", "word"].join(""),
      ' = value => "result";',
    ].join("");

    expect(
      findSecurityViolations(
        asFiles({
          ".env.example": safeExample,
          "src/config/arrow.fixture.js": source,
        })
      )
    ).toEqual([]);
  });

  it.each([
    [
      "src/config/runtimeCredentials.js",
      ["production", "Password"],
      approvedPasswordParts,
    ],
    [
      "src/config/runtimeCredentials.js",
      ["production", "_password"],
      approvedPasswordParts,
    ],
    [
      "src/config/runtimeCredentials.js",
      ["Production", "Password"],
      approvedPasswordParts,
    ],
    [
      "src/config/securitySettings.js",
      ["client", "Secret"],
      approvedWrongPasswordParts,
    ],
    [
      "src/config/securitySettings.js",
      ["client", "_secret"],
      approvedWrongPasswordParts,
    ],
    [
      "src/config/securitySettings.js",
      ["Client", "Secret"],
      approvedWrongPasswordParts,
    ],
  ])(
    "rejects a controlled value in production-like %s",
    (file, identifierParts, valueParts) => {
      const violations = findSecurityViolations(
        asFiles({
          ".env.example": safeExample,
          [file]: literalAssignment(identifierParts, valueParts),
        })
      );

      expect(violations).toEqual(expectedHardcodedCredentialViolation(file));
    }
  );

  it("rejects a controlled value in an unapproved test file", () => {
    const file = "tests/unapproved.fixture.js";
    const violations = findSecurityViolations(
      asFiles({
        ".env.example": safeExample,
        [file]: literalAssignment(["pass", "word"], approvedPasswordParts),
      })
    );

    expect(violations).toEqual(expectedHardcodedCredentialViolation(file));
  });

  it("rejects an approved path and value under another credential name", () => {
    const file = "tests/controlled.fixture.js";
    const violations = findSecurityViolations(
      asFiles({
        ".env.example": safeExample,
        [file]: literalAssignment(["client", "Secret"], approvedPasswordParts),
      })
    );

    expect(violations).toEqual(expectedHardcodedCredentialViolation(file));
  });

  it("rejects an approved path and identifier with another literal", () => {
    const file = "tests/controlled.fixture.js";
    const violations = findSecurityViolations(
      asFiles({
        ".env.example": safeExample,
        [file]: literalAssignment(["pass", "word"], syntheticCredentialParts),
      })
    );

    expect(violations).toEqual(expectedHardcodedCredentialViolation(file));
  });

  it("rejects a hardcoded apiKey object-property literal", () => {
    const source = literalProperty(
      ["api", "Key"],
      syntheticCredentialParts
    );
    const violations = findSecurityViolations(
      asFiles({
        ".env.example": safeExample,
        "src/config.fixture.js": source,
      })
    );

    expect(violations).toEqual(
      expectedHardcodedCredentialViolation("src/config.fixture.js")
    );
  });

  it("rejects a quoted clientSecret object-property literal", () => {
    const file = "src/quoted-config.fixture.js";
    const violations = findSecurityViolations(
      asFiles({
        ".env.example": safeExample,
        [file]: quotedLiteralProperty(
          ["client", "Secret"],
          syntheticCredentialParts
        ),
      })
    );

    expect(violations).toEqual(expectedHardcodedCredentialViolation(file));
  });

  it("accepts only the exact approved controlled test fixture tuple", () => {
    expect(
      findSecurityViolations(
        asFiles({
          ".env.example": safeExample,
          "tests/controlled.fixture.js": literalAssignment(
            ["pass", "word"],
            approvedPasswordParts
          ),
        })
      )
    ).toEqual([]);
  });

  it("accepts only the exact approved documentation example tuple", () => {
    expect(
      findSecurityViolations(
        asFiles({
          ".env.example": safeExample,
          "README.md": literalProperty(
            ["pass", "word"],
            documentedPasswordParts
          ),
        })
      )
    ).toEqual([]);
  });

  it("accepts explicit placeholders", () => {
    const acceptedSources = [
      literalAssignment(["to", "ken"], ["test", "-token"]),
      literalAssignment(["sec", "ret"], ["change", "_this", "_secret"]),
      literalAssignment(["api", "Key"], ["example", "-api-key"]),
    ].join("\n");

    expect(
      findSecurityViolations(
        asFiles({
          ".env.example": safeExample,
          "tests/controlled.fixture.js": acceptedSources,
        })
      )
    ).toEqual([]);
  });

  it("accepts environment, request, and generated credential assignments", () => {
    const dynamicSources = [
      ["const ", ["sec", "ret"].join(""), " = process.env.JWT_ACCESS_SECRET;"].join(""),
      ["const ", ["pass", "word"].join(""), " = request.body.password;"].join(""),
      ["const ", ["access", "Token"].join(""), " = jwt.sign(payload);"].join(""),
      ["const token = generateToken();"].join(""),
    ].join("\n");

    expect(
      findSecurityViolations(
        asFiles({
          ".env.example": safeExample,
          "src/dynamic.fixture.js": dynamicSources,
        })
      )
    ).toEqual([]);
  });

  describe("comment-aware and static-field assignment coverage", () => {
    it.each([
      ["static public class field", ["static ", "private", "Key"], " ", " "],
      [
        "static class field with a block comment",
        ["static", " /* modifier gap */ ", "api", "Key"],
        " /* assignment gap */ ",
        " ",
      ],
      [
        "static class field with a line comment",
        ["static", " // modifier gap\n  ", "client", "Secret"],
        " ",
        " // literal gap\n  ",
      ],
    ])("rejects a hardcoded %s", (_label, targetParts, beforeEquals, afterEquals) => {
      const file = "src/config/static-field.fixture.js";
      const source = [
        "class RuntimeConfig {\n  ",
        directLiteralAssignment(
          targetParts,
          syntheticCredentialParts,
          beforeEquals,
          afterEquals
        ),
        "\n}",
      ].join("");

      expect(
        findSecurityViolations(
          asFiles({
            ".env.example": safeExample,
            [file]: source,
          })
        )
      ).toEqual(expectedHardcodedCredentialViolation(file));
    });

    it.each([
      ["before the assignment operator", " // declaration gap\n  ", " "],
      ["after the assignment operator", " ", " // literal gap\n  "],
    ])(
      "rejects a declaration with a line comment %s",
      (_label, beforeEquals, afterEquals) => {
        const file = "src/config/line-comment-declaration.fixture.js";
        const source = directLiteralAssignment(
          ["const ", "production", "Password"],
          syntheticCredentialParts,
          beforeEquals,
          afterEquals
        );

        expect(
          findSecurityViolations(
            asFiles({
              ".env.example": safeExample,
              [file]: source,
            })
          )
        ).toEqual(expectedHardcodedCredentialViolation(file));
      }
    );

    it.each([
      ["before the assignment operator", " // assignment gap\n", " "],
      ["after the assignment operator", " ", " // literal gap\n"],
    ])(
      "rejects a bare assignment with a line comment %s",
      (_label, beforeEquals, afterEquals) => {
        const file = "src/config/line-comment-bare.fixture.js";
        const source = directLiteralAssignment(
          ["admin", "Password"],
          syntheticCredentialParts,
          beforeEquals,
          afterEquals
        );

        expect(
          findSecurityViolations(
            asFiles({
              ".env.example": safeExample,
              [file]: source,
            })
          )
        ).toEqual(expectedHardcodedCredentialViolation(file));
      }
    );

    it.each([
      [
        "dot member with block comments around the dot",
        [
          "config",
          " /* receiver gap */ ",
          ".",
          " /* property gap */ ",
          "api",
          "Key",
        ],
      ],
      [
        "dot member with a line comment before the dot",
        ["config", " // receiver gap\n  ", ".", " ", "client", "Secret"],
      ],
      [
        "nested member with comments between segments",
        [
          "runtime",
          " /* first segment */ ",
          ".",
          " credentials",
          " // second segment\n  ",
          ".",
          " ",
          "service",
          "Token",
        ],
      ],
    ])("rejects a hardcoded %s", (_label, targetParts) => {
      const file = "src/config/commented-member.fixture.js";
      const source = directLiteralAssignment(
        targetParts,
        syntheticCredentialParts
      );

      expect(
        findSecurityViolations(
          asFiles({
            ".env.example": safeExample,
            [file]: source,
          })
        )
      ).toEqual(expectedHardcodedCredentialViolation(file));
    });

    it("rejects a bracket member with a comment before the opening bracket", () => {
      const file = "src/config/commented-bracket.fixture.js";
      const source = directLiteralAssignment(
        [
          "settings",
          " /* bracket gap */ ",
          "[",
          '"',
          "client",
          "Secret",
          '"',
          "]",
        ],
        syntheticCredentialParts
      );

      expect(
        findSecurityViolations(
          asFiles({
            ".env.example": safeExample,
            [file]: source,
          })
        )
      ).toEqual(expectedHardcodedCredentialViolation(file));
    });

    it("rejects a bracket member with comments around bracket and assignment tokens", () => {
      const file = "src/config/commented-bracket-assignment.fixture.js";
      const source = directLiteralAssignment(
        [
          "runtime",
          " /* receiver gap */ ",
          ".",
          " settings",
          " // before bracket\n  ",
          "[",
          " /* after bracket */ ",
          "'",
          "api",
          "Key",
          "'",
          " /* before close */ ",
          "]",
        ],
        syntheticCredentialParts,
        " /* before equals */ ",
        " // after equals\n  "
      );

      expect(
        findSecurityViolations(
          asFiles({
            ".env.example": safeExample,
            [file]: source,
          })
        )
      ).toEqual(expectedHardcodedCredentialViolation(file));
    });

    it("rejects a hardcoded assignment inside a line comment", () => {
      const file = "src/config/commented-out-line.fixture.js";
      const source = [
        "// const ",
        ["api", "Key"].join(""),
        ' = "',
        syntheticCredentialParts.join(""),
        '";',
      ].join("");

      expect(
        findSecurityViolations(
          asFiles({
            ".env.example": safeExample,
            [file]: source,
          })
        )
      ).toEqual(expectedHardcodedCredentialViolation(file));
    });

    it("rejects a hardcoded assignment inside a block comment", () => {
      const file = "src/config/commented-out-block.fixture.js";
      const source = [
        "/*\nconst ",
        ["client", "Secret"].join(""),
        ' = "',
        syntheticCredentialParts.join(""),
        '";\n*/',
      ].join("");

      expect(
        findSecurityViolations(
          asFiles({
            ".env.example": safeExample,
            [file]: source,
          })
        )
      ).toEqual(expectedHardcodedCredentialViolation(file));
    });

    it("rejects original controlled values in static and comment-separated production assignments", () => {
      const commentMemberFile =
        "src/config/original-comment-member.fixture.js";
      const staticFile = "src/config/original-static-field.fixture.js";
      const commentMemberSource = directLiteralAssignment(
        [
          "config",
          " /* member gap */ ",
          ".",
          " ",
          "production",
          "Password",
        ],
        approvedWrongPasswordParts,
        " ",
        " // literal gap\n  "
      );
      const staticSource = [
        "class RuntimeConfig {\n  ",
        directLiteralAssignment(
          ["static ", "pass", "word"],
          approvedPasswordParts
        ),
        "\n}",
      ].join("");

      expect(
        findSecurityViolations(
          asFiles({
            ".env.example": safeExample,
            [commentMemberFile]: commentMemberSource,
            [staticFile]: staticSource,
          })
        )
      ).toEqual([
        ...expectedHardcodedCredentialViolation(commentMemberFile),
        ...expectedHardcodedCredentialViolation(staticFile),
      ]);
    });

    it.each([
      [
        "process.env",
        [
          "class RuntimeConfig {\n  static ",
          ["api", "Key"].join(""),
          " = process.env.API_KEY;\n}",
        ].join(""),
      ],
      [
        "a provider function",
        [
          "class RuntimeConfig {\n  static ",
          ["private", "Key"].join(""),
          " = secretProvider.get();\n}",
        ].join(""),
      ],
    ])("accepts a static field from %s", (_label, source) => {
      expect(
        findSecurityViolations(
          asFiles({
            ".env.example": safeExample,
            "src/config/dynamic-static-field.fixture.js": source,
          })
        )
      ).toEqual([]);
    });

    it("accepts a comment-separated dynamic member assignment", () => {
      const source = [
        "config",
        " /* receiver gap */ ",
        ".",
        " ",
        ["api", "Key"].join(""),
        " = // dynamic source\n  secretProvider.get();",
      ].join("");

      expect(
        findSecurityViolations(
          asFiles({
            ".env.example": safeExample,
            "src/config/dynamic-comment-member.fixture.js": source,
          })
        )
      ).toEqual([]);
    });

    it("does not classify comment-separated equality or inequality expressions as assignments", () => {
      const identifier = ["pass", "word"].join("");
      const member = ["config", ".", "api", "Key"].join("");
      const value = syntheticCredentialParts.join("");
      const source = ["==", "===", "!=", "!=="]
        .flatMap((operator) => [
          `${identifier} /* before operator */ ${operator} /* after operator */ "${value}";`,
          `${member} // before operator\n  ${operator} "${value}";`,
        ])
        .join("\n");

      expect(
        findSecurityViolations(
          asFiles({
            ".env.example": safeExample,
            "src/config/comment-comparison.fixture.js": source,
          })
        )
      ).toEqual([]);
    });

    it("does not classify an arrow function with comments as an assignment", () => {
      const source = [
        "const ",
        ["pass", "word"].join(""),
        " /* before equals */ = // before value\n  value /* before arrow */ => ",
        '"result";',
      ].join("");

      expect(
        findSecurityViolations(
          asFiles({
            ".env.example": safeExample,
            "src/config/comment-arrow.fixture.js": source,
          })
        )
      ).toEqual([]);
    });

    it("accepts the exact controlled fixture tuple through a static commented field", () => {
      const source = [
        "class Fixture {\n  ",
        directLiteralAssignment(
          ["static", " /* exact tuple */ ", "pass", "word"],
          approvedPasswordParts,
          " ",
          " // approved literal\n  "
        ),
        "\n}",
      ].join("");

      expect(
        findSecurityViolations(
          asFiles({
            ".env.example": safeExample,
            "tests/controlled.fixture.js": source,
          })
        )
      ).toEqual([]);
    });

    it("accepts explicit placeholders in static and comment-separated assignments", () => {
      const source = [
        "class RuntimeConfig {\n  ",
        directLiteralAssignment(
          ["static ", "api", "Key"],
          ["example", "-api-key"],
          " /* assignment gap */ ",
          " // literal gap\n  "
        ),
        "\n}\n",
        directLiteralAssignment(
          ["production", "Password"],
          ["change", "_this", "_password"],
          " // assignment gap\n",
          " "
        ),
      ].join("");

      expect(
        findSecurityViolations(
          asFiles({
            ".env.example": safeExample,
            "src/config/comment-placeholder.fixture.js": source,
          })
        )
      ).toEqual([]);
    });

    it("does not treat comment-like text inside a quoted literal as a token gap", () => {
      const quotedText = [
        "config ",
        "/* not a source comment */",
        " . ",
        ["api", "Key"].join(""),
        " = secretProvider.get();",
      ].join("");
      const source = `const message = ${JSON.stringify(quotedText)};`;

      expect(
        findSecurityViolations(
          asFiles({
            ".env.example": safeExample,
            "src/config/comment-text.fixture.js": source,
          })
        )
      ).toEqual([]);
    });

    it("does not treat URL slashes inside a quoted literal as a line comment", () => {
      const source =
        'const documentationUrl = "https://example.invalid/path//fragment";';

      expect(
        findSecurityViolations(
          asFiles({
            ".env.example": safeExample,
            "src/config/url-literal.fixture.js": source,
          })
        )
      ).toEqual([]);
    });

    it("returns only file, rule, and category for a static commented finding", () => {
      const file = "src/config/static-redaction.fixture.js";
      const source = [
        "class RuntimeConfig {\n  ",
        directLiteralAssignment(
          ["static", " /* modifier gap */ ", "private", "Key"],
          syntheticCredentialParts,
          " ",
          " // literal gap\n  "
        ),
        "\n}",
      ].join("");
      const violations = findSecurityViolations(
        asFiles({
          ".env.example": safeExample,
          [file]: source,
        })
      );

      expect(violations).toEqual(expectedHardcodedCredentialViolation(file));
      for (const result of violations) {
        expect(Object.keys(result)).toEqual(["file", "rule", "category"]);
      }
    });

    it("serializes neither the synthetic value nor the commented source line", () => {
      const file = "src/config/comment-redaction.fixture.js";
      const sourceLine = directLiteralAssignment(
        ["config", ".", "service", "Token"],
        syntheticCredentialParts,
        " ",
        " // literal gap\n  "
      );
      const serialized = JSON.stringify(
        findSecurityViolations(
          asFiles({
            ".env.example": safeExample,
            [file]: sourceLine,
          })
        )
      );

      expect(serialized).not.toContain(syntheticCredentialParts.join(""));
      expect(serialized).not.toContain(sourceLine);
    });
  });

  it("redacts hardcoded credential findings", () => {
    const source = literalAssignment(
      ["client", "Secret"],
      syntheticCredentialParts
    );
    const violations = findSecurityViolations(
      asFiles({
        ".env.example": safeExample,
        "src/redaction.fixture.js": source,
      })
    );
    const serialized = JSON.stringify(violations);

    expect(violations).toEqual(
      expectedHardcodedCredentialViolation("src/redaction.fixture.js")
    );
    expect(serialized).not.toContain(syntheticCredentialParts.join(""));
    expect(serialized).not.toContain(source);
    for (const result of violations) {
      expect(Object.keys(result)).toEqual(["file", "rule", "category"]);
    }
  });

  it("redacts direct-assignment findings", () => {
    const file = "src/redacted-member.fixture.js";
    const source = directLiteralAssignment(
      ["runtime", ".", "credentials", ".", "service", "Token"],
      syntheticCredentialParts
    );
    const violations = findSecurityViolations(
      asFiles({
        ".env.example": safeExample,
        [file]: source,
      })
    );
    const serialized = JSON.stringify(violations);

    expect(violations).toEqual(expectedHardcodedCredentialViolation(file));
    expect(serialized).not.toContain(syntheticCredentialParts.join(""));
    expect(serialized).not.toContain(source);
    for (const result of violations) {
      expect(Object.keys(result)).toEqual(["file", "rule", "category"]);
    }
  });

  it("passes against the current repository files", () => {
    expect(findSecurityViolations(readTrackedFiles())).toEqual([]);
  });
});
