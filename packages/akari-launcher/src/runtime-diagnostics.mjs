import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import path, { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { resolveChromeCacheDir } from './chrome-command.mjs';
import { findExecutable } from './path-lookup.mjs';
import { readInstalledAppVersionInfo, readOwnVersion, resolveAkariHome } from './update-check.mjs';

const THIS_DIRECTORY = dirname(fileURLToPath(import.meta.url));
const ANCESTOR_SEARCH_MAX_DEPTH = 10;

/**
 * `packages/<pkg>/bin/<entry>` の候補を列挙する純粋関数。
 * Electron 側と同じ resourcesPath →祖先 packages → dirname 隣接の順序意味論を持つ。
 */
export function packagedCliCandidates(packageName, entryName, dirnameValue, resourcesPath) {
  const relativePath = join('packages', packageName, 'bin', entryName);
  const candidates = [];
  if (resourcesPath) candidates.push(resolve(resourcesPath, relativePath));
  for (const ancestor of ancestorDirectories(dirnameValue)) {
    candidates.push(resolve(ancestor, relativePath));
  }
  candidates.push(resolve(dirnameValue, '..', packageName, 'bin', entryName));
  return [...new Set(candidates)];
}

function ancestorDirectories(startDirectory) {
  const directories = [];
  let current = resolve(startDirectory);
  for (let depth = 0; depth < ANCESTOR_SEARCH_MAX_DEPTH; depth += 1) {
    directories.push(current);
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return directories;
}

function firstExisting(candidates, exists = existsSync) {
  return candidates.find((candidate) => exists(candidate)) ?? null;
}

function isWithin(candidate, root) {
  if (!root) return false;
  const relative = path.relative(resolve(root), resolve(candidate));
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

export function resolveAppBundle(options = {}) {
  const env = options.env ?? process.env;
  const platform = options.platform ?? process.platform;
  const execPath = options.execPath ?? process.execPath;
  const exists = options.exists ?? existsSync;
  const resourceCandidates = [];
  if (env.AKARI_APP_RESOURCES) resourceCandidates.push(resolve(env.AKARI_APP_RESOURCES));
  const fromExecutable = resourcesFromExecutable(execPath, platform);
  if (fromExecutable) resourceCandidates.push(fromExecutable);
  resourceCandidates.push(...(options.defaultAppResources ?? defaultAppResources(platform, env)));

  const resourcePath = firstExisting([...new Set(resourceCandidates)], exists);
  if (!resourcePath) return { found: false, path: null, version: null };
  let version = null;
  try {
    const manifest = JSON.parse(readFileSync(join(resourcePath, 'packages', 'akari-launcher', 'package.json'), 'utf8'));
    if (typeof manifest.version === 'string') version = manifest.version;
  } catch {
    // Resources は実在するが launcher manifest が無い／壊れている。found と version を分けて返す。
  }
  return { found: true, path: resourcePath, version };
}

function resourcesFromExecutable(execPath, platform) {
  if (platform === 'darwin') {
    const normalized = resolve(execPath);
    const marker = '.app/Contents/';
    const index = normalized.indexOf(marker);
    return index >= 0 ? join(normalized.slice(0, index + '.app/Contents'.length), 'Resources') : null;
  }
  if (platform === 'win32') return join(dirname(execPath), 'resources');
  return null;
}

function defaultAppResources(platform, env) {
  if (platform === 'darwin') return ['/Applications/AKARI Video.app/Contents/Resources'];
  if (platform === 'win32' && env.LOCALAPPDATA) {
    return [join(env.LOCALAPPDATA, 'Programs', 'AKARI Video', 'resources')];
  }
  return [];
}

export function resolveRuntimePaths(options = {}) {
  const env = options.env ?? process.env;
  const launcherDirectory = options.launcherDirectory ?? THIS_DIRECTORY;
  const exists = options.exists ?? existsSync;
  const installInfo = options.installInfo ?? readInstalledAppVersionInfo(env);
  const managedRoot = dirname(installInfo.path);
  const appBundle = options.appBundle ?? resolveAppBundle({ ...options, env, exists });
  const resolveCli = (packageName, entryName) => {
    const monorepoCandidates = packagedCliCandidates(packageName, entryName, launcherDirectory)
      .filter((candidate) => !isWithin(candidate, managedRoot) && !isWithin(candidate, appBundle.path));
    const monorepo = firstExisting(monorepoCandidates, exists);
    if (monorepo) return { path: monorepo, origin: 'monorepo' };
    const managed = firstExisting([join(managedRoot, 'packages', packageName, 'bin', entryName)], exists);
    if (managed) return { path: managed, origin: 'managed-app' };
    const bundled = appBundle.path
      ? firstExisting([join(appBundle.path, 'packages', packageName, 'bin', entryName)], exists)
      : null;
    return bundled ? { path: bundled, origin: 'app-bundle' } : { path: null, origin: 'none' };
  };

  return {
    app_managed: {
      status: installInfo.status,
      version: installInfo.version,
      path: managedRoot,
    },
    app_bundle: appBundle,
    render_cut: resolveCli('render-cut', 'render-cut.mjs'),
    edit_lint: resolveCli('edit-lint', 'edit-lint.mjs'),
  };
}

export async function resolveDoctorReport(options = {}) {
  const env = options.env ?? process.env;
  const platform = options.platform ?? process.platform;
  const execPath = options.execPath ?? process.execPath;
  const pathEnv = Object.hasOwn(env, 'PATH') ? (env.PATH ?? '') : (process.env.PATH ?? '');
  const pathExt = env.PATHEXT ?? process.env.PATHEXT;
  const runtime = resolveRuntimePaths(options);
  const mediaBin = await resolveMediaTools({ ...options, env, platform, pathEnv, pathExt });
  const chrome = await resolveChromeInstallation({ ...options, env });
  const gpuExport = await resolveGpuExportAvailability({ ...options, env, platform });
  const akariHome = resolveAkariHome(env);
  const cliShimDir = join(akariHome, 'cli', 'bin');
  const report = {
    cli: {
      version: options.cliVersion ?? readOwnVersion(),
      entry_path: options.entryPath ?? process.argv[1] ?? null,
      node: {
        exec_path: execPath,
        electron_run_as_node: env.ELECTRON_RUN_AS_NODE === '1',
        version: options.nodeVersion ?? process.versions.node,
      },
    },
    ...runtime,
    ffmpeg: mediaBin.ffmpeg,
    ffprobe: mediaBin.ffprobe,
    chrome,
    gpu_export: gpuExport,
    path: {
      cli_shim_dir: cliShimDir,
      on_path: pathContains(pathEnv, cliShimDir, platform),
    },
  };
  report.verdict = determineDoctorVerdict(report);
  report.next_steps = doctorNextSteps(report);
  return report;
}

export async function resolveGpuExportAvailability(options = {}) {
  const platform = options.platform ?? process.platform;
  if (platform !== 'darwin') {
    return { available: false, reason: 'GPU hardware export v0 is available on macOS only', launcher_tier: null };
  }
  try {
    const resolver = options.resolveGpuLauncher
      ?? (await import('../../gpu-export/src/runner.mjs')).resolveGpuLauncher;
    const launcher = options.gpuLauncher ?? await resolver({
      env: options.env ?? process.env,
      platform,
      homeDirectory: options.homeDirectory,
    });
    const available = launcher?.tier === 1 || launcher?.tier === 2;
    return {
      available,
      reason: available ? `${launcher.kind} launcher tier ${launcher.tier}` : launcher?.reason ?? 'Electron launcher unavailable',
      launcher_tier: launcher?.tier ?? null,
    };
  } catch (error) {
    return { available: false, reason: String(error?.message ?? error), launcher_tier: null };
  }
}

async function resolveMediaTools(options) {
  let mediaBin = null;
  try {
    mediaBin = options.loadMediaBin
      ? await options.loadMediaBin()
      : await loadMediaBinModule();
  } catch {
    mediaBin = null;
  }
  return {
    ffmpeg: resolveMediaTool('ffmpeg', mediaBin?.resolveFfmpeg, options),
    ffprobe: resolveMediaTool('ffprobe', mediaBin?.resolveFfprobe, options),
  };
}

async function loadMediaBinModule() {
  const candidates = [
    new URL('../../media-bin/src/index.mjs', import.meta.url),
    new URL('../vendor/packages/media-bin/src/index.mjs', import.meta.url),
  ];
  let lastError;
  for (const candidate of candidates) {
    try {
      return await import(candidate.href);
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError ?? new Error('media-bin is unavailable');
}

function resolveMediaTool(name, resolver, options) {
  if (typeof resolver === 'function') {
    try {
      const resolved = resolver({ env: options.env });
      const executable = /[\\/]/u.test(resolved)
        ? resolve(resolved)
        : findExecutable(resolved, options.pathEnv, options.platform, options.pathExt);
      if (executable) {
        const normalized = executable.split(path.sep).join('/');
        const origin = normalized.includes('/media-bin/') ? 'media-bin' : 'path';
        return { path: executable, origin };
      }
    } catch {
      // media-bin は「未発見」を throw する契約。PATH の直接探索へ縮退する。
    }
  }
  const executable = findExecutable(name, options.pathEnv, options.platform, options.pathExt);
  return executable ? { path: executable, origin: 'path' } : { path: null, origin: 'none' };
}

async function resolveChromeInstallation(options) {
  const cacheDir = resolveChromeCacheDir(options.homeDirectory ?? homedir(), options.chromeCacheDir);
  try {
    const browsers = options.loadBrowsers
      ? await options.loadBrowsers()
      : await import('@puppeteer/browsers');
    if (typeof browsers.Cache === 'function') {
      const installed = new browsers.Cache(cacheDir).getInstalledBrowsers();
      const chrome = installed.find((entry) => entry.browser === 'chrome' && existsSync(entry.executablePath));
      if (chrome) return { found: true, path: resolve(chrome.executablePath), cache_dir: cacheDir };
    }
  } catch {
    // optional dependency が無くても既定キャッシュ規約の直接探索で診断を続ける。
  }
  const executable = findChromeExecutable(cacheDir);
  return { found: executable !== null, path: executable, cache_dir: cacheDir };
}

function findChromeExecutable(cacheDir) {
  const executableNames = new Set(['chrome', 'chrome.exe', 'Google Chrome for Testing']);
  const walk = (directory, depth) => {
    if (depth > 7) return null;
    let entries;
    try {
      entries = readdirSync(directory, { withFileTypes: true });
    } catch {
      return null;
    }
    for (const entry of entries) {
      const candidate = join(directory, entry.name);
      if (entry.isFile() && executableNames.has(entry.name)) return resolve(candidate);
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const found = walk(join(directory, entry.name), depth + 1);
      if (found) return found;
    }
    return null;
  };
  return walk(cacheDir, 0);
}

function pathContains(pathEnv, directory, platform) {
  const delimiter = platform === 'win32' ? ';' : path.delimiter;
  const normalize = (value) => {
    const normalized = resolve(value);
    return platform === 'win32' ? normalized.toLowerCase() : normalized;
  };
  const expected = normalize(directory);
  return pathEnv.split(delimiter).filter(Boolean).some((entry) => normalize(entry) === expected);
}

export function determineDoctorVerdict(report) {
  const bothEditingToolsMissing = report.render_cut.origin === 'none' && report.edit_lint.origin === 'none';
  if (bothEditingToolsMissing || report.ffmpeg.origin === 'none' || report.ffprobe.origin === 'none') return 'broken';
  const oneEditingToolMissing = report.render_cut.origin === 'none' || report.edit_lint.origin === 'none';
  const unmanagedPathProblem = report.app_managed.status === 'missing'
    && !report.path.on_path
    && report.render_cut.origin !== 'monorepo'
    && report.edit_lint.origin !== 'monorepo';
  if (oneEditingToolMissing || report.app_managed.status === 'invalid' || unmanagedPathProblem) return 'degraded';
  return 'ok';
}

function doctorNextSteps(report) {
  const steps = [];
  if (report.render_cut.origin === 'none' && report.edit_lint.origin === 'none') {
    steps.push('書き出し部品がありません。デスクトップ版を導入するか、install.sh 経路の本体を導入してください。');
  } else {
    if (report.render_cut.origin === 'none') steps.push('render-cut がありません。デスクトップ版または install.sh 経路の本体を修復してください。');
    if (report.edit_lint.origin === 'none') steps.push('edit-lint がありません。デスクトップ版または install.sh 経路の本体を修復してください。');
  }
  if (report.ffmpeg.origin === 'none') steps.push('ffmpeg を導入し、PATH または AKARI_FFMPEG_BIN で参照できるようにしてください。');
  if (report.ffprobe.origin === 'none') steps.push('ffprobe を導入し、PATH または AKARI_FFPROBE_BIN で参照できるようにしてください。');
  if (!report.chrome.found) steps.push('Chrome が未導入です。`akari chrome install` を実行してください。');
  if (!report.path.on_path && report.render_cut.origin !== 'monorepo') {
    steps.push('`~/.akari/cli/bin` を PATH に追加してください。');
  }
  return steps;
}

export function doctorExitCode(verdict) {
  return verdict === 'broken' ? 1 : 0;
}
