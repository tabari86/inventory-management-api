const request = require("supertest");

const app = require("../src/app");

describe("App", () => {
  it("should return API running message", async () => {
    const response = await request(app).get("/");

    expect(response.statusCode).toBe(200);
    expect(response.body).toEqual({
      message: "Inventory Management API is running",
    });
  });
});