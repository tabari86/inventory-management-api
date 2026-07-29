const mongoose = require("mongoose");
const { MongoMemoryReplSet } = require("mongodb-memory-server");

let mongoReplSet;

jest.setTimeout(30000);

beforeAll(async () => {
  process.env.JWT_ACCESS_SECRET = "test_access_token_secret";
  process.env.JWT_ACCESS_EXPIRES_IN = "15m";

  mongoReplSet = await MongoMemoryReplSet.create({
    replSet: {
      count: 1,
      storageEngine: "wiredTiger",
    },
  });

  const mongoUri = mongoReplSet.getUri();

  await mongoose.connect(mongoUri);
  // Wait for declared indexes before transactional tests begin. Otherwise
  // background index creation can surface a transient transaction retry.
  await Promise.all(
    Object.values(mongoose.models).map((model) => model.init())
  );
});

afterEach(async () => {
  const collections = mongoose.connection.collections;

  for (const key of Object.keys(collections)) {
    await collections[key].deleteMany({});
  }
});

afterAll(async () => {
  await mongoose.connection.dropDatabase();
  await mongoose.connection.close();

  if (mongoReplSet) {
    await mongoReplSet.stop();
  }
});
