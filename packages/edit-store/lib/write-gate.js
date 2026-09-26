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
 * 保存の臨界経路は tmp + rename だけに限定する。edit-lint は保存後 400ms の末尾
 * debounce で同じプロジェクトにつき最新 1 本だけをプロセス内実行する。lint が
 * 利用できない場合は従来どおり fail-open とし、編集不能にはしない。
 *
 * fail-open（オーナー裁定 2026-08-02、初出 2026-07-26 editlint-packaged-resolve）:
 * lint 実行系が見つからない場合は書き込みを全面ブロックせず検証スキップで続行する。
 * 編集不能より lint なし保存の方が被害が小さいという判断（型不正は各書き込みの
 * ローカル検証が別途残るため安全側は保たれる）。
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.SAVED_BY_PATH = void 0;
exports.lintProjectCandidates = lintProjectCandidates;
exports.lintProjectCandidatesOnDisk = lintProjectCandidatesOnDisk;
exports.assertLintPasses = assertLintPasses;
exports.setDefaultSavedByAppVersion = setDefaultSavedByAppVersion;
exports.writeSavedByStamp = writeSavedByStamp;
exports.writeProjectFilesGuarded = writeProjectFilesGuarded;
exports.assertNoCamelCaseTransitionOut = assertNoCamelCaseTransitionOut;
exports.scheduleProjectLint = scheduleProjectLint;
exports.writeAtomic = writeAtomic;
exports.runEditLint = runEditLint;
exports.findEditLintModulePath = findEditLintModulePath;
exports.findEditLintBinPath = findEditLintBinPath;
const fs_1 = require("fs");
const path_1 = require("path");
const url_1 = require("url");
const os_1 = require("os");
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
    if (isValidSavedByAppVersion(appVersion)) {
        await writeAtomic(destination, serializeSavedByStamp(appVersion));
    }
    else {
        // 版不明の書き手は、以前の書き手の版を主張できない。
        await fs_1.promises.rm(destination, { force: true });
    }
}
/** atomic 保存を即時完了し、lint は末尾 debounce で非同期に実行する。 */
async function writeProjectFilesGuarded(projectRoot, candidates, options = {}) {
    const editCandidate = candidates['edit.json'];
    if (typeof editCandidate === 'string') {
        assertNoCamelCaseTransitionOut(editCandidate);
    }
    for (const [name, text] of Object.entries(candidates)) {
        if (text === null) {
            continue;
        }
        const destination = (0, path_1.join)(projectRoot, name);
        await writeAtomic(destination, text);
        if (name === 'edit.json') {
            const version = options.appVersion ?? defaultSavedByAppVersion;
            if (isValidSavedByAppVersion(version)) {
                await writeAtomic((0, path_1.join)(projectRoot, exports.SAVED_BY_PATH), serializeSavedByStamp(version));
            }
            else {
                // An unknown writer cannot keep a previous writer's version claim.
                await fs_1.promises.rm((0, path_1.join)(projectRoot, exports.SAVED_BY_PATH), { force: true });
            }
        }
        // edit.json とスタンプの rename が完了したら同期で通知する。lint スケジュールより前に出すことで、
        // 購読側が watcher（実測 42〜1183ms のばらつき）を待たずに済む。
        if (options.onDidWrite) {
            try {
                options.onDidWrite(destination, text);
            }
            catch (error) {
                console.warn('[edit-store] onDidWrite の通知に失敗しました（保存は完了しています）。', error);
            }
        }
    }
    scheduleProjectLint(projectRoot, options);
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
        const previousRun = lintRunChains.get(key) ?? Promise.resolve({ pass: true, errors: [], findings: [] });
        const currentRun = previousRun
            .catch(() => ({ pass: true, errors: [], findings: [] }))
            .then(() => (options.lintRunner ?? runEditLint)(key));
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
// 同じ宛先への書き込みは 1 本ずつ直列化する。
// 一時ファイル名が PID だけだった頃は、同一プロセス内で書き込みが 2 本重なると同じ
// 一時ファイルを奪い合い、短い方が truncate した後に長い方の書き込みがその先へ着地して
// 「完結した JSON + 前版の残骸」という壊れ方をした（実機 2026-08-07: edit.json が
// 多バイト文字の途中で切れた不正バイトを含む状態で破損。1ms 差の 2 連続 PUT が原因）。
// 一時ファイル名を毎回一意にして衝突自体を無くし、さらに直列化で後勝ちの順序も確定させる。
const writeChains = new Map();
let writeSequence = 0;
async function writeAtomic(destination, content) {
    const previous = writeChains.get(destination) ?? Promise.resolve();
    const next = previous
        .catch(() => undefined)
        .then(async () => {
        await fs_1.promises.mkdir((0, path_1.dirname)(destination), { recursive: true });
        const temporary = `${destination}.${process.pid}.${++writeSequence}.tmp`;
        try {
            await fs_1.promises.writeFile(temporary, content, 'utf8');
            await fs_1.promises.rename(temporary, destination);
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
