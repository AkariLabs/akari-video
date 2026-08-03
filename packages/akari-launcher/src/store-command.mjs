import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, hostname } from 'node:os';
import path from 'node:path';

/**
 * AKARI Store 連携（`akari store <connect|status|download|disconnect>`）。
 *
 * `connect` の既定は**デバイスコードフロー**（2026-08-03 オーナー要望「トークンの
 * 使い方とかみんなよくわからん」への回答）: ブラウザが開き、ログイン → 承認ボタンで
 * 完了する。トークンはユーザーの目に触れない。`--token akst_...` は上級者・自動化向けの
 * 手動フォールバック。取得したトークンで本体から「何を購入済みか」（entitlements API）と
 * 「配布物の取得」（download API）が使える。宣言パック等の展開（unlock）は
 * セットアップスキル側の仕事で、本コマンドはその土台のプリミティブだけを持つ。
 *
 * 規約は launcher の他コマンドと同じ:
 *   - `~/.akari` は AKARI_HOME で差し替え可能（テスト・隔離実行）
 *   - 副作用（fetch / openBrowser / sleep / log）は options で注入可能・node --test で実プロセス不要
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

function defaultOpenBrowser(url, platform = process.platform) {
  // 失敗しても致命ではない（URL は画面に出している）
  const cmd = platform === 'darwin' ? ['open', url]
    : platform === 'win32' ? ['cmd', '/c', 'start', '', url]
    : ['xdg-open', url];
  try {
    const result = spawnSync(cmd[0], cmd.slice(1), { stdio: 'ignore' });
    return result.status === 0;
  } catch {
    return false;
  }
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

async function validateAndSave({ fetchImpl, env, log }, baseUrl, token) {
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

export async function runStoreCommand(args, options = {}) {
  const log = options.log ?? ((line) => console.log(line));
  const env = options.env ?? process.env;
  const fetchImpl = options.fetch ?? fetch;
  const openBrowser = options.openBrowser ?? defaultOpenBrowser;
  const sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  const sub = args[0];

  if (sub === 'connect') {
    const baseUrl = (parseFlag(args, '--url') ?? DEFAULT_BASE_URL).replace(/\/$/, '');

    // 手動フォールバック（自動化・上級者向け）
    const manualToken = parseFlag(args, '--token');
    if (manualToken) {
      return validateAndSave({ fetchImpl, env, log }, baseUrl, manualToken);
    }

    // 既定 = デバイスコードフロー: ブラウザでログイン → 承認ボタンだけで完了
    let start;
    try {
      const res = await fetchImpl(`${baseUrl}/device/start`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ label: `AKARI Video (${hostname()})` })
      });
      if (!res.ok) {
        log(`ストアに接続できませんでした（${res.status}）`);
        return { exitCode: 1 };
      }
      start = await res.json();
    } catch (error) {
      log(`ストアに接続できませんでした: ${error instanceof Error ? error.message : String(error)}`);
      return { exitCode: 1 };
    }

    log('ブラウザで AKARI Store を開いて接続を承認してください。');
    log(`  確認コード: ${start.user_code}`);
    log(`  URL: ${start.verification_url}`);
    if (!args.includes('--no-open')) {
      openBrowser(start.verification_url);
    }
    log('承認を待っています…（Ctrl+C で中止）');

    const deadline = Date.now() + (start.expires_in ?? 600) * 1000;
    const intervalMs = Math.max(1, start.interval ?? 3) * 1000;
    while (Date.now() < deadline) {
      await sleep(intervalMs);
      let res;
      try {
        res = await fetchImpl(`${baseUrl}/device/claim`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ deviceCode: start.device_code })
        });
      } catch {
        continue; // 一時的なネットワーク断はリトライ
      }
      if (res.status === 410) {
        log('コードの有効期限が切れました。もう一度 `akari store connect` を実行してください。');
        return { exitCode: 1 };
      }
      const body = await res.json().catch(() => ({}));
      if (body.status === 'approved' && body.token) {
        return validateAndSave({ fetchImpl, env, log }, baseUrl, body.token);
      }
    }
    log('承認の待機がタイムアウトしました。もう一度 `akari store connect` を実行してください。');
    return { exitCode: 1 };
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
  log('  connect                              ブラウザで承認して接続（既定。--token akst_... で手動 / --no-open でブラウザを開かない / --url <base>）');
  log('  status                               接続状態と購入済み一覧');
  log('  download <productId> [--dest <dir>]  購入済み配布物の取得');
  log('  disconnect                           接続解除');
  return { exitCode: sub ? 1 : 0 };
}
