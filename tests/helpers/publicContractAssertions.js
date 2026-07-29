const expectNoForbiddenFields = (value, forbidden = new Set(["__v"])) => {
  if (Array.isArray(value)) {
    for (const item of value) expectNoForbiddenFields(item, forbidden);
    return;
  }
  if (!value || typeof value !== "object") return;

  for (const [key, nested] of Object.entries(value)) {
    expect(forbidden.has(key)).toBe(false);
    expectNoForbiddenFields(nested, forbidden);
  }
};

const expectOnlyKeys = (value, allowedKeys, requiredKeys = []) => {
  expect(value).toEqual(expect.any(Object));
  expect(Object.keys(value).every((key) => allowedKeys.includes(key))).toBe(true);
  for (const key of requiredKeys) expect(value).toHaveProperty(key);
};

module.exports = {
  expectNoForbiddenFields,
  expectOnlyKeys,
};
