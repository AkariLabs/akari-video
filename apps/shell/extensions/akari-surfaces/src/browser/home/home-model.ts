export interface HomeStats {
    duration?: string;
    clips?: string;
    assets?: string;
    bytes?: string;
    lastExport?: string;
}

/** A project with only declared sources has nothing to play on the output timeline. */
export function hasPreviewContent(edit: unknown): boolean {
    if (!edit || typeof edit !== 'object') { return false; }
    const value = edit as Record<string, unknown>;
    const timeline = value.timeline && typeof value.timeline === 'object' ? value.timeline as Record<string, unknown> : {};
    const hasItems = (items: unknown): boolean => Array.isArray(items) && items.length > 0;
    return [value.clips, value.cuts, value.overlays, value.layers, value.captions, timeline.clips].some(hasItems)
        || (Array.isArray(value.tracks) && value.tracks.some(track => track && typeof track === 'object' && hasItems((track as { items?: unknown }).items)));
}

export function formatDuration(seconds: unknown): string | undefined {
    if (typeof seconds !== 'number' || !Number.isFinite(seconds) || seconds < 0) { return undefined; }
    const whole = Math.floor(seconds);
    return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`;
}

export function formatBytes(bytes: unknown): string | undefined {
    if (typeof bytes !== 'number' || !Number.isFinite(bytes) || bytes < 0) { return undefined; }
    return bytes >= 1_000_000_000 ? `${(bytes / 1_000_000_000).toFixed(1)} GB`
        : bytes >= 1_000_000 ? `${(bytes / 1_000_000).toFixed(1)} MB`
            : `${Math.round(bytes / 1_000)} KB`;
}

export function buildHomeStats(edit: unknown, assetCount?: number, assetBytes?: number, lastExport?: number): HomeStats {
    const value = edit && typeof edit === 'object' ? edit as Record<string, unknown> : {};
    const timeline = value.timeline && typeof value.timeline === 'object' ? value.timeline as Record<string, unknown> : {};
    const tracks = Array.isArray(value.tracks) ? value.tracks : undefined;
    const trackItems = tracks?.flatMap(track => track && typeof track === 'object' && Array.isArray((track as { items?: unknown[] }).items) ? (track as { items: unknown[] }).items : []);
    const clips = Array.isArray(value.clips) ? value.clips : Array.isArray(timeline.clips) ? timeline.clips : trackItems;
    const fps = value.output && typeof value.output === 'object' ? (value.output as { fps?: unknown }).fps : undefined;
    const endFrames = trackItems?.reduce<number>((max, item) => {
        if (!item || typeof item !== 'object') { return max; }
        const clip = item as { at?: unknown; duration?: unknown };
        return typeof clip.at === 'number' && typeof clip.duration === 'number' ? Math.max(max, clip.at + clip.duration) : max;
    }, 0);
    const trackDuration = typeof fps === 'number' && fps > 0 && endFrames ? endFrames / fps : undefined;
    const duration = formatDuration(value.duration_s ?? timeline.duration_s ?? trackDuration);
    return {
        duration: duration === '0:00' ? '—' : duration,
        clips: clips ? clips.length ? String(clips.length) : '—' : undefined,
        assets: assetCount === undefined ? Array.isArray(value.sources) ? value.sources.length ? String(value.sources.length) : '—' : undefined : assetCount ? String(assetCount) : '—',
        bytes: assetBytes === 0 ? '—' : formatBytes(assetBytes),
        lastExport: lastExport === undefined ? undefined : new Date(lastExport).toLocaleString('ja-JP', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })
    };
}

export function homeWindowTitle(project: string, channel?: string): string {
    return `${project} — ${channel || '単体'}`;
}

export type UpdateStage = 'found' | 'downloading' | 'ready';
export function noticeStage(available: boolean, downloading: boolean, ready: boolean): UpdateStage | undefined {
    return ready ? 'ready' : downloading ? 'downloading' : available ? 'found' : undefined;
}

export function noticeStorageKey(version: string): string { return `akari.update.later.${version}`; }

export function shouldAutoShowNotice(next: { stage: UpdateStage; version: string } | undefined, previous: { stage: UpdateStage; version: string } | undefined, postponed: boolean, dismissed = false): boolean {
    return !!next && !postponed && !dismissed && (next.stage !== previous?.stage || next.version !== previous?.version);
}

export function validateChannelName(input: string, existing: readonly string[]): { name?: string; error?: string } {
    const name = input.trim();
    if (!name) { return { error: 'チャンネル名を入力してください。' }; }
    if (name === '.' || name.includes('..') || /[/\\<>:"|?*]/.test(name) || [...name].some(char => char.charCodeAt(0) < 32)) {
        return { error: '「/」「\\」「..」やファイル名に使えない文字は入れられません。' };
    }
    if (name.length > 64) { return { error: 'チャンネル名は 64 文字以内にしてください。' }; }
    if (existing.some(channel => channel.toLocaleLowerCase() === name.toLocaleLowerCase())) {
        return { error: '同じ名前のチャンネルがあります。' };
    }
    return { name };
}
