import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { constants as osConstants } from 'node:os';
import { StringDecoder } from 'node:string_decoder';
import { fileURLToPath } from 'node:url';

const catalog = JSON.parse(fs.readFileSync(fileURLToPath(new URL('./connect/connectors.json', import.meta.url)), 'utf8'));

const generation = catalog.filter(row => row.group === '素材を作る').map(row => row.id);
const usage = '使い方: akari connect list [--json] | akari connect exec <id> -- <command…>';

export function connectPaths(env = process.env, home = os.homedir()) {
  return {
    settings: path.join(env.AKARI_HOME || path.join(home, '.akari'), 'connectors.json'),
    primary: env.AKARI_CREDENTIALS_FILE || path.join(env.AKARI_HOME || path.join(home, '.akari'), 'credentials.env'),
    legacy: env.AKARI_CREDENTIALS_FILE ? null : path.join(home, '.config', 'akari-video', 'credentials.env')
  };
}
function readSettings(file) {
  try {
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    return {
      enabled: typeof data.enabled === 'object' && data.enabled ? data.enabled : {},
      generationOrder: Array.isArray(data.generationOrder) ? data.generationOrder.filter(id => generation.includes(id)) : [],
      fallbackOnFailure: data.fallbackOnFailure === true
    };
  } catch (error) {
    if (error.code === 'ENOENT') return { enabled: {}, generationOrder: [], fallbackOnFailure: false };
    throw new Error('つなぐ設定を読めません。');
  }
}
function readCredentialFile(file) {
  const values = new Map();
  if (!file) return values;
  let content;
  try {
    const stat = fs.lstatSync(file);
    if (!stat.isFile()) throw new Error();
    content = fs.readFileSync(file, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') return values;
    throw new Error('資格情報ファイルを読めません。');
  }
  for (const raw of content.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const index = line.indexOf('=');
    const name = line.slice(0, index).trim();
    if (index < 1 || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) continue;
    let value = line.slice(index + 1).trim();
    if (value.length >= 2 && (/^".*"$/.test(value) || /^'.*'$/.test(value))) value = value.slice(1, -1);
    values.set(name, value);
  }
  return values;
}
function credentialValues(paths, env) {
  const values = new Map();
  for (const [name, value] of readCredentialFile(paths.legacy)) if (value.trim()) values.set(name, { value, source: 'credentials.env' });
  for (const [name, value] of readCredentialFile(paths.primary)) if (value.trim()) values.set(name, { value, source: 'credentials.env' });
  for (const entry of catalog) if (entry.env && typeof env[entry.env] === 'string' && env[entry.env].trim()) {
    values.set(entry.env, { value: env[entry.env], source: 'env' });
  }
  return values;
}
function dirNames(root) {
  try { return fs.readdirSync(root, { withFileTypes: true }).filter(entry => entry.isDirectory()).map(entry => entry.name); }
  catch { return []; }
}
const appNames = {
  blender: /^Blender(?: \d+(?:\.\d+)*)?\.app$/i,
  photoshop: /^Adobe Photoshop(?: \d{4})?(?:\.app)?$/i,
  'after-effects': /^Adobe After Effects(?: \d{4})?(?:\.app)?$/i,
  'ableton-live': /^Ableton Live .+\.app$/i,
  'davinci-resolve': /^DaVinci Resolve(?:\.app)?$/i,
  'final-cut-pro': /^Final Cut Pro\.app$/i
};
export function detectApp(id, roots, platform = process.platform) {
  if (platform === 'win32' && id === 'final-cut-pro') return false;
  const pattern = appNames[id];
  if (!pattern) return false;
  for (const root of roots) for (const name of dirNames(root)) {
    if (pattern.test(name) && (name.endsWith('.app') || platform === 'win32')) return true;
    if ((id === 'photoshop' || id === 'after-effects' || id === 'davinci-resolve') && pattern.test(name) &&
        dirNames(path.join(root, name)).some(child => pattern.test(child) && (platform === 'win32' || child.endsWith('.app')))) return true;
    if (platform === 'win32' && (id === 'photoshop' || id === 'after-effects') && name === 'Adobe' &&
        dirNames(path.join(root, name)).some(child => pattern.test(child))) return true;
    if (platform === 'win32' && id === 'davinci-resolve' && name === 'Blackmagic Design' &&
        dirNames(path.join(root, name)).some(child => pattern.test(child))) return true;
    if (platform === 'win32' && id === 'blender' && name === 'Blender Foundation' && dirNames(path.join(root, name)).length) return true;
  }
  return false;
}
export function listConnectors({ env = process.env, home = os.homedir(), platform = process.platform, roots } = {}) {
  const paths = connectPaths(env, home);
  const settings = readSettings(paths.settings);
  const credentials = credentialValues(paths, env);
  const scanRoots = roots || (platform === 'win32' ? [env.ProgramFiles, env['ProgramFiles(x86)']].filter(Boolean) : ['/Applications', path.join(home, 'Applications')]);
  const order = [...new Set(settings.generationOrder), ...generation.filter(id => !settings.generationOrder.includes(id))];
  const rows = catalog.map(entry => {
    const detected = entry.app ? detectApp(entry.app, scanRoots, platform) : entry.kind === 'blender-recipe' ? detectApp('blender', scanRoots, platform) : false;
    const credential = entry.env ? credentials.get(entry.env) : undefined;
    const hasKey = !!credential;
    const status = entry.kind === 'built-in' ? 'つながった' : entry.kind === 'planned' ? '準備中' :
      entry.kind === 'key' ? hasKey ? 'つながった' : '準備が要る' :
      entry.kind === 'browser' ? '見つかった' :
      entry.id === 'after-effects' && detected ? '準備が要る' : detected ? '見つかった' : '準備が要る';
    return { id: entry.id, group: entry.group, name: entry.name, status, enabled: entry.kind === 'built-in' || settings.enabled[entry.id] !== false,
      detected, credential: entry.env ? hasKey : null, credentialSource: credential?.source ?? null };
  });
  rows.sort((a, b) => a.group === '素材を作る' && b.group === '素材を作る' ? order.indexOf(a.id) - order.indexOf(b.id) : 0);
  return { rows, generationOrder: order, fallbackOnFailure: settings.fallbackOnFailure };
}

export function createSecretRedactor(secret, emit) {
  const decoder = new StringDecoder('utf8');
  let pending = '';
  const write = text => { if (text) emit(text); };
  const longestPrefixSuffix = () => {
    for (let length = Math.min(secret.length - 1, pending.length); length > 0; length--) {
      if (secret.startsWith(pending.slice(-length))) return length;
    }
    return 0;
  };
  const drain = final => {
    while (pending) {
      const found = pending.indexOf(secret);
      if (found >= 0) {
        write(pending.slice(0, found));
        write('[REDACTED]');
        pending = pending.slice(found + secret.length);
        continue;
      }
      const held = longestPrefixSuffix();
      write(pending.slice(0, pending.length - held));
      if (final && held) write('[REDACTED]');
      pending = final ? '' : pending.slice(pending.length - held);
      return;
    }
  };
  return {
    write(chunk) { pending += decoder.write(chunk); drain(false); },
    end() { pending += decoder.end(); drain(true); }
  };
}

async function forwardStream(stream, secret, emit) {
  if (!stream) return;
  const redactor = createSecretRedactor(secret, emit);
  for await (const chunk of stream) redactor.write(chunk);
  redactor.end();
}

export async function runConnectCommand(args, options = {}) {
  const log = options.log || (line => process.stdout.write(`${line}\n`));
  const error = options.error || (line => process.stderr.write(`${line}\n`));
  const stdoutWrite = options.stdoutWrite || (chunk => process.stdout.write(chunk));
  const stderrWrite = options.stderrWrite || (chunk => process.stderr.write(chunk));
  const env = options.env || process.env;
  const home = options.home || os.homedir();
  if (args[0] === 'list' && (args.length === 1 || args.length === 2 && args[1] === '--json')) {
    const data = listConnectors({ env, home, roots: options.roots, platform: options.platform });
    if (args[1] === '--json') log(JSON.stringify(data));
    else for (const row of data.rows) log(`${row.name}: ${row.status}${row.enabled ? '' : '（使わない）'}`);
    return { exitCode: 0 };
  }
  if (args[0] === 'exec' && args.length >= 4 && args[2] === '--') {
    const entry = catalog.find(row => row.id === args[1]);
    if (!entry?.env) { error('鍵で実行できない接続です。'); return { exitCode: 2 }; }
    const settings = readSettings(connectPaths(env, home).settings);
    if (settings.enabled[entry.id] === false) { error('この接続は「使う」がオフです。'); return { exitCode: 2 }; }
    const credential = credentialValues(connectPaths(env, home), env).get(entry.env);
    if (!credential) { error('鍵が設定されていません。'); return { exitCode: 2 }; }
    const secret = credential.value;
    const childEnv = { ...env };
    for (const connector of catalog) if (connector.env) delete childEnv[connector.env];
    childEnv[entry.env] = secret;
    let child;
    try {
      child = (options.spawn || spawn)(args[3], args.slice(4), {
        shell: false, env: childEnv, stdio: ['inherit', 'pipe', 'pipe']
      });
    } catch {
      error('子プロセスを起動できませんでした。');
      return { exitCode: 1 };
    }
    let launchFailed = false;
    const closed = new Promise(resolve => {
      child.once('error', () => { launchFailed = true; });
      child.once('close', (code, signal) => {
        const signalCode = signal ? osConstants.signals[signal] : undefined;
        resolve(typeof code === 'number' ? code : typeof signalCode === 'number' ? 128 + signalCode : 1);
      });
    });
    const [exitCode] = await Promise.all([
      closed,
      forwardStream(child.stdout, secret, stdoutWrite),
      forwardStream(child.stderr, secret, stderrWrite)
    ]);
    if (launchFailed) error('子プロセスを起動できませんでした。');
    return { exitCode };
  }
  error(usage);
  return { exitCode: 2 };
}
