#!/usr/bin/env node

// 接続レジストリを、無償・読み取り専用の確認だけで更新する。

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { importPackage } from "./resolve-packages.mjs";

let DEFAULT_CONNECTIONS_REGISTRY;
let resolveConnections;
let credentialsPaths;
let readSharedCredentials;
let translate;
let getLanguage;

async function loadDependencies() {
  const [creatorRoot, connections, i18n] = await Promise.all([
    importPackage("creator-root/src/index.mjs", { from: import.meta.url }),
    import("./resolve-connections.mjs"),
    importPackage("i18n/index.mjs", { from: import.meta.url }),
  ]);
  DEFAULT_CONNECTIONS_REGISTRY = creatorRoot.DEFAULT_CONNECTIONS_REGISTRY;
  credentialsPaths = creatorRoot.credentialsPaths;
  readSharedCredentials = creatorRoot.readCredentials;
  resolveConnections = connections.resolveConnections;
  translate = i18n.t;
  getLanguage = i18n.getLanguage;
}

const usage = "使い方: node skills/setup-connections/bin/doctor.mjs [プロジェクトルート|connections.json]";
const t = (key, params) => translate?.(key, params) ?? key;
export const timeoutMs = 5_000;

async function main() {
  // Help and argument errors precede the required package load. Keep their original
  // Japanese fallback when an installed copy cannot find the i18n package.
  try {
    const i18n = await importPackage("i18n/index.mjs", { from: import.meta.url });
    translate = i18n.t;
    getLanguage = i18n.getLanguage;
  } catch { /* loadDependencies reports the existing setup guide for a normal run. */ }
  const argument = process.argv[2];

  if (process.argv.length > 3) {
    console.error(translate ? t("cli.connections.general.usage") : usage);
    process.exit(2);
  }

  if (argument === "--help" || argument === "-h") {
    console.log(translate ? t("cli.connections.general.usage") : usage);
    process.exit(0);
  }

  const inputPath = path.resolve(argument ?? process.cwd());
  const connectionsPath = inputPath.endsWith(".json")
    ? inputPath
    : path.join(inputPath, ".akari", "connections.json");
  const projectRoot = inputPath.endsWith(".json")
    ? path.dirname(path.dirname(connectionsPath))
    : inputPath;
  const reportPath = path.join(projectRoot, ".akari", "reports", "connections-report.html");
  await loadDependencies();
  const credentialsPath = credentialsPaths().primary;
  const context = { inputPath, connectionsPath, projectRoot, reportPath, credentialsPath };
  if (inputPath.endsWith(".json")) {
    await mainLegacy(context);
    return;
  }
  await mainResolved(context);
}

async function mainLegacy({ connectionsPath, reportPath, credentialsPath }) {
  const registry = readRegistry(connectionsPath);
  const credentialState = readCredentials(credentialsPath);
  warnParseWarnings(credentialState.parseWarnings);
  console.log(t("cli.connections.general.keyLocation", { location: locationLabel(credentialState.location) }));
  const checkedAt = new Date().toISOString();

  if (credentialState.exists && !credentialState.securePermissions) {
    console.warn(t("cli.connections.general.permissions", { mode: credentialState.mode, path: credentialsPath }));
  }

  const results = await Promise.all(
    registry.providers.map((provider) => inspectProvider(provider, credentialState, checkedAt)),
  );
  if (results.some((result) => result.key_source === "missing")) {
    printCredentialGuide(registry, credentialsPath);
  }
  for (const [index, result] of results.entries()) registry.providers[index].doctor = result.doctor;

  const secretValues = collectSecretValues(registry.providers, credentialState, process.env);
  const jsonOutput = `${JSON.stringify(registry, null, 2)}\n`;
  refuseSecretLeak(jsonOutput, secretValues);
  const connectors = readConnectorSummary();
  const htmlOutput = renderReport(registry, results, credentialState, checkedAt, credentialsPath, connectors);
  refuseSecretLeak(htmlOutput, secretValues);

  fs.writeFileSync(connectionsPath, jsonOutput, "utf8");
  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  fs.writeFileSync(reportPath, htmlOutput, "utf8");

  for (const result of results) {
    console.log(`${result.id}: ${result.doctor.status} — ${displayDetail(result.doctor.detail)}`);
  }
  printConnectorSummary(connectors);
  console.log(t("cli.connections.general.reportPath", { path: reportPath }));
}

async function mainResolved({ projectRoot, reportPath, credentialsPath }) {
  const resolved = await resolveConnections({ projectRoot });
  const registry = clone(resolved.effective);
  const credentialState = readCredentials(credentialsPath);
  warnParseWarnings(credentialState.parseWarnings);
  console.log(t("cli.connections.general.keyLocation", { location: locationLabel(credentialState.location) }));
  const checkedAt = new Date().toISOString();

  if (credentialState.exists && !credentialState.securePermissions) {
    console.warn(t("cli.connections.general.permissions", { mode: credentialState.mode, path: credentialsPath }));
  }

  const results = await Promise.all(registry.providers.map(async (provider) => ({
    ...await inspectProvider(provider, credentialState, checkedAt),
    layer: resolved.sources.providers[provider.id],
  })));
  if (results.some((result) => result.key_source === "missing")) {
    printCredentialGuide(registry, credentialsPath);
  }
  for (const [index, result] of results.entries()) registry.providers[index].doctor = result.doctor;

  const projectRegistry = resolved.layers.project.exists
    ? readRegistryAt(resolved.layers.project.path)
    : emptyProjectRegistry();
  const workspaceRegistry = resolved.layers.workspace
    ? resolved.layers.workspace.exists
      ? readRegistryAt(resolved.layers.workspace.path)
      : clone(DEFAULT_CONNECTIONS_REGISTRY)
    : null;
  const effectiveById = new Map(registry.providers.map((provider) => [provider.id, provider]));

  for (const result of results) {
    const provider = effectiveById.get(result.id);
    if (result.layer === "project" || (!resolved.layers.workspace && result.layer === "default")) {
      upsertProviderDoctor(projectRegistry, provider, result.doctor);
    }
    if (workspaceRegistry && (result.layer === "workspace" || result.layer === "default")) {
      upsertProviderDoctor(workspaceRegistry, provider, result.doctor);
    }
  }

  const secretValues = collectSecretValues(registry.providers, credentialState, process.env);
  writeRegistry(resolved.layers.project.path, projectRegistry, secretValues);
  if (workspaceRegistry) {
    writeRegistry(resolved.layers.workspace.path, workspaceRegistry, secretValues);
  }

  const connectors = readConnectorSummary();
  const htmlOutput = renderReport(registry, results, credentialState, checkedAt, credentialsPath, connectors);
  refuseSecretLeak(htmlOutput, secretValues);
  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  fs.writeFileSync(reportPath, htmlOutput, "utf8");

  if (resolved.layers.workspace) {
    console.log(t("cli.connections.general.workspace", { path: resolved.layers.workspace.rootDir }));
  } else {
    console.log(t("cli.connections.general.noWorkspace"));
  }
  for (const result of results) {
    console.log(`${result.id} [${result.layer}]: ${result.doctor.status} — ${displayDetail(result.doctor.detail)}`);
  }
  printConnectorSummary(connectors);
  console.log(t("cli.connections.general.reportPath", { path: reportPath }));
}

const connectorIds = ["fal", "higgsfield", "runway", "elevenlabs", "fish-audio", "suno"];

export function readConnectorSummary(env = process.env, home = os.homedir()) {
  const file = path.join(env.AKARI_HOME || path.join(home, ".akari"), "connectors.json");
  let data;
  try {
    data = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return { exists: false, enabled: {}, generationOrder: connectorIds, fallbackOnFailure: false };
  }
  const enabled = Object.fromEntries(connectorIds.map(id => [id, data?.enabled?.[id] !== false]));
  const requested = Array.isArray(data?.generationOrder)
    ? data.generationOrder.filter(id => connectorIds.includes(id)) : [];
  return { exists: true, enabled,
    generationOrder: [...new Set(requested), ...connectorIds.filter(id => !requested.includes(id))],
    fallbackOnFailure: data?.fallbackOnFailure === true };
}

function printConnectorSummary(summary) {
  console.log(`${t("cli.connections.connectors.connectorsTitle")}:`);
  if (!summary.exists) {
    console.log(`  ${t("cli.connections.connectors.noSettingsMessage")}`);
    return;
  }
  const state = value => t(`cli.connections.connectors.${value ? "on" : "off"}`);
  console.log(`  ${t("cli.connections.connectors.enabledLabel")}: ${connectorIds.map(id => `${id}=${state(summary.enabled[id])}`).join(" / ")}`);
  console.log(`  ${t("cli.connections.connectors.generationOrderLabel")}: ${summary.generationOrder.join(" → ")}`);
  console.log(`  ${t("cli.connections.connectors.automaticFallbackLabel")}: ${state(summary.fallbackOnFailure)}`);
  console.log(`  ${t("cli.connections.connectors.stateListLabel")}`);
}

function readRegistry(connectionsPath) {
  let value;
  try {
    value = JSON.parse(fs.readFileSync(connectionsPath, "utf8"));
  } catch {
    throw new Error(t("cli.connections.error.read"));
  }
  if (!isPlainObject(value) || !Array.isArray(value.providers) || !isPlainObject(value.policy)) {
    throw new Error(t("cli.connections.error.structure"));
  }
  return value;
}

function readRegistryAt(filePath) {
  let value;
  try {
    value = JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    throw new Error(t("cli.connections.error.readAt", { path: filePath }));
  }
  if (!isPlainObject(value) || !Array.isArray(value.providers) || !isPlainObject(value.policy)) {
    throw new Error(t("cli.connections.error.structureAt", { path: filePath }));
  }
  return value;
}

function emptyProjectRegistry() {
  return {
    providers: [],
    policy: { currency: "JPY", monthly_budget: null, approval_threshold: null },
    memory: [],
  };
}

function upsertProviderDoctor(registry, provider, doctor) {
  const index = registry.providers.findIndex((item) => item.id === provider.id);
  if (index >= 0) {
    registry.providers[index] = { ...registry.providers[index], doctor };
    return;
  }
  registry.providers.push({ ...clone(provider), doctor });
}

function writeRegistry(filePath, registry, credentialValues) {
  const jsonOutput = `${JSON.stringify(registry, null, 2)}\n`;
  refuseSecretLeak(jsonOutput, credentialValues);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, jsonOutput, "utf8");
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function readCredentials(credentialsPath) {
  const state = readSharedCredentials();
  const mode = state.primaryExists ? state.primaryMode : state.legacyMode;
  return { exists: state.primaryExists || state.legacyExists, securePermissions: mode === 0o600,
    mode: mode === null ? null : mode.toString(8).padStart(3, "0"), values: state.values, parseWarnings: state.warnings,
    location: state.primaryExists && state.legacyExists ? "両方" : state.primaryExists ? "新" : state.legacyExists ? "旧" : "なし" };
}

function warnParseWarnings(warnings) {
  for (const source of ["primary", "legacy"]) {
    const lines = warnings.filter((warning) => warning.source === source).map((warning) => t("cli.connections.general.parseLine", { line: warning.line }));
    if (lines.length > 0) {
      console.warn(t("cli.connections.general.parseWarning", { source: t(`cli.connections.location.${source}`), lines: lines.join(t("cli.connections.general.parseSeparator")) }));
    }
  }
}

export function resolveProviderKey(envName, credentialState, env) {
  const environmentValue = env?.[envName];
  if (typeof environmentValue === "string" && environmentValue.trim().length > 0) {
    return { secret: environmentValue, key_source: "env" };
  }
  const credentialValue = credentialState?.values?.get(envName);
  if (typeof credentialValue === "string" && credentialValue.trim().length > 0) {
    return { secret: credentialValue, key_source: "credentials.env" };
  }
  return { secret: null, key_source: "missing" };
}

export async function inspectProvider(
  provider,
  credentialState,
  checkedAt,
  { env = process.env, adapters: adapterTable = adapters, localAdapters: localTable = localAdapters } = {},
) {
  const id = typeof provider.id === "string" ? provider.id : "unknown-provider";
  if (provider.auth === "login" || provider.auth === "oauth-mcp") {
    return result(id, checkedAt, "unchecked", `${provider.auth} 認証は doctor から疎通確認しません。人間がログイン状態を確認してください。`, false, null);
  }
  if (provider.auth === "none") {
    const localAdapter = localTable[id];
    if (!localAdapter) {
      return result(id, checkedAt, "unchecked", "無償・読み取り専用と確認済みの doctor adapter がありません。", true, null);
    }
    const doctor = await localAdapter(checkedAt);
    return { id, configured: true, key_source: null, doctor };
  }
  if (provider.auth !== "env-key") {
    return result(id, checkedAt, "unchecked", "未対応の認証方式のため確認していません。", false, null);
  }

  const envName = extractEnvName(provider.env);
  if (!envName) {
    return result(id, checkedAt, "unconfigured", "env は ${KEY_NAME} 形式で登録してください。", false, "missing");
  }
  const { secret, key_source: keySource } = resolveProviderKey(envName, credentialState, env);
  if (secret === null) {
    return result(id, checkedAt, "unconfigured", `${envName} は環境変数にも credentials.env にも設定されていません。`, false, keySource);
  }

  const adapter = adapterTable[id];
  if (!adapter) {
    return result(id, checkedAt, "unchecked", "無償・読み取り専用と確認済みの doctor adapter がありません。", true, keySource);
  }
  const doctor = await adapter(secret, checkedAt);
  return { id, configured: true, key_source: keySource, doctor };
}

export const adapters = {
  fal: (secret, checkedAt) =>
    checkGet("https://rest.alpha.fal.ai/billing/user_balance", { Authorization: `Key ${secret}` }, checkedAt),
  replicate: (secret, checkedAt) =>
    checkGet("https://api.replicate.com/v1/account", { Authorization: `Bearer ${secret}` }, checkedAt),
  groq: (secret, checkedAt) =>
    checkGet("https://api.groq.com/openai/v1/models", { Authorization: `Bearer ${secret}` }, checkedAt),
  elevenlabs: (secret, checkedAt) =>
    checkGet("https://api.elevenlabs.io/v1/models", { "xi-api-key": secret }, checkedAt),
  openrouter: (secret, checkedAt) =>
    checkGet("https://openrouter.ai/api/v1/key", { Authorization: `Bearer ${secret}` }, checkedAt),
  'fish-audio': (secret, checkedAt) =>
    checkGet('https://api.fish.audio/wallet/self/api-credit', { Authorization: `Bearer ${secret}` }, checkedAt),
  'google-ai': (secret, checkedAt) =>
    checkGet('https://generativelanguage.googleapis.com/v1beta/models', { 'x-goog-api-key': secret }, checkedAt),
};

const localAdapters = {
  voicevox: (checkedAt) => checkVoicevox(checkedAt),
};

async function checkVoicevox(checkedAt) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch("http://127.0.0.1:50021/version", {
      method: "GET",
      headers: { Accept: "application/json" },
      redirect: "error",
      signal: controller.signal,
    });
    if (response.ok) {
      let version = "";
      try {
        version = String(await response.json()).trim();
      } catch {
        version = "";
      }
      return {
        last_checked: checkedAt,
        status: "ok",
        detail: version
          ? `VOICEVOX エンジンが起動中です（version ${version}）。`
          : "VOICEVOX エンジンが起動中です。",
      };
    }
    return {
      last_checked: checkedAt,
      status: "setup_required",
      detail: "VOICEVOX アプリを起動するか、generate-narration が自動起動します。",
    };
  } catch {
    return {
      last_checked: checkedAt,
      status: "setup_required",
      detail: "VOICEVOX アプリを起動するか、generate-narration が自動起動します。",
    };
  } finally {
    clearTimeout(timeout);
  }
}

async function checkGet(url, headers, checkedAt) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      method: "GET",
      headers: { ...headers, Accept: "application/json" },
      redirect: "error",
      signal: controller.signal,
    });
    if (response.body) await response.body.cancel();
    if (response.ok) {
      return { last_checked: checkedAt, status: "ok", detail: "認証済み（無償・読み取り専用 GET で確認）。" };
    }
    if (response.status === 401 || response.status === 403) {
      return { last_checked: checkedAt, status: "unauthorized", detail: `認証されませんでした（HTTP ${response.status}）。` };
    }
    return { last_checked: checkedAt, status: "unchecked", detail: `認証を判定できませんでした（HTTP ${response.status}）。` };
  } catch (error) {
    const timedOut = error instanceof Error && error.name === "AbortError";
    return {
      last_checked: checkedAt,
      status: "unchecked",
      detail: timedOut ? `接続確認が ${timeoutMs / 1000} 秒でタイムアウトしました。` : "ネットワーク不通のため確認できませんでした。",
    };
  } finally {
    clearTimeout(timeout);
  }
}

function result(id, checkedAt, status, detail, configured, keySource) {
  return { id, configured, key_source: keySource, doctor: { last_checked: checkedAt, status, detail } };
}

function extractEnvName(value) {
  if (typeof value !== "string") return null;
  const match = /^\$\{([A-Za-z_][A-Za-z0-9_]*)\}$/.exec(value);
  return match ? match[1] : null;
}

function printCredentialGuide(registry, credentialsPath) {
  console.log(t("cli.connections.general.keysMissing", { path: credentialsPath }));
  console.log(t("cli.connections.general.keyGuide", { path: credentialsPath }));
  for (const provider of registry.providers) {
    if (provider.auth !== "env-key") continue;
    const name = extractEnvName(provider.env) ?? "KEY_NAME";
    const setupUrl = isPlainObject(provider.notes) ? provider.notes.setup_url : null;
    console.log(`- ${provider.id}: ${name}${typeof setupUrl === "string" ? ` / ${setupUrl}` : ""}`);
  }
}

function collectSecretValues(providers, credentialState, env) {
  const secrets = new Set(credentialState.values.values());
  for (const provider of providers) {
    if (provider.auth !== "env-key") continue;
    const envName = extractEnvName(provider.env);
    if (!envName) continue;
    const { secret } = resolveProviderKey(envName, credentialState, env);
    if (secret) secrets.add(secret);
  }
  return secrets;
}

function refuseSecretLeak(output, values) {
  for (const secret of values) {
    if (secret && output.includes(secret)) {
      throw new Error(t("cli.connections.error.secret"));
    }
  }
}

function locationLabel(value) {
  return t(`cli.connections.location.${({ "両方": "both", "新": "new", "旧": "old", "なし": "none" })[value]}`);
}

// doctor.detail is persisted in Japanese for the connections.json contract. Translate only at display time.
// This also covers results loaded from an earlier connections.json without changing its schema.
function displayDetail(detail) {
  if (typeof detail !== "string") return detail;
  const exact = {
    "未確認": "unchecked", "無償・読み取り専用と確認済みの doctor adapter がありません。": "noAdapter",
    "未対応の認証方式のため確認していません。": "unsupportedAuth",
    "env は ${KEY_NAME} 形式で登録してください。": "envFormat",
    "VOICEVOX エンジンが起動中です。": "voicevoxRunning",
    "VOICEVOX アプリを起動するか、generate-narration が自動起動します。": "voicevoxStart",
    "認証済み（無償・読み取り専用 GET で確認）。": "authenticated",
    "ネットワーク不通のため確認できませんでした。": "network",
  };
  if (exact[detail]) return t(`cli.connections.detail.${exact[detail]}`);
  const patterns = [
    [/^(login|oauth-mcp) 認証は doctor から疎通確認しません。人間がログイン状態を確認してください。$/, "login", ["auth"]],
    [/^(.+) は環境変数にも credentials\.env にも設定されていません。$/, "keyMissing", ["name"]],
    [/^VOICEVOX エンジンが起動中です（version (.+)）。$/, "voicevoxVersion", ["version"]],
    [/^認証されませんでした（HTTP (\d+)）。$/, "unauthorized", ["status"]],
    [/^認証を判定できませんでした（HTTP (\d+)）。$/, "httpUnknown", ["status"]],
    [/^接続確認が (\d+) 秒でタイムアウトしました。$/, "timeout", ["seconds"]],
  ];
  for (const [pattern, key, names] of patterns) {
    const match = pattern.exec(detail);
    if (match) return t(`cli.connections.detail.${key}`, Object.fromEntries(names.map((name, index) => [name, match[index + 1]])));
  }
  return detail;
}

function displayNote(provider, field, fallback) {
  const value = provider.notes?.[field];
  const original = DEFAULT_CONNECTIONS_REGISTRY.providers.find((item) => item.id === provider.id)?.notes?.[field];
  if (getLanguage() === "en" && original !== undefined && JSON.stringify(value) === JSON.stringify(original)) {
    return t(`cli.connections.notes.${provider.id.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())}.${field}`);
  }
  return Array.isArray(value) ? arrayText(value) : value ?? fallback;
}

function renderReport(registry, results, credentialState, checkedAt, credentialsPath, connectors) {
  const resultById = new Map(results.map((item) => [item.id, item]));
  const cards = registry.providers.map((provider) => {
    const result = resultById.get(provider.id);
    const layer = result?.layer ?? "project";
    const notes = isPlainObject(provider.notes) ? provider.notes : {};
    const credentialLabel = provider.auth === "env-key"
      ? result?.configured
        ? t("cli.connections.credential.configured")
        : t("cli.connections.general.unset")
      : provider.auth === "none"
        ? t("cli.connections.credential.local")
        : t("cli.connections.credential.noValue", { auth: provider.auth });
    const keySourceLabel = result?.key_source === "env"
      ? t("cli.connections.keySource.env")
      : result?.key_source === "credentials.env"
        ? "credentials.env"
        : result?.key_source === "missing"
          ? t("cli.connections.general.unset")
          : t("cli.connections.keySource.notNeeded");
    const allowed = Array.isArray(provider.models?.allowed) && provider.models.allowed.length > 0
      ? provider.models.allowed.join(", ")
      : t("cli.connections.general.unset");
    return `<article class="card status-${escapeHtml(provider.doctor.status)} layer-${escapeHtml(layer)}">
      <div class="card-head"><h2>${escapeHtml(provider.id)}</h2><div class="badges"><span>${escapeHtml(provider.doctor.status)}</span><span class="layer-badge">${escapeHtml(layer)}</span></div></div>
      <dl>
        <dt>${t("cli.connections.field.description")}</dt><dd>${escapeHtml(displayNote(provider, "description", t("cli.connections.general.blank")))}</dd>
        <dt>${t("cli.connections.field.workflows")}</dt><dd>${escapeHtml(displayNote(provider, "workflows", t("cli.connections.general.blank")))}</dd>
        <dt>${t("cli.connections.field.billing")}</dt><dd>${escapeHtml(displayNote(provider, "billing", t("cli.connections.general.blank")))}</dd>
        <dt>quota</dt><dd>${escapeHtml(displayNote(provider, "quota", t("cli.connections.general.blank")))}</dd>
        <dt>${t("cli.connections.field.scopes")}</dt><dd>${escapeHtml(displayNote(provider, "scopes", t("cli.connections.general.blank")))}</dd>
        <dt>${t("cli.connections.field.credential")}</dt><dd>${escapeHtml(credentialLabel)}</dd>
        <dt>${t("cli.connections.field.keySource")}</dt><dd>${escapeHtml(keySourceLabel)}</dd>
        <dt>${t("cli.connections.field.defaultModel")}</dt><dd>${escapeHtml(provider.models?.default ?? t("cli.connections.general.unset"))}</dd>
        <dt>${t("cli.connections.field.allowedModels")}</dt><dd>${escapeHtml(allowed)}</dd>
        <dt>${t("cli.connections.field.lastChecked")}</dt><dd>${escapeHtml(provider.doctor.last_checked ?? t("cli.connections.detail.unchecked"))}</dd>
        <dt>${t("cli.connections.field.result")}</dt><dd>${escapeHtml(displayDetail(provider.doctor.detail ?? "未確認"))}</dd>
      </dl>
      ${typeof notes.setup_url === "string" ? `<p><a href="${escapeHtml(notes.setup_url)}">${t("cli.connections.general.setupPage")}</a></p>` : ""}
    </article>`;
  }).join("\n");
  const hasMissingKey = results.some((result) => result.key_source === "missing");
  const missingGuide = !hasMissingKey ? "" : `<section class="guide"><h2>${t("cli.connections.guide.title")}</h2><p>${t("cli.connections.guide.bodyBefore")}<code>${escapeHtml(credentialsPath)}</code>${t("cli.connections.guide.bodyAfter")}</p><ul>${registry.providers.filter((provider) => provider.auth === "env-key").map((provider) => {
    const notes = isPlainObject(provider.notes) ? provider.notes : {};
    return `<li>${escapeHtml(provider.id)}: <code>${escapeHtml(extractEnvName(provider.env) ?? "KEY_NAME")}</code>${typeof notes.setup_url === "string" ? ` — <a href="${escapeHtml(notes.setup_url)}">${t("cli.connections.guide.source")}</a>` : ""}</li>`;
  }).join("")}</ul></section>`;
  const policy = registry.policy;
  const state = value => t(`cli.connections.connectors.${value ? "on" : "off"}`);
  const connectorsSection = connectors.exists
    ? `<section class="policy"><h2>${t("cli.connections.connectors.connectorsTitle")}</h2><dl><dt>${t("cli.connections.connectors.enabledLabel")}</dt><dd>${escapeHtml(connectorIds.map(id => `${id}=${state(connectors.enabled[id])}`).join(" / "))}</dd><dt>${t("cli.connections.connectors.generationOrderLabel")}</dt><dd>${escapeHtml(connectors.generationOrder.join(" → "))}</dd><dt>${t("cli.connections.connectors.automaticFallbackLabel")}</dt><dd>${state(connectors.fallbackOnFailure)}</dd></dl><p>${t("cli.connections.connectors.stateListLabel")}</p></section>`
    : `<section class="policy"><h2>${t("cli.connections.connectors.connectorsTitle")}</h2><p>${t("cli.connections.connectors.noSettingsMessage")}</p></section>`;
  return `<!doctype html>
<html lang="${getLanguage()}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:; base-uri 'none'; form-action 'none'"><title>${t("cli.connections.general.title")}</title><style>
:root{color-scheme:light dark;font-family:system-ui,sans-serif}body{max-width:1100px;margin:0 auto;padding:32px 20px;background:#10131a;color:#eef2f8}header,.guide,.policy,.card{background:#191f2b;border:1px solid #303a4d;border-radius:14px;padding:20px}.summary{color:#aeb8ca}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:16px;margin-top:18px}.card-head{display:flex;align-items:center;justify-content:space-between;gap:12px}.card h2{margin:0}.badges{display:flex;gap:6px;flex-wrap:wrap;justify-content:flex-end}.card-head span{border-radius:999px;padding:4px 10px;background:#384359}.card-head .layer-badge{background:#263b55}.layer-project .layer-badge{background:#4c356b}.layer-workspace .layer-badge{background:#27534c}.layer-default .layer-badge{background:#4e4930}.status-ok{border-color:#2d9d78}.status-unauthorized{border-color:#d76a6a}.status-unconfigured{border-color:#d5a941}dl{display:grid;grid-template-columns:8em 1fr;gap:8px;margin-bottom:0}dt{color:#aeb8ca}dd{margin:0;overflow-wrap:anywhere}a{color:#81b7ff}.guide,.policy{margin-top:18px}code{overflow-wrap:anywhere}</style></head>
<body><header><h1>${t("cli.connections.general.title")}</h1><p class="summary">${t("cli.connections.general.summary", { checkedAt: escapeHtml(checkedAt) })}</p></header>
${missingGuide}
${connectorsSection}
<section class="policy"><h2>${t("cli.connections.policy.title")}</h2><dl><dt>${t("cli.connections.policy.currency")}</dt><dd>${escapeHtml(policy.currency)}</dd><dt>${t("cli.connections.policy.monthly")}</dt><dd>${escapeHtml(money(policy.monthly_budget, policy.currency))}</dd><dt>${t("cli.connections.policy.threshold")}</dt><dd>${escapeHtml(money(policy.approval_threshold, policy.currency))}</dd><dt>${t("cli.connections.policy.spending")}</dt><dd>${t("cli.connections.policy.noData")}</dd></dl></section>
<main class="grid">${cards}</main></body></html>\n`;
}

function money(value, currency) {
  return typeof value === "number" ? `${value} ${currency}` : t("cli.connections.policy.paidStopped");
}

function arrayText(value) {
  return Array.isArray(value) && value.length > 0 ? value.join(" / ") : t("cli.connections.general.blank");
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[character]);
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isMainModule() {
  if (!process.argv[1]) return false;
  try {
    return fs.realpathSync(fileURLToPath(import.meta.url)) === fs.realpathSync(path.resolve(process.argv[1]));
  } catch {
    return false;
  }
}

if (isMainModule()) {
  main().catch((error) => {
    console.error(error?.message ?? (translate ? t("cli.connections.error.default") : "接続確認を完了できませんでした。connections.json の形式と書き込み権限を確認してください。"));
    process.exit(1);
  });
}
