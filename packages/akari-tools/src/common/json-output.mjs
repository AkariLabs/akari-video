export function printJson(value) {
  process.stdout.write(`${JSON.stringify(value)}\n`);
}

export function summarize(value, fallback, max = 500) {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  return text ? text.slice(0, max) : fallback;
}
