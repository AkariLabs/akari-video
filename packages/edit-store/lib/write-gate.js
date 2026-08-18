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
exports.lintProjectCandidates = lintProjectCandidates;
exports.assertLintPasses = assertLintPasses;
exports.writeProjectFilesGuarded = writeProjectFilesGuarded;
exports.scheduleProjectLint = scheduleProjectLint;
exports.writeAtomic = writeAtomic;
exports.runEditLint = runEditLint;
exports.findEditLintModulePath = findEditLintModulePath;
exports.findEditLintBinPath = findEditLintBinPath;
const fs_1 = require("fs");
const path_1 = require("path");
const url_1 = require("url");
const DEFAULT_LINT_DEBOUNCE_MS = 400;
const lintTimers = new Map();
const lintRevisions = new Map();
const dynamicImport = new Function('specifier', 'return import(specifier)');
/**
 * 実ファイルは変更せず、候補全文だけを options.inputOverrides で差し替えて検証する。
 * 既存 export のシグネチャは維持し、preview-server の保存前検査にも使える。
 */
async function lintProjectCandidates(projectRoot, candidates) {
    return runEditLint(projectRoot, candidates, false);
}
/** 互換 API。保存後 lint への移行後も、明示的に検証したい呼び出し側向けに残す。 */
async function assertLintPasses(projectRoot, candidates) {
    const result = await lintProjectCandidates(projectRoot, candidates);
    if (!result.pass) {
        throw new Error(result.errors[0] ?? 'edit-lint が変更を拒否しました');
    }
}
/** atomic 保存を即時完了し、lint は末尾 debounce で非同期に実行する。 */
async function writeProjectFilesGuarded(projectRoot, candidates, options = {}) {
    for (const [name, text] of Object.entries(candidates)) {
        if (text === null) {
            continue;
        }
        const destination = (0, path_1.join)(projectRoot, name);
        await writeAtomic(destination, text);
        // rename 完了直後に同期で通知する。lint スケジュールより前に出すことで、
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
        void runEditLint(key).then(result => lintRevisions.get(key) === revision ? options.onLintResult?.(result) : undefined, error => {
            console.warn('[edit-store] 保存後 edit-lint の実行に失敗しました（保存は維持します）。', error);
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
