/**
 * 書き出し成果物タブの自動オープンを「その成果物を作っているレンダーの完走」まで待たせる門。
 *
 * 背景（2026-09-04 実測・オーナー報告「書き出し後に自動で開く mp4 が初回だけ再生できない」）:
 * render-cut は出力を `.akari/render-tmp/<run>/final.mp4` から `exports/*.mp4` へ **rename した後**に、
 * 同じファイルへ verify（`decodeAllFramesAndCount` = 全編 ffmpeg デコード）とコンタクトシート生成を回す。
 * ファイル出現からレンダー完了までは実測で 25〜31 秒あり（final-3: 15:58:07 → 15:58:38 /
 * final-4: 16:00:10 → 16:00:35）、その間に開いたプレビューは同じ mp4 を全力デコード中の
 * ffmpeg と競合して初回再生に失敗していた。
 *
 * 門の根拠に `.akari/render.json` を使う。render-cut は実行開始時にこれを `phase: "planned"` で
 * 書き（render-cut.mjs の writeState 呼び出し 1 本目）、完走時に `"verified"`（失敗時 `"error"`）へ
 * 書き換える。plan.output は最初から最終成果物のパスを名指しているので、「この成果物を作っている
 * レンダーが今も走っているか」がファイルだけで判定できる。書き出しダイアログ経由でも AI パートナー
 * 経由の CLI 実行でも同じように効く（どちらも同じ render-cut を通る）。
 */

/** レンダー状態の正本。プロジェクト直下からの相対パス。 */
export const RENDER_STATE_RELATIVE_PATH = '.akari/render.json';

/**
 * 「まだ走っている」ことを表す render-cut の state.phase。
 * ここに無い値（未知の phase・phase 欠落）は完了扱いにする — 門は fail-open にして、
 * 判定できないときは従来どおり即座に開く（開けない不具合より遅れて開く不具合の方が軽い、の逆を取る）。
 */
const PENDING_RENDER_PHASES: ReadonlySet<string> = new Set(['planned', 'filter_report', 'rendered']);

/**
 * 待たせる上限。render-cut が rename 後・writeState 前に強制終了された場合だけ効く保険で、
 * 通常のレンダーはこの上限より先に render.json を書き換えて門を開ける（長尺でも同じ）。
 */
export const ARTIFACT_OPEN_GATE_TIMEOUT_MS = 30 * 60 * 1000;

/** 門の判定に要る `.akari/render.json` の 2 項目だけ。 */
export interface RenderStateFacts {
    readonly phase?: string;
    readonly output?: string;
}

/** `.akari/render.json` の本文から判定に要る 2 項目を取り出す。壊れていれば undefined。 */
export function parseRenderStateFacts(text: string | undefined): RenderStateFacts | undefined {
    if (typeof text !== 'string' || text.trim() === '') {
        return undefined;
    }
    let parsed: any;
    try {
        parsed = JSON.parse(text);
    } catch {
        return undefined;
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        return undefined;
    }
    return {
        phase: typeof parsed.phase === 'string' ? parsed.phase : undefined,
        output: typeof parsed.plan?.output === 'string' ? parsed.plan.output : undefined
    };
}

/** `./exports\final-4.mp4` のような表記ゆれを比較可能な形へ揃える。 */
export function normalizeArtifactPath(value: string | undefined): string | undefined {
    if (typeof value !== 'string') {
        return undefined;
    }
    const normalized = value.replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/+$/, '');
    return normalized === '' ? undefined : normalized;
}

/**
 * この成果物の自動オープンを今は待たせるべきか。
 * true = まだ開かない（同じ成果物を作っているレンダーが走行中）。
 */
export function shouldHoldArtifactOpen(input: {
    readonly renderState: RenderStateFacts | undefined;
    readonly artifactRelativePath: string;
    readonly waitedMs: number;
}): boolean {
    if (!(input.waitedMs < ARTIFACT_OPEN_GATE_TIMEOUT_MS)) {
        return false;
    }
    const state = input.renderState;
    if (!state) {
        return false;
    }
    const output = normalizeArtifactPath(state.output);
    const artifact = normalizeArtifactPath(input.artifactRelativePath);
    if (!output || !artifact || output !== artifact) {
        return false;
    }
    return PENDING_RENDER_PHASES.has(state.phase ?? '');
}
