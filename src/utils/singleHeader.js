const getSingleHeader = (req, headerName) => {
  const normalizedName = headerName.toLowerCase();
  const rawHeaders = Array.isArray(req.rawHeaders) ? req.rawHeaders : [];
  const rawValues = [];

  for (let index = 0; index < rawHeaders.length; index += 2) {
    if (String(rawHeaders[index]).toLowerCase() === normalizedName) {
      rawValues.push(rawHeaders[index + 1]);
    }
  }

  if (rawValues.length > 1) {
    return { present: true, validCardinality: false };
  }

  if (rawValues.length === 1) {
    return {
      present: true,
      validCardinality: typeof rawValues[0] === "string",
      value: rawValues[0],
    };
  }

  const value = req.headers?.[normalizedName];
  if (value === undefined) return { present: false, validCardinality: true };

  return {
    present: true,
    validCardinality: typeof value === "string",
    value,
  };
};

module.exports = getSingleHeader;
