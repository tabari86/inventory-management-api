# Security policy

This document describes the implemented Phase 1 controls and their limits. It
is not a penetration-test report, compliance certification, or claim of complete
OWASP coverage.

## Authentication and authorization

Login issues a signed JWT access token and an opaque refresh token. The access
token lifetime defaults to `15m`; startup accepts positive `s`, `m`, `h`, or `d`
durations up to 24 hours. Protected routes verify the JWT and load an active
User. Role middleware applies the `admin`, `manager`, and `viewer` permissions
documented by the API; public registration and API-based admin creation are not
available.

Refresh tokens are random 64-byte values returned once to the client. Only a
SHA-256 hash is stored, with a seven-day expiry. Refresh rotates and revokes the
used token; logout revokes the presented token. Each refresh token is
single-use: one MongoDB transaction atomically consumes the old token and
creates one hashed successor with the same session, so concurrent reuse is
rejected. A successful login normally revokes older active refresh tokens for
that user. MongoDB TTL cleanup is asynchronous, and server-side revocation
remains authoritative while a row exists. Token-family revocation and refresh-
token theft detection remain outside Phase 1.

## Request and mutation controls

- `express-validator` allowlists and normalizes request fields before
  controllers invoke application services. Collection reads reject unknown,
  nested, operator-like, and unsupported query values.
- Direct application-service callers receive the same bounded caller-command
  validation. Public service validation emits at most 20 static
  `{field,message}` details (128-character fields and 160-character messages)
  and never copies rejected values or raw Mongoose messages. Unknown validation
  shape is treated as an internal error instead of being downgraded to 400.
- Unexpected service failures retain the original exception only as native
  `cause`; public safe messages, HTTP details, structured logs, and validation
  details exclude that cause. Such failures are non-retryable unless a separate
  proven policy says otherwise.
- Helmet supplies security headers and Express does not expose `X-Powered-By`.
- Login rate limiting is process-local. It protects the current single-instance
  demo topology but is not a distributed rate limit.
- Request and correlation IDs are validated or safely replaced, returned on
  responses, and included in allowlisted operational and business-event
  metadata.
- Optional idempotency keys are hashed and scoped to actor plus stable operation
  ID. The original mutation, audit/outbox persistence, and completion record
  share one transaction; replay does not repeat the domain write.
- Inventory and lifecycle mutations use MongoDB transactions, guarded writes,
  explicit aggregate versions, referential checks, and derived Stock lifecycle
  guards. These are application consistency controls, not distributed-system
  guarantees.
- Unknown driver errors are not wrapped inside caller-owned transaction
  callbacks. Their MongoDB labels remain available until the outer transaction
  owner finishes retry and abort handling; only the final application boundary
  converts an ultimate raw failure to `INTERNAL_ERROR`.
- Application context is a strict transport-neutral allowlist, not an extension
  bag. Exactly `http-api/user` and `internal/service` are accepted. Context and
  actor objects must be plain exact-shape records; extra metadata, inherited or
  accessor fields, cross-pairs, and arbitrary actor/source strings are rejected.
  Request, correlation, causation, and actor IDs are 1-128 ASCII allowlisted
  characters, and causation remains equal to request ID. Service IDs are bounded
  identifiers, not credentials; tokens, passwords, headers, and caller metadata
  are not application-context fields.
- The internal/service value contract reuses the same transactional
  idempotency/audit/outbox controls without widening public HTTP input. It adds
  no worker, scheduler, consumer, webhook, n8n, queue, or machine-authentication
  implementation. Existing HTTP request-context generation and user actors are
  unchanged.

## Environment and secret handling

`src/config/environment.js` is the startup validation boundary. It parses and
bounds runtime values before database connection or listener startup. Invalid
configuration produces the structured `STARTUP_CONFIGURATION_INVALID` event,
exits with code `1`, and does not include the rejected value. MongoDB connection
errors and operational log events also exclude connection strings and
credentials.

The repository policy is:

- `.env` files are ignored and must never be committed. `.env.example` contains
  local placeholders only.
- Production secrets are injected by the deployment platform. They do not
  belong in source, Docker image layers, Swagger examples, tests, documentation,
  tickets, or incident reports.
- Production `JWT_ACCESS_SECRET` must be at least 32 characters and cannot equal
  known project, Docker, test, or obvious placeholders. JWT secret rotation
  invalidates existing access tokens.
- `MONGODB_URI` must use `mongodb://` or `mongodb+srv://`. Credential rotation
  requires updating the deployment variable and restarting the service. The URI
  must never be printed.
- `ADMIN_NAME`, `ADMIN_EMAIL`, and `ADMIN_PASSWORD` are validated only by the
  seed command. They are temporary bootstrap inputs, not normal API startup
  configuration. Production seed passwords reject the documented placeholders;
  the command never logs the password or an external error message that could
  contain the connection string.
- Docker Compose is explicitly a local-development runtime and may use its
  documented placeholder values. The built image still defaults to production
  and runs as the non-root `node` user. Render keeps `NODE_ENV=production` and
  receives its JWT and database values through platform variables.

`npm run verify:security` scans the current repository file set for tracked
environment/private-key files, private-key headers, high-confidence embedded
MongoDB credentials, JWT-like literals, non-placeholder example secrets, and
high-confidence hardcoded string literals assigned through declarations, bare
assignments, dot or nested-dot members, static quoted bracket members,
instance or static public class fields, and quoted or unquoted object-literal
properties. Direct assignment tokens may be separated by whitespace, block
comments, or newline-terminated line comments, including comments after `=`;
commented-out assignments remain scanned because committed comments can also
contain secrets. No credential value is globally allowlisted. A controlled
fixture exception requires an exact normalized file path, normalized terminal
identifier, expected value SHA-256, and explicitly approved test-fixture or
documentation-example context with a recorded reason; tests and documentation
are not blanket-exempt. Findings report only a path, rule identifier, and
redacted category. This deterministic regex-based current-working-tree check
intentionally avoids Git history, is not a complete JavaScript parser, and is
not a substitute for a dedicated secret-scanning service.

## Dependency policy and CI gates

Dependency changes are risk-based. Production Critical and High findings take
priority, followed by realistically exposed direct findings and compatible
patch/minor updates. Major or forced upgrades are not used to make audit output
look cleaner. `npm audit --omit=dev --audit-level=high` is a release gate.

The full audit is also reviewed. At the WP8 local audit, production dependencies
had no reported vulnerabilities after compatible updates. The remaining High
reports belong to Jest's development-only minimatch/brace-expansion chain. That
code is not installed in the production image and receives repository-controlled
test patterns rather than public API input. A forced override or the audit's
suggested incompatible Jest change was not accepted; the toolchain must be
updated when a compatible upstream dependency graph is available. This is a
documented development-tooling limitation, not a bypass of the production gate.

GitHub Actions uses read-only repository permissions, a bounded job, deterministic
`npm ci`, production and full audit checks, repository and syntax verification,
the complete tests, OpenAPI validation, Docker build and Compose validation, and
an isolated local Compose runtime smoke test. CI has no Atlas, Render, or
application-runtime secrets and performs no deployment.

## Public Swagger decision

`/api-docs` intentionally remains unauthenticated in production for portfolio
and demo review. API operations still enforce their documented Bearer and RBAC
requirements. The OpenAPI document uses local and HTTPS production server URLs,
keeps legacy `/api` behavior described but exposes canonical `/api/v1` paths,
and contains no database URI, credential, private key, or token example.
`npm run validate:openapi` validates both the schema and these public-content
constraints.

## Exposure response

- Exposed access token: treat it as usable until expiry. Remove it from every
  public location, record only redacted incident metadata, and rotate the JWT
  secret when broad invalidation is required.
- Exposed refresh token: revoke its stored record immediately (or revoke the
  user's active refresh tokens), remove the exposed value, and require a new
  login. Rotating only the JWT signing secret does not revoke refresh-token rows.
- Exposed MongoDB credential: rotate it at the database provider, update the
  deployment variable, restart, verify readiness, and review provider access
  logs without copying the credential into the incident report.
- Exposed admin bootstrap password: rotate the User password, remove the seed
  variable, and review access/activity. Seed credentials are not intended to
  remain as routine application configuration.

## Known Phase 1 limitations

Phase 1 has no managed secret platform, machine-to-machine or service-to-service
authentication, distributed rate limiting/tracing, SIEM integration, formal
penetration test, or advanced load test. Outbox records are persisted but are
not delivered; there is no worker, webhook, n8n integration, or external message
broker. Deployment is single-region Render rather than a multi-region or AWS
topology.
