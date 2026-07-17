#!/usr/bin/env node

// 接続レジストリを、無償・読み取り専用の確認だけで更新する。

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const usage = "使い方: node skills/manage-connections/bin/doctor.mjs [プロジェクトルート|connections.json]";
const argument = process.argv[2];

if (process.argv.length > 3) {
  console.error(usage);
  process.exit(2);
}

if (argument === "--help" || argument === "-h") {
  console.log(usage);
  process.exit(0);
}

const inputPath = path.resolve(argument ?? process.cwd());
const connectionsPath = inputPath.endsWith(".json")
  ? inputPath
  : path.join(inputPath, ".akari", "connections.json");
const projectRoot = inputPath.endsWith(".json")
  ? path.dirname(path.dirname(connectionsPath))
  : inputPath;
const reportPath = path.join(projectRoot, "connections-report.html");
const credentialsPath = path.resolve(
  process.env.AKARI_CREDENTIALS_FILE ?? path.join(os.homedir(), ".config", "akari-video", "credentials.env"),
);
const timeoutMs = 5_000;

async function main() {
  const registry = readRegistry();
  const credentialState = readCredentials();
  const checkedAt = new Date().toISOString();

  if (!credentialState.exists) {
    printCredentialGuide(registry);
  } else if (!credentialState.securePermissions) {
    console.warn(`警告: credentials.env の権限は 600 ではありません（現在 ${credentialState.mode}）。chmod 600 ${credentialsPath} を実行してください。`);
  }

  const results = await Promise.all(
    registry.providers.map((provider) => inspectProvider(provider, credentialState, checkedAt)),
  );
  for (const [index, result] of results.entries()) registry.providers[index].doctor = result.doctor;

  const jsonOutput = `${JSON.stringify(registry, null, 2)}\n`;
  refuseSecretLeak(jsonOutput, credentialState.values);
  const htmlOutput = renderReport(registry, results, credentialState, checkedAt);
  refuseSecretLeak(htmlOutput, credentialState.values);

  fs.writeFileSync(connectionsPath, jsonOutput, "utf8");
  fs.writeFileSync(reportPath, htmlOutput, "utf8");

  for (const result of results) {
    console.log(`${result.id}: ${result.doctor.status} — ${result.doctor.detail}`);
  }
  console.log(`接続レポート: ${reportPath}`);
}

function readRegistry() {
  let value;
  try {
    value = JSON.parse(fs.readFileSync(connectionsPath, "utf8"));
  } catch {
    throw new Error("connections.json を読めません");
  }
  if (!isPlainObject(value) || !Array.isArray(value.providers) || !isPlainObject(value.policy)) {
    throw new Error("connections.json の構造が不正です");
  }
  return value;
}

function readCredentials() {
  let stat;
  try {
    stat = fs.statSync(credentialsPath);
  } catch (error) {
    if (error && error.code === "ENOENT") {
      return { exists: false, securePermissions: false, mode: null, values: new Map(), parseWarnings: [] };
    }
    throw error;
  }
  if (!stat.isFile()) throw new Error("credentials.env が通常ファイルではありません");

  const mode = (stat.mode & 0o777).toString(8).padStart(3, "0");
  const values = new Map();
  const parseWarnings = [];
  const source = fs.readFileSync(credentialsPath, "utf8");
  for (const [index, originalLine] of source.split(/\r?\n/).entries()) {
    const line = originalLine.trim();
    if (!line || line.startsWith("#")) continue;
    const separator = line.indexOf("=");
    if (separator < 1) {
      parseWarnings.push(index + 1);
      continue;
    }
    const name = line.slice(0, separator).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
      parseWarnings.push(index + 1);
      continue;
    }
    let value = line.slice(separator + 1).trim();
    if (
      value.length >= 2 &&
      ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'")))
    ) {
      value = value.slice(1, -1);
    }
    values.set(name, value);
  }
  if (parseWarnings.length > 0) {
    console.warn(`警告: credentials.env の ${parseWarnings.map((line) => `${line} 行目`).join("、")}を KEY=VALUE として読めませんでした。`);
  }
  return { exists: true, securePermissions: mode === "600", mode, values, parseWarnings };
}

async function inspectProvider(provider, credentialState, checkedAt) {
  const id = typeof provider.id === "string" ? provider.id : "unknown-provider";
  if (provider.auth === "login" || provider.auth === "oauth-mcp") {
    return result(id, checkedAt, "unchecked", `${provider.auth} 認証は doctor から疎通確認しません。人間がログイン状態を確認してください。`, false);
  }
  if (provider.auth !== "env-key") {
    return result(id, checkedAt, "unchecked", "未対応の認証方式のため確認していません。", false);
  }

  const envName = extractEnvName(provider.env);
  if (!envName) {
    return result(id, checkedAt, "unconfigured", "env は ${KEY_NAME} 形式で登録してください。", false);
  }
  const secret = credentialState.values.get(envName);
  if (!credentialState.exists || typeof secret !== "string" || secret.length === 0) {
    return result(id, checkedAt, "unconfigured", `${envName} は credentials.env に未設定です。`, false);
  }

  const adapter = adapters[id];
  if (!adapter) {
    return result(id, checkedAt, "unchecked", "無償・読み取り専用と確認済みの doctor adapter がありません。", true);
  }
  const doctor = await adapter(secret, checkedAt);
  return { id, configured: true, doctor };
}

const adapters = {
  fal: (secret, checkedAt) =>
    checkGet("https://rest.alpha.fal.ai/billing/user_balance", { Authorization: `Key ${secret}` }, checkedAt),
  replicate: (secret, checkedAt) =>
    checkGet("https://api.replicate.com/v1/account", { Authorization: `Bearer ${secret}` }, checkedAt),
  elevenlabs: (secret, checkedAt) =>
    checkGet("https://api.elevenlabs.io/v1/models", { "xi-api-key": secret }, checkedAt),
  openrouter: (secret, checkedAt) =>
    checkGet("https://openrouter.ai/api/v1/key", { Authorization: `Bearer ${secret}` }, checkedAt),
};

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

function result(id, checkedAt, status, detail, configured) {
  return { id, configured, doctor: { last_checked: checkedAt, status, detail } };
}

function extractEnvName(value) {
  if (typeof value !== "string") return null;
  const match = /^\$\{([A-Za-z_][A-Za-z0-9_]*)\}$/.exec(value);
  return match ? match[1] : null;
}

function printCredentialGuide(registry) {
  console.log(`credentials.env がありません: ${credentialsPath}`);
  console.log(`作成後に chmod 600 ${credentialsPath} を実行してください。キーは人間が取得して配置してください。`);
  for (const provider of registry.providers) {
    if (provider.auth !== "env-key") continue;
    const name = extractEnvName(provider.env) ?? "KEY_NAME";
    const setupUrl = isPlainObject(provider.notes) ? provider.notes.setup_url : null;
    console.log(`- ${provider.id}: ${name}${typeof setupUrl === "string" ? ` / ${setupUrl}` : ""}`);
  }
}

function refuseSecretLeak(output, values) {
  for (const secret of values.values()) {
    if (secret && output.includes(secret)) {
      throw new Error("資格情報の値と一致する文字列が出力に含まれています");
    }
  }
}

function renderReport(registry, results, credentialState, checkedAt) {
  const resultById = new Map(results.map((item) => [item.id, item]));
  const cards = registry.providers.map((provider) => {
    const result = resultById.get(provider.id);
    const notes = isPlainObject(provider.notes) ? provider.notes : {};
    const credentialLabel = provider.auth === "env-key"
      ? result?.configured
        ? "設定済み（マスク）"
        : "未設定"
      : `${provider.auth}（値なし）`;
    const allowed = Array.isArray(provider.models?.allowed) && provider.models.allowed.length > 0
      ? provider.models.allowed.join(", ")
      : "未設定";
    return `<article class="card status-${escapeHtml(provider.doctor.status)}">
      <div class="card-head"><h2>${escapeHtml(provider.id)}</h2><span>${escapeHtml(provider.doctor.status)}</span></div>
      <dl>
        <dt>用途</dt><dd>${escapeHtml(notes.description ?? "未記入")}</dd>
        <dt>工程</dt><dd>${escapeHtml(arrayText(notes.workflows))}</dd>
        <dt>課金モデル</dt><dd>${escapeHtml(notes.billing ?? "未記入")}</dd>
        <dt>quota</dt><dd>${escapeHtml(notes.quota ?? "未記入")}</dd>
        <dt>必要スコープ</dt><dd>${escapeHtml(arrayText(notes.scopes))}</dd>
        <dt>資格情報</dt><dd>${escapeHtml(credentialLabel)}</dd>
        <dt>既定モデル</dt><dd>${escapeHtml(provider.models?.default ?? "未設定")}</dd>
        <dt>許可モデル</dt><dd>${escapeHtml(allowed)}</dd>
        <dt>最終確認</dt><dd>${escapeHtml(provider.doctor.last_checked ?? "未確認")}</dd>
        <dt>結果</dt><dd>${escapeHtml(provider.doctor.detail ?? "未確認")}</dd>
      </dl>
      ${typeof notes.setup_url === "string" ? `<p><a href="${escapeHtml(notes.setup_url)}">設定ページ</a></p>` : ""}
    </article>`;
  }).join("\n");
  const missingGuide = credentialState.exists ? "" : `<section class="guide"><h2>credentials.env の準備</h2><p><code>${escapeHtml(credentialsPath)}</code> を作成し、権限を 600 にしてください。次の KEY 名だけを登録し、値はレポートや会話へ貼らないでください。</p><ul>${registry.providers.filter((provider) => provider.auth === "env-key").map((provider) => {
    const notes = isPlainObject(provider.notes) ? provider.notes : {};
    return `<li>${escapeHtml(provider.id)}: <code>${escapeHtml(extractEnvName(provider.env) ?? "KEY_NAME")}</code>${typeof notes.setup_url === "string" ? ` — <a href="${escapeHtml(notes.setup_url)}">取得先</a>` : ""}</li>`;
  }).join("")}</ul></section>`;
  const policy = registry.policy;
  return `<!doctype html>
<html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:; base-uri 'none'; form-action 'none'"><title>AKARI 接続レポート</title><style>
:root{color-scheme:light dark;font-family:system-ui,sans-serif}body{max-width:1100px;margin:0 auto;padding:32px 20px;background:#10131a;color:#eef2f8}header,.guide,.policy,.card{background:#191f2b;border:1px solid #303a4d;border-radius:14px;padding:20px}.summary{color:#aeb8ca}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:16px;margin-top:18px}.card-head{display:flex;align-items:center;justify-content:space-between;gap:12px}.card h2{margin:0}.card-head span{border-radius:999px;padding:4px 10px;background:#384359}.status-ok{border-color:#2d9d78}.status-unauthorized{border-color:#d76a6a}.status-unconfigured{border-color:#d5a941}dl{display:grid;grid-template-columns:8em 1fr;gap:8px;margin-bottom:0}dt{color:#aeb8ca}dd{margin:0;overflow-wrap:anywhere}a{color:#81b7ff}.guide,.policy{margin-top:18px}code{overflow-wrap:anywhere}</style></head>
<body><header><h1>AKARI 接続レポート</h1><p class="summary">生成日時: ${escapeHtml(checkedAt)}。資格情報は存在有無だけを表示し、値は保存していません。</p></header>
${missingGuide}
<section class="policy"><h2>コスト承認ポリシー</h2><dl><dt>通貨</dt><dd>${escapeHtml(policy.currency)}</dd><dt>月間予算上限</dt><dd>${escapeHtml(money(policy.monthly_budget, policy.currency))}</dd><dt>個別承認閾値</dt><dd>${escapeHtml(money(policy.approval_threshold, policy.currency))}</dd><dt>予算消化状況</dt><dd>実績データ未連携</dd></dl></section>
<main class="grid">${cards}</main></body></html>\n`;
}

function money(value, currency) {
  return typeof value === "number" ? `${value} ${currency}` : "未設定（有償操作を停止）";
}

function arrayText(value) {
  return Array.isArray(value) && value.length > 0 ? value.join(" / ") : "未記入";
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[character]);
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

main().catch(() => {
  console.error("接続確認を完了できませんでした。connections.json の形式と書き込み権限を確認してください。");
  process.exitCode = 1;
});
