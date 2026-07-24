/**
 * analyze-footage が出力する analysis.json（skills/analyze-footage/references/analysis.schema.json）
 * の一部だけを読む最小の型と導出関数。スキーマそのものの再実装ではなく、
 * カード表示に要る尺とサムネイルだけを既存契約から機械的に取り出す。
 */
export interface AnalysisTranscriptSegment {
    start: number;
    end: number;
}

export interface AnalysisKeyframe {
    t: number;
    path: string;
}

export interface AnalysisEvent {
    type: string;
    start?: number;
    end?: number;
    t?: number;
}

export interface AnalysisJson {
    version: number;
    source: string;
    transcript?: AnalysisTranscriptSegment[];
    keyframes?: AnalysisKeyframe[];
    events?: AnalysisEvent[];
}

/**
 * analysis.schema.json にトップレベルの duration フィールドは無いため、
 * transcript[].end / keyframes[].t / events[].end（filler/trouble/highlight/hook）/
 * events[].t（chapter）の最大値から導出する。全て空なら 0。
 */
export function deriveAnalysisDurationSeconds(analysis: AnalysisJson): number {
    const values: number[] = [];
    for (const segment of analysis.transcript ?? []) {
        if (typeof segment.end === 'number') {
            values.push(segment.end);
        }
    }
    for (const keyframe of analysis.keyframes ?? []) {
        if (typeof keyframe.t === 'number') {
            values.push(keyframe.t);
        }
    }
    for (const event of analysis.events ?? []) {
        if (typeof event.end === 'number') {
            values.push(event.end);
        }
        if (typeof event.t === 'number') {
            values.push(event.t);
        }
    }
    return values.length ? Math.max(...values) : 0;
}

export function formatDurationBadge(seconds: number): string {
    const total = Math.max(0, Math.round(seconds));
    const minutes = Math.floor(total / 60);
    const rest = (total % 60).toString().padStart(2, '0');
    return `${minutes}:${rest}`;
}
