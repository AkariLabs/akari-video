/** File naming and creation rules shared by timeline discovery and dialogs. */
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export const TIMELINE_ASPECT_PRESETS: readonly { id: string; label: string; width: number; height: number }[] = [
    { id: '16:9', label: '16:9', width: 1920, height: 1080 },
    { id: '9:16', label: '9:16', width: 1080, height: 1920 },
    { id: '1:1', label: '1:1', width: 1080, height: 1080 },
    { id: '4:5', label: '4:5', width: 1080, height: 1350 }
];

export function isTimelineEditFileName(name: string): boolean {
    return name === 'edit.json' || /^edit\.([a-z0-9]+(?:-[a-z0-9]+)*)\.json$/.test(name);
}

export function timelineSlugFromEditFileName(name: string): string | undefined {
    return name !== 'edit.json' && isTimelineEditFileName(name) ? name.slice(5, -5) : undefined;
}

function sidecarFileName(stem: string, slug?: string): string {
    if (slug !== undefined && !SLUG.test(slug)) throw new Error('Invalid timeline slug');
    return slug === undefined ? `${stem}.json` : `${stem}.${slug}.json`;
}

export function timelineEditFileName(slug?: string): string { return sidecarFileName('edit', slug); }
export function timelineCaptionsFileName(slug?: string): string { return sidecarFileName('captions', slug); }
export function timelineReviewFileName(slug?: string): string { return sidecarFileName('review', slug); }

export function slugifyTimelineName(name: string): string {
    return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

export function uniqueTimelineSlug(base: string, taken: readonly string[]): string {
    const stem = slugifyTimelineName(base) || 'timeline';
    let slug = stem;
    for (let suffix = 2; taken.includes(slug); suffix++) slug = `${stem}-${suffix}`;
    return slug;
}

export function estimateAspectFromOrientation(width?: number, height?: number): { width: number; height: number } {
    const portrait = Number.isFinite(width) && Number.isFinite(height) && width! > 0 && height! > width!;
    return portrait ? { width: 1080, height: 1920 } : { width: 1920, height: 1080 };
}

export function timelineDisplayName(slug: string | undefined, metaTitle?: string): string {
    return metaTitle?.trim() || slug || 'タイムライン';
}

export function timelineWidgetId(slug?: string): string {
    return slug === undefined ? 'akari-annotations-widget' : `akari-annotations-widget:${slug}`;
}

export function sortTimelineEditFileNames(names: readonly string[]): string[] {
    return names.filter(isTimelineEditFileName).sort((a, b) => {
        if (a === b) return 0;
        if (a === 'edit.json') return -1;
        if (b === 'edit.json') return 1;
        const left = timelineSlugFromEditFileName(a)!;
        const right = timelineSlugFromEditFileName(b)!;
        return left < right ? -1 : left > right ? 1 : 0;
    });
}

// v2 の語彙に meta はなく、packages/schemas/** は本タスクでは編集禁止のため出力しない。
// 表示名は slug へフォールバックする。スキーマ拡張は別票で扱う。
export function createTimelineEditContent(options: { width: number; height: number; fps?: number }): object {
    return {
        version: 2,
        output: { width: options.width, height: options.height, fps: options.fps ?? 30 },
        sources: [], tracks: []
    };
}
