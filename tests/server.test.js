jest.mock("dotenv", () => ({ config: jest.fn() }));
jest.mock("../src/app", () => ({ listen: jest.fn() }));
jest.mock("../src/config/database", () => jest.fn());

const originalMongoUri = process.env.MONGODB_URI;
const originalJwtSecret = process.env.JWT_ACCESS_SECRET;

const loadServer = () => {
  jest.isolateModules(() => {
    require("../src/server");
  });
};

describe("Server environment validation", () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  afterAll(() => {
    if (originalMongoUri === undefined) {
      delete process.env.MONGODB_URI;
    } else {
      process.env.MONGODB_URI = originalMongoUri;
    }

    if (originalJwtSecret === undefined) {
      delete process.env.JWT_ACCESS_SECRET;
    } else {
      process.env.JWT_ACCESS_SECRET = originalJwtSecret;
    }
  });

  it("fails when MONGODB_URI is missing", () => {
    delete process.env.MONGODB_URI;
    process.env.JWT_ACCESS_SECRET = "test-secret";

    expect(loadServer).toThrow(/MONGODB_URI/);
  });

  it("fails when JWT_ACCESS_SECRET is missing", () => {
    process.env.MONGODB_URI = "mongodb://localhost/test";
    delete process.env.JWT_ACCESS_SECRET;

    expect(loadServer).toThrow(/JWT_ACCESS_SECRET/);
  });

  it("continues startup when required variables are present", () => {
    process.env.MONGODB_URI = "mongodb://localhost/test";
    process.env.JWT_ACCESS_SECRET = "test-secret";

    expect(loadServer).not.toThrow();
  });
});
