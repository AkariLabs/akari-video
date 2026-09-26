/**
 * ブラウザ安全なエントリポイント（テキスト手術のみ）。
 * lint ゲート付き書き込み（Node 専用）は './write-gate' を明示的に import すること
 * （ここから re-export すると browser バンドルに node builtins が混入するため分離している）。
 */
export * from './edit-store';
export * from './caption-store';
export * from './caption-style-preset';
export * from './generated/textstyle-catalog';
export * from './caption-words-rederive';
export * from './caption-window';
export * from './caption-clock';
export * from './timeline-map';
export * from './caption-display';
export * from './caption-runs';
export * from './generation-meta';
// Includes AdjustV1 and its curve/wheel/hue types; AdjustV0 remains an alias.
export * from './edit-v2';
export * from './edit-v2-item-write';
export * from './internal-model';
export * from './legacy-audio-view';
export * from './retime';
export * from './track-order';
export * from './track-z';
export * from './track-transition-compatibility';
export * from './cut-adjacency';
export * from './transition-vocabulary';
export * from './transition-visual';
export * from './ducking';
export * from './envelope';
export * from './audio-schedule';
export * from './audio-ownership';
export * from './cut-audio-split-ops';
export * from './canonical';
export * from './tree-ops';
export * from './item-anchor';
export * from './shape-markup';
export * from './shape-preset';
export * from './cut-ranges';
export * from './adjust-css-approx';
// Legacy parser implementation lives in the frozen migration unit. This re-export keeps
// text-surgery consumers source-compatible while preventing legacy knowledge from returning
// to edit-store.ts.
export { parseEdit } from './migrate/legacy-parse';
export { LegacyEditVersionError } from './migrate/error';
export * from './adjust-css-visual';

export { effectiveScale, normalizeTransform } from './transform';
export * from './transform-keyframe-edit';

// write-gate.ts の SAVED_BY_PATH と同値に保つ。
export const SAVED_BY_PATH = '.akari/saved-by.json';
const SAVED_BY_SCHEMA_VERSION = 1;

export interface SavedByStamp {
    version: 1;
    app: 'akari-video';
    appVersion: string;
    savedAt: string;
}

export function parseSavedBy(text: string | undefined): SavedByStamp | undefined {
    if (!text) return undefined;
    try {
        const value: unknown = JSON.parse(text);
        if (!value || typeof value !== 'object') return undefined;
        const stamp = value as Partial<SavedByStamp>;
        return stamp.version === SAVED_BY_SCHEMA_VERSION && stamp.app === 'akari-video'
            && typeof stamp.appVersion === 'string' && /^\d+\.\d+\.\d+(?:[-+][\w.-]+)?$/.test(stamp.appVersion)
            && typeof stamp.savedAt === 'string' && !Number.isNaN(Date.parse(stamp.savedAt))
            ? stamp as SavedByStamp : undefined;
    } catch {
        return undefined;
    }
}

export function newerSavedByVersion(
    text: string | undefined,
    currentVersion: string | undefined,
    compareVersions: (left: string, right: string) => number
): string | undefined {
    const savedVersion = parseSavedBy(text)?.appVersion;
    return savedVersion && currentVersion && compareVersions(savedVersion, currentVersion) > 0
        ? savedVersion : undefined;
}

export function isUnknownKeyEditError(error: unknown): boolean {
    const message = error instanceof Error ? error.message : String(error);
    return /edit\.json[^\n]*未定義キーを使用できません/.test(message);
}

export function newerVersionOpenNotice(savedVersion: string, currentVersion: string): string {
    return `このプロジェクトは新しい版の AKARI Video（v${savedVersion}）で保存されています。`
        + `いまの版（v${currentVersion}）では開けない機能が使われています。AKARI Video を更新してください。`;
}

export function newerVersionLintPrefix(savedVersion: string): string {
    return `このプロジェクトは新しい版（v${savedVersion}）で保存されています。`
        + 'いまの版の検証は新しい機能を知らないため、誤ってエラーを出すことがあります。';
}

export function withNewerVersionLintPrefix(message: string, savedVersion?: string): string {
    return savedVersion ? `${newerVersionLintPrefix(savedVersion)} ${message}` : message;
}
