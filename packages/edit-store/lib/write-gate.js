"use strict";
/**
 * edit.json / captions.json の lint ゲート付き書き込み層（Node 専用）。
 *
 * 由来: apps/shell の akari-annotations-service.ts / akari-preview-service.ts に
 * 複製されていた assertLintPasses / runEditLint / findEditLintBinPath / writeAtomic を
 * ここへ一本化した（プレビュー・パリティ契約 §2.7「すべての書き込み経路は edit-lint を通す」）。
 * preview-server の PUT ハンドラも同じゲートを使う。
 *
 * ゲートの作法（CF-write と同一）: 候補全文を実ファイルへは一切書かず、兄弟ファイル
 * （source 動画・captions.json 等）をシンボリックリンクで写した一時ディレクトリに候補だけを
 * 置いて packages/edit-lint/bin/edit-lint.mjs --json を叩く（edit-lint は「呼び出しのみ」— 改変しない）。
 *
 * fail-open（オーナー裁定 2026-08-02、初出 2026-07-26 editlint-packaged-resolve）:
 * lint 実行系（bin）が見つからない場合は書き込みを全面ブロックせず検証スキップで続行する。
 * 編集不能より lint なし保存の方が被害が小さいという判断（型不正は各書き込みの
 * ローカル検証が別途残るため安全側は保たれる）。
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.lintProjectCandidates = lintProjectCandidates;
exports.assertLintPasses = assertLintPasses;
exports.writeProjectFilesGuarded = writeProjectFilesGuarded;
exports.writeAtomic = writeAtomic;
exports.runEditLint = runEditLint;
exports.findEditLintBinPath = findEditLintBinPath;
const child_process_1 = require("child_process");
const fs_1 = require("fs");
const os_1 = require("os");
const path_1 = require("path");
const util_1 = require("util");
const execFileAsync = (0, util_1.promisify)(child_process_1.execFile);
/**
 * プロジェクト直下の候補ファイル群（edit.json / captions.json）を、実ファイルへ書く前に
 * edit-lint へかける。複数候補（edit.json + captions.json の同時書き換え）は同じ一時
 * ディレクトリに置いて 1 回で整合検証する。
 */
async function lintProjectCandidates(projectRoot, candidates) {
    const candidateNames = new Set(Object.keys(candidates));
    const tempRoot = await fs_1.promises.mkdtemp((0, path_1.resolve)((0, os_1.tmpdir)(), 'akari-lint-'));
    try {
        let siblingNames = [];
        try {
            siblingNames = await fs_1.promises.readdir(projectRoot);
        }
        catch {
            siblingNames = [];
        }
        await Promise.all(siblingNames.map(async (name) => {
            if (candidateNames.has(name)) {
                return;
            }
            try {
                const targetStat = await fs_1.promises.stat((0, path_1.join)(projectRoot, name));
                await fs_1.promises.symlink((0, path_1.join)(projectRoot, name), (0, path_1.join)(tempRoot, name), targetStat.isDirectory() ? 'dir' : 'file');
            }
            catch {
                // Reference is unreadable or a broken symlink; edit-lint will report it as a
                // missing-file finding on its own, same as it would against the real project.
            }
        }));
        await Promise.all(Object.entries(candidates).map(([name, text]) => fs_1.promises.writeFile((0, path_1.join)(tempRoot, name), text, 'utf8')));
        return await runEditLint(tempRoot);
    }
    finally {
        await fs_1.promises.rm(tempRoot, { recursive: true, force: true });
    }
}
/** lint に落ちたら書き込まずに例外を投げる（呼び出し側の catch で UI が巻き戻る）。 */
async function assertLintPasses(projectRoot, candidates) {
    const result = await lintProjectCandidates(projectRoot, candidates);
    if (!result.pass) {
        throw new Error(result.errors[0] ?? 'edit-lint が変更を拒否しました');
    }
}
/** lint ゲート → atomic 書き込み（tmp + rename）を一括で行う唯一の正規経路。 */
async function writeProjectFilesGuarded(projectRoot, candidates) {
    await assertLintPasses(projectRoot, candidates);
    for (const [name, text] of Object.entries(candidates)) {
        await writeAtomic((0, path_1.join)(projectRoot, name), text);
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
async function runEditLint(projectRoot) {
    let binPath;
    try {
        binPath = findEditLintBinPath();
    }
    catch (error) {
        warnEditLintUnavailableOnce(error);
        return { pass: true, errors: [], findings: [] };
    }
    // ELECTRON_RUN_AS_NODE: パッケージ版 shell で process.execPath が Electron 実行体を指すため、
    // 付与しないと node スクリプトではなく Electron アプリとして再起動してしまう
    // （素の node で実行される preview-server では無害な no-op）。
    const stdout = await execFileAsync(process.execPath, [binPath, projectRoot, '--json'], {
        encoding: 'utf8', maxBuffer: 10 * 1024 * 1024,
        env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }
    }).then(result => result.stdout, (error) => typeof error.stdout === 'string' ? error.stdout : '{}');
    let parsed;
    try {
        parsed = JSON.parse(stdout);
    }
    catch (error) {
        return {
            pass: false,
            errors: [`edit-lint の出力を解析できませんでした: ${error instanceof Error ? error.message : String(error)}`],
            findings: []
        };
    }
    const findings = Array.isArray(parsed.findings) ? parsed.findings : [];
    const errorFindings = findings.filter(finding => finding.severity === 'error');
    return {
        pass: errorFindings.length === 0,
        errors: errorFindings.map(finding => `[${finding.check ?? 'edit-lint'}] ${finding.message ?? '不明なエラー'}`),
        findings
    };
}
function findEditLintBinPath() {
    const candidates = [];
    // パッケージ版 shell: バンドル済みバックエンドの隣に edit-lint が同梱される配置。
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
    console.warn('[edit-store] edit-lint bin が見つからないため、検証なしで保存しています。', error instanceof Error ? error.message : error);
}
function isFile(candidate) {
    try {
        return (0, fs_1.statSync)(candidate).isFile();
    }
    catch {
        return false;
    }
}
