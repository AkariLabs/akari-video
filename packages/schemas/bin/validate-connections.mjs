#!/usr/bin/env node

// connections.json v0 の構造を、Node.js 組み込み機能だけで検証する。

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const usage = "使い方: node packages/schemas/bin/validate-connections.mjs <connections.json>";
const connectionsArgument = process.argv[2];

if (!connectionsArgument || process.argv.length !== 3) {
  console.error(usage);
  process.exit(2);
}

if (connectionsArgument === "--help" || connectionsArgument === "-h") {
  console.log(usage);
  process.exit(0);
}

const connectionsPath = path.resolve(connectionsArgument);
const schemaPath = fileURLToPath(new URL("../connections.schema.json", import.meta.url));
const errors = [];

if (!isRegularFile(connectionsPath)) {
  fail(`connections.json が見つかりません: ${connectionsPath}`);
  finish();
}

let schema;
try {
  schema = JSON.parse(fs.readFileSync(schemaPath, "utf8"));
} catch (error) {
  fail(`connections.schema.json を JSON として読めません: ${messageOf(error)}`);
  finish();
}
if (schema.$id !== "urn:akari-video:schema:connections:v0") {
  fail("connections.schema.json の $id が v0 契約と一致しません");
  finish();
}

let connections;
try {
  connections = JSON.parse(fs.readFileSync(connectionsPath, "utf8"));
} catch (error) {
  fail(`connections.json を JSON として読めません: ${messageOf(error)}`);
  finish();
}

validateConnections(connections);
finish();

function validateConnections(value) {
  if (!isPlainObject(value)) {
    fail("connections.json のルートは object である必要があります");
    return;
  }
  validateFields(value, ["providers", "policy"], ["providers", "policy", "memory"], "ルート");
  validateProviders(value.providers);
  validatePolicy(value.policy);
  if (hasOwn(value, "memory")) validateMemory(value.memory);
}

function validateProviders(value) {
  if (!Array.isArray(value)) {
    fail("providers は配列である必要があります");
    return;
  }
  const ids = new Set();
  for (const [index, provider] of value.entries()) {
    const label = `providers[${index}]`;
    if (!isPlainObject(provider)) {
      fail(`${label} は object である必要があります`);
      continue;
    }
    const fields = ["id", "kind", "auth", "env", "models", "notes", "doctor"];
    validateFields(provider, fields, fields, label);
    validateNonEmptyString(provider.id, `${label}.id`);
    if (typeof provider.id === "string") {
      if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(provider.id)) {
        fail(`${label}.id は英小文字・数字の kebab-case である必要があります`);
      }
      if (ids.has(provider.id)) fail(`provider id が重複しています: ${provider.id}`);
      ids.add(provider.id);
    }

    validateEnum(provider.kind, ["genai", "image", "video", "tts", "music", "sns", "analytics", "notify"], `${label}.kind`);
    validateEnum(provider.auth, ["login", "env-key", "oauth-mcp", "none"], `${label}.auth`);
    if (provider.auth === "env-key") {
      if (typeof provider.env !== "string" || !/^\$\{[A-Za-z_][A-Za-z0-9_]*\}$/.test(provider.env)) {
        fail(`${label}.env は env-key 認証では \${KEY_NAME} 形式である必要があります`);
      }
    } else if (provider.env !== null) {
      fail(`${label}.env は login / oauth-mcp 認証では null である必要があります`);
    }
    validateModels(provider.models, `${label}.models`);
    validateNotes(provider.notes, `${label}.notes`, provider.auth);
    validateDoctor(provider.doctor, `${label}.doctor`);
  }
}

function validateModels(value, label) {
  if (!isPlainObject(value)) {
    fail(`${label} は object である必要があります`);
    return;
  }
  validateFields(value, ["default", "allowed"], ["default", "allowed"], label);
  if (value.default !== null) validateNonEmptyString(value.default, `${label}.default`);
  validateStringArray(value.allowed, `${label}.allowed`);
  if (typeof value.default === "string" && Array.isArray(value.allowed) && !value.allowed.includes(value.default)) {
    fail(`${label}.default は allowed に含まれている必要があります`);
  }
}

function validateNotes(value, label, auth) {
  if (!isPlainObject(value)) {
    fail(`${label} は object である必要があります`);
    return;
  }
  const fields = ["description", "workflows", "billing", "quota", "scopes", "setup_url"];
  validateFields(value, fields, fields, label);
  for (const field of ["description", "billing", "quota"]) {
    validateNonEmptyString(value[field], `${label}.${field}`);
  }
  validateStringArray(value.workflows, `${label}.workflows`);
  validateStringArray(value.scopes, `${label}.scopes`);
  if (value.setup_url !== null) validateHttpsUrl(value.setup_url, `${label}.setup_url`);
  if (auth === "env-key" && value.setup_url === null) {
    fail(`${label}.setup_url は env-key の取得先案内に必要です`);
  }
}

function validateDoctor(value, label) {
  if (!isPlainObject(value)) {
    fail(`${label} は object である必要があります`);
    return;
  }
  validateFields(value, ["status"], ["last_checked", "status", "detail"], label);
  validateEnum(
    value.status,
    ["ok", "unauthorized", "unconfigured", "unchecked", "setup_required"],
    `${label}.status`,
  );
  if (hasOwn(value, "last_checked") && value.last_checked !== null) {
    if (typeof value.last_checked !== "string" || !isIsoDateTime(value.last_checked)) {
      fail(`${label}.last_checked は null または ISO 8601 日時である必要があります`);
    }
  }
  if (hasOwn(value, "detail")) validateNonEmptyString(value.detail, `${label}.detail`);
}

function validateMemory(value) {
  if (!Array.isArray(value)) {
    fail("memory は配列である必要があります");
    return;
  }
  const names = new Set();
  for (const [index, connection] of value.entries()) {
    const label = `memory[${index}]`;
    if (!isPlainObject(connection)) {
      fail(`${label} は object である必要があります`);
      continue;
    }
    const required = ["name", "root"];
    const allowed = ["name", "root", "entry", "include", "exclude", "read_policy"];
    validateFields(connection, required, allowed, label);
    validateNonEmptyString(connection.name, `${label}.name`);
    if (typeof connection.name === "string") {
      if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(connection.name)) {
        fail(`${label}.name は英小文字・数字の kebab-case である必要があります`);
      }
      if (names.has(connection.name)) fail(`memory name が重複しています: ${connection.name}`);
      names.add(connection.name);
    }
    validateNonEmptyString(connection.root, `${label}.root`);
    if (hasOwn(connection, "entry")) validateNonEmptyString(connection.entry, `${label}.entry`);
    if (hasOwn(connection, "include")) validateStringArray(connection.include, `${label}.include`);
    if (hasOwn(connection, "exclude")) validateStringArray(connection.exclude, `${label}.exclude`);
    if (hasOwn(connection, "read_policy") && connection.read_policy !== "read-only") {
      fail(`${label}.read_policy は read-only である必要があります`);
    }
  }
}

function validatePolicy(value) {
  const label = "policy";
  if (!isPlainObject(value)) {
    fail(`${label} は object である必要があります`);
    return;
  }
  const fields = ["currency", "monthly_budget", "approval_threshold"];
  validateFields(value, fields, fields, label);
  if (typeof value.currency !== "string" || !/^[A-Z]{3}$/.test(value.currency)) {
    fail("policy.currency は 3 文字の大文字通貨コードである必要があります");
  }
  for (const field of ["monthly_budget", "approval_threshold"]) {
    const item = value[field];
    if (item !== null && (!isFiniteNumber(item) || item < 0)) {
      fail(`policy.${field} は null または 0 以上の有限数である必要があります`);
    }
  }
}

function validateFields(value, required, allowed, label) {
  for (const field of required) {
    if (!hasOwn(value, field)) fail(`${label}.${field} は必須です`);
  }
  for (const field of Object.keys(value)) {
    if (!allowed.includes(field)) fail(`${label}.${field} は未定義のフィールドです`);
  }
}

function validateStringArray(value, label) {
  if (!Array.isArray(value)) {
    fail(`${label} は配列である必要があります`);
    return;
  }
  const seen = new Set();
  for (const [index, item] of value.entries()) {
    validateNonEmptyString(item, `${label}[${index}]`);
    if (typeof item === "string") {
      if (seen.has(item)) fail(`${label} に重複があります: ${item}`);
      seen.add(item);
    }
  }
}

function validateNonEmptyString(value, label) {
  if (typeof value !== "string" || value.trim().length === 0) {
    fail(`${label} は空でない文字列である必要があります`);
  }
}

function validateEnum(value, allowed, label) {
  if (typeof value !== "string" || !allowed.includes(value)) {
    fail(`${label} は ${allowed.join(" / ")} のいずれかである必要があります`);
  }
}

function validateHttpsUrl(value, label) {
  if (typeof value !== "string" || value.trim().length === 0) {
    fail(`${label} は空でない文字列である必要があります`);
    return;
  }
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== "https:") fail(`${label} は https URL である必要があります`);
  } catch {
    fail(`${label} は有効な URL である必要があります`);
  }
}

function isIsoDateTime(value) {
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) && /^\d{4}-\d{2}-\d{2}T/.test(value);
}

function isRegularFile(filePath) {
  try {
    return fs.statSync(filePath).isFile();
  } catch {
    return false;
  }
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isFiniteNumber(value) {
  return typeof value === "number" && Number.isFinite(value);
}

function hasOwn(value, key) {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function messageOf(error) {
  return error instanceof Error ? error.message : String(error);
}

function fail(message) {
  errors.push(message);
}

function finish() {
  if (errors.length > 0) {
    console.error(`NG: ${connectionsPath}`);
    for (const error of errors) console.error(`- ${error}`);
    process.exit(1);
  }
  console.log(`OK: ${connectionsPath}`);
  process.exit(0);
}
