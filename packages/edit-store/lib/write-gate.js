"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.ConflictError = exports.SAVED_BY_PATH = void 0;
exports.lintProjectCandidates = lintProjectCandidates;
exports.lintProjectCandidatesOnDisk = lintProjectCandidatesOnDisk;
exports.assertLintPasses = assertLintPasses;
exports.setDefaultSavedByAppVersion = setDefaultSavedByAppVersion;
exports.writeSavedByStamp = writeSavedByStamp;
exports.projectFileHash = projectFileHash;
exports.recoverInterruptedProjectWrite = recoverInterruptedProjectWrite;
exports.recoverInterruptedProjectWriteDetailed = recoverInterruptedProjectWriteDetailed;
exports.writeProjectFilesTransactional = writeProjectFilesTransactional;
exports.writeProjectFilesGuarded = writeProjectFilesGuarded;
exports.captureProjectLintBaseline = captureProjectLintBaseline;
exports.assertNoCamelCaseTransitionOut = assertNoCamelCaseTransitionOut;
exports.scheduleProjectLint = scheduleProjectLint;
exports.markPreexistingLintFindings = markPreexistingLintFindings;
exports.writeAtomic = writeAtomic;
exports.runEditLint = runEditLint;
exports.findEditLintModulePath = findEditLintModulePath;
exports.findEditLintBinPath = findEditLintBinPath;
const fs_1 = require("fs");
const path_1 = require("path");
const url_1 = require("url");
const os_1 = require("os");
const os_2 = require("os");
const crypto_1 = require("crypto");
const history_store_1 = require("./history-store");
// index.ts の SAVED_BY_PATH と同値に保つ（Node 専用入口は index を import しない）。
exports.SAVED_BY_PATH = '.akari/saved-by.json';
const SAVED_BY_SCHEMA_VERSION = 1;
const APP_VERSION_PATTERN = /^\d+\.\d+\.\d+(?:[-+][\w.-]+)?$/;
function isValidSavedByAppVersion(version) {
    return typeof version === 'string' && APP_VERSION_PATTERN.test(version);
}
function serializeSavedByStamp(appVersion, savedAt = new Date().toISOString()) {
    return `${JSON.stringify({ version: SAVED_BY_SCHEMA_VERSION, app: 'akari-video', appVersion, savedAt }, null, 2)}\n`;
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
    constructor(entryPath, cause) {
        super(`影プロジェクトへ ${entryPath} をリンクできませんでした（${cause.code ?? cause.message}）`);
        this.name = 'ShadowLinkUnavailable';
    }
}
function isLinkUnsupported(error) {
    const code = error?.code;
    return typeof code === 'string' && LINK_UNSUPPORTED_CODES.has(code);
}
const DEFAULT_LINT_DEBOUNCE_MS = 400;
const lintTimers = new Map();
const lintRevisions = new Map();
const lintRunChains = new Map();
/** プロジェクトごとの直近の保存後 lint の指摘。次の保存の「保存前から有った指摘」の基準にする。 */
const lastLintFindings = new Map();
/** debounce 窓の最初の書き込みの直前に取った基準。窓の lint が走るときに消費する。 */
const pendingLintBaselines = new Map();
const dynamicImport = new Function('specifier', 'return import(specifier)');
/**
 * 実ファイルは変更せず、候補全文だけを options.inputOverrides で差し替えて検証する。
 * 既存 export のシグネチャは維持し、preview-server の保存前検査にも使える。
 */
async function lintProjectCandidates(projectRoot, candidates) {
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
async function lintProjectCandidatesOnDisk(projectRoot, candidates, hooks = {}) {
    const shadowRoot = await fs_1.promises.mkdtemp((0, path_1.join)((0, os_1.tmpdir)(), 'akari-edit-store-lint-'));
    try {
        for (const entry of await fs_1.promises.readdir(projectRoot, { withFileTypes: true })) {
            await materializeShadowEntry((0, path_1.resolve)(projectRoot, entry.name), (0, path_1.join)(shadowRoot, entry.name), entry.isDirectory(), entry.name, hooks);
        }
        for (const [relativePath, text] of Object.entries(candidates)) {
            const segments = candidateSegments(relativePath);
            const destination = (0, path_1.join)(shadowRoot, ...segments);
            await materializeShadowDirectory(shadowRoot, (0, path_1.dirname)(destination), hooks);
            await fs_1.promises.rm(destination, { recursive: true, force: true });
            if (text !== null)
                await fs_1.promises.writeFile(destination, text, 'utf8');
        }
        return await runEditLint(shadowRoot, undefined, false);
    }
    catch (error) {
        if (!(error instanceof ShadowLinkUnavailable))
            throw error;
        warnShadowUnavailableOnce(error);
        hooks.onShadowUnavailable?.(error.message);
        return await lintProjectCandidates(projectRoot, candidates);
    }
    finally {
        await fs_1.promises.rm(shadowRoot, { recursive: true, force: true });
    }
}
/**
 * 影プロジェクトへ 1 エントリを写す。まず従来どおり symlink / junction を試し、
 * OS がリンク作成を拒んだときだけファイルコピーへ倒す（権限のある環境の挙動は変えない）。
 */
async function materializeShadowEntry(source, destination, preferDirectory, label, hooks) {
    const symlink = hooks.symlink
        ?? ((target, path, type) => fs_1.promises.symlink(target, path, type));
    try {
        await symlink(source, destination, preferDirectory ? 'junction' : 'file');
        hooks.onShadowEntry?.(label, 'symlink');
        return;
    }
    catch (error) {
        if (!isLinkUnsupported(error))
            throw error;
        if (preferDirectory)
            throw new ShadowLinkUnavailable(source, error);
        // symlink エントリはリンク先を辿って種別を決める（リンクの実体がディレクトリなら
        // コピーしない）。辿れない壊れたリンクは lint も読めないので影へは作らない。
        const stats = await fs_1.promises.stat(source).catch(() => null);
        if (stats === null) {
            hooks.onShadowEntry?.(label, 'skip');
            return;
        }
        if (stats.isDirectory())
            throw new ShadowLinkUnavailable(source, error);
        await fs_1.promises.copyFile(source, destination);
        hooks.onShadowEntry?.(label, 'copy');
    }
}
let shadowUnavailableWarned = false;
function warnShadowUnavailableOnce(error) {
    if (shadowUnavailableWarned) {
        return;
    }
    shadowUnavailableWarned = true;
    console.warn('[edit-store] 影プロジェクトを作れないため、実ディスクを読む lint check を省いて'
        + '候補のメモリ検証だけで保存しています。', error.message);
}
function candidateSegments(relativePath) {
    const segments = relativePath.split('/');
    if (relativePath.length === 0 || relativePath.startsWith('/') || relativePath.includes('\\')
        || segments.some(segment => segment.length === 0 || segment === '.' || segment === '..')) {
        throw new Error(`候補パスはプロジェクト相対の安全な / 区切りで指定してください: ${relativePath}`);
    }
    return segments;
}
async function materializeShadowDirectory(shadowRoot, directory, hooks) {
    if (directory === shadowRoot)
        return;
    await materializeShadowDirectory(shadowRoot, (0, path_1.dirname)(directory), hooks);
    try {
        const stat = await fs_1.promises.lstat(directory);
        if (!stat.isSymbolicLink()) {
            if (!stat.isDirectory())
                throw new Error(`候補の親パスがディレクトリではありません: ${directory}`);
            return;
        }
        const source = await fs_1.promises.realpath(directory);
        await fs_1.promises.unlink(directory);
        await fs_1.promises.mkdir(directory);
        for (const entry of await fs_1.promises.readdir(source, { withFileTypes: true })) {
            await materializeShadowEntry((0, path_1.resolve)(source, entry.name), (0, path_1.join)(directory, entry.name), entry.isDirectory(), entry.name, hooks);
        }
    }
    catch (error) {
        if (error.code !== 'ENOENT')
            throw error;
        await fs_1.promises.mkdir(directory);
    }
}
/** 互換 API。保存後 lint への移行後も、明示的に検証したい呼び出し側向けに残す。 */
async function assertLintPasses(projectRoot, candidates) {
    const result = await lintProjectCandidates(projectRoot, candidates);
    if (!result.pass) {
        throw new Error(result.errors[0] ?? 'edit-lint が変更を拒否しました');
    }
}
let defaultSavedByAppVersion;
/** CLI / preview-server 等のプロセス内で書き手の版を 1 回だけ設定する。 */
function setDefaultSavedByAppVersion(version) {
    defaultSavedByAppVersion = isValidSavedByAppVersion(version) ? version : undefined;
}
/** CLI の既存 edit.json 保存直後に、スタンプだけを atomic に更新する。 */
async function writeSavedByStamp(projectRoot, appVersion) {
    const destination = (0, path_1.join)(projectRoot, exports.SAVED_BY_PATH);
    try {
        if (isValidSavedByAppVersion(appVersion)) {
            await writeAtomic(destination, serializeSavedByStamp(appVersion));
        }
        else {
            // 版不明の書き手は、以前の書き手の版を主張できない。
            await fs_1.promises.rm(destination, { force: true });
        }
    }
    catch (error) {
        if (!(0, history_store_1.renameRetryWarningLogged)(error)) {
            const code = error?.code;
            console.warn(`[edit-store] saved-by.json の更新に失敗しました（保存は完了しています）。${code ? ` ${code}` : ''}`);
        }
    }
}
function projectFileHash(bytes) {
    return `sha256:${(0, crypto_1.createHash)('sha256').update(bytes).digest('hex')}`;
}
class ConflictError extends Error {
    constructor(files) {
        super(`ほかの変更があったので書きませんでした。もう一度実行してください: ${files.join('、')}`);
        this.code = 'AKARI_WRITE_CONFLICT';
        this.name = 'ConflictError';
        this.files = files;
    }
}
exports.ConflictError = ConflictError;
const JOURNAL_VERSION = 1;
const sharedSymbol = Symbol.for('akari.edit-store.write-locks');
const sharedGlobal = globalThis;
const sharedState = sharedGlobal[sharedSymbol] ?? (sharedGlobal[sharedSymbol] = {
    chains: new Map(), unreleased: new Map(), committed: new Set(), yieldUntil: new Map(), activeClaims: new Set()
});
sharedState.yieldUntil ??= new Map();
sharedState.activeClaims ??= new Set();
const projectWriteChains = sharedState.chains;
const pause = (ms) => new Promise(done => setTimeout(done, ms));
const absent = (error) => error?.code === 'ENOENT';
const retryCodes = new Set(['EPERM', 'EBUSY', 'EACCES', 'ENOTEMPTY']);
const retryDelays = [10, 20, 40, 80, 160, 320];
const LOCK_YIELD_MS = 25;
const backgroundReleaseDelays = [5, 10, 20, 40, 80, 160, 320, 640];
async function retryFs(action) {
    for (let attempt = 0;; attempt++) {
        try {
            return await action();
        }
        catch (error) {
            if (!retryCodes.has(error.code ?? '') || attempt === retryDelays.length)
                throw error;
            await pause(retryDelays[attempt]);
        }
    }
}
async function renameAfterContention(source, target) {
    try {
        await (0, history_store_1.renameWithRetry)(source, target);
    }
    catch (error) {
        if (!retryCodes.has(error.code ?? ''))
            throw error;
        await pause(2 + Math.floor(Math.random() * 14));
        await (0, history_store_1.renameWithRetry)(source, target);
    }
}
function fileOps(options) {
    return { ...fs_1.promises, ...options.hooks?.fs };
}
async function readBytes(path, ops = fs_1.promises) {
    try {
        return await ops.readFile(path);
    }
    catch (error) {
        if (absent(error))
            return undefined;
        throw error;
    }
}
function safeRelative(root, relative) {
    const target = (0, path_1.resolve)(root, relative);
    if (!relative || target === (0, path_1.resolve)(root) || !target.startsWith((0, path_1.resolve)(root) + path_1.sep)) {
        throw new Error(`書き込み先がプロジェクトの外です: ${relative}`);
    }
    return target;
}
function normalizedWriteNames(files) {
    const seen = new Set();
    return Object.entries(files).map(([raw, candidate]) => {
        const name = raw.replace(/^(\.\/)+/, '');
        const segments = name.split('/');
        if (!name || raw.includes('\\') || raw.includes(':') || name.startsWith('/')
            || segments.some(part => !part || part === '.' || part === '..')
            || /^\.akari\/(?:write\.lock(?:\.wait|\.claim|\.probe-[^/]*)?|write-journal\.json|work\/journal)(?:\/|$)/i.test(name)) {
            throw new Error(`書き込み先に使えない相対パスです: ${raw}`);
        }
        const key = name.toLocaleLowerCase('en-US');
        if (seen.has(key))
            throw new Error(`同じファイルを指す書き込み先が重複しています: ${raw}`);
        seen.add(key);
        return [name, candidate];
    });
}
function ownerAlive(pid) {
    try {
        process.kill(pid, 0);
        return true;
    }
    catch (error) {
        return error.code !== 'ESRCH';
    }
}
function queueBackgroundLockRelease(lock, waitMark, nonce, ops, attempt = 0) {
    if (attempt >= backgroundReleaseDelays.length)
        return;
    const timer = setTimeout(() => {
        const key = (0, path_1.resolve)((0, path_1.dirname)((0, path_1.dirname)(lock)));
        const previous = projectWriteChains.get(key) ?? Promise.resolve();
        let finish;
        const completion = new Promise(done => { finish = done; });
        projectWriteChains.set(key, completion);
        void previous.catch(() => undefined).then(async () => {
            if (sharedState.unreleased.get(lock) !== nonce)
                return;
            try {
                await ops.unlink(lock);
                sharedState.unreleased.delete(lock);
                try {
                    await ops.unlink(waitMark);
                    sharedState.yieldUntil.set(key, Date.now() + LOCK_YIELD_MS);
                }
                catch { /* 待ち手の印が無ければ譲らない。 */ }
            }
            catch {
                queueBackgroundLockRelease(lock, waitMark, nonce, ops, attempt + 1);
            }
        }).finally(() => {
            if (projectWriteChains.get(key) === completion)
                projectWriteChains.delete(key);
            finish();
        });
    }, backgroundReleaseDelays[attempt]);
    timer.unref();
}
async function acquireProjectLock(projectRoot, options) {
    const folder = (0, path_1.join)(projectRoot, '.akari');
    const lock = (0, path_1.join)(folder, 'write.lock');
    const waitMark = (0, path_1.join)(folder, 'write.lock.wait');
    const claim = (0, path_1.join)(folder, 'write.lock.claim');
    const deadline = Date.now() + (options.waitTimeoutMs ?? 31_000);
    const now = options.hooks?.now ?? Date.now;
    const host = (0, os_2.hostname)();
    const ops = fileOps(options);
    const nonce = (0, crypto_1.randomUUID)();
    let permissionFailures = 0;
    let permissionFailureAt = 0;
    let probeAttempts = 0;
    let probeSucceeded = false;
    let placedWaitMark = false;
    const clearOwnWaitMark = async () => {
        if (!placedWaitMark)
            return;
        placedWaitMark = false;
        try {
            await ops.unlink(waitMark);
        }
        catch { /* 既に消えた印は取得を妨げない。 */ }
    };
    const markWaiting = async () => {
        try {
            await ops.writeFile(waitMark, '', { flag: 'wx' });
            placedWaitMark = true;
        }
        catch { /* ほかの待ち手の印や一時的な失敗は待機を妨げない。 */ }
    };
    const releaseOwned = (ownedNonce, acquiredAt, reused = false) => async () => {
        // 長時間の処理中に lock を奪われた場合は、別の持ち主の lock を消さない。
        if (reused || now() - acquiredAt >= 30_000) {
            try {
                const current = await readBytes(lock, ops);
                if (!current || JSON.parse(current.toString('utf8')).nonce !== ownedNonce)
                    return;
            }
            catch {
                return;
            }
        }
        try {
            await ops.unlink(lock);
            sharedState.unreleased.delete(lock);
            try {
                await ops.unlink(waitMark);
                sharedState.yieldUntil.set((0, path_1.resolve)(projectRoot), Date.now() + LOCK_YIELD_MS);
            }
            catch { /* 待ち手の印が無ければ譲らない。 */ }
            return;
        }
        catch {
            // 保存は成功として返し、次の自分の保存は nonce で待たずに使い直せる。
            sharedState.unreleased.set(lock, ownedNonce);
            queueBackgroundLockRelease(lock, waitMark, ownedNonce, ops);
        }
    };
    const wait = async (transient = false) => {
        if (Date.now() >= deadline)
            throw new Error('書き込みの待ち時間を超えました。もう一度実行してください。');
        await pause(transient ? 1 + Math.floor(Math.random() * 4) : 2 + Math.floor(Math.random() * 14));
    };
    const yieldMs = (sharedState.yieldUntil.get((0, path_1.resolve)(projectRoot)) ?? 0) - Date.now();
    if (yieldMs > 0)
        await pause(yieldMs);
    try {
        const probes = (await ops.readdir(folder)).filter(name => name.startsWith('write.lock.probe-')).slice(0, 16);
        for (const name of probes) {
            const probe = (0, path_1.join)(folder, name);
            try {
                if (now() - (await ops.stat(probe)).mtimeMs > 5_000)
                    await ops.unlink(probe);
            }
            catch (error) {
                if (!absent(error) && !retryCodes.has(error.code ?? ''))
                    throw error;
            }
        }
    }
    catch (error) {
        if (!absent(error))
            throw error;
    }
    for (;;) {
        const acquiredAt = now();
        try {
            // 通常は排他作成だけ。親が無い初回に限ってディレクトリを作る。
            await ops.writeFile(lock, JSON.stringify({ pid: process.pid, host,
                created_at: new Date(acquiredAt).toISOString(), nonce }), { flag: 'wx' });
            sharedState.unreleased.delete(lock);
            await clearOwnWaitMark();
            return releaseOwned(nonce, acquiredAt);
        }
        catch (error) {
            const code = error.code;
            if (code === 'ENOENT') {
                permissionFailures = 0;
                await retryFs(() => ops.mkdir(folder, { recursive: true }));
                continue;
            }
            if (code !== 'EEXIST' && !retryCodes.has(code ?? ''))
                throw error;
            if (code !== 'EEXIST') {
                if (code === 'EPERM' || code === 'EACCES') {
                    if (permissionFailures++ === 0)
                        permissionFailureAt = Date.now();
                    if (permissionFailures >= 5 && Date.now() - permissionFailureAt >= 50) {
                        if (!probeSucceeded && probeAttempts < 2) {
                            probeAttempts++;
                            const probe = (0, path_1.join)(folder, `write.lock.probe-${(0, crypto_1.randomUUID)()}`);
                            try {
                                await ops.writeFile(probe, '', { flag: 'wx' });
                            }
                            catch (probeError) {
                                const probeCode = probeError.code;
                                if (probeCode === 'EPERM' || probeCode === 'EACCES')
                                    throw error;
                                throw probeError;
                            }
                            probeSucceeded = true;
                            await retryFs(() => ops.unlink(probe)).catch(() => undefined);
                        }
                        else if (!probeSucceeded) {
                            throw error;
                        }
                        permissionFailures = 0;
                    }
                }
                else
                    permissionFailures = 0;
                await wait(true);
                continue;
            }
            permissionFailures = 0;
        }
        let existing;
        try {
            existing = await readBytes(lock, ops);
        }
        catch (error) {
            if (!retryCodes.has(error.code ?? ''))
                throw error;
        }
        if (!existing) {
            await wait(true);
            continue;
        }
        if (existing) {
            let owner = {};
            try {
                owner = JSON.parse(existing.toString('utf8'));
            }
            catch { /* 壊れた lock は期限後に奪う */ }
            const created = Date.parse(owner.created_at ?? '');
            if (owner.host === host && owner.pid === process.pid && typeof owner.nonce === 'string'
                && owner.nonce === sharedState.unreleased.get(lock)) {
                sharedState.unreleased.delete(lock);
                await clearOwnWaitMark();
                return releaseOwned(owner.nonce, Number.isFinite(created) ? created : now(), true);
            }
            let age;
            try {
                age = now() - (Number.isFinite(created) ? created : (await fs_1.promises.stat(lock)).mtimeMs);
            }
            catch (error) {
                if (!absent(error) && !retryCodes.has(error.code ?? ''))
                    throw error;
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
                        let claimant = {};
                        try {
                            const parsed = JSON.parse((await ops.readFile((0, path_1.join)(claim, 'owner.json'))).toString('utf8'));
                            if (parsed && typeof parsed === 'object' && !Array.isArray(parsed))
                                claimant = parsed;
                        }
                        catch { /* 識別できない claim は期限後だけ取り除く */ }
                        if (sharedState.activeClaims.has(claim))
                            return;
                        if (claimant.host === host && claimant.pid === process.pid) {
                            await retryFs(() => ops.rm(claim, { recursive: true, force: true }));
                            return;
                        }
                        const live = claimant.host === host && Number.isInteger(claimant.pid)
                            && (claimant.pid ?? 0) > 0 && (options.hooks?.processAlive ?? ownerAlive)(claimant.pid);
                        const createdAt = Date.parse(claimant.created_at ?? '');
                        const age = live && Number.isFinite(createdAt) && createdAt <= now()
                            ? now() - createdAt : now() - stat.mtimeMs;
                        if (age > (live ? 30_000 : 5_000))
                            await retryFs(() => ops.rm(claim, { recursive: true, force: true }));
                    }
                    catch (error) {
                        if (!absent(error) && !retryCodes.has(error.code ?? ''))
                            throw error;
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
                    await retryFs(() => ops.writeFile((0, path_1.join)(claim, 'owner.json'), claimOwner));
                    const current = await readBytes(lock, ops);
                    const ownerBytes = await readBytes((0, path_1.join)(claim, 'owner.json'), ops);
                    if (current?.equals(existing) && ownerBytes?.toString('utf8') === claimOwner) {
                        const retired = (0, path_1.join)(claim, `retired-${nonce}`);
                        let renameSucceeded = false;
                        try {
                            await retryFs(() => ops.rename(lock, retired));
                            renameSucceeded = true;
                        }
                        catch (error) {
                            if (!absent(error))
                                throw error;
                        }
                        if (renameSucceeded) {
                            const retiredBytes = await readBytes(retired, ops);
                            if (retiredBytes?.equals(existing)) {
                                await retryFs(() => ops.unlink(retired)).catch(() => undefined);
                                sharedState.unreleased.delete(lock);
                            }
                            else {
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
                }
                catch (error) {
                    if (error.code === 'EEXIST')
                        await clearStaleClaim();
                    if (error.code !== 'EEXIST'
                        && !retryCodes.has(error.code ?? ''))
                        throw error;
                }
                finally {
                    if (claimed) {
                        const ownerBytes = await readBytes((0, path_1.join)(claim, 'owner.json'), ops).catch(() => undefined);
                        if (!keepClaim && ownerBytes?.toString('utf8') === claimOwner)
                            await retryFs(() => ops.rm(claim, { recursive: true, force: true })).catch(() => undefined);
                        sharedState.activeClaims.delete(claim);
                    }
                }
            }
            else if (typeof owner.pid === 'number' && Number.isInteger(owner.pid) && owner.pid > 0
                && typeof owner.host === 'string' && owner.host.length > 0
                && typeof owner.nonce === 'string' && owner.nonce.length > 0
                && Number.isFinite(created) && age >= 0) {
                await markWaiting();
            }
        }
        await wait();
    }
}
function recoveryNotice(detail) {
    if (detail.broken)
        return '前回の書き込み記録が壊れていたので退避しました。ファイルは変更していません。';
    if (!detail.restored.length && !detail.preserved.length && !detail.missing.length)
        return '前回の書き込みが途中で止まっていましたが、ファイルは元のままでした';
    return (detail.restored.length
        ? `前回の書き込みが途中で止まったので元に戻しました: ${detail.restored.join('、')}`
        : '前回の書き込みが途中で止まっていました')
        + (detail.preserved.length ? `。${detail.preserved.map(path => `${path} はその後に変更されていたのでそのままにしました`).join('。')}` : '')
        + (detail.missing.length ? `。${detail.missing.map(path => `${path} は退避が見つからないので戻せませんでした`).join('。')}` : '');
}
async function cleanupJournal(projectRoot, id, options, removeWork = true) {
    const ops = fileOps(options);
    const journalRoot = (0, path_1.join)(projectRoot, '.akari', 'work', 'journal');
    const backupRemoved = await retryFs(() => ops.rm((0, path_1.join)(journalRoot, id), { recursive: true, force: true }))
        .then(() => true, () => false);
    if (!backupRemoved)
        return;
    await retryFs(() => ops.unlink((0, path_1.join)(projectRoot, '.akari', 'write-journal.json'))).catch(() => undefined);
    if (!(await fs_1.promises.readdir(journalRoot).catch(() => [])).length)
        await retryFs(() => ops.rmdir(journalRoot)).catch(() => undefined);
    const workRoot = (0, path_1.join)(projectRoot, '.akari', 'work');
    if (removeWork && !(await fs_1.promises.readdir(workRoot).catch(() => [])).length)
        await retryFs(() => ops.rmdir(workRoot)).catch(() => undefined);
}
async function recoverJournalUnderLock(projectRoot, options = {}) {
    const journalPath = (0, path_1.join)(projectRoot, '.akari', 'write-journal.json');
    const bytes = await retryFs(() => readBytes(journalPath, fileOps(options)));
    if (!bytes)
        return undefined;
    const journalRoot = (0, path_1.join)(projectRoot, '.akari', 'work', 'journal');
    let journal;
    try {
        journal = JSON.parse(bytes.toString('utf8'));
        if (journal.version !== JOURNAL_VERSION || !/^[\da-f-]+$/i.test(journal.id) || !Array.isArray(journal.files))
            throw new Error();
        for (const file of journal.files) {
            safeRelative(projectRoot, file.path);
            if (file.backup && !file.backup.startsWith(`.akari/work/journal/${journal.id}/`))
                throw new Error();
        }
    }
    catch {
        await retryFs(() => fileOps(options).mkdir(journalRoot, { recursive: true })).catch(() => undefined);
        await (0, history_store_1.renameWithRetry)(journalPath, (0, path_1.join)(journalRoot, `broken-${(0, crypto_1.randomUUID)()}.json`)).catch(() => undefined);
        return { restored: [], preserved: [], missing: [], broken: true };
    }
    const restored = [];
    const preserved = [];
    const missing = [];
    // 全 rename 後の印があれば、残骸だけ消す。元のバイト列へ戻さない。
    if (journal.committed || sharedState.committed.has(`${(0, path_1.resolve)(projectRoot)}:${journal.id}`)) {
        await cleanupJournal(projectRoot, journal.id, options);
        if (!(await readBytes(journalPath)))
            sharedState.committed.delete(`${(0, path_1.resolve)(projectRoot)}:${journal.id}`);
        return undefined;
    }
    for (const file of journal.files) {
        // 印より前に落ちた場合だけ、現在値が今回の値と一致するファイルを戻す。
        const destination = safeRelative(projectRoot, file.path);
        const current = await readBytes(destination);
        const currentHash = current ? projectFileHash(current) : null;
        if (currentHash === file.original_hash)
            continue;
        if (currentHash !== file.next_hash) {
            preserved.push(file.path);
            continue;
        }
        if (file.existed && file.backup) {
            let backup;
            try {
                backup = await retryFs(() => readBytes(safeRelative(projectRoot, file.backup)));
            }
            catch { /* 退避が読めなくても、次の保存は塞がない。 */ }
            if (!backup) {
                missing.push(file.path);
                continue;
            }
            await writeAtomicBytes(destination, backup);
        }
        else
            await retryFs(() => fileOps(options).rm(destination, { force: true }));
        restored.push(file.path);
    }
    await cleanupJournal(projectRoot, journal.id, options);
    return { restored, preserved, missing };
}
async function writeAtomicBytes(destination, content) {
    await retryFs(() => fs_1.promises.mkdir((0, path_1.dirname)(destination), { recursive: true }));
    const temporary = `${destination}.${process.pid}.${(0, crypto_1.randomUUID)()}.tmp`;
    try {
        await fs_1.promises.writeFile(temporary, content);
        await (0, history_store_1.renameWithRetry)(temporary, destination);
    }
    catch (error) {
        await retryFs(() => fs_1.promises.rm(temporary, { force: true })).catch(() => undefined);
        throw error;
    }
}
async function writeJournal(destination, content, options) {
    const ops = fileOps(options);
    const temporary = `${destination}.${process.pid}.${(0, crypto_1.randomUUID)()}.tmp`;
    try {
        await retryFs(() => ops.writeFile(temporary, content, 'utf8'));
        await (0, history_store_1.renameWithRetry)(temporary, destination);
    }
    catch (error) {
        await retryFs(() => ops.rm(temporary, { force: true })).catch(() => undefined);
        throw error;
    }
}
/** 保存の onDidWrite 通知の中から await しない。 */
async function recoverInterruptedProjectWrite(projectRoot) {
    const detail = await recoverInterruptedProjectWriteDetailed(projectRoot);
    return detail && recoveryNotice(detail);
}
async function recoverInterruptedProjectWriteDetailed(projectRoot) {
    // journal が無ければ lock も .akari も作らず、開く処理を待たせない。
    try {
        await retryFs(() => fs_1.promises.stat((0, path_1.join)(projectRoot, '.akari', 'write-journal.json')));
    }
    catch (error) {
        if (absent(error))
            return undefined;
        throw error;
    }
    const key = (0, path_1.resolve)(projectRoot);
    const previous = projectWriteChains.get(key) ?? Promise.resolve();
    let finish;
    const completion = new Promise(done => { finish = done; });
    projectWriteChains.set(key, completion);
    await previous.catch(() => undefined);
    let release;
    try {
        release = await acquireProjectLock(projectRoot, {});
        return await recoverJournalUnderLock(projectRoot);
    }
    finally {
        try {
            if (release)
                await release();
        }
        finally {
            finish();
            if (projectWriteChains.get(key) === completion)
                projectWriteChains.delete(key);
        }
    }
}
async function writeProjectFilesTransactional(projectRoot, input, options = {}) {
    const key = (0, path_1.resolve)(projectRoot);
    const previous = projectWriteChains.get(key) ?? Promise.resolve();
    let finish;
    const completion = new Promise(done => { finish = done; });
    projectWriteChains.set(key, completion);
    await previous.catch(() => undefined);
    let release;
    try {
        release = await acquireProjectLock(projectRoot, options);
        const recoveredDetail = await recoverJournalUnderLock(projectRoot, options);
        const recovered = recoveredDetail && recoveryNotice(recoveredDetail);
        if (recovered)
            options.onRecovered?.(recovered);
        const entries = normalizedWriteNames(input.files);
        const compared = entries.some(([, candidate]) => candidate.expectedHash !== undefined);
        const originals = compared || !options.writeUnchanged
            ? await Promise.all(entries.map(async ([name]) => retryFs(() => readBytes(safeRelative(projectRoot, name), fileOps(options)))))
            : entries.map(() => undefined);
        const conflicts = entries.flatMap(([name, candidate], index) => candidate.expectedHash === undefined
            || candidate.expectedHash === (originals[index] ? projectFileHash(originals[index]) : null)
            || originals[index]?.subarray(0, 3).equals(Buffer.from([0xef, 0xbb, 0xbf]))
                && candidate.expectedHash === projectFileHash(originals[index].subarray(3)) ? [] : [name]);
        if (conflicts.length)
            throw new ConflictError(conflicts);
        const writes = entries.flatMap(([name, candidate], index) => candidate.next === null
            || !options.writeUnchanged && originals[index]?.equals(Buffer.from(candidate.next, 'utf8'))
            ? [] : [{ name, next: candidate.next, original: originals[index] }]);
        if (!writes.length)
            return { written: [], ...(recovered ? { recovered } : {}) };
        if (!compared) {
            // 従来の保存は順に atomic rename する。失敗時も前のファイルを戻さない。
            for (let index = 0; index < writes.length; index++) {
                const item = writes[index];
                await writeAtomic(safeRelative(projectRoot, item.name), item.next, async (source, target) => {
                    try {
                        options.onWillWrite?.(target, item.name);
                    }
                    catch { /* 通知は保存を止めない。 */ }
                    if (options.hooks?.rename)
                        await options.hooks.rename(source, target, index + 1);
                    else
                        await renameAfterContention(source, target);
                });
                try {
                    await options.onDidWrite?.(safeRelative(projectRoot, item.name), item.next, item.name);
                }
                catch { /* rename 後の通知は保存を失敗にしない。 */ }
            }
            return { written: writes.map(item => item.name), ...(recovered ? { recovered } : {}) };
        }
        const id = (0, crypto_1.randomUUID)();
        const backupRoot = (0, path_1.join)(projectRoot, '.akari', 'work', 'journal', id);
        const journalPath = (0, path_1.join)(projectRoot, '.akari', 'write-journal.json');
        const workExisted = await fs_1.promises.stat((0, path_1.join)(projectRoot, '.akari', 'work')).then(() => true, error => { if (absent(error))
            return false; throw error; });
        try {
            // 退避を先に作り、journal の rename が済んでから対象ファイルを変える。
            await retryFs(() => fileOps(options).mkdir(backupRoot, { recursive: true }));
            const files = [];
            for (let index = 0; index < writes.length; index++) {
                const item = writes[index];
                const backup = item.original ? `.akari/work/journal/${id}/${index}.bin` : null;
                if (backup)
                    await retryFs(() => fileOps(options).writeFile(safeRelative(projectRoot, backup), item.original));
                files.push({ path: item.name, existed: !!item.original,
                    original_hash: item.original ? projectFileHash(item.original) : null,
                    next_hash: projectFileHash(item.next), backup });
            }
            const journal = { version: 1, id, label: input.label, pid: process.pid, host: (0, os_2.hostname)(),
                created_at: new Date(options.hooks?.now?.() ?? Date.now()).toISOString(), files };
            await writeJournal(journalPath, `${JSON.stringify(journal, null, 2)}\n`, options);
        }
        catch (error) {
            // journal 前の失敗には復元対象がない。
            await retryFs(() => fileOps(options).rm(backupRoot, { recursive: true, force: true })).catch(() => undefined);
            throw error;
        }
        let written = 0;
        try {
            if (options.hooks?.crashAfterJournal)
                throw new SimulatedCrash();
            for (const item of writes) {
                await writeAtomic(safeRelative(projectRoot, item.name), item.next, async (source, target) => {
                    try {
                        options.onWillWrite?.(target, item.name);
                    }
                    catch (error) {
                        console.warn('[edit-store] onWillWrite の通知に失敗しました。', error);
                    }
                    if (options.hooks?.rename)
                        await options.hooks.rename(source, target, written + 1);
                    else
                        await renameAfterContention(source, target);
                });
                written++;
                try {
                    await options.onDidWrite?.(safeRelative(projectRoot, item.name), item.next, item.name);
                }
                catch { /* 書けた後の通知は保存を失敗にしない。 */ }
                if (written === 1 && options.hooks?.crashAfterFirstRename)
                    throw new SimulatedCrash();
            }
        }
        catch (error) {
            if (error instanceof SimulatedCrash)
                throw error;
            // 印の前の失敗は、既に rename したファイルだけ元のバイト列へ戻す。
            let restored = true;
            for (let index = written - 1; index >= 0; index--) {
                const item = writes[index];
                try {
                    if (item.original)
                        await writeAtomicBytes(safeRelative(projectRoot, item.name), item.original);
                    else
                        await retryFs(() => fileOps(options).rm(safeRelative(projectRoot, item.name), { force: true }));
                }
                catch {
                    restored = false;
                }
            }
            if (restored) {
                await cleanupJournal(projectRoot, id, options, !workExisted);
            }
            throw error;
        }
        // 全 rename 後は成功扱い。同じプロセス内では記録で回復するが、別プロセス・再起動後は印だけが頼り。
        sharedState.committed.add(`${(0, path_1.resolve)(projectRoot)}:${id}`);
        try {
            const journalBytes = await readBytes(journalPath);
            if (journalBytes) {
                const journal = JSON.parse(journalBytes.toString('utf8'));
                journal.committed = true;
                await writeJournal(journalPath, `${JSON.stringify(journal, null, 2)}\n`, options);
            }
        }
        catch { /* 片付けは次回へ持ち越す。 */ }
        await cleanupJournal(projectRoot, id, options, !workExisted);
        return { written: writes.map(item => item.name), ...(recovered ? { recovered } : {}) };
    }
    finally {
        try {
            if (release)
                await release();
        }
        finally {
            finish();
            if (projectWriteChains.get(key) === completion)
                projectWriteChains.delete(key);
        }
    }
}
class SimulatedCrash extends Error {
}
/** atomic 保存を即時完了し、lint は末尾 debounce で非同期に実行する。 */
async function writeProjectFilesGuarded(projectRoot, candidates, options = {}) {
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
                try {
                    options.onDidWrite((0, path_1.join)(projectRoot, name), text);
                }
                catch (error) {
                    console.warn('[edit-store] onDidWrite の通知に失敗しました（保存は完了しています）。', error);
                }
            }
        }
    });
    scheduleProjectLint(projectRoot, options);
}
async function captureProjectLintBaseline(projectRoot) {
    const lintKey = (0, path_1.resolve)(projectRoot);
    if (!pendingLintBaselines.has(lintKey)) {
        pendingLintBaselines.set(lintKey, lastLintFindings.get(lintKey) ?? await readPersistedLintFindings(projectRoot));
    }
}
/** Web UI 旧版が生成した camelCase は schema が閉じていない legacy edit でも保存させない。 */
function assertNoCamelCaseTransitionOut(content) {
    let parsed;
    try {
        parsed = JSON.parse(content);
    }
    catch {
        // JSON 自体の診断は既存の保存後 lint に任せる。
        return;
    }
    const visit = (value) => {
        if (!value || typeof value !== 'object')
            return false;
        if (Object.prototype.hasOwnProperty.call(value, 'transitionOut'))
            return true;
        return Object.values(value).some(visit);
    };
    if (visit(parsed)) {
        throw new Error('transitionOut は Web UI 旧版が書いた綴りです。正しい transition_out へ直すか、'
            + 'Web UI で開き直して保存してください。');
    }
}
/**
 * 同じプロジェクト宛ての連続保存をまとめ、最後の状態だけを lint する。
 * 保存後 lint は実 projectRoot に対して writeReports=true で走るため、結果は
 * `.akari/lint.json` と `.akari/reports/edit-lint-report.html` へ書かれる。
 * これは render-cut が読む PASS ゲートを常に最新に保つ、意図した保存後 lint の副作用。
 */
function scheduleProjectLint(projectRoot, options = {}) {
    const key = (0, path_1.resolve)(projectRoot);
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
        void currentRun.then(result => lintRevisions.get(key) === revision ? options.onLintResult?.(result) : undefined, error => {
            console.warn('[edit-store] 保存後 edit-lint の実行に失敗しました（保存は維持します）。', error);
        }).finally(() => {
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
function markPreexistingLintFindings(result, baseline) {
    if (!baseline?.length)
        return result;
    const remaining = new Map();
    for (const finding of baseline) {
        const key = lintFindingIdentity(finding);
        remaining.set(key, (remaining.get(key) ?? 0) + 1);
    }
    const findings = result.findings.map(finding => {
        const key = lintFindingIdentity(finding);
        const count = remaining.get(key) ?? 0;
        if (count === 0)
            return finding;
        remaining.set(key, count - 1);
        return { ...finding, preexisting: true };
    });
    return { ...result, findings };
}
function lintFindingIdentity(finding) {
    const file = finding.path?.split('#', 1)[0] ?? '';
    const range = finding.range;
    const where = range && Number.isFinite(range.start) && Number.isFinite(range.end)
        ? `${file}@${range.start}-${range.end}` : finding.path ?? '';
    return JSON.stringify([finding.severity ?? '', finding.check ?? '', finding.message ?? '', where]);
}
async function readPersistedLintFindings(projectRoot) {
    try {
        const parsed = JSON.parse(await fs_1.promises.readFile((0, path_1.join)(projectRoot, '.akari', 'lint.json'), 'utf8'));
        return Array.isArray(parsed.findings) ? parsed.findings : undefined;
    }
    catch {
        return undefined;
    }
}
// 同じ宛先への書き込みは 1 本ずつ直列化する。
// 一時ファイル名が PID だけだった頃は、同一プロセス内で書き込みが 2 本重なると同じ
// 一時ファイルを奪い合い、短い方が truncate した後に長い方の書き込みがその先へ着地して
// 「完結した JSON + 前版の残骸」という壊れ方をした（実機 2026-08-07: edit.json が
// 多バイト文字の途中で切れた不正バイトを含む状態で破損。1ms 差の 2 連続 PUT が原因）。
// 一時ファイル名を毎回一意にして衝突自体を無くし、さらに直列化で後勝ちの順序も確定させる。
const writeChains = new Map();
let writeSequence = 0;
async function writeAtomic(destination, content, rename = history_store_1.renameWithRetry) {
    const previous = writeChains.get(destination) ?? Promise.resolve();
    const next = previous
        .catch(() => undefined)
        .then(async () => {
        await fs_1.promises.mkdir((0, path_1.dirname)(destination), { recursive: true });
        const temporary = `${destination}.${process.pid}.${++writeSequence}.tmp`;
        try {
            await fs_1.promises.writeFile(temporary, content, 'utf8');
            await rename(temporary, destination);
        }
        catch (error) {
            await fs_1.promises.rm(temporary, { force: true }).catch(() => undefined);
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
async function runEditLint(projectRoot, inputOverrides, writeReports = true) {
    let modulePath;
    try {
        modulePath = findEditLintModulePath();
    }
    catch (error) {
        warnEditLintUnavailableOnce(error);
        return { pass: true, errors: [], findings: [] };
    }
    try {
        const lintModule = await dynamicImport((0, url_1.pathToFileURL)(modulePath).href);
        const parsed = await lintModule.lintProject(projectRoot, { inputOverrides, writeReports });
        const findings = Array.isArray(parsed.findings) ? parsed.findings : [];
        const errorFindings = findings.filter(finding => finding.severity === 'error');
        return {
            pass: parsed.verdict === 'pass' && errorFindings.length === 0,
            errors: errorFindings.map(finding => `[${finding.check ?? 'edit-lint'}] ${finding.message ?? '不明なエラー'}`),
            findings
        };
    }
    catch (error) {
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
function findEditLintModulePath() {
    const binPath = findEditLintBinPath();
    const modulePath = (0, path_1.resolve)((0, path_1.dirname)(binPath), '../src/edit-lint.mjs');
    if (isFile(modulePath)) {
        return modulePath;
    }
    throw new Error(`edit-lint module was not found next to ${binPath}`);
}
/** 既存の複数候補探索を維持する。 */
function findEditLintBinPath() {
    const candidates = [];
    const packagedCandidate = (0, path_1.resolve)(__dirname, '../edit-lint/bin/edit-lint.mjs');
    candidates.push(packagedCandidate);
    if (isFile(packagedCandidate)) {
        return packagedCandidate;
    }
    let ancestor = (0, path_1.resolve)(__dirname);
    for (let depth = 0; depth < 10; depth++) {
        const candidate = (0, path_1.resolve)(ancestor, 'packages/edit-lint/bin/edit-lint.mjs');
        candidates.push(candidate);
        if (isFile(candidate)) {
            return candidate;
        }
        const parent = (0, path_1.dirname)(ancestor);
        if (parent === ancestor) {
            break;
        }
        ancestor = parent;
    }
    const cwdCandidates = [
        (0, path_1.resolve)(process.cwd(), '../../packages/edit-lint/bin/edit-lint.mjs'),
        (0, path_1.resolve)(process.cwd(), 'packages/edit-lint/bin/edit-lint.mjs'),
        (0, path_1.resolve)(process.cwd(), '../packages/edit-lint/bin/edit-lint.mjs')
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
function warnEditLintUnavailableOnce(error) {
    if (editLintUnavailableWarned) {
        return;
    }
    editLintUnavailableWarned = true;
    console.warn('[edit-store] edit-lint が見つからないため、検証なしで保存しています。', error instanceof Error ? error.message : error);
}
function isFile(candidate) {
    try {
        return (0, fs_1.statSync)(candidate).isFile();
    }
    catch {
        return false;
    }
}
