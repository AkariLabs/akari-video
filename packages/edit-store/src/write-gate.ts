/**
 * edit.json / captions.json の atomic 書き込みと保存後 lint（Node 専用）。
 *
 * 由来: apps/shell の akari-annotations-service.ts / akari-preview-service.ts に
 * 複製されていた assertLintPasses / runEditLint / findEditLintBinPath / writeAtomic を
 * ここへ一本化した（プレビュー・パリティ契約 §2.7「すべての書き込み経路は edit-lint を通す」）。
 * preview-server の PUT ハンドラも同じ共有層を使う。保存前ゲートだった lint は
 * task 2026-08-18-shell-write-path-latency で保存後 debounce lint へ移した。
 *
 * 比較なしの保存は lock + tmp + rename、比較つきの保存は journal と退避も使う。
 * edit-lint は保存後 400ms の末尾
 * debounce で同じプロジェクトにつき最新 1 本だけをプロセス内実行する。lint が
 * 利用できない場合は従来どおり fail-open とし、編集不能にはしない。
 *
 * fail-open（オーナー裁定 2026-08-02、初出 2026-07-26 editlint-packaged-resolve）:
 * lint 実行系が見つからない場合は書き込みを全面ブロックせず検証スキップで続行する。
 * 編集不能より lint なし保存の方が被害が小さいという判断（型不正は各書き込みの
 * ローカル検証が別途残るため安全側は保たれる）。
 */

import { promises as fs, statSync } from 'fs';
import { dirname, join, resolve, sep } from 'path';
import { pathToFileURL } from 'url';
import { tmpdir } from 'os';
import { hostname } from 'os';
import { createHash, randomUUID } from 'crypto';
import { renameRetryWarningLogged, renameWithRetry } from './history-store';
// index.ts の SAVED_BY_PATH と同値に保つ（Node 専用入口は index を import しない）。
export const SAVED_BY_PATH = '.akari/saved-by.json';
const SAVED_BY_SCHEMA_VERSION = 1;
const APP_VERSION_PATTERN = /^\d+\.\d+\.\d+(?:[-+][\w.-]+)?$/;

function isValidSavedByAppVersion(version: unknown): version is string {
    return typeof version === 'string' && APP_VERSION_PATTERN.test(version);
}

function serializeSavedByStamp(appVersion: string, savedAt = new Date().toISOString()): string {
    return `${JSON.stringify({ version: SAVED_BY_SCHEMA_VERSION, app: 'akari-video', appVersion, savedAt }, null, 2)}\n`;
}

export interface EditLintFinding {
    severity?: string;
    message?: string;
    check?: string;
    path?: string;
    range?: { start?: number; end?: number };
    /** 今回の保存より前の lint にも同じ指摘があった（この保存が起こした問題ではない）。 */
    preexisting?: boolean;
}

export interface EditLintGateResult {
    pass: boolean;
    errors: string[];
    findings: EditLintFinding[];
}

/** 候補ファイル名（プロジェクト直下からの相対パス）→ 書き込み予定の全文。null は不在扱い。 */
export type LintCandidates = Record<string, string | null>;

export interface DeferredLintOptions {
    /** edit.json を保存した AKARI Video の版。不明なら既存スタンプを消す。 */
    appVersion?: string;
    debounceMs?: number;
    onLintResult?: (result: EditLintGateResult) => void | Promise<void>;
    /** Deterministic test seam; production callers use runEditLint. */
    lintRunner?: (projectRoot: string) => Promise<EditLintGateResult>;
    /**
     * atomic rename が完了した「直後」に、書けた全文を同期で渡す。
     * onWillWrite（rename 直前・自己書き込み由来 watcher の抑止用）の対になる通知で、
     * 用途は「書き込みの発生を watcher より先に知らせる」こと。
     * 購読側（プレビュー拡張）は file watcher の通知を待たずに差分判定へ入れる。
     * ここで例外を投げても保存は完了済みなので、呼び出し側は握りつぶして保存を維持する。
     */
    onDidWrite?: (filePath: string, content: string) => void;
    onRecovered?: (notice: string) => void;
}

interface EditLintModule {
    lintProject(input: string, options?: Record<string, unknown>): Promise<{
        verdict?: string;
        findings?: EditLintFinding[];
    }>;
}

/** 影プロジェクトの 1 エントリをどう実体化したか。 */
export type ShadowEntryStrategy = 'symlink' | 'copy' | 'skip';

/**
 * 影プロジェクト構築の決定論テスト用シーム。本番呼び出しは既定（fs.symlink）のままで、
 * 何も渡さなければ挙動は従来と同一。
 */
export interface ShadowLintHooks {
    /** symlink の差し替え口。権限のある環境／無い環境をテストから作り分けるためだけに使う。 */
    symlink?: (target: string, path: string, type: 'junction' | 'file') => Promise<void>;
    /** エントリ 1 件ごとに実体化の手段を通知する観測口。 */
    onShadowEntry?: (name: string, strategy: ShadowEntryStrategy) => void;
    /** 影プロジェクトを作れず候補のメモリ検証へ退避したことを通知する観測口。 */
    onShadowUnavailable?: (reason: string) => void;
}

/**
 * 「OS / ファイルシステムがリンク作成自体を拒んだ」エラーコード。入力が誤っている系
 * （EEXIST・ENOENT・ENOTDIR 等）は含めない — それらは従来どおり throw して原因を隠さない。
 *
 * Windows ではディレクトリ junction は権限不要だが、ファイル symlink は管理者権限か
 * 開発者モードが必要。そのため一般の Windows 機では `.gitignore` 等のファイルリンクが
 * 必ず EPERM になり、保存前の検証ステージングが本番の書き込みより先に落ちていた。
 */
const LINK_UNSUPPORTED_CODES = new Set([
    'EPERM', 'EACCES', 'EINVAL', 'ENOSYS', 'ENOTSUP', 'EOPNOTSUPP', 'UNKNOWN'
]);

/** ディレクトリをリンクできなかったことを示す内部シグナル（素材の実体コピーは選ばない）。 */
class ShadowLinkUnavailable extends Error {
    constructor(entryPath: string, cause: NodeJS.ErrnoException) {
        super(`影プロジェクトへ ${entryPath} をリンクできませんでした（${cause.code ?? cause.message}）`);
        this.name = 'ShadowLinkUnavailable';
    }
}

function isLinkUnsupported(error: unknown): boolean {
    const code = (error as NodeJS.ErrnoException | null | undefined)?.code;
    return typeof code === 'string' && LINK_UNSUPPORTED_CODES.has(code);
}

const DEFAULT_LINT_DEBOUNCE_MS = 400;
const lintTimers = new Map<string, ReturnType<typeof setTimeout>>();
const lintRevisions = new Map<string, number>();
const lintRunChains = new Map<string, Promise<EditLintGateResult>>();
/** プロジェクトごとの直近の保存後 lint の指摘。次の保存の「保存前から有った指摘」の基準にする。 */
const lastLintFindings = new Map<string, EditLintFinding[]>();
/** debounce 窓の最初の書き込みの直前に取った基準。窓の lint が走るときに消費する。 */
const pendingLintBaselines = new Map<string, EditLintFinding[] | undefined>();
const dynamicImport = new Function('specifier', 'return import(specifier)') as
    (specifier: string) => Promise<EditLintModule>;

/**
 * 実ファイルは変更せず、候補全文だけを options.inputOverrides で差し替えて検証する。
 * 既存 export のシグネチャは維持し、preview-server の保存前検査にも使える。
 */
export async function lintProjectCandidates(
    projectRoot: string,
    candidates: LintCandidates
): Promise<EditLintGateResult> {
    return runEditLint(projectRoot, candidates, false);
}

/**
 * 実ディスクを直接読む lint check（motion 袋参照等）を含め、候補一式を保存前に検証する。
 * 元プロジェクトの直下エントリは影プロジェクトへ symlink し、候補の祖先だけを実体化する。
 * 既存 lintProjectCandidates の inputOverrides 契約は変更せず、Project API だけがこの入口を使う。
 *
 * リンクが使えない環境（Windows の非特権ユーザー等）では**ファイルだけコピーへ倒す**。
 * 影プロジェクトは lint の読み取り専用ステージングなので、ファイルはコピーで等価であり、
 * かつ影側への書き込みが元プロジェクトへ伝播しない（symlink 経路と同じ安全性）。
 * ディレクトリはコピーしない: プロジェクト直下には assets/（4K 原本が何十 GB）が来るため、
 * junction も作れない環境では影プロジェクトの構築自体を諦め、候補のメモリ差し替えだけで
 * 検証する（実ディスクを読む check は落ちるが、保存は止めない — 冒頭の fail-open 裁定）。
 */
export async function lintProjectCandidatesOnDisk(
    projectRoot: string,
    candidates: LintCandidates,
    hooks: ShadowLintHooks = {}
): Promise<EditLintGateResult> {
    const shadowRoot = await fs.mkdtemp(join(tmpdir(), 'akari-edit-store-lint-'));
    try {
        for (const entry of await fs.readdir(projectRoot, { withFileTypes: true })) {
            await materializeShadowEntry(
                resolve(projectRoot, entry.name),
                join(shadowRoot, entry.name),
                entry.isDirectory(),
                entry.name,
                hooks
            );
        }
        for (const [relativePath, text] of Object.entries(candidates)) {
            const segments = candidateSegments(relativePath);
            const destination = join(shadowRoot, ...segments);
            await materializeShadowDirectory(shadowRoot, dirname(destination), hooks);
            await fs.rm(destination, { recursive: true, force: true });
            if (text !== null) await fs.writeFile(destination, text, 'utf8');
        }
        return await runEditLint(shadowRoot, undefined, false);
    } catch (error) {
        if (!(error instanceof ShadowLinkUnavailable)) throw error;
        warnShadowUnavailableOnce(error);
        hooks.onShadowUnavailable?.(error.message);
        return await lintProjectCandidates(projectRoot, candidates);
    } finally {
        await fs.rm(shadowRoot, { recursive: true, force: true });
    }
}

/**
 * 影プロジェクトへ 1 エントリを写す。まず従来どおり symlink / junction を試し、
 * OS がリンク作成を拒んだときだけファイルコピーへ倒す（権限のある環境の挙動は変えない）。
 */
async function materializeShadowEntry(
    source: string,
    destination: string,
    preferDirectory: boolean,
    label: string,
    hooks: ShadowLintHooks
): Promise<void> {
    const symlink = hooks.symlink
        ?? ((target: string, path: string, type: 'junction' | 'file') => fs.symlink(target, path, type));
    try {
        await symlink(source, destination, preferDirectory ? 'junction' : 'file');
        hooks.onShadowEntry?.(label, 'symlink');
        return;
    } catch (error) {
        if (!isLinkUnsupported(error)) throw error;
        if (preferDirectory) throw new ShadowLinkUnavailable(source, error as NodeJS.ErrnoException);
        // symlink エントリはリンク先を辿って種別を決める（リンクの実体がディレクトリなら
        // コピーしない）。辿れない壊れたリンクは lint も読めないので影へは作らない。
        const stats = await fs.stat(source).catch(() => null);
        if (stats === null) {
            hooks.onShadowEntry?.(label, 'skip');
            return;
        }
        if (stats.isDirectory()) throw new ShadowLinkUnavailable(source, error as NodeJS.ErrnoException);
        await fs.copyFile(source, destination);
        hooks.onShadowEntry?.(label, 'copy');
    }
}

let shadowUnavailableWarned = false;

function warnShadowUnavailableOnce(error: Error): void {
    if (shadowUnavailableWarned) {
        return;
    }
    shadowUnavailableWarned = true;
    console.warn(
        '[edit-store] 影プロジェクトを作れないため、実ディスクを読む lint check を省いて'
        + '候補のメモリ検証だけで保存しています。',
        error.message
    );
}

function candidateSegments(relativePath: string): string[] {
    const segments = relativePath.split('/');
    if (relativePath.length === 0 || relativePath.startsWith('/') || relativePath.includes('\\')
        || segments.some(segment => segment.length === 0 || segment === '.' || segment === '..')) {
        throw new Error(`候補パスはプロジェクト相対の安全な / 区切りで指定してください: ${relativePath}`);
    }
    return segments;
}

async function materializeShadowDirectory(
    shadowRoot: string,
    directory: string,
    hooks: ShadowLintHooks
): Promise<void> {
    if (directory === shadowRoot) return;
    await materializeShadowDirectory(shadowRoot, dirname(directory), hooks);
    try {
        const stat = await fs.lstat(directory);
        if (!stat.isSymbolicLink()) {
            if (!stat.isDirectory()) throw new Error(`候補の親パスがディレクトリではありません: ${directory}`);
            return;
        }
        const source = await fs.realpath(directory);
        await fs.unlink(directory);
        await fs.mkdir(directory);
        for (const entry of await fs.readdir(source, { withFileTypes: true })) {
            await materializeShadowEntry(
                resolve(source, entry.name),
                join(directory, entry.name),
                entry.isDirectory(),
                entry.name,
                hooks
            );
        }
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
        await fs.mkdir(directory);
    }
}

/** 互換 API。保存後 lint への移行後も、明示的に検証したい呼び出し側向けに残す。 */
export async function assertLintPasses(projectRoot: string, candidates: LintCandidates): Promise<void> {
    const result = await lintProjectCandidates(projectRoot, candidates);
    if (!result.pass) {
        throw new Error(result.errors[0] ?? 'edit-lint が変更を拒否しました');
    }
}

let defaultSavedByAppVersion: string | undefined;

/** CLI / preview-server 等のプロセス内で書き手の版を 1 回だけ設定する。 */
export function setDefaultSavedByAppVersion(version: string | undefined): void {
    defaultSavedByAppVersion = isValidSavedByAppVersion(version) ? version : undefined;
}

/** CLI の既存 edit.json 保存直後に、スタンプだけを atomic に更新する。 */
export async function writeSavedByStamp(projectRoot: string, appVersion: string | undefined): Promise<void> {
    const destination = join(projectRoot, SAVED_BY_PATH);
    try {
        if (isValidSavedByAppVersion(appVersion)) {
            await writeAtomic(destination, serializeSavedByStamp(appVersion));
        } else {
            // 版不明の書き手は、以前の書き手の版を主張できない。
            await fs.rm(destination, { force: true });
        }
    } catch (error) {
        if (!renameRetryWarningLogged(error)) {
            const code = (error as NodeJS.ErrnoException)?.code;
            console.warn(`[edit-store] saved-by.json の更新に失敗しました（保存は完了しています）。${code ? ` ${code}` : ''}`);
        }
    }
}

export function projectFileHash(bytes: Buffer | Uint8Array | string): string {
    return `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
}

export class ConflictError extends Error {
    readonly code = 'AKARI_WRITE_CONFLICT';
    readonly files: string[];
    constructor(files: string[]) {
        super(`ほかの変更があったので書きませんでした。もう一度実行してください: ${files.join('、')}`);
        this.name = 'ConflictError';
        this.files = files;
    }
}

type TransactionFile = { expectedHash?: string | null; next: string | null };
type TransactionHooks = {
    now?: () => number;
    processAlive?: (pid: number) => boolean;
    rename?: (source: string, target: string, index: number) => Promise<void>;
    crashAfterJournal?: boolean;
    crashAfterFirstRename?: boolean;
    fs?: Partial<Pick<typeof fs, 'unlink' | 'rm' | 'mkdir' | 'rmdir' | 'writeFile' | 'readFile'>>;
};
export type TransactionOptions = {
    waitTimeoutMs?: number;
    writeUnchanged?: boolean;
    onRecovered?: (notice: string) => void;
    onWillWrite?: (destination: string, name: string) => void;
    onDidWrite?: (path: string, content: string, name: string) => void | Promise<void>;
    hooks?: TransactionHooks;
};
type JournalFile = { path: string; existed: boolean; original_hash: string | null;
    next_hash: string; backup: string | null };
type Journal = { version: 1; id: string; label: string; pid: number; host: string; committed?: boolean;
    created_at: string; files: JournalFile[] };
const JOURNAL_VERSION = 1;

type SharedWriteState = { chains: Map<string, Promise<void>>; unreleased: Map<string, string>;
    committed: Set<string>; yieldUntil: Map<string, number>; activeClaims: Set<string> };
const sharedSymbol = Symbol.for('akari.edit-store.write-locks');
const sharedGlobal = globalThis as typeof globalThis & { [key: symbol]: SharedWriteState | undefined };
const sharedState = sharedGlobal[sharedSymbol] ?? (sharedGlobal[sharedSymbol] = {
    chains: new Map(), unreleased: new Map(), committed: new Set(), yieldUntil: new Map(), activeClaims: new Set()
});
sharedState.yieldUntil ??= new Map();
sharedState.activeClaims ??= new Set();
const projectWriteChains = sharedState.chains;
const pause = (ms: number) => new Promise<void>(done => setTimeout(done, ms));
const absent = (error: unknown) => (error as NodeJS.ErrnoException)?.code === 'ENOENT';
const retryCodes = new Set(['EPERM', 'EBUSY', 'EACCES', 'ENOTEMPTY']);
const retryDelays = [10, 20, 40, 80, 160, 320];
const LOCK_YIELD_MS = 25;
const backgroundReleaseDelays = [5, 10, 20, 40, 80, 160, 320, 640];

async function retryFs<T>(action: () => Promise<T>): Promise<T> {
    for (let attempt = 0;; attempt++) {
        try { return await action(); }
        catch (error) {
            if (!retryCodes.has((error as NodeJS.ErrnoException).code ?? '') || attempt === retryDelays.length) throw error;
            await pause(retryDelays[attempt]);
        }
    }
}

async function renameAfterContention(source: string, target: string): Promise<void> {
    try { await renameWithRetry(source, target); }
    catch (error) {
        if (!retryCodes.has((error as NodeJS.ErrnoException).code ?? '')) throw error;
        await pause(2 + Math.floor(Math.random() * 14));
        await renameWithRetry(source, target);
    }
}

function fileOps(options: TransactionOptions): typeof fs {
    return { ...fs, ...options.hooks?.fs };
}

async function readBytes(path: string, ops: typeof fs = fs): Promise<Buffer | undefined> {
    try { return await ops.readFile(path); } catch (error) { if (absent(error)) return undefined; throw error; }
}

function safeRelative(root: string, relative: string): string {
    const target = resolve(root, relative);
    if (!relative || target === resolve(root) || !target.startsWith(resolve(root) + sep)) {
        throw new Error(`書き込み先がプロジェクトの外です: ${relative}`);
    }
    return target;
}

function normalizedWriteNames(files: Record<string, TransactionFile>): Array<[string, TransactionFile]> {
    const seen = new Set<string>();
    return Object.entries(files).map(([raw, candidate]) => {
        const name = raw.replace(/^(\.\/)+/, '');
        const segments = name.split('/');
        if (!name || raw.includes('\\') || raw.includes(':') || name.startsWith('/')
            || segments.some(part => !part || part === '.' || part === '..')
            || /^\.akari\/(?:write\.lock(?:\.wait|\.claim|\.probe-[^/]*)?|write-journal\.json|work\/journal)(?:\/|$)/i.test(name)) {
            throw new Error(`書き込み先に使えない相対パスです: ${raw}`);
        }
        const key = name.toLocaleLowerCase('en-US');
        if (seen.has(key)) throw new Error(`同じファイルを指す書き込み先が重複しています: ${raw}`);
        seen.add(key);
        return [name, candidate];
    });
}

function ownerAlive(pid: number): boolean {
    try { process.kill(pid, 0); return true; }
    catch (error) { return (error as NodeJS.ErrnoException).code !== 'ESRCH'; }
}

function queueBackgroundLockRelease(lock: string, waitMark: string, nonce: string,
    ops: typeof fs, attempt = 0): void {
    if (attempt >= backgroundReleaseDelays.length) return;
    const timer = setTimeout(() => {
        const key = resolve(dirname(dirname(lock)));
        const previous = projectWriteChains.get(key) ?? Promise.resolve();
        let finish!: () => void;
        const completion = new Promise<void>(done => { finish = done; });
        projectWriteChains.set(key, completion);
        void previous.catch(() => undefined).then(async () => {
            if (sharedState.unreleased.get(lock) !== nonce) return;
            try {
                await ops.unlink(lock);
                sharedState.unreleased.delete(lock);
                try {
                    await ops.unlink(waitMark);
                    sharedState.yieldUntil.set(key, Date.now() + LOCK_YIELD_MS);
                } catch { /* 待ち手の印が無ければ譲らない。 */ }
            } catch {
                queueBackgroundLockRelease(lock, waitMark, nonce, ops, attempt + 1);
            }
        }).finally(() => {
            if (projectWriteChains.get(key) === completion) projectWriteChains.delete(key);
            finish();
        });
    }, backgroundReleaseDelays[attempt]);
    timer.unref();
}

async function acquireProjectLock(projectRoot: string, options: TransactionOptions): Promise<() => Promise<void>> {
    const folder = join(projectRoot, '.akari');
    const lock = join(folder, 'write.lock');
    const waitMark = join(folder, 'write.lock.wait');
    const claim = join(folder, 'write.lock.claim');
    const deadline = Date.now() + (options.waitTimeoutMs ?? 31_000);
    const now = options.hooks?.now ?? Date.now;
    const host = hostname();
    const ops = fileOps(options);
    const nonce = randomUUID();
    let permissionFailures = 0;
    let permissionFailureAt = 0;
    let probeAttempts = 0;
    let probeSucceeded = false;
    let placedWaitMark = false;
    const clearOwnWaitMark = async () => {
        if (!placedWaitMark) return;
        placedWaitMark = false;
        try { await ops.unlink(waitMark); }
        catch { /* 既に消えた印は取得を妨げない。 */ }
    };
    const markWaiting = async () => {
        try {
            await ops.writeFile(waitMark, '', { flag: 'wx' });
            placedWaitMark = true;
        } catch { /* ほかの待ち手の印や一時的な失敗は待機を妨げない。 */ }
    };
    const releaseOwned = (ownedNonce: string, acquiredAt: number, reused = false): (() => Promise<void>) => async () => {
        // 長時間の処理中に lock を奪われた場合は、別の持ち主の lock を消さない。
        if (reused || now() - acquiredAt >= 30_000) {
            try {
                const current = await readBytes(lock, ops);
                if (!current || (JSON.parse(current.toString('utf8')) as { nonce?: string }).nonce !== ownedNonce) return;
            } catch { return; }
        }
        try {
            await ops.unlink(lock);
            sharedState.unreleased.delete(lock);
            try {
                await ops.unlink(waitMark);
                sharedState.yieldUntil.set(resolve(projectRoot), Date.now() + LOCK_YIELD_MS);
            } catch { /* 待ち手の印が無ければ譲らない。 */ }
            return;
        } catch {
            // 保存は成功として返し、次の自分の保存は nonce で待たずに使い直せる。
            sharedState.unreleased.set(lock, ownedNonce);
            queueBackgroundLockRelease(lock, waitMark, ownedNonce, ops);
        }
    };
    const wait = async (transient = false) => {
        if (Date.now() >= deadline) throw new Error('書き込みの待ち時間を超えました。もう一度実行してください。');
        await pause(transient ? 1 + Math.floor(Math.random() * 4) : 2 + Math.floor(Math.random() * 14));
    };
    const yieldMs = (sharedState.yieldUntil.get(resolve(projectRoot)) ?? 0) - Date.now();
    if (yieldMs > 0) await pause(yieldMs);
    try {
        const probes = (await ops.readdir(folder)).filter(name => name.startsWith('write.lock.probe-')).slice(0, 16);
        for (const name of probes) {
            const probe = join(folder, name);
            try {
                if (now() - (await ops.stat(probe)).mtimeMs > 5_000) await ops.unlink(probe);
            } catch (error) { if (!absent(error) && !retryCodes.has((error as NodeJS.ErrnoException).code ?? '')) throw error; }
        }
    } catch (error) { if (!absent(error)) throw error; }
    for (;;) {
        const acquiredAt = now();
        try {
            // 通常は排他作成だけ。親が無い初回に限ってディレクトリを作る。
            await ops.writeFile(lock, JSON.stringify({ pid: process.pid, host,
                created_at: new Date(acquiredAt).toISOString(), nonce }), { flag: 'wx' });
            sharedState.unreleased.delete(lock);
            await clearOwnWaitMark();
            return releaseOwned(nonce, acquiredAt);
        } catch (error) {
            const code = (error as NodeJS.ErrnoException).code;
            if (code === 'ENOENT') {
                permissionFailures = 0;
                await retryFs(() => ops.mkdir(folder, { recursive: true }));
                continue;
            }
            if (code !== 'EEXIST' && !retryCodes.has(code ?? '')) throw error;
            if (code !== 'EEXIST') {
                if (code === 'EPERM' || code === 'EACCES') {
                    if (permissionFailures++ === 0) permissionFailureAt = Date.now();
                    if (permissionFailures >= 5 && Date.now() - permissionFailureAt >= 50) {
                        if (!probeSucceeded && probeAttempts < 2) {
                            probeAttempts++;
                            const probe = join(folder, `write.lock.probe-${randomUUID()}`);
                            try {
                                await ops.writeFile(probe, '', { flag: 'wx' });
                            } catch (probeError) {
                                const probeCode = (probeError as NodeJS.ErrnoException).code;
                                if (probeCode === 'EPERM' || probeCode === 'EACCES') throw error;
                                throw probeError;
                            }
                            probeSucceeded = true;
                            await retryFs(() => ops.unlink(probe)).catch(() => undefined);
                        } else if (!probeSucceeded) {
                            throw error;
                        }
                        permissionFailures = 0;
                    }
                } else permissionFailures = 0;
                await wait(true);
                continue;
            }
            permissionFailures = 0;
        }
        let existing: Buffer | undefined;
        try { existing = await readBytes(lock, ops); }
        catch (error) { if (!retryCodes.has((error as NodeJS.ErrnoException).code ?? '')) throw error; }
        if (!existing) {
            await wait(true);
            continue;
        }
        if (existing) {
            let owner: { pid?: number; host?: string; created_at?: string; nonce?: string } = {};
            try { owner = JSON.parse(existing.toString('utf8')) as typeof owner; } catch { /* 壊れた lock は期限後に奪う */ }
            const created = Date.parse(owner.created_at ?? '');
            if (owner.host === host && owner.pid === process.pid && typeof owner.nonce === 'string'
                && owner.nonce === sharedState.unreleased.get(lock)) {
                sharedState.unreleased.delete(lock);
                await clearOwnWaitMark();
                return releaseOwned(owner.nonce, Number.isFinite(created) ? created : now(), true);
            }
            let age: number;
            try { age = now() - (Number.isFinite(created) ? created : (await fs.stat(lock)).mtimeMs); }
            catch (error) {
                if (!absent(error) && !retryCodes.has((error as NodeJS.ErrnoException).code ?? '')) throw error;
                await wait(true);
                continue;
            }
            const stale = age > 30_000 || typeof owner.nonce === 'string'
                && owner.nonce === sharedState.unreleased.get(lock)
                || owner.host === host && typeof owner.pid === 'number'
                && !(options.hooks?.processAlive ?? ownerAlive)(owner.pid);
            if (stale) {
                // 奪取だけ claim で直列化し、取得済みの相手の lock を消さない。
                const clearStaleClaim = async () => {
                    try {
                        const stat = await ops.stat(claim);
                        let claimant: { pid?: number; host?: string; created_at?: string } = {};
                        try {
                            const parsed: unknown = JSON.parse((await ops.readFile(join(claim, 'owner.json'))).toString('utf8'));
                            if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) claimant = parsed as typeof claimant;
                        }
                        catch { /* 識別できない claim は期限後だけ取り除く */ }
                        if (sharedState.activeClaims.has(claim)) return;
                        if (claimant.host === host && claimant.pid === process.pid) {
                            await retryFs(() => ops.rm(claim, { recursive: true, force: true }));
                            return;
                        }
                        const live = claimant.host === host && Number.isInteger(claimant.pid)
                            && (claimant.pid ?? 0) > 0 && (options.hooks?.processAlive ?? ownerAlive)(claimant.pid!);
                        const createdAt = Date.parse(claimant.created_at ?? '');
                        const age = live && Number.isFinite(createdAt) && createdAt <= now()
                            ? now() - createdAt : now() - stat.mtimeMs;
                        if (age > (live ? 30_000 : 5_000))
                            await retryFs(() => ops.rm(claim, { recursive: true, force: true }));
                    } catch (error) {
                        if (!absent(error) && !retryCodes.has((error as NodeJS.ErrnoException).code ?? '')) throw error;
                    }
                };
                let claimed = false;
                let claimOwner = '';
                let keepClaim = false;
                try {
                    await clearStaleClaim();
                    await retryFs(() => ops.mkdir(claim));
                    claimed = true;
                    sharedState.activeClaims.add(claim);
                    claimOwner = JSON.stringify({ pid: process.pid, host, created_at: new Date(now()).toISOString(), nonce });
                    await retryFs(() => ops.writeFile(join(claim, 'owner.json'), claimOwner));
                    const current = await readBytes(lock, ops);
                    const ownerBytes = await readBytes(join(claim, 'owner.json'), ops);
                    if (current?.equals(existing) && ownerBytes?.toString('utf8') === claimOwner) {
                        const retired = join(claim, `retired-${nonce}`);
                        let renameSucceeded = false;
                        try {
                            await retryFs(() => ops.rename(lock, retired));
                            renameSucceeded = true;
                        } catch (error) {
                            if (!absent(error)) throw error;
                        }
                        if (renameSucceeded) {
                            const retiredBytes = await readBytes(retired, ops);
                            if (retiredBytes?.equals(existing)) {
                                await retryFs(() => ops.unlink(retired)).catch(() => undefined);
                                sharedState.unreleased.delete(lock);
                            } else {
                                const restored = await retryFs(() => ops.link(retired, lock))
                                    .then(() => true, () => false);
                                if (!restored && !await readBytes(lock, ops)) {
                                    keepClaim = true;
                                    throw new Error('退避した lock を元の場所へ戻せませんでした。');
                                }
                                if (restored)
                                    await retryFs(() => ops.unlink(retired)).catch(() => undefined);
                            }
                        }
                    }
                } catch (error) {
                    if ((error as NodeJS.ErrnoException).code === 'EEXIST') await clearStaleClaim();
                    if ((error as NodeJS.ErrnoException).code !== 'EEXIST'
                        && !retryCodes.has((error as NodeJS.ErrnoException).code ?? '')) throw error;
                } finally { if (claimed) {
                    const ownerBytes = await readBytes(join(claim, 'owner.json'), ops).catch(() => undefined);
                    if (!keepClaim && ownerBytes?.toString('utf8') === claimOwner)
                        await retryFs(() => ops.rm(claim, { recursive: true, force: true })).catch(() => undefined);
                    sharedState.activeClaims.delete(claim);
                } }
            } else if (typeof owner.pid === 'number' && Number.isInteger(owner.pid) && owner.pid > 0
                && typeof owner.host === 'string' && owner.host.length > 0
                && typeof owner.nonce === 'string' && owner.nonce.length > 0
                && Number.isFinite(created) && age >= 0) {
                await markWaiting();
            }
        }
        await wait();
    }
}

export type RecoveryDetail = { restored: string[]; preserved: string[]; missing: string[]; broken?: true };
function recoveryNotice(detail: RecoveryDetail): string | undefined {
    if (detail.broken) return '前回の書き込み記録が壊れていたので退避しました。ファイルは変更していません。';
    if (!detail.restored.length && !detail.preserved.length && !detail.missing.length)
        return '前回の書き込みが途中で止まっていましたが、ファイルは元のままでした';
    return (detail.restored.length
        ? `前回の書き込みが途中で止まったので元に戻しました: ${detail.restored.join('、')}`
        : '前回の書き込みが途中で止まっていました')
        + (detail.preserved.length ? `。${detail.preserved.map(path => `${path} はその後に変更されていたのでそのままにしました`).join('。')}` : '')
        + (detail.missing.length ? `。${detail.missing.map(path => `${path} は退避が見つからないので戻せませんでした`).join('。')}` : '');
}

async function cleanupJournal(projectRoot: string, id: string, options: TransactionOptions,
    removeWork = true): Promise<void> {
    const ops = fileOps(options);
    const journalRoot = join(projectRoot, '.akari', 'work', 'journal');
    const backupRemoved = await retryFs(() => ops.rm(join(journalRoot, id), { recursive: true, force: true }))
        .then(() => true, () => false);
    if (!backupRemoved) return;
    await retryFs(() => ops.unlink(join(projectRoot, '.akari', 'write-journal.json'))).catch(() => undefined);
    if (!(await fs.readdir(journalRoot).catch(() => [])).length)
        await retryFs(() => ops.rmdir(journalRoot)).catch(() => undefined);
    const workRoot = join(projectRoot, '.akari', 'work');
    if (removeWork && !(await fs.readdir(workRoot).catch(() => [])).length)
        await retryFs(() => ops.rmdir(workRoot)).catch(() => undefined);
}

async function recoverJournalUnderLock(projectRoot: string, options: TransactionOptions = {}): Promise<RecoveryDetail | undefined> {
    const journalPath = join(projectRoot, '.akari', 'write-journal.json');
    const bytes = await retryFs(() => readBytes(journalPath, fileOps(options)));
    if (!bytes) return undefined;
    const journalRoot = join(projectRoot, '.akari', 'work', 'journal');
    let journal: Journal;
    try {
        journal = JSON.parse(bytes.toString('utf8')) as Journal;
        if (journal.version !== JOURNAL_VERSION || !/^[\da-f-]+$/i.test(journal.id) || !Array.isArray(journal.files)) throw new Error();
        for (const file of journal.files) {
            safeRelative(projectRoot, file.path);
            if (file.backup && !file.backup.startsWith(`.akari/work/journal/${journal.id}/`)) throw new Error();
        }
    } catch {
        await retryFs(() => fileOps(options).mkdir(journalRoot, { recursive: true })).catch(() => undefined);
        await renameWithRetry(journalPath, join(journalRoot, `broken-${randomUUID()}.json`)).catch(() => undefined);
        return { restored: [], preserved: [], missing: [], broken: true };
    }
    const restored: string[] = [];
    const preserved: string[] = [];
    const missing: string[] = [];
    // 全 rename 後の印があれば、残骸だけ消す。元のバイト列へ戻さない。
    if (journal.committed || sharedState.committed.has(`${resolve(projectRoot)}:${journal.id}`)) {
        await cleanupJournal(projectRoot, journal.id, options);
        if (!(await readBytes(journalPath))) sharedState.committed.delete(`${resolve(projectRoot)}:${journal.id}`);
        return undefined;
    }
    for (const file of journal.files) {
        // 印より前に落ちた場合だけ、現在値が今回の値と一致するファイルを戻す。
        const destination = safeRelative(projectRoot, file.path);
        const current = await readBytes(destination);
        const currentHash = current ? projectFileHash(current) : null;
        if (currentHash === file.original_hash) continue;
        if (currentHash !== file.next_hash) { preserved.push(file.path); continue; }
        if (file.existed && file.backup) {
            let backup: Buffer | undefined;
            try { backup = await retryFs(() => readBytes(safeRelative(projectRoot, file.backup!))); }
            catch { /* 退避が読めなくても、次の保存は塞がない。 */ }
            if (!backup) { missing.push(file.path); continue; }
            await writeAtomicBytes(destination, backup);
        } else await retryFs(() => fileOps(options).rm(destination, { force: true }));
        restored.push(file.path);
    }
    await cleanupJournal(projectRoot, journal.id, options);
    return { restored, preserved, missing };
}

async function writeAtomicBytes(destination: string, content: Buffer): Promise<void> {
    await retryFs(() => fs.mkdir(dirname(destination), { recursive: true }));
    const temporary = `${destination}.${process.pid}.${randomUUID()}.tmp`;
    try { await fs.writeFile(temporary, content); await renameWithRetry(temporary, destination); }
    catch (error) { await retryFs(() => fs.rm(temporary, { force: true })).catch(() => undefined); throw error; }
}

async function writeJournal(destination: string, content: string, options: TransactionOptions): Promise<void> {
    const ops = fileOps(options);
    const temporary = `${destination}.${process.pid}.${randomUUID()}.tmp`;
    try {
        await retryFs(() => ops.writeFile(temporary, content, 'utf8'));
        await renameWithRetry(temporary, destination);
    } catch (error) {
        await retryFs(() => ops.rm(temporary, { force: true })).catch(() => undefined);
        throw error;
    }
}

/** 保存の onDidWrite 通知の中から await しない。 */
export async function recoverInterruptedProjectWrite(projectRoot: string): Promise<string | undefined> {
    const detail = await recoverInterruptedProjectWriteDetailed(projectRoot);
    return detail && recoveryNotice(detail);
}

export async function recoverInterruptedProjectWriteDetailed(projectRoot: string): Promise<RecoveryDetail | undefined> {
    // journal が無ければ lock も .akari も作らず、開く処理を待たせない。
    try { await retryFs(() => fs.stat(join(projectRoot, '.akari', 'write-journal.json'))); }
    catch (error) { if (absent(error)) return undefined; throw error; }
    const key = resolve(projectRoot);
    const previous = projectWriteChains.get(key) ?? Promise.resolve();
    let finish!: () => void;
    const completion = new Promise<void>(done => { finish = done; });
    projectWriteChains.set(key, completion);
    await previous.catch(() => undefined);
    let release: (() => Promise<void>) | undefined;
    try {
        release = await acquireProjectLock(projectRoot, {});
        return await recoverJournalUnderLock(projectRoot);
    } finally {
        try { if (release) await release(); }
        finally { finish(); if (projectWriteChains.get(key) === completion) projectWriteChains.delete(key); }
    }
}

export async function writeProjectFilesTransactional(projectRoot: string,
    input: { files: Record<string, TransactionFile>; label: string }, options: TransactionOptions = {}):
    Promise<{ written: string[]; recovered?: string }> {
    const key = resolve(projectRoot);
    const previous = projectWriteChains.get(key) ?? Promise.resolve();
    let finish!: () => void;
    const completion = new Promise<void>(done => { finish = done; });
    projectWriteChains.set(key, completion);
    await previous.catch(() => undefined);
    let release: (() => Promise<void>) | undefined;
    try {
        release = await acquireProjectLock(projectRoot, options);
        const recoveredDetail = await recoverJournalUnderLock(projectRoot, options);
        const recovered = recoveredDetail && recoveryNotice(recoveredDetail);
        if (recovered) options.onRecovered?.(recovered);
        const entries = normalizedWriteNames(input.files);
        const compared = entries.some(([, candidate]) => candidate.expectedHash !== undefined);
        const originals = compared || !options.writeUnchanged
            ? await Promise.all(entries.map(async ([name]) => retryFs(() =>
                readBytes(safeRelative(projectRoot, name), fileOps(options)))))
            : entries.map(() => undefined);
        const conflicts = entries.flatMap(([name, candidate], index) => candidate.expectedHash === undefined
            || candidate.expectedHash === (originals[index] ? projectFileHash(originals[index]!) : null)
            || originals[index]?.subarray(0, 3).equals(Buffer.from([0xef, 0xbb, 0xbf]))
                && candidate.expectedHash === projectFileHash(originals[index]!.subarray(3)) ? [] : [name]);
        if (conflicts.length) throw new ConflictError(conflicts);
        const writes = entries.flatMap(([name, candidate], index) => candidate.next === null
            || !options.writeUnchanged && originals[index]?.equals(Buffer.from(candidate.next, 'utf8'))
            ? [] : [{ name, next: candidate.next!, original: originals[index] }]);
        if (!writes.length) return { written: [], ...(recovered ? { recovered } : {}) };
        if (!compared) {
            // 従来の保存は順に atomic rename する。失敗時も前のファイルを戻さない。
            for (let index = 0; index < writes.length; index++) {
                const item = writes[index];
                await writeAtomic(safeRelative(projectRoot, item.name), item.next,
                    async (source, target) => {
                        try { options.onWillWrite?.(target, item.name); } catch { /* 通知は保存を止めない。 */ }
                        if (options.hooks?.rename) await options.hooks.rename(source, target, index + 1);
                        else await renameAfterContention(source, target);
                    });
                try { await options.onDidWrite?.(safeRelative(projectRoot, item.name), item.next, item.name); }
                catch { /* rename 後の通知は保存を失敗にしない。 */ }
            }
            return { written: writes.map(item => item.name), ...(recovered ? { recovered } : {}) };
        }
        const id = randomUUID();
        const backupRoot = join(projectRoot, '.akari', 'work', 'journal', id);
        const journalPath = join(projectRoot, '.akari', 'write-journal.json');
        const workExisted = await fs.stat(join(projectRoot, '.akari', 'work')).then(() => true,
            error => { if (absent(error)) return false; throw error; });
        try {
            // 退避を先に作り、journal の rename が済んでから対象ファイルを変える。
            await retryFs(() => fileOps(options).mkdir(backupRoot, { recursive: true }));
            const files: JournalFile[] = [];
            for (let index = 0; index < writes.length; index++) {
                const item = writes[index];
                const backup = item.original ? `.akari/work/journal/${id}/${index}.bin` : null;
                if (backup) await retryFs(() => fileOps(options).writeFile(safeRelative(projectRoot, backup), item.original!));
                files.push({ path: item.name, existed: !!item.original,
                    original_hash: item.original ? projectFileHash(item.original) : null,
                    next_hash: projectFileHash(item.next), backup });
            }
            const journal: Journal = { version: 1, id, label: input.label, pid: process.pid, host: hostname(),
                created_at: new Date(options.hooks?.now?.() ?? Date.now()).toISOString(), files };
            await writeJournal(journalPath, `${JSON.stringify(journal, null, 2)}\n`, options);
        } catch (error) {
            // journal 前の失敗には復元対象がない。
            await retryFs(() => fileOps(options).rm(backupRoot, { recursive: true, force: true })).catch(() => undefined);
            throw error;
        }
        let written = 0;
        try {
            if (options.hooks?.crashAfterJournal) throw new SimulatedCrash();
            for (const item of writes) {
                await writeAtomic(safeRelative(projectRoot, item.name), item.next,
                    async (source, target) => {
                        try { options.onWillWrite?.(target, item.name); }
                        catch (error) { console.warn('[edit-store] onWillWrite の通知に失敗しました。', error); }
                        if (options.hooks?.rename) await options.hooks.rename(source, target, written + 1);
                        else await renameAfterContention(source, target);
                    });
                written++;
                try { await options.onDidWrite?.(safeRelative(projectRoot, item.name), item.next, item.name); }
                catch { /* 書けた後の通知は保存を失敗にしない。 */ }
                if (written === 1 && options.hooks?.crashAfterFirstRename) throw new SimulatedCrash();
            }
        } catch (error) {
            if (error instanceof SimulatedCrash) throw error;
            // 印の前の失敗は、既に rename したファイルだけ元のバイト列へ戻す。
            let restored = true;
            for (let index = written - 1; index >= 0; index--) {
                const item = writes[index];
                try {
                    if (item.original) await writeAtomicBytes(safeRelative(projectRoot, item.name), item.original);
                    else await retryFs(() => fileOps(options).rm(safeRelative(projectRoot, item.name), { force: true }));
                } catch { restored = false; }
            }
            if (restored) {
                await cleanupJournal(projectRoot, id, options, !workExisted);
            }
            throw error;
        }
        // 全 rename 後は成功扱い。同じプロセス内では記録で回復するが、別プロセス・再起動後は印だけが頼り。
        sharedState.committed.add(`${resolve(projectRoot)}:${id}`);
        try {
            const journalBytes = await readBytes(journalPath);
            if (journalBytes) {
                const journal = JSON.parse(journalBytes.toString('utf8')) as Journal;
                journal.committed = true;
                await writeJournal(journalPath, `${JSON.stringify(journal, null, 2)}\n`, options);
            }
        } catch { /* 片付けは次回へ持ち越す。 */ }
        await cleanupJournal(projectRoot, id, options, !workExisted);
        return { written: writes.map(item => item.name), ...(recovered ? { recovered } : {}) };
    } finally {
        try { if (release) await release(); }
        finally { finish(); if (projectWriteChains.get(key) === completion) projectWriteChains.delete(key); }
    }
}

class SimulatedCrash extends Error {}

/** atomic 保存を即時完了し、lint は末尾 debounce で非同期に実行する。 */

export async function writeProjectFilesGuarded(
    projectRoot: string,
    candidates: LintCandidates,
    options: DeferredLintOptions = {}
): Promise<void> {
    const editCandidate = candidates['edit.json'];
    if (typeof editCandidate === 'string') {
        assertNoCamelCaseTransitionOut(editCandidate);
    }
    await captureProjectLintBaseline(projectRoot);
    const files = Object.fromEntries(Object.entries(candidates)
        .map(([name, next]) => [name, { next }]));
    await writeProjectFilesTransactional(projectRoot, { files, label: 'guarded' }, {
        writeUnchanged: true,
        onRecovered: options.onRecovered ?? (notice => console.warn(notice)),
        onDidWrite: async (_destination, text, name) => {
            if (name === 'edit.json') {
                await writeSavedByStamp(projectRoot, options.appVersion ?? defaultSavedByAppVersion);
            }
            if (options.onDidWrite) {
                try { options.onDidWrite(join(projectRoot, name), text); }
                catch (error) { console.warn('[edit-store] onDidWrite の通知に失敗しました（保存は完了しています）。', error); }
            }
        }
    });
    scheduleProjectLint(projectRoot, options);
}

export async function captureProjectLintBaseline(projectRoot: string): Promise<void> {
    const lintKey = resolve(projectRoot);
    if (!pendingLintBaselines.has(lintKey)) {
        pendingLintBaselines.set(lintKey, lastLintFindings.get(lintKey) ?? await readPersistedLintFindings(projectRoot));
    }
}

/** Web UI 旧版が生成した camelCase は schema が閉じていない legacy edit でも保存させない。 */
export function assertNoCamelCaseTransitionOut(content: string): void {
    let parsed: unknown;
    try {
        parsed = JSON.parse(content);
    } catch {
        // JSON 自体の診断は既存の保存後 lint に任せる。
        return;
    }
    const visit = (value: unknown): boolean => {
        if (!value || typeof value !== 'object') return false;
        if (Object.prototype.hasOwnProperty.call(value, 'transitionOut')) return true;
        return Object.values(value as Record<string, unknown>).some(visit);
    };
    if (visit(parsed)) {
        throw new Error(
            'transitionOut は Web UI 旧版が書いた綴りです。正しい transition_out へ直すか、'
            + 'Web UI で開き直して保存してください。'
        );
    }
}

/**
 * 同じプロジェクト宛ての連続保存をまとめ、最後の状態だけを lint する。
 * 保存後 lint は実 projectRoot に対して writeReports=true で走るため、結果は
 * `.akari/lint.json` と `.akari/reports/edit-lint-report.html` へ書かれる。
 * これは render-cut が読む PASS ゲートを常に最新に保つ、意図した保存後 lint の副作用。
 */
export function scheduleProjectLint(projectRoot: string, options: DeferredLintOptions = {}): void {
    const key = resolve(projectRoot);
    const revision = (lintRevisions.get(key) ?? 0) + 1;
    lintRevisions.set(key, revision);
    const previous = lintTimers.get(key);
    if (previous) {
        clearTimeout(previous);
    }
    const timer = setTimeout(() => {
        lintTimers.delete(key);
        const baseline = pendingLintBaselines.get(key);
        pendingLintBaselines.delete(key);
        const previousRun = lintRunChains.get(key) ?? Promise.resolve({ pass: true, errors: [], findings: [] });
        const currentRun = previousRun
            .catch(() => ({ pass: true, errors: [], findings: [] }))
            .then(() => (options.lintRunner ?? runEditLint)(key))
            .then(result => {
                if (!result.findings.some(finding => finding.check === 'edit-lint.execution')) {
                    lastLintFindings.set(key, result.findings);
                }
                return markPreexistingLintFindings(result, baseline);
            });
        lintRunChains.set(key, currentRun);
        void currentRun.then(
            result => lintRevisions.get(key) === revision ? options.onLintResult?.(result) : undefined,
            error => {
                console.warn('[edit-store] 保存後 edit-lint の実行に失敗しました（保存は維持します）。', error);
            }
        ).finally(() => {
            if (lintRunChains.get(key) === currentRun) {
                lintRunChains.delete(key);
            }
        });
    }, options.debounceMs ?? DEFAULT_LINT_DEBOUNCE_MS);
    lintTimers.set(key, timer);
}

/**
 * 保存前の lint にも有った指摘へ preexisting を付ける。字幕の挿入で配列の番号がずれても
 * 同じ指摘と分かるよう、時刻範囲を持つ指摘は path の番号ではなく範囲で照合する。
 * 基準が無い（初回・lint.json 不在）ときは従来どおり全部を今回の保存の指摘として返す。
 */
export function markPreexistingLintFindings(
    result: EditLintGateResult,
    baseline: readonly EditLintFinding[] | undefined
): EditLintGateResult {
    if (!baseline?.length) return result;
    const remaining = new Map<string, number>();
    for (const finding of baseline) {
        const key = lintFindingIdentity(finding);
        remaining.set(key, (remaining.get(key) ?? 0) + 1);
    }
    const findings = result.findings.map(finding => {
        const key = lintFindingIdentity(finding);
        const count = remaining.get(key) ?? 0;
        if (count === 0) return finding;
        remaining.set(key, count - 1);
        return { ...finding, preexisting: true };
    });
    return { ...result, findings };
}

function lintFindingIdentity(finding: EditLintFinding): string {
    const file = finding.path?.split('#', 1)[0] ?? '';
    const range = finding.range;
    const where = range && Number.isFinite(range.start) && Number.isFinite(range.end)
        ? `${file}@${range.start}-${range.end}` : finding.path ?? '';
    return JSON.stringify([finding.severity ?? '', finding.check ?? '', finding.message ?? '', where]);
}

async function readPersistedLintFindings(projectRoot: string): Promise<EditLintFinding[] | undefined> {
    try {
        const parsed = JSON.parse(await fs.readFile(join(projectRoot, '.akari', 'lint.json'), 'utf8')) as { findings?: unknown };
        return Array.isArray(parsed.findings) ? parsed.findings as EditLintFinding[] : undefined;
    } catch {
        return undefined;
    }
}

// 同じ宛先への書き込みは 1 本ずつ直列化する。
// 一時ファイル名が PID だけだった頃は、同一プロセス内で書き込みが 2 本重なると同じ
// 一時ファイルを奪い合い、短い方が truncate した後に長い方の書き込みがその先へ着地して
// 「完結した JSON + 前版の残骸」という壊れ方をした（実機 2026-08-07: edit.json が
// 多バイト文字の途中で切れた不正バイトを含む状態で破損。1ms 差の 2 連続 PUT が原因）。
// 一時ファイル名を毎回一意にして衝突自体を無くし、さらに直列化で後勝ちの順序も確定させる。
const writeChains = new Map<string, Promise<void>>();
let writeSequence = 0;

export async function writeAtomic(destination: string, content: string,
    rename: (source: string, target: string) => Promise<void> = renameWithRetry): Promise<void> {
    const previous = writeChains.get(destination) ?? Promise.resolve();
    const next = previous
        .catch(() => undefined)
        .then(async () => {
            await fs.mkdir(dirname(destination), { recursive: true });
            const temporary = `${destination}.${process.pid}.${++writeSequence}.tmp`;
            try {
                await fs.writeFile(temporary, content, 'utf8');
                await rename(temporary, destination);
            } catch (error) {
                await fs.rm(temporary, { force: true }).catch(() => undefined);
                throw error;
            }
        });
    writeChains.set(destination, next.catch(() => undefined));
    return next;
}

/**
 * edit-lint をプロセス内実行する。inputOverrides は候補全文のメモリ差し替え。
 * writeReports=false は保存前候補検査用で実プロジェクトへレポートを書かない。
 * 既定の true は保存後 lint 用で、projectRoot の `.akari/lint.json` と HTML レポートを更新する。
 */
export async function runEditLint(
    projectRoot: string,
    inputOverrides?: LintCandidates,
    writeReports = true
): Promise<EditLintGateResult> {
    let modulePath: string;
    try {
        modulePath = findEditLintModulePath();
    } catch (error) {
        warnEditLintUnavailableOnce(error);
        return { pass: true, errors: [], findings: [] };
    }
    try {
        const lintModule = await dynamicImport(pathToFileURL(modulePath).href);
        const parsed = await lintModule.lintProject(projectRoot, { inputOverrides, writeReports });
        const findings = Array.isArray(parsed.findings) ? parsed.findings : [];
        const errorFindings = findings.filter(finding => finding.severity === 'error');
        return {
            pass: parsed.verdict === 'pass' && errorFindings.length === 0,
            errors: errorFindings.map(
                finding => `[${finding.check ?? 'edit-lint'}] ${finding.message ?? '不明なエラー'}`
            ),
            findings
        };
    } catch (error) {
        return {
            pass: false,
            errors: [`edit-lint を実行できませんでした: ${error instanceof Error ? error.message : String(error)}`],
            findings: [{
                severity: 'error',
                check: 'edit-lint.execution',
                message: error instanceof Error ? error.message : String(error)
            }]
        };
    }
}

export function findEditLintModulePath(): string {
    const binPath = findEditLintBinPath();
    const modulePath = resolve(dirname(binPath), '../src/edit-lint.mjs');
    if (isFile(modulePath)) {
        return modulePath;
    }
    throw new Error(`edit-lint module was not found next to ${binPath}`);
}

/** 既存の複数候補探索を維持する。 */
export function findEditLintBinPath(): string {
    const candidates: string[] = [];
    const packagedCandidate = resolve(__dirname, '../edit-lint/bin/edit-lint.mjs');
    candidates.push(packagedCandidate);
    if (isFile(packagedCandidate)) {
        return packagedCandidate;
    }

    let ancestor = resolve(__dirname);
    for (let depth = 0; depth < 10; depth++) {
        const candidate = resolve(ancestor, 'packages/edit-lint/bin/edit-lint.mjs');
        candidates.push(candidate);
        if (isFile(candidate)) {
            return candidate;
        }
        const parent = dirname(ancestor);
        if (parent === ancestor) {
            break;
        }
        ancestor = parent;
    }

    const cwdCandidates = [
        resolve(process.cwd(), '../../packages/edit-lint/bin/edit-lint.mjs'),
        resolve(process.cwd(), 'packages/edit-lint/bin/edit-lint.mjs'),
        resolve(process.cwd(), '../packages/edit-lint/bin/edit-lint.mjs')
    ];
    for (const candidate of cwdCandidates) {
        if (candidates.includes(candidate)) {
            continue;
        }
        candidates.push(candidate);
        if (isFile(candidate)) {
            return candidate;
        }
    }
    throw new Error(`edit-lint bin was not found (tried: ${candidates.join(', ')})`);
}

let editLintUnavailableWarned = false;

function warnEditLintUnavailableOnce(error: unknown): void {
    if (editLintUnavailableWarned) {
        return;
    }
    editLintUnavailableWarned = true;
    console.warn(
        '[edit-store] edit-lint が見つからないため、検証なしで保存しています。',
        error instanceof Error ? error.message : error
    );
}

function isFile(candidate: string): boolean {
    try {
        return statSync(candidate).isFile();
    } catch {
        return false;
    }
}
