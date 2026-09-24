import type { NarrationEngine, NarrationVoice, VoiceProfileSummary, VoiceEngine } from './akari-annotations-protocol';
import { GEMINI_WATERMARK_NOTICE } from './voice-clone-model';

export function voiceProfileConsent(profile: VoiceProfileSummary): boolean {
    return typeof profile.consent === 'string' ? profile.consent.trim().length > 0 : profile.consent?.self_voice === true;
}

/** CLI は鍵だけある環境でも needs を返すことがある。 */
export function falKeyAvailable(engine: Pick<NarrationEngine, 'id' | 'availability'> | undefined): boolean {
    return engine?.id === 'fal-qwen3' && engine.availability.state !== 'unconfigured';
}

export function orderedVoiceProfiles(profiles: readonly VoiceProfileSummary[], defaultProfile?: string):
    Array<{ profile: VoiceProfileSummary; selectable: boolean }> {
    const rows = profiles.filter(profile => !profile.legacy || !profiles.some(other => other.id === profile.id && !other.legacy));
    const index = rows.findIndex(profile => profile.id === defaultProfile);
    if (index > 0) rows.unshift(...rows.splice(index, 1));
    return rows.map(profile => ({ profile, selectable: voiceProfileConsent(profile) }));
}

export function readAloudProvenanceLabel(provenance: Record<string, unknown> | undefined,
    profiles: readonly VoiceProfileSummary[]): string {
    const credit = typeof provenance?.credit === 'string' ? provenance.credit.trim() : '';
    if (credit) return credit;
    const voice = typeof provenance?.voice === 'string' ? provenance.voice : '';
    if (voice.startsWith('profile:')) {
        const id = voice.slice('profile:'.length);
        const profile = profiles.find(item => item.id === id);
        return profile ? `自分の声（${profile.label}）` : voice;
    }
    return voice || '—';
}

export function chooseVoiceCopy(profile: VoiceProfileSummary, irodoriAvailable: boolean, falAvailable: boolean):
    { engine?: VoiceEngine; stale: boolean } {
    if (!voiceProfileConsent(profile)) return { stale: false };
    const local = profile.engines.includes('irodori');
    const cloud = profile.engines.includes('fal-qwen3');
    if (local && irodoriAvailable && profile.copies?.irodori?.stale !== true) return { engine: 'irodori', stale: false };
    if (cloud && falAvailable) return { engine: 'fal-qwen3', stale: profile.copies?.['fal-qwen3']?.stale === true };
    if (local && irodoriAvailable) return { engine: 'irodori', stale: true };
    return { stale: false };
}

export const READ_ALOUD_LOCAL_IDS = ['voicevox', 'irodori'] as const;
export const READ_ALOUD_CLOUD_IDS = ['gemini-3.8-flash-tts', 'gemini-3.1-flash-tts', 'gemini-tts',
    'elevenlabs-v3', 'fish-s2.1-pro', 'minimax-2.6-hd', 'chatterbox'] as const;
export const READ_ALOUD_COPY_IDS = ['irodori', 'fal-qwen3', 'gemini-3.8-flash-tts', 'minimax-2.6-hd',
    'fish-s2.1-pro', 'chatterbox', 'index-tts-2'] as const;

export function readAloudProvider(engine: NarrationEngine): string {
    return engine.provider === 'fish-audio' ? 'Fish Audio' : engine.provider === 'google-ai' ? 'Google' : 'fal';
}

export function readAloudKeyMissing(engine: NarrationEngine): boolean {
    return engine.place === 'cloud' && engine.availability.state === 'unconfigured';
}

export function readAloudStyleEnabled(engine: NarrationEngine | undefined, voice: string, voiceMode: boolean): boolean {
    if (!engine) return false;
    return engine.id === 'irodori' ? !voiceMode && voice === 'custom' : engine.supports?.style === true;
}

export function readAloudAutoVerify(engineId: string, verificationAvailable: boolean): boolean {
    return engineId === 'chatterbox' && verificationAvailable;
}

export function readAloudEngineGroups(engines: readonly NarrationEngine[], previous?: string): {
    local: NarrationEngine[]; cloud: NarrationEngine[]; visible: NarrationEngine[]; hidden: NarrationEngine[]
} {
    const local = READ_ALOUD_LOCAL_IDS.flatMap(id => engines.filter(engine => engine.id === id));
    const cloud = READ_ALOUD_CLOUD_IDS.flatMap(id => engines.filter(engine => engine.id === id))
        .sort((a, b) => Number(readAloudKeyMissing(a)) - Number(readAloudKeyMissing(b)));
    const visible = cloud.filter((engine, index) => index < 3 || engine.id === previous);
    return { local, cloud, visible, hidden: cloud.filter(engine => !visible.includes(engine)) };
}

export function readAloudPrice(engine: NarrationEngine): string {
    if (engine.place !== 'cloud') return '無料';
    const price = engine.price;
    const unit = price?.unit ?? (price?.usd_per_1000_chars !== undefined ? 'usd_per_1000_chars' : null);
    const value = price?.value ?? price?.usd_per_1000_chars;
    if (unit === null || value === undefined || value === null) return '見積不可';
    const suffix = unit === 'usd_per_second' ? '秒' : unit === 'usd_per_request' ? '回' : '1000 字';
    return `$${value} / ${suffix}${price?.verified === false ? '（暫定）' : ''}`;
}

export function readAloudCopyEngines(profile: VoiceProfileSummary, engines: readonly NarrationEngine[], last?: string): {
    options: Array<{ engine: NarrationEngine; usable: boolean; stale: boolean; reason?: string }>; selected?: string
} {
    const usable = new Set(profile.usable_engines ?? profile.engines);
    const options = READ_ALOUD_COPY_IDS.flatMap(id => engines.filter(engine => engine.id === id)).map(engine => {
        const stale = profile.copies?.[engine.id]?.stale === true;
        const reason = engine.id === 'irodori' && engine.availability.state !== 'available' ? 'つながりません'
            : engine.availability.state === 'unconfigured' ? '鍵なし'
            : !usable.has(engine.id) || engine.availability.state !== 'available' ? '写しなし' : undefined;
        return { engine, usable: reason === undefined, stale, reason };
    });
    const selected = (options.find(row => row.engine.id === 'irodori' && row.usable)
        ?? options.find(row => row.engine.id === last && row.usable)
        ?? options.find(row => row.usable))?.engine.id;
    return { options, selected };
}

export function readAloudCopyOptionLabel(row: { engine: NarrationEngine; stale: boolean; reason?: string }): string {
    const name = row.engine.id === 'irodori' ? '彩（無料・自分の PC）' : row.engine.label;
    return `${name}${row.stale ? '（写しが古い）' : ''}${row.reason ? `（${row.reason}）` : ''}`;
}

export function readAloudCopyNote(row: { engine: NarrationEngine; stale: boolean }): string {
    return `${row.engine.supports?.clone === 'per-request' ? '録音を毎回送ります' : '写しを使います'}${row.stale ? ' · 写しが古いです' : ''}`
        + (row.engine.id === 'gemini-3.8-flash-tts' ? ` · ${GEMINI_WATERMARK_NOTICE}` : '');
}

export function selectReadAloudEngine(engines: readonly NarrationEngine[], preferred?: string): NarrationEngine | undefined {
    const available = engines.filter(engine => engine.availability.state === 'available'
        || (engine.id === 'voicevox' && engine.availability.state === 'needs'));
    return available.find(engine => engine.id === preferred)
        ?? available.find(engine => engine.id === 'voicevox') ?? available[0];
}

export function selectReadAloudVoice(voices: readonly NarrationVoice[], preferred?: string): NarrationVoice | undefined {
    return voices.find(voice => voice.id === preferred) ?? voices.find(voice => voice.default) ?? voices[0];
}

/** needs のときだけ常駐起動し、生成前にカードを取り直す。 */
export async function prepareReadAloudEngine(engine: NarrationEngine,
    start: () => Promise<unknown>, refresh: () => Promise<readonly NarrationEngine[]>): Promise<void> {
    if (engine.id !== 'voicevox' || engine.availability.state !== 'needs') return;
    await start();
    const engines = await refresh();
    if (!engines.some(item => item.id === 'voicevox' && item.availability.state === 'available')) {
        throw new Error('VOICEVOX の起動を確認できませんでした。');
    }
}

/** 要修正行は読みが変わるまで再生成を始めない。失敗行はそのまま再試行できる。 */
export function batchRetryAction(state: { status: 'wait' | 'running' | 'done' | 'failed';
    verdict?: 'ok' | 'check' | 'ng'; reading: string; verifiedReading?: string }): 'none' | 'focus-reading' | 'regenerate' {
    if (state.status === 'failed') return 'regenerate';
    if (state.status === 'wait' && state.verifiedReading !== undefined && state.reading !== state.verifiedReading) return 'regenerate';
    if (state.status === 'done' && (state.verdict === 'check' || state.verdict === 'ng')) return 'focus-reading';
    return 'none';
}

export function irodoriCustomVoiceMissing(engineId: string | undefined, voiceId: string, style: string): boolean {
    return engineId === 'irodori' && voiceId === 'custom' && !style.trim();
}

export function narrationEstimate(engine: NarrationEngine, reading: string): {
    chars: number; usd: number | null; yen: number | null; provisional: boolean; label: string
} {
    const chars = reading.length;
    const unit = engine.price?.unit ?? (engine.price?.usd_per_1000_chars !== undefined ? 'usd_per_1000_chars' : null);
    const value = engine.price?.value ?? engine.price?.usd_per_1000_chars;
    const usd = engine.place !== 'cloud' ? 0 : value == null ? null : unit === 'usd_per_second'
        ? chars / 5 * value : unit === 'usd_per_request' ? value : chars / 1000 * value;
    return { chars, usd, yen: usd === null ? null : Math.round(usd * 150), provisional: engine.price?.verified === false,
        label: engine.place !== 'cloud' ? '費用 ¥0' : usd === null ? '見積不可（従量）' :
            `見積 $${usd.toFixed(3)}（≈ ¥${Math.round(usd * 150)}）· 承認 1 回` };
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
    timeDomain: 'source' | 'output'; enginePlace: 'local' | 'network' | 'cloud'; speedSupported: boolean;
    start: number; nextStart?: number }): { choice: OverflowChoice; extendEnd?: number; remainder: number; recommendedSpeed: number } {
    const comparison = compareNarrationDuration(input.frameSeconds, input.durationSeconds, input.timeDomain, input.speedSupported);
    if (comparison.overflow <= 0) return { choice: 'keep', remainder: 0, recommendedSpeed: comparison.recommendedSpeed };
    if (input.timeDomain === 'output') {
        const desired = input.start + input.durationSeconds;
        const extendEnd = Math.min(desired, Math.max(input.start + input.frameSeconds, input.nextStart ?? Infinity));
        return { choice: 'extend', extendEnd, remainder: Math.max(0, desired - extendEnd), recommendedSpeed: comparison.recommendedSpeed };
    }
    if (input.enginePlace !== 'cloud' && input.speedSupported) return {
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
    if (engine.place !== 'cloud') return {
        buttonLabel: '▶ 試聴',
        footnote: engine.id === 'irodori' ? '彩は時間がかかります（お試し）。作った音声を試聴してから置きます。' : 'ローカルなので費用承認なし。作った音声はまず試聴、置くのはその後。',
        needsApproval: false
    };
    const quote = narrationEstimate(engine, reading);
    return {
        buttonLabel: '費用を見て試聴…',
        footnote: 'クラウド。試聴の前に費用承認を 1 回。送るのは読み原稿の文字だけ。',
        needsApproval: true,
        confirm: {
            title: '費用承認',
            msg: quote.usd === null ? `見積を出せません。送ると ${readAloudProvider(engine)} の従量で課金されます。送りますか` :
                `$${quote.usd.toFixed(3)}（as_of ${engine.price?.as_of ?? '未確認'}）で ${readAloudProvider(engine)} に 読み原稿 ${quote.chars} 字 を送ります。費用承認しますか`,
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
