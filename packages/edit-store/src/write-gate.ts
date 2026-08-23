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

import { promises as fs, statSync } from 'fs';
import { dirname, join, resolve } from 'path';
import { pathToFileURL } from 'url';

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

/** 候補ファイル名（プロジェクト直下からの相対パス）→ 書き込み予定の全文。null は不在扱い。 */
export type LintCandidates = Record<string, string | null>;

export interface DeferredLintOptions {
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
}

interface EditLintModule {
    lintProject(input: string, options?: Record<string, unknown>): Promise<{
        verdict?: string;
        findings?: EditLintFinding[];
    }>;
}

const DEFAULT_LINT_DEBOUNCE_MS = 400;
const lintTimers = new Map<string, ReturnType<typeof setTimeout>>();
const lintRevisions = new Map<string, number>();
const lintRunChains = new Map<string, Promise<EditLintGateResult>>();
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

/** 互換 API。保存後 lint への移行後も、明示的に検証したい呼び出し側向けに残す。 */
export async function assertLintPasses(projectRoot: string, candidates: LintCandidates): Promise<void> {
    const result = await lintProjectCandidates(projectRoot, candidates);
    if (!result.pass) {
        throw new Error(result.errors[0] ?? 'edit-lint が変更を拒否しました');
    }
}

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
    for (const [name, text] of Object.entries(candidates)) {
        if (text === null) {
            continue;
        }
        const destination = join(projectRoot, name);
        await writeAtomic(destination, text);
        // rename 完了直後に同期で通知する。lint スケジュールより前に出すことで、
        // 購読側が watcher（実測 42〜1183ms のばらつき）を待たずに済む。
        if (options.onDidWrite) {
            try {
                options.onDidWrite(destination, text);
            } catch (error) {
                console.warn('[edit-store] onDidWrite の通知に失敗しました（保存は完了しています）。', error);
            }
        }
    }
    scheduleProjectLint(projectRoot, options);
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
        const previousRun = lintRunChains.get(key) ?? Promise.resolve({ pass: true, errors: [], findings: [] });
        const currentRun = previousRun
            .catch(() => ({ pass: true, errors: [], findings: [] }))
            .then(() => (options.lintRunner ?? runEditLint)(key));
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

// 同じ宛先への書き込みは 1 本ずつ直列化する。
// 一時ファイル名が PID だけだった頃は、同一プロセス内で書き込みが 2 本重なると同じ
// 一時ファイルを奪い合い、短い方が truncate した後に長い方の書き込みがその先へ着地して
// 「完結した JSON + 前版の残骸」という壊れ方をした（実機 2026-08-07: edit.json が
// 多バイト文字の途中で切れた不正バイトを含む状態で破損。1ms 差の 2 連続 PUT が原因）。
// 一時ファイル名を毎回一意にして衝突自体を無くし、さらに直列化で後勝ちの順序も確定させる。
const writeChains = new Map<string, Promise<void>>();
let writeSequence = 0;

export async function writeAtomic(destination: string, content: string): Promise<void> {
    const previous = writeChains.get(destination) ?? Promise.resolve();
    const next = previous
        .catch(() => undefined)
        .then(async () => {
            await fs.mkdir(dirname(destination), { recursive: true });
            const temporary = `${destination}.${process.pid}.${++writeSequence}.tmp`;
            try {
                await fs.writeFile(temporary, content, 'utf8');
                await fs.rename(temporary, destination);
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
