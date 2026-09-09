export interface ClipKindBadgeItem {
    source?: { kind?: string; path?: string; src?: string };
}

export interface ClipKindBadgeContext {
    path?: string;
    lane?: 'visual' | 'audio';
}

const MEDIA_EXTENSIONS = {
    image: new Set(['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp', 'tif', 'tiff', 'avif', 'heic']),
    audio: new Set(['wav', 'mp3', 'm4a', 'aac', 'flac', 'ogg', 'opus', 'aif', 'aiff'])
};

/** 素材カードと語彙を揃える。akari-project は依存境界外のため表は共有しない。 */
export function clipKindBadge(
    item: ClipKindBadgeItem | undefined, context: ClipKindBadgeContext = {}
): { text: string; title: string } | undefined {
    let text: string;
    switch (item?.source?.kind) {
        case 'html':
            text = (context.path ?? item?.source?.path ?? '').split(/[\\/]/).includes('scene3d') ? '3D' : 'HTML';
            break;
        case 'media': {
            const path = context.path ?? item?.source?.src ?? '';
            const extension = /\.([^./\\]+)$/.exec(path)?.[1].toLowerCase() ?? '';
            text = context.lane === 'audio' ? '音声'
                : MEDIA_EXTENSIONS.image.has(extension) ? '画像'
                    : MEDIA_EXTENSIONS.audio.has(extension) ? '音声' : '動画';
            break;
        }
        case 'scene3d': text = '3D'; break;
        case 'video': text = '動画'; break;
        case 'image': text = '画像'; break;
        case 'audio': text = '音声'; break;
        case 'caption': text = '字幕'; break;
        default: return undefined;
    }
    return { text, title: `種別: ${text}` };
}
