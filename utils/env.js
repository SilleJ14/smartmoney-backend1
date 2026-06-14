export function parseEnvBoolean(name, defaultValue = false) {
  const raw = process.env[name];

  if (raw === undefined || raw === null || raw === "") {
    return defaultValue;
  }

  return ["true", "1", "yes", "on"].includes(
    String(raw).toLowerCase()
  );
}

export function parseEnvNumber(name, defaultValue) {
  const value = Number(process.env[name]);

  return Number.isFinite(value) ? value : defaultValue;
}