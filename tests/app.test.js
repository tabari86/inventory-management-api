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

  it("adds security headers to health responses", async () => {
    const response = await request(app).get("/health");

    expect(response.statusCode).toBe(200);
    expect(response.headers["x-content-type-options"]).toBe("nosniff");
    expect(response.headers["content-security-policy"]).toContain(
      "default-src 'self'"
    );
    expect(response.headers["x-powered-by"]).toBeUndefined();
  });

  it("keeps Swagger UI publicly reachable", async () => {
    const response = await request(app).get("/api-docs").redirects(1);

    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toContain("text/html");
    expect(response.headers["content-security-policy"]).toBeDefined();
  });
});
