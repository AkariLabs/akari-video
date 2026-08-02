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

import { execFile } from 'child_process';
import { promises as fs, statSync } from 'fs';
import { tmpdir } from 'os';
import { dirname, join, resolve } from 'path';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

export interface EditLintFinding {
    severity?: string;
    message?: string;
    check?: string;
    path?: string;
}

export interface EditLintGateResult {
    pass: boolean;
    errors: string[];
    findings: EditLintFinding[];
}

/** 候補ファイル名（プロジェクト直下の basename）→ 書き込み予定の全文。 */
export type LintCandidates = Record<string, string>;

/**
 * プロジェクト直下の候補ファイル群（edit.json / captions.json）を、実ファイルへ書く前に
 * edit-lint へかける。複数候補（edit.json + captions.json の同時書き換え）は同じ一時
 * ディレクトリに置いて 1 回で整合検証する。
 */
export async function lintProjectCandidates(
    projectRoot: string,
    candidates: LintCandidates
): Promise<EditLintGateResult> {
    const candidateNames = new Set(Object.keys(candidates));
    const tempRoot = await fs.mkdtemp(resolve(tmpdir(), 'akari-lint-'));
    try {
        let siblingNames: string[] = [];
        try {
            siblingNames = await fs.readdir(projectRoot);
        } catch {
            siblingNames = [];
        }
        await Promise.all(siblingNames.map(async name => {
            if (candidateNames.has(name)) {
                return;
            }
            try {
                const targetStat = await fs.stat(join(projectRoot, name));
                await fs.symlink(
                    join(projectRoot, name), join(tempRoot, name), targetStat.isDirectory() ? 'dir' : 'file'
                );
            } catch {
                // Reference is unreadable or a broken symlink; edit-lint will report it as a
                // missing-file finding on its own, same as it would against the real project.
            }
        }));
        await Promise.all(Object.entries(candidates).map(([name, text]) =>
            fs.writeFile(join(tempRoot, name), text, 'utf8')
        ));
        return await runEditLint(tempRoot);
    } finally {
        await fs.rm(tempRoot, { recursive: true, force: true });
    }
}

/** lint に落ちたら書き込まずに例外を投げる（呼び出し側の catch で UI が巻き戻る）。 */
export async function assertLintPasses(projectRoot: string, candidates: LintCandidates): Promise<void> {
    const result = await lintProjectCandidates(projectRoot, candidates);
    if (!result.pass) {
        throw new Error(result.errors[0] ?? 'edit-lint が変更を拒否しました');
    }
}

/** lint ゲート → atomic 書き込み（tmp + rename）を一括で行う唯一の正規経路。 */
export async function writeProjectFilesGuarded(projectRoot: string, candidates: LintCandidates): Promise<void> {
    await assertLintPasses(projectRoot, candidates);
    for (const [name, text] of Object.entries(candidates)) {
        await writeAtomic(join(projectRoot, name), text);
    }
}

export async function writeAtomic(destination: string, content: string): Promise<void> {
    await fs.mkdir(dirname(destination), { recursive: true });
    const temporary = `${destination}.${process.pid}.tmp`;
    await fs.writeFile(temporary, content, 'utf8');
    await fs.rename(temporary, destination);
}

export async function runEditLint(projectRoot: string): Promise<EditLintGateResult> {
    let binPath: string;
    try {
        binPath = findEditLintBinPath();
    } catch (error) {
        warnEditLintUnavailableOnce(error);
        return { pass: true, errors: [], findings: [] };
    }
    // ELECTRON_RUN_AS_NODE: パッケージ版 shell で process.execPath が Electron 実行体を指すため、
    // 付与しないと node スクリプトではなく Electron アプリとして再起動してしまう
    // （素の node で実行される preview-server では無害な no-op）。
    const stdout = await execFileAsync(process.execPath, [binPath, projectRoot, '--json'], {
        encoding: 'utf8', maxBuffer: 10 * 1024 * 1024,
        env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }
    }).then(
        result => result.stdout,
        (error: NodeJS.ErrnoException & { stdout?: string }) => typeof error.stdout === 'string' ? error.stdout : '{}'
    );
    let parsed: { findings?: EditLintFinding[] };
    try {
        parsed = JSON.parse(stdout);
    } catch (error) {
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

export function findEditLintBinPath(): string {
    const candidates: string[] = [];

    // パッケージ版 shell: バンドル済みバックエンドの隣に edit-lint が同梱される配置。
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
        '[edit-store] edit-lint bin が見つからないため、検証なしで保存しています。',
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
