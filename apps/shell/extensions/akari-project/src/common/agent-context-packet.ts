import { formatDurationBadge } from './analysis-summary';

/**
 * GUI カード操作からエージェントへ渡す「文脈パケット」を組み立てる汎用 composer。
 * 素材カードの「エージェントに頼む」アクションが最初の呼び出し元だが、
 * 後続（プランタブ・カタログの Ask agent 等）も同じ関数を再利用する前提で、
 * 対象種別（targetKind）ごとの語彙をここに持ち込まない純関数として切り出す。
 */
export interface AgentContextField {
    /** 例: '尺'・'analysis:'。省略時はラベル無しで値だけを出す。 */
    label?: string;
    value: string;
}

/**
 * fields[0] は対象の識別子（例: 素材のプロジェクト相対パス）として
 * 【targetKind】の直後・括弧の外に出す。fields[1..] は括弧内へ「・」区切りで
 * 並べる。sendText 側が 1 行送信を前提とするため、依頼文中の改行は空白へ
 * 畳み込み、結果は必ず 1 行の文字列になる。
 */
export function composeAgentContextPacket(
    targetKind: string,
    fields: readonly AgentContextField[],
    request: string
): string {
    if (fields.length === 0) {
        throw new Error('composeAgentContextPacket: fields は最低 1 件必要です');
    }
    const [primary, ...rest] = fields;
    const detail = rest.map(renderField).join('・');
    const suffix = detail ? `（${detail}）` : '';
    return `【${targetKind}】${renderField(primary)}${suffix}について: ${collapseToSingleLine(request)}`;
}

function renderField(field: AgentContextField): string {
    return field.label ? `${field.label} ${field.value}` : field.value;
}

function collapseToSingleLine(text: string): string {
    return text.replace(/\s+/g, ' ').trim();
}

/** 素材カードから composeAgentContextPacket へ渡す前段の入力。 */
export interface MaterialAgentContext {
    /** プロジェクト相対パス（例: assets/clip.mp4）。 */
    relativePath: string;
    analyzed: boolean;
    durationSeconds?: number;
    /** analysis.json のプロジェクト相対パス。analyzed のときのみ意味を持つ。 */
    analysisRelativePath?: string;
}

const MATERIAL_TARGET_KIND = '素材';
const DURATION_UNKNOWN_LABEL = '尺不明';
const ANALYZED_LABEL = '分析済み';
const NOT_ANALYZED_LABEL = '未分析';

/**
 * 素材カード「エージェントに頼む」の v0 唯一の呼び出し元。必須要素:
 * プロジェクト相対パス・尺（未分析は「尺不明」）・分析状態・
 * analysis.json の相対パス（分析済みのときのみ）・ユーザー入力文。
 */
export function composeMaterialAskAgentPrompt(context: MaterialAgentContext, request: string): string {
    const fields: AgentContextField[] = [
        { value: context.relativePath },
        context.analyzed
            ? { label: '尺', value: formatDurationBadge(context.durationSeconds ?? 0) }
            : { value: DURATION_UNKNOWN_LABEL },
        { value: context.analyzed ? ANALYZED_LABEL : NOT_ANALYZED_LABEL }
    ];
    if (context.analyzed && context.analysisRelativePath) {
        fields.push({ label: 'analysis:', value: context.analysisRelativePath });
    }
    return composeAgentContextPacket(MATERIAL_TARGET_KIND, fields, request);
}
