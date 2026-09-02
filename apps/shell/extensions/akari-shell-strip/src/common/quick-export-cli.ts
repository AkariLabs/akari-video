import { DEFAULT_EXPORT_OUTPUT_NAME } from './export-request-packet';

/**
 * 「この場で書き出す」バックエンドが `packages/edit-lint` / `packages/render-cut`
 * の既存 CLI を子プロセスで直接呼ぶ際の引数組み立てと、完了判定を担う純関数群。
 * 両 CLI 本体は無改造・子プロセスからの呼び出しのみ（task.md 境界）。
 *
 * 出力画素数を変えるときは render-cut の --scale-to に渡し、描画自体は edit.json の
 * output.width/height のまま維持する。
 *
 * 画質・エンジン・fps（task 2026-07-25-export-options）: 画質と fps は既定値のとき
 * render-cut への引数を追加しない。一方、エンジン選択とエンコーダ選択を呼び出し境界で
 * 固定するため、シェルは既定でも `--engine auto` と `--encoder auto` を明示送信する。
 * `--progress` は常に付ける — エンコードパラメータに一切影響しない計装用フラグ
 * （render-cut の plan.commands / 出力バイトは不変。out_time= を PROGRESS 行に
 * 変換して stdout へ流すだけ）。
 */

export const QUICK_EXPORT_OUTPUT_DIRECTORY = 'exports';

export type QuickExportQuality = 'master' | 'high' | 'standard' | 'light';
export type QuickExportEngine = 'auto' | 'gpu' | 'osr';
export type QuickExportEncoder = 'auto' | 'videotoolbox' | 'nvenc' | 'qsv' | 'amf' | 'mf' | 'x264';
export type QuickExportCodec = 'h264' | 'hevc';

export function buildQuickExportEncoderChoices(
    platform: 'darwin' | 'win32' | 'linux'
): Array<{ label: string; value: QuickExportEncoder }> {
    const automatic = { label: '自動（既定・ハードウェアが使えれば優先）', value: 'auto' as const };
    const software = { label: 'ソフトウェア（x264）', value: 'x264' as const };
    if (platform === 'darwin') {
        return [automatic, { label: 'ハードウェア（VideoToolbox）', value: 'videotoolbox' }, software];
    }
    if (platform === 'win32') {
        return [
            automatic,
            { label: 'ハードウェア（NVENC）', value: 'nvenc' },
            { label: 'ハードウェア（QSV）', value: 'qsv' },
            { label: 'ハードウェア（AMF）', value: 'amf' },
            { label: 'ハードウェア（Media Foundation）', value: 'mf' },
            software
        ];
    }
    return [automatic, software];
}

/** render-cut --quality の既定値と同じ（省略時に選ばれているのと同じ選択）。 */
export const QUICK_EXPORT_DEFAULT_QUALITY: QuickExportQuality = 'standard';
export const QUICK_EXPORT_DEFAULT_ENGINE: QuickExportEngine = 'auto';
export const QUICK_EXPORT_DEFAULT_CODEC: QuickExportCodec = 'h264';
/** render-cut の省略時は x264 固定になるため、シェルからは常に明示送信する既定値。 */
export const QUICK_EXPORT_DEFAULT_ENCODER: QuickExportEncoder = 'auto';

export interface QuickExportRenderSettings {
    readonly outputName: string;
    /** 既定（'standard'）なら --quality を付けない。 */
    readonly quality?: QuickExportQuality;
    /** 未指定でも --engine auto を明示送信する。 */
    readonly engine?: QuickExportEngine;
    /** 未指定でも --encoder auto を明示送信する。 */
    readonly encoder?: QuickExportEncoder;
    /** 未指定（h264）なら --codec を付けない。 */
    readonly codec?: QuickExportCodec;
    /** 未指定（そのまま）なら --fps を付けない。 */
    readonly fps?: number;
    /** 未指定（そのまま）なら --scale-to を付けない。 */
    readonly scaleTo?: { readonly width: number; readonly height: number };
    /** フォルダ選択ダイアログで得た絶対パス。未指定なら既定の `exports/` を使う。 */
    readonly outputDirectory?: string;
}

/** edit-lint CLI: `edit-lint <projectRoot> --json`（`.akari/lint.json` を書く既定の呼び方）。 */
export function buildEditLintArgs(projectRoot: string): string[] {
    return [projectRoot, '--json'];
}

/**
 * 出力ファイル名からディレクトリ区切り・親ディレクトリ参照を剥がし、
 * 常に 1 段のファイル名に収める（パス脱出防止）。出力先フォルダ自体は
 * OS のフォルダ選択ダイアログが返す実在パスなので、この関数の対象は
 * あくまで自由入力のファイル名だけ。
 * 空文字・空白のみ・`.`/`..` のみになった場合は既定名にフォールバックする。
 */
export function sanitizeQuickExportOutputName(outputName: string): string {
    const trimmed = outputName.trim();
    const segments = trimmed.split(/[\\/]+/).filter(segment => segment !== '' && segment !== '.' && segment !== '..');
    const lastSegment = segments[segments.length - 1]?.trim();
    return lastSegment || DEFAULT_EXPORT_OUTPUT_NAME;
}

/**
 * 同名の成果物を上書きしないため、既存名と衝突した場合だけ `-2`, `-3`, ... を
 * 拡張子の直前へ付ける。番号に欠番があれば最初の空きを使う。
 */
export function nextAvailableOutputName(baseName: string, existingNames: readonly string[]): string {
    const sanitizedName = sanitizeQuickExportOutputName(baseName);
    const existing = new Set(existingNames);
    if (!existing.has(sanitizedName)) {
        return sanitizedName;
    }
    const extensionIndex = sanitizedName.lastIndexOf('.');
    const hasExtension = extensionIndex > 0;
    const stem = hasExtension ? sanitizedName.slice(0, extensionIndex) : sanitizedName;
    const extension = hasExtension ? sanitizedName.slice(extensionIndex) : '';
    for (let suffix = 2; ; suffix++) {
        const candidate = `${stem}-${suffix}${extension}`;
        if (!existing.has(candidate)) {
            return candidate;
        }
    }
}

/**
 * render-cut の `--out` に渡す出力パス。`outputDirectory` 未指定なら既定の
 * プロジェクトルート相対 `exports/<name>`（v0 と同一の組み立て）。指定時は
 * その絶対パス直下に置く（render-cut 自身の `--out` は絶対パスを素通しする —
 * src/render-cut.mjs の resolveOutput 参照。プロジェクト外の入力ファイルを
 * 上書きしないことは render-cut 自身の ensureOutputDoesNotReplaceInput が
 * 常に検査する）。
 */
export function buildRenderCutOutputPath(outputName: string, outputDirectory?: string): string {
    const sanitizedName = sanitizeQuickExportOutputName(outputName);
    if (!outputDirectory || outputDirectory.trim() === '') {
        return `${QUICK_EXPORT_OUTPUT_DIRECTORY}/${sanitizedName}`;
    }
    const trimmedDirectory = outputDirectory.replace(/[\\/]+$/, '');
    return `${trimmedDirectory}/${sanitizedName}`;
}

/** @deprecated 後方互換のためだけに残す薄いラッパー。新規呼び出しは buildRenderCutOutputPath を使う。 */
export function buildRenderCutOutputRelativePath(outputName: string): string {
    return buildRenderCutOutputPath(outputName);
}

/**
 * render-cut CLI: `render-cut <projectRoot> --out <path> [--quality ...] --engine ...
 * --encoder ... [--fps ...] --progress`。quality は既定値なら省略するが、engine と encoder は
 * 呼び出し境界で選択を固定するため `auto` も常に明示送信する。
 */
export function buildRenderCutArgs(projectRoot: string, settings: QuickExportRenderSettings): string[] {
    const args = [projectRoot, '--out', buildRenderCutOutputPath(settings.outputName, settings.outputDirectory)];
    if (settings.quality !== undefined && settings.quality !== QUICK_EXPORT_DEFAULT_QUALITY) {
        args.push('--quality', settings.quality);
    }
    args.push('--engine', settings.engine ?? QUICK_EXPORT_DEFAULT_ENGINE);
    args.push('--encoder', settings.encoder ?? QUICK_EXPORT_DEFAULT_ENCODER);
    if (settings.codec !== undefined && settings.codec !== QUICK_EXPORT_DEFAULT_CODEC) {
        args.push('--codec', settings.codec);
    }
    if (settings.fps !== undefined) {
        args.push('--fps', String(settings.fps));
    }
    if (settings.scaleTo !== undefined) {
        args.push('--scale-to', `${settings.scaleTo.width}x${settings.scaleTo.height}`);
    }
    args.push('--progress');
    return args;
}

export type QuickExportLintOutcome = 'pass' | 'fail' | 'error';

/** edit-lint の exit code: 0 PASS・1 FAIL・2 実行エラー（bin/edit-lint.mjs の契約どおり）。 */
export function determineLintOutcome(exitCode: number | null): QuickExportLintOutcome {
    if (exitCode === 0) {
        return 'pass';
    }
    if (exitCode === 1) {
        return 'fail';
    }
    return 'error';
}

export type QuickExportRenderOutcome = 'success' | 'failure';

/**
 * render-cut の完了判定は exit code だけでなく実ファイルの存在 + サイズも見る
 * （task.md 「exit 0 + 出力ファイル実在（サイズ > 0）で完了表示」）。
 */
export function determineRenderOutcome(
    exitCode: number | null,
    output: { readonly exists: boolean; readonly size: number } | undefined
): QuickExportRenderOutcome {
    if (exitCode !== 0) {
        return 'failure';
    }
    if (!output || !output.exists || output.size <= 0) {
        return 'failure';
    }
    return 'success';
}

/** stderr 全文から末尾 N 行だけを要約として取り出す（空行は除く）。 */
export function summarizeStderrTail(stderr: string, maxLines = 5): string {
    const lines = stderr.split(/\r?\n/).map(line => line.trim()).filter(line => line !== '');
    const tail = lines.slice(-maxLines);
    const cause = [...lines].reverse().find(line => /(?:error|failed|not found|cannot|unable|見つかりません|失敗|不在)/iu.test(line));
    if (cause && !tail.includes(cause) && maxLines > 0) {
        return [cause, ...tail.slice(-(maxLines - 1))].join('\n');
    }
    return tail.join('\n');
}

/**
 * render-cut が非成功だったとき、stderr が空でも必ずユーザー向け理由を返す。
 * 特に「exit 0 だが期待した成果物が無い」は従来 failureSummary が空になり、
 * GUI では失敗ラベル以外の手掛かりが消えていたため明示的に区別する。
 */
export function describeRenderFailure(
    exitCode: number | null,
    stderr: string,
    outputPath: string,
    output: { readonly size: number } | undefined
): string {
    const stderrSummary = summarizeStderrTail(stderr);
    if (stderrSummary) {
        return stderrSummary;
    }
    if (exitCode === 0 && (!output || output.size <= 0)) {
        return `render-cut は正常終了を返しましたが、成果物 ${outputPath} が作成されませんでした`;
    }
    const exitLabel = exitCode === null ? '終了コードを返さず' : `exit code ${exitCode} で`;
    return `render-cut が ${exitLabel}終了しました（エラー出力はありません）`;
}

/** JSON-RPC / バックエンド境界の unknown を空でない1行へ正規化する。 */
export function describeUnexpectedQuickExportFailure(error: unknown, fallback: string): string {
    if (error instanceof Error && error.message.trim()) {
        return `${fallback}: ${error.message.trim()}`;
    }
    if (typeof error === 'string' && error.trim()) {
        return `${fallback}: ${error.trim()}`;
    }
    return fallback;
}
