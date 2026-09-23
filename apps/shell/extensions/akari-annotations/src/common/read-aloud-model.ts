import type { NarrationEngine, NarrationVoice } from './akari-annotations-protocol';

export function selectReadAloudEngine(engines: readonly NarrationEngine[], preferred?: string): NarrationEngine | undefined {
    const available = engines.filter(engine => engine.availability.state === 'available'
        || (engine.id === 'voicevox' && engine.availability.state === 'needs'));
    return available.find(engine => engine.id === preferred)
        ?? available.find(engine => engine.id === 'voicevox') ?? available[0];
}

export function selectReadAloudVoice(voices: readonly NarrationVoice[], preferred?: string): NarrationVoice | undefined {
    return voices.find(voice => voice.id === preferred) ?? voices.find(voice => voice.default) ?? voices[0];
}

export function narrationEstimate(engine: NarrationEngine, reading: string): {
    chars: number; usd: number; yen: number; provisional: boolean; label: string
} {
    const chars = reading.length;
    const usd = chars / 1000 * (engine.price?.usd_per_1000_chars ?? 0);
    return { chars, usd, yen: Math.round(usd * 150), provisional: engine.price?.verified === false,
        label: engine.place === 'local' ? '費用 ¥0' : `見積 $${usd.toFixed(3)}（≈ ¥${Math.round(usd * 150)}）· 承認 1 回` };
}

export interface ReadAloudRow { id: string; text: string; start: number; end: number;
    timeDomain: 'source' | 'output'; outputStart?: number; nextStart?: number }

/** 出力に現れる字幕だけを対象にし、画面上の順序で返す。 */
export function selectReadAloudRows(rows: readonly ReadAloudRow[], selectedIds: readonly string[] = []): ReadAloudRow[] {
    const selected = new Set(selectedIds);
    return rows.filter(row => row.text.trim() && Number.isFinite(row.outputStart)
        && (selected.size === 0 || selected.has(row.id)))
        .sort((a, b) => a.outputStart! - b.outputStart! || a.id.localeCompare(b.id));
}

export function batchNarrationEstimate(engine: NarrationEngine, readings: readonly string[]): ReturnType<typeof narrationEstimate> {
    return narrationEstimate(engine, readings.join(''));
}

export type OverflowChoice = 'extend' | 'retry' | 'keep';
export function defaultOverflowAction(input: { frameSeconds: number; durationSeconds: number;
    timeDomain: 'source' | 'output'; enginePlace: 'local' | 'cloud'; speedSupported: boolean;
    start: number; nextStart?: number }): { choice: OverflowChoice; extendEnd?: number; remainder: number; recommendedSpeed: number } {
    const comparison = compareNarrationDuration(input.frameSeconds, input.durationSeconds, input.timeDomain, input.speedSupported);
    if (comparison.overflow <= 0) return { choice: 'keep', remainder: 0, recommendedSpeed: comparison.recommendedSpeed };
    if (input.timeDomain === 'output') {
        const desired = input.start + input.durationSeconds;
        const extendEnd = Math.min(desired, Math.max(input.start + input.frameSeconds, input.nextStart ?? Infinity));
        return { choice: 'extend', extendEnd, remainder: Math.max(0, desired - extendEnd), recommendedSpeed: comparison.recommendedSpeed };
    }
    if (input.enginePlace === 'local' && input.speedSupported) return {
        choice: 'retry', remainder: comparison.overflow, recommendedSpeed: comparison.recommendedSpeed
    };
    return { choice: 'keep', remainder: comparison.overflow, recommendedSpeed: comparison.recommendedSpeed };
}

export function staleNarrations(narrations: readonly { id: string; caption_ref?: string | null; script?: string }[],
    captions: readonly { id: string; text: string }[]): Set<string> {
    const texts = new Map(captions.map(caption => [caption.id, caption.text]));
    return new Set(narrations.filter(narration => narration.caption_ref && texts.has(narration.caption_ref)
        && narration.script !== texts.get(narration.caption_ref)).map(narration => narration.id));
}

/** 試聴前の表示と費用承認を、エンジンの availability を含む CLI 応答から決定する。 */
export function readAloudPreviewPlan(engine: NarrationEngine, reading: string): {
    buttonLabel: string; footnote: string; needsApproval: boolean;
    confirm?: { title: string; msg: string; ok: string; cancel: string };
} {
    if (engine.place === 'local') return {
        buttonLabel: '▶ 試聴',
        footnote: 'ローカルなので費用承認なし。作った音声はまず試聴、置くのはその後。',
        needsApproval: false
    };
    const quote = narrationEstimate(engine, reading);
    return {
        buttonLabel: '費用を見て試聴…',
        footnote: 'クラウド。試聴の前に費用承認を 1 回。送るのは読み原稿の文字だけ。',
        needsApproval: true,
        confirm: {
            title: '費用承認',
            msg: `$${quote.usd.toFixed(3)}（as_of ${engine.price?.as_of ?? '未確認'}）で gemini-tts（fal）に 読み原稿 ${quote.chars} 字 を送ります。費用承認しますか`,
            ok: '費用承認する', cancel: 'キャンセル'
        }
    };
}

export function compareNarrationDuration(frameSeconds: number | undefined, durationSeconds: number, timeDomain?: string, speedSupported = false): {
    overflow: number; extendEnabled: boolean; retryEnabled: boolean; recommendedSpeed: number
} {
    const overflow = frameSeconds === undefined ? 0 : Math.max(0, durationSeconds - frameSeconds);
    return {
        overflow,
        extendEnabled: overflow > 0 && timeDomain === 'output',
        retryEnabled: overflow > 0 && speedSupported,
        recommendedSpeed: frameSeconds && frameSeconds > 0
            ? Math.min(2, Math.ceil(durationSeconds / frameSeconds * 20) / 20) : 2
    };
}
