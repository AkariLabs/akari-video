export interface PreviewPlaceholderInput {
    width?: number;
    height?: number;
    timeSeconds?: number;
    imageUrl?: string;
}

const escapeHtml = (value: string): string => value.replace(/[&<>"']/g, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
}[character]!));

export function previewPlaceholderHtml(input: PreviewPlaceholderInput): string {
    const width = Number.isFinite(input.width) && input.width! > 0 ? input.width! : 16;
    const height = Number.isFinite(input.height) && input.height! > 0 ? input.height! : 9;
    const tenths = Number.isFinite(input.timeSeconds) ? Math.round(Math.max(0, input.timeSeconds!) * 10) : undefined;
    const clock = tenths === undefined ? '' : ` · ${Math.floor(tenths / 600)}:${((tenths % 600) / 10).toFixed(1).padStart(4, '0')}`;
    const image = input.imageUrl?.startsWith('data:image/jpeg;base64,')
        ? `<img src="${escapeHtml(input.imageUrl)}" alt="" />` : '';
    return `<style>
.akari-placeholder-stage { position: absolute; left: 50%; top: 50%; width: min(calc(100cqw - 32px), calc((100cqh - 32px) * ${width} / ${height})); aspect-ratio: ${width} / ${height}; overflow: hidden; background: #000; transform: translate(-50%, -50%); }
.akari-placeholder-stage img { width: 100%; height: 100%; object-fit: contain; }
.akari-placeholder-status { position: absolute; left: 12px; bottom: 12px; padding: 5px 8px; border-radius: 4px; background: rgba(0,0,0,.72); color: #eee; font: 12px system-ui, sans-serif; }
</style><main class="akari-placeholder-stage" role="status">${image}<span class="akari-placeholder-status">読み込み中${escapeHtml(clock)}</span></main>`;
}
