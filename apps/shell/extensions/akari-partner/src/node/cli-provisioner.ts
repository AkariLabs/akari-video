import { spawnSync } from 'child_process';
import { createHash } from 'crypto';
import {
    chmodSync,
    existsSync,
    mkdirSync,
    promises as fs,
    readdirSync,
    renameSync,
    rmSync,
    writeFileSync
} from 'fs';
import { dirname, join } from 'path';
import { EnsureCliResult } from '../common/akari-partner-protocol';
import { resolveAkariHomeDir } from './partner-connection-writer';

/**
 * task/2026-08-17-shell-managed-cli: アプリ管理の `akari` CLI 自動配備。
 *
 * パッケージ実行時: Resources 配下の同梱 `akari-video`（= `packages/akari-launcher`）を
 * 常にシム target にする。同梱物が無い旧構成だけは、版固定 tarball を公式レジストリから
 * 取得し、`dist.integrity`（SRI 形式・既定 sha512）で検証してから
 * `<akariHome>/cli/<version>/` へ展開する従来経路を使う。
 *
 * dev 実行時（このアプリ自身が Electron 実行体として動いていない場合）はダウンロードせず、
 * リポ上方探索で `packages/akari-launcher/bin/akari.mjs` を直接シムに焼き込む
 * （akari-surfaces の `findUpwardFile` と同型の探索をここで自前実装 — 依存を増やさない）。
 *
 * 冪等: シムは毎回書き直す（安価・idempotent）。同梱 CLI 使用時は過去の registry 配備物を
 * 全削除し、registry 経路では対象版が展開済みなら再取得せず旧版を直近 1 世代だけ残す。
 *
 * 失敗は全経路で fail-soft: 例外を投げず `{ status: 'failed' | 'skipped', log }` を返す
 * （呼び出し側 = パートナー接続フローを止めないため）。
 */

const DEFAULT_REGISTRY_BASE = 'https://registry.npmjs.org/akari-video';
const UPWARD_SEARCH_MAX_DEPTH = 12;
const SHELL_PACKAGE_NAME = '@akari-video/shell';
const LAUNCHER_ENTRY_RELATIVE = 'packages/akari-launcher/bin/akari.mjs';

export interface EnsureCliOptions {
    /** 配備先ルート（既定: `resolveAkariHomeDir()` = `AKARI_HOME` または `~/.akari`）。テスト容易性のため注入可能。 */
    akariHome?: string;
    /** 判定・シム焼き込みに使う実行体パス（既定 `process.execPath`）。 */
    execPath?: string;
    /** Electron ランタイム上で動いているか（既定 `Boolean(process.versions.electron)`）。 */
    hasElectronRuntime?: boolean;
    platform?: NodeJS.Platform;
    env?: NodeJS.ProcessEnv;
    /** Electron の `process.resourcesPath`（packaged 時のみ設定される）。 */
    resourcesPath?: string;
    fetchImpl?: typeof fetch;
    registryBaseUrl?: string;
    /** `apps/shell/package.json`（版の出所）の探索起点。テスト用に上書き可能。 */
    shellPackageJsonStartDirs?: string[];
    /** dev 実行時の `packages/akari-launcher/bin/akari.mjs` 探索起点。テスト用に上書き可能。 */
    repoSearchStartDirs?: string[];
    spawnTar?: typeof spawnSync;
}

export async function ensureCli(options: EnsureCliOptions = {}): Promise<EnsureCliResult> {
    const log: string[] = [];
    const push = (line: string): void => {
        log.push(line);
    };
    try {
        const env = options.env ?? process.env;
        const akariHome = options.akariHome ?? resolveAkariHomeDir(env);
        const execPath = options.execPath ?? process.execPath;
        const platform = options.platform ?? process.platform;
        const hasElectronRuntime = options.hasElectronRuntime ?? Boolean(process.versions.electron);
        const packaged = isElectronExecutable(execPath, hasElectronRuntime);
        const cliRoot = resolveCliRoot(akariHome);
        const shimDir = resolveCliShimDir(akariHome);

        if (!packaged) {
            const repoMjs = await findRepoAkariLauncherMjs(options.repoSearchStartDirs ?? [__dirname, process.cwd()]);
            if (!repoMjs) {
                push(`dev 実行: ${LAUNCHER_ENTRY_RELATIVE} が見つかりませんでした。CLI シムは未配備のままです。`);
                return { status: 'skipped', log };
            }
            writeShimFile(shimDir, platform, buildShimScript({ platform, targetMjsPath: repoMjs }));
            push(`dev 実行: ${repoMjs} を直接シムへ焼き込みました`);
            return { status: 'ready', shimDir, log };
        }

        const shellVersion = await resolveShellVersion({
            resourcesPath: options.resourcesPath,
            startDirs: options.shellPackageJsonStartDirs ?? [__dirname, process.cwd()]
        });
        if (!shellVersion) {
            push(`シェル自身の版（${SHELL_PACKAGE_NAME} の package.json）を特定できませんでした。CLI 配備をスキップしました。`);
            return { status: 'skipped', log };
        }

        const appVersion = await readInstalledAppVersion(akariHome);
        const appVersionRelation = appVersion
            ? versionRelation(appVersion, shellVersion)
            : undefined;
        const versionDetails = appVersion
            ? { appVersion, appVersionRelation }
            : {};
        if (appVersionRelation === 'older') {
            push(`版のずれ: CLI v${shellVersion} / 本体 v${appVersion} → 本体が古い。akari update で本体を更新してください。`);
        } else if (appVersionRelation === 'newer') {
            push(`版のずれ: CLI v${shellVersion} / 本体 v${appVersion} → CLI と本体の版が不一致です。`);
        }

        // extraResources が同梱する `Contents/Resources/packages/akari-launcher/bin/akari.mjs`
        // を packaged 実行の唯一の正とする。同じ Resources / Electron 実行体パスなら、
        // shellVersion が変わってもシム内容は変わらず、アプリ更新後の同梱実体へ追随する。
        const bundledMjsPath = options.resourcesPath
            ? join(options.resourcesPath, 'packages', 'akari-launcher', 'bin', 'akari.mjs')
            : undefined;
        if (bundledMjsPath && existsSync(bundledMjsPath)) {
            push(`同梱 CLI を使用します（アプリ更新をまたいでシムは不変）: ${bundledMjsPath}`);
            const shimPath = writeShimFile(
                shimDir,
                platform,
                buildShimScript({ platform, targetMjsPath: bundledMjsPath, bakedNodeExecPath: execPath })
            );
            push(`シム生成: ${shimPath}`);
            pruneBundledCliArtifacts(cliRoot, push);
            return { status: 'ready', version: shellVersion, ...versionDetails, shimDir, log };
        }

        const versionDir = join(cliRoot, shellVersion);
        const mjsPath = join(versionDir, 'package', 'bin', 'akari.mjs');
        let targetMjsPath: string;
        if (existsSync(mjsPath)) {
            push(`v${shellVersion} は配備済みです（${versionDir}）`);
            targetMjsPath = mjsPath;
        } else {
            const outcome = await fetchAndExtractVersion({
                version: shellVersion,
                cliRoot,
                versionDir,
                platform,
                fetchImpl: options.fetchImpl ?? globalThis.fetch,
                registryBaseUrl: options.registryBaseUrl ?? DEFAULT_REGISTRY_BASE,
                spawnTar: options.spawnTar ?? spawnSync,
                push
            });
            if (outcome === 'fetched') {
                targetMjsPath = mjsPath;
            } else {
                push('CLI は未配備のままです。');
                return { status: 'failed', version: shellVersion, ...versionDetails, log };
            }
        }

        const shimPath = writeShimFile(
            shimDir,
            platform,
            buildShimScript({ platform, targetMjsPath, bakedNodeExecPath: execPath })
        );
        push(`シム生成: ${shimPath}`);
        pruneOldVersionDirs(cliRoot, shellVersion);

        return { status: 'ready', version: shellVersion, ...versionDetails, shimDir, log };
    } catch (error) {
        push(`CLI 配備で予期しないエラーが発生しました（接続は続行します）: ${errorMessage(error)}`);
        return { status: 'failed', log };
    }
}

/** 書き出し本体の install-ref。AKARI_HOME 解決後のパスだけを読み、homedir を直書きしない。 */
export async function readInstalledAppVersion(akariHome: string): Promise<string | undefined> {
    try {
        const raw = (await fs.readFile(join(akariHome, 'app', '.akari-install-ref'), 'utf8')).trim();
        return /^v?(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)$/.exec(raw)?.[1];
    } catch {
        return undefined;
    }
}

function versionRelation(appVersion: string, cliVersion: string): 'older' | 'same' | 'newer' {
    const compared = compareVersionTriplets(appVersion, cliVersion);
    return compared < 0 ? 'older' : compared > 0 ? 'newer' : 'same';
}

// --- 配備先パス --------------------------------------------------------------

export function resolveCliRoot(akariHome: string): string {
    return join(akariHome, 'cli');
}

export function resolveCliShimDir(akariHome: string): string {
    return join(resolveCliRoot(akariHome), 'bin');
}

export function cliShimFilePath(shimDir: string, platform: NodeJS.Platform): string {
    return join(shimDir, platform === 'win32' ? 'akari.cmd' : 'akari');
}

export interface BuildCliPathEnvOptions {
    akariHome: string;
    platform: NodeJS.Platform;
    /** 既存の PATH（未設定なら空文字扱い）。 */
    existingPath?: string;
    /** 既定は platform から導出（win32: `;` / それ以外: `:`）。テスト用に上書き可能。 */
    pathDelimiter?: string;
}

/**
 * `prepareLaunch()` が PTY へ渡す env の PATH 差分。`ensureCli()` の結果を受け渡すのではなく、
 * ここで改めてシムの存在を fs で確認する（RPC 呼び出しをまたいで状態を信頼しない — 未配備 /
 * failed 時は空オブジェクトを返し、呼び出し側は PATH を一切変更しない）。
 */
export function buildCliPathEnv(options: BuildCliPathEnvOptions): Record<string, string> {
    const shimDir = resolveCliShimDir(options.akariHome);
    const shimPath = cliShimFilePath(shimDir, options.platform);
    if (!existsSync(shimPath)) {
        return {};
    }
    const delimiter = options.pathDelimiter ?? (options.platform === 'win32' ? ';' : ':');
    const existingPath = options.existingPath ?? '';
    if (existingPath.split(delimiter)[0] === shimDir) {
        return { PATH: existingPath };
    }
    return { PATH: existingPath ? `${shimDir}${delimiter}${existingPath}` : shimDir };
}

// --- Electron 実行体判定 -------------------------------------------------------

/**
 * `akari-partner-server.ts` の `isElectronExecutable` と同じ意味論（packaged app として
 * 動いているか）。実行体パスに electron / `.app/Contents/MacOS/` を含むか、Electron
 * ランタイム上で動いているかのどちらかで packaged とみなす。dev 実行（`theia start` 等・
 * 素の node）ではどちらも false になる。
 */
export function isElectronExecutable(execPath: string, hasElectronRuntime: boolean): boolean {
    return /electron|\.app\/Contents\/MacOS\//i.test(execPath) || hasElectronRuntime;
}

// --- シェル自身の版の解決 -------------------------------------------------------

export interface ResolveShellVersionOptions {
    resourcesPath?: string;
    startDirs: string[];
}

/**
 * `apps/shell/package.json`（`name: "@akari-video/shell"`）を上方探索で見つけ、その
 * `version` を返す。packaged 時は `resourcesPath/app.asar/package.json` を最優先候補に
 * 加える（electron-builder の `files` 設定で package.json は asar ルートに同梱される —
 * `packaged-tool-candidates.ts` と同じ `resourcesPath` 起点の規約）。単純に「直近の
 * package.json」ではなく名前一致まで見るのは、拡張自身の package.json 等の途中経路の
 * package.json に誤って止まらないため。
 */
export async function resolveShellVersion(options: ResolveShellVersionOptions): Promise<string | undefined> {
    const candidateDirs = [
        ...(options.resourcesPath ? [join(options.resourcesPath, 'app.asar')] : []),
        ...options.startDirs
    ];
    for (const start of candidateDirs) {
        let dir = start;
        for (let depth = 0; depth <= UPWARD_SEARCH_MAX_DEPTH; depth++) {
            const version = await readShellVersionIfMatching(join(dir, 'package.json'));
            if (version) {
                return version;
            }
            const parent = dirname(dir);
            if (parent === dir) {
                break;
            }
            dir = parent;
        }
    }
    return undefined;
}

async function readShellVersionIfMatching(candidate: string): Promise<string | undefined> {
    try {
        const raw = await fs.readFile(candidate, 'utf8');
        const parsed = JSON.parse(raw) as { name?: string; version?: string };
        if (parsed?.name === SHELL_PACKAGE_NAME && typeof parsed.version === 'string' && parsed.version) {
            return parsed.version;
        }
    } catch {
        // 読めない/対象外の package.json。上位へ探索を続ける。
    }
    return undefined;
}

// --- dev 実行時のリポ探索 -------------------------------------------------------

export async function findRepoAkariLauncherMjs(startDirs: string[]): Promise<string | undefined> {
    for (const start of startDirs) {
        const found = await searchUpwardForFile(start, LAUNCHER_ENTRY_RELATIVE);
        if (found) {
            return found;
        }
    }
    return undefined;
}

async function searchUpwardForFile(startDir: string, relativeTarget: string): Promise<string | undefined> {
    let dir = startDir;
    for (let depth = 0; depth <= UPWARD_SEARCH_MAX_DEPTH; depth++) {
        const candidate = join(dir, relativeTarget);
        if (await isFile(candidate)) {
            return candidate;
        }
        const parent = dirname(dir);
        if (parent === dir) {
            break;
        }
        dir = parent;
    }
    return undefined;
}

async function isFile(candidate: string): Promise<boolean> {
    try {
        return (await fs.stat(candidate)).isFile();
    } catch {
        return false;
    }
}

// --- registry からの取得・展開 -------------------------------------------------

interface RegistryVersionMetadata {
    tarballUrl: string;
    integrity: string;
}

/** `https://registry.npmjs.org/akari-video/<version>` の応答から dist 情報だけを抜き出す純関数。 */
export function parseRegistryVersionMetadata(payload: unknown): RegistryVersionMetadata | undefined {
    if (!payload || typeof payload !== 'object') {
        return undefined;
    }
    const dist = (payload as { dist?: unknown }).dist;
    if (!dist || typeof dist !== 'object') {
        return undefined;
    }
    const tarballUrl = (dist as { tarball?: unknown }).tarball;
    const integrity = (dist as { integrity?: unknown }).integrity;
    if (typeof tarballUrl !== 'string' || !tarballUrl || typeof integrity !== 'string' || !integrity) {
        return undefined;
    }
    return { tarballUrl, integrity };
}

/**
 * npm の SRI 形式 integrity（例: `sha512-<base64>`。スペース区切りで複数候補が並ぶこともある）を
 * 検証する純関数。一致するアルゴリズムが 1 つでもあれば true。
 */
export function verifyTarballIntegrity(buffer: Buffer, integrity: string): boolean {
    const entries = integrity.trim().split(/\s+/).filter(Boolean);
    for (const entry of entries) {
        const match = /^(sha512|sha384|sha256|sha1)-(.+)$/.exec(entry);
        if (!match) {
            continue;
        }
        const [, algorithm, expectedBase64] = match;
        const actualBase64 = createHash(algorithm).update(buffer).digest('base64');
        if (actualBase64 === expectedBase64) {
            return true;
        }
    }
    return false;
}

export function resolveTarBinary(platform: NodeJS.Platform, env: NodeJS.ProcessEnv = process.env): string {
    if (platform === 'win32') {
        return join(env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe');
    }
    return '/usr/bin/tar';
}

interface FetchAndExtractOptions {
    version: string;
    cliRoot: string;
    versionDir: string;
    platform: NodeJS.Platform;
    fetchImpl: typeof fetch;
    registryBaseUrl: string;
    spawnTar: typeof spawnSync;
    push: (line: string) => void;
}

/**
 * `fetched`（成功）と `unavailable`（registry 未到達 / 未公開版 / 応答不正 / 展開失敗など
 * ネットワーク・可用性起因）を `integrity-mismatch`（取得はできたが SRI 不一致 = 改ざんの疑い）
 * で区別する。旧構成の registry 経路でも真因を握りつぶさず、integrity 不一致は
 * 改ざんの疑いとしてログに残す。
 */
type FetchAndExtractOutcome = 'fetched' | 'unavailable' | 'integrity-mismatch';

async function fetchAndExtractVersion(options: FetchAndExtractOptions): Promise<FetchAndExtractOutcome> {
    const { version, cliRoot, versionDir, platform, fetchImpl, registryBaseUrl, spawnTar, push } = options;
    const metadataUrl = `${registryBaseUrl}/${version}`;
    push(`registry から取得しています: ${metadataUrl}`);

    let metadata: RegistryVersionMetadata | undefined;
    try {
        const response = await fetchImpl(metadataUrl, {
            headers: { Accept: 'application/json', 'User-Agent': 'AKARI-Video-Partner-CLI-Provisioner' }
        });
        if (!response.ok) {
            push(`registry が ${response.status} を返しました（未公開の版の可能性があります）。`);
            return 'unavailable';
        }
        metadata = parseRegistryVersionMetadata(await response.json());
    } catch (error) {
        push(`registry への接続に失敗しました: ${errorMessage(error)}`);
        return 'unavailable';
    }
    if (!metadata) {
        push('registry の応答に dist.tarball / dist.integrity がありません。');
        return 'unavailable';
    }

    let tarballBuffer: Buffer;
    try {
        const response = await fetchImpl(metadata.tarballUrl);
        if (!response.ok) {
            push(`tarball の取得に失敗しました（HTTP ${response.status}）。`);
            return 'unavailable';
        }
        tarballBuffer = Buffer.from(await response.arrayBuffer());
    } catch (error) {
        push(`tarball の取得に失敗しました: ${errorMessage(error)}`);
        return 'unavailable';
    }

    if (!verifyTarballIntegrity(tarballBuffer, metadata.integrity)) {
        push('tarball の integrity 検証に失敗しました（改ざんの疑い）。');
        return 'integrity-mismatch';
    }

    mkdirSync(cliRoot, { recursive: true });
    const uniqueSuffix = `${process.pid}-${Date.now()}`;
    const downloadPath = join(cliRoot, `.download-${version}-${uniqueSuffix}.tgz`);
    const stagingDir = `${versionDir}.staging-${uniqueSuffix}`;
    writeFileSync(downloadPath, tarballBuffer);
    rmSync(stagingDir, { recursive: true, force: true });
    mkdirSync(stagingDir, { recursive: true });

    try {
        extractTarball({ platform, tarPath: downloadPath, destDir: stagingDir, spawnTar });
    } catch (error) {
        rmSync(stagingDir, { recursive: true, force: true });
        rmSync(downloadPath, { force: true });
        push(`tarball の展開に失敗しました: ${errorMessage(error)}`);
        return 'unavailable';
    }
    rmSync(downloadPath, { force: true });
    // 展開先は staging → rename でアトミックに確定させる（途中クラッシュでも半端な
    // バージョンディレクトリを残さない — self-update.mjs の stageSelfUpdate と同じ意味論）。
    rmSync(versionDir, { recursive: true, force: true });
    renameSync(stagingDir, versionDir);
    push(`v${version} を配備しました: ${versionDir}`);
    return 'fetched';
}

function extractTarball(options: {
    platform: NodeJS.Platform;
    tarPath: string;
    destDir: string;
    spawnTar: typeof spawnSync;
}): void {
    const tarBinary = resolveTarBinary(options.platform);
    // npm tarball の `package/` プレフィックスは剥がさない（シムが
    // `<version>/package/bin/akari.mjs` を直接指す設計のため --strip-components は使わない）。
    const result = options.spawnTar(tarBinary, ['-xzf', options.tarPath, '-C', options.destDir], { stdio: 'pipe' });
    if (result.error) {
        throw result.error;
    }
    if (result.status !== 0) {
        throw new Error(`tar が失敗しました（code ${result.status}）: ${result.stderr?.toString().trim() ?? ''}`);
    }
}

// --- シム生成 ------------------------------------------------------------------

export interface BuildShimScriptOptions {
    platform: NodeJS.Platform;
    /** 実行対象の `akari.mjs` 絶対パス（packaged 時は展開済み版・dev 時はリポ内パス）。 */
    targetMjsPath: string;
    /**
     * packaged 実行時に配備時点で確定した Electron 実行体パス（存在チェック付きで
     * `ELECTRON_RUN_AS_NODE=1` と共に使う）。dev 実行時は未指定（node 解決を PATH に委ねる）。
     */
    bakedNodeExecPath?: string;
}

/**
 * node 解決順: `AKARI_NODE_BIN` env → 配備時に確定した Electron 実行体
 * （存在すれば `ELECTRON_RUN_AS_NODE=1` を設定して使う。packaged 時のみ）→ PATH 上の `node`。
 */
export function buildShimScript(options: BuildShimScriptOptions): string {
    return options.platform === 'win32' ? buildWindowsShimScript(options) : buildPosixShimScript(options);
}

function buildPosixShimScript(options: BuildShimScriptOptions): string {
    const lines = [
        '#!/bin/sh',
        '# AKARI CLI shim — generated by akari-partner cli-provisioner. Do not edit by hand.',
        'if [ -n "$AKARI_NODE_BIN" ]; then',
        `  exec "$AKARI_NODE_BIN" "${options.targetMjsPath}" "$@"`,
        'fi'
    ];
    if (options.bakedNodeExecPath) {
        lines.push(
            `if [ -x "${options.bakedNodeExecPath}" ]; then`,
            `  ELECTRON_RUN_AS_NODE=1 exec "${options.bakedNodeExecPath}" "${options.targetMjsPath}" "$@"`,
            'fi'
        );
    }
    lines.push(`exec node "${options.targetMjsPath}" "$@"`, '');
    return lines.join('\n');
}

function buildWindowsShimScript(options: BuildShimScriptOptions): string {
    const lines = [
        '@echo off',
        'rem AKARI CLI shim — generated by akari-partner cli-provisioner. Do not edit by hand.',
        'if defined AKARI_NODE_BIN (',
        `  "%AKARI_NODE_BIN%" "${options.targetMjsPath}" %*`,
        '  exit /b %ERRORLEVEL%',
        ')'
    ];
    if (options.bakedNodeExecPath) {
        lines.push(
            `if exist "${options.bakedNodeExecPath}" (`,
            '  set ELECTRON_RUN_AS_NODE=1',
            `  "${options.bakedNodeExecPath}" "${options.targetMjsPath}" %*`,
            '  exit /b %ERRORLEVEL%',
            ')'
        );
    }
    lines.push(`node "${options.targetMjsPath}" %*`, 'exit /b %ERRORLEVEL%', '');
    return lines.join('\r\n');
}

function writeShimFile(shimDir: string, platform: NodeJS.Platform, content: string): string {
    mkdirSync(shimDir, { recursive: true });
    const target = cliShimFilePath(shimDir, platform);
    writeFileSync(target, content, 'utf8');
    if (platform !== 'win32') {
        chmodSync(target, 0o755);
    }
    return target;
}

// --- 同梱 CLI への切り替え後の掃除 ---------------------------------------------

/**
 * 同梱 CLI のシムから参照されない registry 配備物と途中生成物を全て削除する。
 * 掃除の失敗はシムの利用可否に影響させず、対象ごとにログへ残して続行する。
 */
function pruneBundledCliArtifacts(cliRoot: string, push: (line: string) => void): void {
    let entries: import('fs').Dirent[];
    try {
        entries = readdirSync(cliRoot, { withFileTypes: true });
    } catch (error) {
        push(`同梱 CLI 切り替え後の遺物確認に失敗しました: ${errorMessage(error)}`);
        return;
    }

    for (const entry of entries) {
        const isVersionDir = entry.isDirectory() && entry.name !== 'bin' && !entry.name.startsWith('.');
        const isDownload = /^\.download-.*\.tgz$/.test(entry.name);
        const isStaging = entry.name.includes('.staging-');
        if (!isVersionDir && !isDownload && !isStaging) {
            continue;
        }
        const target = join(cliRoot, entry.name);
        try {
            rmSync(target, { recursive: true, force: true });
        } catch (error) {
            push(`同梱 CLI 切り替え後の遺物削除に失敗しました（${target}）: ${errorMessage(error)}`);
        }
    }
}

// --- 旧版掃除（直近 1 世代だけ残す） ---------------------------------------------

/**
 * `cliRoot` 直下の版ディレクトリ名（`bin` と dotfile を除く）から、`currentVersion` 以外に
 * 残す 1 世代（直近の旧版）を選び、それ以外の削除対象名を返す純関数。
 */
export function selectVersionDirsToDelete(existingNames: string[], currentVersion: string): string[] {
    const others = existingNames.filter(name => name !== currentVersion && name !== 'bin' && !name.startsWith('.'));
    const sortedDesc = [...others].sort((a, b) => -compareVersionTriplets(a, b));
    return sortedDesc.slice(1);
}

export function compareVersionTriplets(a: string, b: string): number {
    const pa = parseVersionTriplet(a);
    const pb = parseVersionTriplet(b);
    if (!pa || !pb) {
        return 0;
    }
    for (let i = 0; i < 3; i++) {
        if (pa[i] !== pb[i]) {
            return pa[i] < pb[i] ? -1 : 1;
        }
    }
    return 0;
}

function parseVersionTriplet(value: string): [number, number, number] | undefined {
    const match = /^(\d+)\.(\d+)\.(\d+)/.exec(value.trim());
    if (!match) {
        return undefined;
    }
    return [Number(match[1]), Number(match[2]), Number(match[3])];
}

function pruneOldVersionDirs(cliRoot: string, currentVersion: string): void {
    let entryNames: string[];
    try {
        entryNames = readdirSync(cliRoot, { withFileTypes: true })
            .filter(entry => entry.isDirectory())
            .map(entry => entry.name);
    } catch {
        return;
    }
    for (const name of selectVersionDirsToDelete(entryNames, currentVersion)) {
        rmSync(join(cliRoot, name), { recursive: true, force: true });
    }
}

// --- 共通 --------------------------------------------------------------------

function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}
