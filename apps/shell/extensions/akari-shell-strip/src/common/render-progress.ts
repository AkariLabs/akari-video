import { t } from './shell-text';
/**
 * `.akari/render.json`（render-cut スキルが書く。本拡張は書き込まない）を
 * 寛容リーダーで読み、進捗表示用の最小状態へ変換する純関数。
 *
 * スキーマは新設しない — render-cut 側の実物（内部 dogfood-v2 実走の
 * render.json）と skills/render-cut/SKILL.md
 * の記述から復元した形を読むだけ。未知の形・欠落フィールドは例外を投げず
 * 'unknown' へフォールバックする。
 */

export interface RenderProgressEngine {
    // 互換経路を含む未知のエンジン名は、render.json の文字列をそのまま保持する。
    // 表示側は gpu / osr だけを特別扱いし、それ以外は汎用ラベルへフォールバックする。
    // eslint-disable-next-line @typescript-eslint/ban-types -- 任意の文字列を保ちつつ既知値の補完も維持する。
    readonly name: 'gpu' | 'osr' | (string & {});
    readonly fallbackReason?: string;
    readonly ineligible?: readonly string[];
}

export type RenderProgressState =
    | { readonly kind: 'in-progress'; readonly label: string; readonly percent: number; readonly engine?: RenderProgressEngine }
    | { readonly kind: 'done'; readonly label: string; readonly percent: number; readonly artifactPath: string; readonly engine?: RenderProgressEngine }
    | { readonly kind: 'failed'; readonly label: string; readonly engine?: RenderProgressEngine }
    | { readonly kind: 'unknown'; readonly label: string; readonly engine?: RenderProgressEngine };

export const RENDER_PROGRESS_UNKNOWN_LABEL = t('shell.export.renderProgress.progressUnknownExportingStatus');

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
const GPU_INELIGIBLE_WARNING_PREFIX = 'GPU export is ineligible; using OSR: ';

export function parseRenderProgress(raw: unknown): RenderProgressState {
    if (!isRecord(raw)) {
        return { kind: 'unknown', label: RENDER_PROGRESS_UNKNOWN_LABEL };
    }

    const engine = parseRenderEngine(raw);
    const verify = isRecord(raw.verify) ? raw.verify : undefined;
    const verdict = typeof verify?.verdict === 'string' ? verify.verdict : undefined;

    if (verdict === 'fail') {
        return { kind: 'failed', label: describeFailure(verify), engine };
    }

    if (verdict === 'pass') {
        const artifactPath = firstArtifactPath(raw.artifacts);
        if (artifactPath) {
            return { kind: 'done', label: doneLabel(engine), percent: 100, artifactPath, engine };
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
        label: inProgressLabel(phase, engine),
        percent: estimatePercent(phase),
        engine
    };
}

function parseRenderEngine(raw: Record<string, unknown>): RenderProgressEngine | undefined {
    const provenance = isRecord(raw.provenance) ? raw.provenance : undefined;
    const actual = engineName(provenance?.engine);
    const requested = engineName(provenance?.engine_requested);
    const name = actual ?? (requested === 'gpu' || requested === 'osr' ? requested : undefined);
    if (!name) {
        return undefined;
    }
    const fallback = isRecord(provenance?.engine_fallback) ? provenance.engine_fallback : undefined;
    const fallbackReason = typeof fallback?.reason === 'string' && fallback.reason.trim()
        ? fallback.reason.trim()
        : undefined;
    const ineligible = Array.isArray(raw.warnings)
        ? raw.warnings
            .filter((warning): warning is string => typeof warning === 'string')
            .filter(warning => warning.startsWith(GPU_INELIGIBLE_WARNING_PREFIX))
            .flatMap(warning => warning.slice(GPU_INELIGIBLE_WARNING_PREFIX.length).split('; '))
            .map(entry => entry.trim())
            .filter(Boolean)
        : [];
    return {
        name,
        ...(fallbackReason ? { fallbackReason } : {}),
        ...(ineligible.length > 0 ? { ineligible } : {})
    };
}

function engineName(value: unknown): RenderProgressEngine['name'] | undefined {
    return typeof value === 'string' && value.trim() ? value : undefined;
}

function doneLabel(engine: RenderProgressEngine | undefined): string {
    if (!engine) {
        return t('shell.export.renderProgress.exportCompleteStatus');
    }
    if (engine.name === 'gpu') {
        return t('shell.export.renderProgress.exportCompleteGpuStatus');
    }
    if (engine.name === 'osr' && engine.ineligible?.length) {
        const first = formatIneligible(engine.ineligible[0]);
        const remainder = engine.ineligible.length - 1;
        return t('shell.export.renderProgress.exportCompleteOsrGpuIneligibleStatus', { value1: first, value2: remainder > 0 ? t('shell.export.renderProgress.additionalReasons', { n: remainder }) : '' });
    }
    if (engine.name === 'osr' && engine.fallbackReason) {
        return t('shell.export.renderProgress.exportCompleteOsrNoGpuExecutableStatus', { value1: engine.fallbackReason });
    }
    if (engine.name === 'osr') {
        return t('shell.export.renderProgress.exportCompleteOsrStatus');
    }
    return t('shell.export.renderProgress.exportCompleteWithArtifactStatus', { value1: engine.name });
}

function inProgressLabel(phase: string | undefined, engine: RenderProgressEngine | undefined): string {
    const base = phase ? t('shell.export.renderProgress.exportingPhaseStatus', { value1: phase }) : t('shell.export.renderProgress.exportingStatus');
    if (engine?.name === 'gpu') {
        return t('shell.export.renderProgress.exportingGpuLabel', { value1: base });
    }
    if (engine?.name === 'osr') {
        return t('shell.export.renderProgress.exportingOsrLabel', { value1: base });
    }
    return engine ? t('shell.export.renderProgress.exportingWithEngineStatus', { value1: base, value2: engine.name }) : base;
}

function formatIneligible(entry: string): string {
    const [, id, ...reasonParts] = entry.split(':');
    const reason = reasonParts.join(':').trim();
    return id?.trim() && reason ? `${id.trim()}: ${reason}` : entry;
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
        ? t('shell.export.renderProgress.exportFailedWithReasonError', { value1: errorMessage })
        : t('shell.export.renderProgress.exportFailedError');
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null;
}
