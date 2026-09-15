import { readFile } from "node:fs/promises";
import path from "node:path";

const ITEM_KEYS = new Set(["id", "zone", "asset", "offset", "scale", "vars", "delay", "role"]);

export async function readWorldItems(projectRoot) {
  const file = path.join(projectRoot, "planning", "world-items.json");
  let text;
  try {
    text = await readFile(file, "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") return { schemaVersion: 1, items: [] };
    throw error;
  }
  let value;
  try {
    value = JSON.parse(text);
  } catch (error) {
    throw new Error(`world-items.json を JSON として読めません: ${error.message}`);
  }
  validateWorldItems(value);
  return value;
}

export function validateWorldItems(value) {
  if (!record(value) || value.schemaVersion !== 1 || !Array.isArray(value.items)) {
    throw new Error("world-items.json は schemaVersion: 1 と items[] が必要です");
  }
  const ids = new Set();
  for (const [index, item] of value.items.entries()) {
    if (!record(item)) throw new Error(`world-items.json items[${index}] は object である必要があります`);
    for (const key of Object.keys(item)) if (!ITEM_KEYS.has(key)) throw new Error(`world-items.json items[${index}].${key} は未定義です`);
    for (const key of ["id", "zone", "asset"]) if (typeof item[key] !== "string" || !item[key]) throw new Error(`world-items.json items[${index}].${key} は空でない string です`);
    if (!/^overlay\/[^/]+$/.test(item.asset)) throw new Error(`world-items.json items[${index}].asset は overlay/<id> で指定してください`);
    if (ids.has(item.id)) throw new Error(`world-items.json item id が重複しています: ${item.id}`);
    ids.add(item.id);
    if (item.offset !== undefined && (!Array.isArray(item.offset) || item.offset.length !== 2 || !item.offset.every(finite))) throw new Error(`world-items.json items[${index}].offset は有限数 2 要素です`);
    if (item.scale !== undefined && (!finite(item.scale) || item.scale <= 0)) throw new Error(`world-items.json items[${index}].scale は正の有限数です`);
    if (item.delay !== undefined && (!finite(item.delay) || item.delay < 0)) throw new Error(`world-items.json items[${index}].delay は 0 以上の有限数です`);
    if (item.role !== undefined && item.role !== "background") throw new Error(`world-items.json items[${index}].role は background です`);
    if (item.vars !== undefined && (!record(item.vars) || Object.values(item.vars).some((value) => !["string", "number"].includes(typeof value)))) throw new Error(`world-items.json items[${index}].vars は string / number 値の object です`);
  }
  return value;
}

const finite = (value) => typeof value === "number" && Number.isFinite(value);
const record = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
