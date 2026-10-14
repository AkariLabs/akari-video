import { cliText as t } from './i18n.mjs';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { constants as osConstants } from 'node:os';
import { StringDecoder } from 'node:string_decoder';
import { fileURLToPath } from 'node:url';

const catalog = JSON.parse(fs.readFileSync(fileURLToPath(new URL('./connect/connectors.json', import.meta.url)), 'utf8'));

const generation = catalog.filter(row => row.group === 'generate').map(row => row.id);
const usage = () => t('cli.connectCommand.ui.usageText');
const groupLabel = group => t(group === 'tools' ? 'cli.connectCommand.group.toolsLabel' : 'cli.connectCommand.group.generateLabel');
const statusLabel = status => t({
  ready: 'cli.connectCommand.ui.availableLabel', planned: 'cli.connectCommand.ui.comingSoonLabel',
  'needs-key': 'cli.connectCommand.ui.keyRequiredLabel', 'needs-blender': 'cli.connectCommand.ui.requiresBlenderLabel'
}[status]);

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
    throw new Error(t('cli.connectCommand.ui.couldNotReadConnectionSettingsError'));
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
    throw new Error(t('cli.connectCommand.ui.couldNotReadCredentialsFileError'));
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
export function detectApp(id, roots, platform = process.platform) {
  if (id !== 'blender') return false;
  const pattern = platform === 'win32' ? /^(?:Blender Foundation|Blender(?: \d+)?)$/i : /^Blender(?: \d+(?:\.\d+)*)?\.app$/i;
  return roots.some(root => dirNames(root).some(name => pattern.test(name)));
}
function detectBlenderCommand(env, platform) {
  const executable = platform === 'win32' ? 'blender.exe' : 'blender';
  const candidates = [env.BLENDER, ...(env.PATH || '').split(platform === 'win32' ? ';' : ':').map(directory => path.join(directory, executable))];
  return candidates.some(candidate => {
    if (!candidate) return false;
    try { fs.accessSync(candidate, fs.constants.X_OK); return fs.statSync(candidate).isFile(); } catch { return false; }
  });
}
export function listConnectors({ env = process.env, home = os.homedir(), platform = process.platform, roots } = {}) {
  const paths = connectPaths(env, home);
  const settings = readSettings(paths.settings);
  const credentials = credentialValues(paths, env);
  const scanRoots = roots || (platform === 'win32' ? [env.ProgramFiles, env['ProgramFiles(x86)']].filter(Boolean) : ['/Applications', path.join(home, 'Applications')]);
  const order = [...new Set(settings.generationOrder), ...generation.filter(id => !settings.generationOrder.includes(id))];
  const rows = catalog.map(entry => {
    const detected = entry.kind === 'blender-recipe' ? detectApp('blender', scanRoots, platform) || (!roots && detectBlenderCommand(env, platform)) : false;
    const credential = entry.env ? credentials.get(entry.env) : undefined;
    const hasKey = !!credential;
    const status = entry.kind === 'built-in' ? 'ready' : entry.kind === 'planned' ? 'planned' :
      entry.kind === 'key' ? hasKey ? 'ready' : 'needs-key' :
      entry.kind === 'blender-recipe' ? detected ? 'ready' : 'needs-blender' : 'planned';
    return { id: entry.id, group: entry.group, name: entry.name, status, enabled: entry.kind === 'built-in' || settings.enabled[entry.id] !== false,
      detected, credential: entry.env ? hasKey : null, credentialSource: credential?.source ?? null };
  });
  rows.sort((a, b) => a.group === 'generate' && b.group === 'generate' ? order.indexOf(a.id) - order.indexOf(b.id) : 0);
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
    if (args[1] === '--json') log(JSON.stringify({ ...data, rows: data.rows.map(row => ({
      ...row, group: groupLabel(row.group), status: statusLabel(row.status)
    })) }));
    else {
      let group = '';
      for (const row of data.rows) {
        if (row.group !== group) { group = row.group; log(groupLabel(group)); }
        log(`  ${row.name}: ${statusLabel(row.status)}${row.enabled ? '' : t('cli.connectCommand.ui.disabledLabel')}`);
      }
    }
    return { exitCode: 0 };
  }
  if (args[0] === 'exec' && args.length >= 4 && args[2] === '--') {
    const entry = catalog.find(row => row.id === args[1]);
    if (!entry?.env) { error(t('cli.connectCommand.ui.connectionCannotRunAPIKeyError')); return { exitCode: 2 }; }
    const settings = readSettings(connectPaths(env, home).settings);
    if (settings.enabled[entry.id] === false) { error(t('cli.connectCommand.ui.connectionDisabledMessage')); return { exitCode: 2 }; }
    const credential = credentialValues(connectPaths(env, home), env).get(entry.env);
    if (!credential) { error(t('cli.connectCommand.ui.noKeyHasBeenSetMessage')); return { exitCode: 2 }; }
    const secret = credential.value;
    const childEnv = { ...env };
    for (const connector of catalog) if (connector.env) delete childEnv[connector.env];
    // 旧カタログの鍵も子プロセスへ漏らさない。
    delete childEnv.HF_KEY;
    delete childEnv.RUNWAYML_API_SECRET;
    childEnv[entry.env] = secret;
    let child;
    try {
      child = (options.spawn || spawn)(args[3], args.slice(4), {
        shell: false, env: childEnv, stdio: ['inherit', 'pipe', 'pipe']
      });
    } catch {
      error(t('cli.connectCommand.ui.couldNotStartChildProcessError'));
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
    if (launchFailed) error(t('cli.connectCommand.ui.couldNotStartChildProcessError'));
    return { exitCode };
  }
  error(usage());
  return { exitCode: 2 };
}
