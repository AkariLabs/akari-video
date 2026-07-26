/**
 * `.akari/render.json`（render-cut スキルが書く。本拡張は書き込まない）を
 * 寛容リーダーで読み、進捗表示用の最小状態へ変換する純関数。
 *
 * スキーマは新設しない — render-cut 側の実物（内部 dogfood-v2 実走の
 * render.json）と skills/render-cut/SKILL.md
 * の記述から復元した形を読むだけ。未知の形・欠落フィールドは例外を投げず
 * 'unknown' へフォールバックする。
 */

export type RenderProgressState =
    | { readonly kind: 'in-progress'; readonly label: string; readonly percent: number }
    | { readonly kind: 'done'; readonly label: string; readonly percent: number; readonly artifactPath: string }
    | { readonly kind: 'failed'; readonly label: string }
    | { readonly kind: 'unknown'; readonly label: string };

export const RENDER_PROGRESS_UNKNOWN_LABEL = '進捗不明（書き出し中）';

// phase 文字列の実測値は "verified"（PASS 完了時）の1つしか確認できていない
// （SKILL.md は状態遷移の途中値を明文化していない）。途中値は推測にとどまる
// ため、一致しない phase 値でも例外にせず「書き出し中」＋ラベルそのまま表示に
// 倒し、目安のパーセントだけをこの表で近似する。
const PHASE_PERCENT_HINTS: ReadonlyArray<readonly [string, number]> = [
    ['plan', 15],
    ['cut', 30],
    ['layer', 40],
    ['rasteriz', 50],
    ['composit', 65],
    ['mix', 80],
    ['verify', 90],
    ['verified', 100]
];

const DEFAULT_IN_PROGRESS_PERCENT_WITH_PHASE = 50;
const DEFAULT_IN_PROGRESS_PERCENT_WITHOUT_PHASE = 20;

export function parseRenderProgress(raw: unknown): RenderProgressState {
    if (!isRecord(raw)) {
        return { kind: 'unknown', label: RENDER_PROGRESS_UNKNOWN_LABEL };
    }

    const verify = isRecord(raw.verify) ? raw.verify : undefined;
    const verdict = typeof verify?.verdict === 'string' ? verify.verdict : undefined;

    if (verdict === 'fail') {
        return { kind: 'failed', label: describeFailure(verify) };
    }

    if (verdict === 'pass') {
        const artifactPath = firstArtifactPath(raw.artifacts);
        if (artifactPath) {
            return { kind: 'done', label: '書き出し完了', percent: 100, artifactPath };
        }
    }

    const hasRecognizableShape = typeof raw.version !== 'undefined'
        || typeof raw.phase !== 'undefined'
        || isRecord(raw.plan);
    if (!hasRecognizableShape) {
        return { kind: 'unknown', label: RENDER_PROGRESS_UNKNOWN_LABEL };
    }

    const phase = typeof raw.phase === 'string' && raw.phase.trim() ? raw.phase.trim() : undefined;
    return {
        kind: 'in-progress',
        label: phase ? `書き出し中（${phase}）` : '書き出し中',
        percent: estimatePercent(phase)
    };
}

function estimatePercent(phase: string | undefined): number {
    if (!phase) {
        return DEFAULT_IN_PROGRESS_PERCENT_WITHOUT_PHASE;
    }
    const lowered = phase.toLowerCase();
    for (const [needle, percent] of PHASE_PERCENT_HINTS) {
        if (lowered.includes(needle)) {
            return percent;
        }
    }
    return DEFAULT_IN_PROGRESS_PERCENT_WITH_PHASE;
}

function firstArtifactPath(artifacts: unknown): string | undefined {
    if (!Array.isArray(artifacts)) {
        return undefined;
    }
    for (const entry of artifacts) {
        if (isRecord(entry) && typeof entry.path === 'string' && entry.path.trim()) {
            return entry.path;
        }
    }
    return undefined;
}

function describeFailure(verify: Record<string, unknown> | undefined): string {
    const findings = verify && Array.isArray(verify.findings) ? verify.findings : undefined;
    const errorMessage = findings
        ?.filter(isRecord)
        .find(finding => finding.severity === 'error' && typeof finding.message === 'string')?.message;
    return typeof errorMessage === 'string' && errorMessage.trim()
        ? `書き出しに失敗しました: ${errorMessage}`
        : '書き出しに失敗しました';
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null;
}
