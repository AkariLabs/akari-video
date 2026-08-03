import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';

import { defaultPrompt } from './first-run.mjs';

/**
 * AKARI Store 連携（`akari store <connect|status|download|disconnect>`）。
 *
 * ストアのマイページで発行した接続トークン（akst_）を保存し、本体から
 * 「何を購入済みか」（entitlements API）と「配布物の取得」（download API）を
 * 使えるようにする。宣言パック等の展開（unlock）はセットアップスキル側の仕事で、
 * 本コマンドはその土台になる機械的なプリミティブだけを持つ。
 *
 * 規約は launcher の他コマンドと同じ:
 *   - `~/.akari` は AKARI_HOME で差し替え可能（テスト・隔離実行）
 *   - 副作用（fetch / prompt / log）は options で注入可能・node --test で実プロセス不要
 */

const DEFAULT_BASE_URL = 'https://akari-oss.app/api/store';
const CREDENTIALS_FILE = 'store-credentials.json';

function resolveAkariHome(env = process.env) {
  return env.AKARI_HOME || path.join(homedir(), '.akari');
}

export function resolveCredentialsPath(env = process.env) {
  return path.join(resolveAkariHome(env), CREDENTIALS_FILE);
}

export function readCredentials(env = process.env) {
  const file = resolveCredentialsPath(env);
  if (!existsSync(file)) return null;
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8'));
    if (typeof parsed?.token !== 'string' || typeof parsed?.url !== 'string') return null;
    return parsed;
  } catch {
    return null;
  }
}

function writeCredentials(env, creds) {
  const file = resolveCredentialsPath(env);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(creds, null, 2)}\n`);
  chmodSync(file, 0o600); // トークンは本人だけが読めるように
}

function parseFlag(args, name) {
  const i = args.indexOf(name);
  return i >= 0 && i + 1 < args.length ? args[i + 1] : null;
}

async function fetchEntitlements(fetchImpl, baseUrl, token) {
  let res;
  try {
    res = await fetchImpl(`${baseUrl}/v1/entitlements`, {
      headers: { authorization: `Bearer ${token}` }
    });
  } catch (error) {
    return { error: `ストアに接続できませんでした: ${error instanceof Error ? error.message : String(error)}` };
  }
  if (res.status === 401) return { error: 'トークンが無効です。マイページで発行し直してください。' };
  if (!res.ok) return { error: `ストアがエラーを返しました（${res.status}）` };
  return { data: await res.json() };
}

function formatEntitlements(data, log) {
  if (data.entitlements.length === 0) {
    log('購入済みの商品はまだありません。');
    return;
  }
  log('購入済みの商品:');
  for (const ent of data.entitlements) {
    log(`  - ${ent.product_id}（v${ent.current_version}）`);
  }
}

export async function runStoreCommand(args, options = {}) {
  const log = options.log ?? ((line) => console.log(line));
  const env = options.env ?? process.env;
  const fetchImpl = options.fetch ?? fetch;
  const prompt = options.prompt ?? defaultPrompt;
  const sub = args[0];

  if (sub === 'connect') {
    const baseUrl = (parseFlag(args, '--url') ?? DEFAULT_BASE_URL).replace(/\/$/, '');
    let token = parseFlag(args, '--token');
    if (!token) {
      log('AKARI Store のマイページ（アカウント > AKARI Video と連携）で接続トークンを発行し、貼り付けてください。');
      token = (await prompt('接続トークン (akst_...): ')).trim();
    }
    if (!/^akst_[A-Za-z0-9_-]+$/.test(token)) {
      log('トークンの形式が正しくありません（akst_ で始まる文字列です）。');
      return { exitCode: 1 };
    }
    const { data, error } = await fetchEntitlements(fetchImpl, baseUrl, token);
    if (error) {
      log(error);
      return { exitCode: 1 };
    }
    writeCredentials(env, {
      url: baseUrl,
      token,
      email: data.email,
      connected_at: new Date().toISOString()
    });
    log(`接続しました: ${data.email}`);
    formatEntitlements(data, log);
    log('セッション内で「購入した素材をセットアップして」と頼むと展開まで進みます。');
    return { exitCode: 0 };
  }

  if (sub === 'status') {
    const creds = readCredentials(env);
    if (!creds) {
      log('未接続です。`akari store connect` で接続してください。');
      return { exitCode: 1 };
    }
    const { data, error } = await fetchEntitlements(fetchImpl, creds.url, creds.token);
    if (error) {
      log(`接続情報はありますが確認に失敗しました: ${error}`);
      return { exitCode: 1 };
    }
    log(`接続中: ${data.email}（${creds.url}）`);
    formatEntitlements(data, log);
    return { exitCode: 0 };
  }

  if (sub === 'download') {
    const productId = args[1];
    if (!productId || productId.startsWith('--')) {
      log('使い方: akari store download <productId> [--dest <dir>]');
      return { exitCode: 1 };
    }
    const creds = readCredentials(env);
    if (!creds) {
      log('未接続です。`akari store connect` で接続してください。');
      return { exitCode: 1 };
    }
    let res;
    try {
      res = await fetchImpl(`${creds.url}/v1/download/${productId}`, {
        headers: { authorization: `Bearer ${creds.token}` }
      });
    } catch (error) {
      log(`ダウンロードに失敗しました: ${error instanceof Error ? error.message : String(error)}`);
      return { exitCode: 1 };
    }
    if (res.status === 403) {
      log(`この商品の購入が確認できません: ${productId}`);
      return { exitCode: 1 };
    }
    if (!res.ok) {
      log(`ダウンロードに失敗しました（${res.status}）`);
      return { exitCode: 1 };
    }
    const destDir = parseFlag(args, '--dest') ?? process.cwd();
    mkdirSync(destDir, { recursive: true });
    const nameMatch = (res.headers.get('content-disposition') ?? '').match(/filename="([^"]+)"/);
    const fileName = nameMatch ? nameMatch[1] : `${productId}.zip`;
    const filePath = path.join(destDir, fileName);
    writeFileSync(filePath, Buffer.from(await res.arrayBuffer()));
    log(`保存しました: ${filePath}`);
    return { exitCode: 0, filePath };
  }

  if (sub === 'disconnect') {
    const file = resolveCredentialsPath(env);
    if (existsSync(file)) {
      rmSync(file);
      log('接続を解除しました（マイページ側のトークン失効もおすすめします）。');
    } else {
      log('未接続です。');
    }
    return { exitCode: 0 };
  }

  log('使い方: akari store <connect|status|download|disconnect>');
  log('  connect [--token akst_...] [--url <base>]   ストアのアカウントと接続');
  log('  status                                       接続状態と購入済み一覧');
  log('  download <productId> [--dest <dir>]          購入済み配布物の取得');
  log('  disconnect                                   接続解除');
  return { exitCode: sub ? 1 : 0 };
}
