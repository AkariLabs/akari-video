import type { AssetBinChildNode } from './asset-bin-grouping';

export type MaterialKind = 'video' | 'audio' | 'image' | 'other';

/** 生ファイルと素材グループで共通の拡張子判定。 */
export function classifyMaterialKind(name: string): MaterialKind {
    const lower = name.toLowerCase();
    if (/\.(mp4|mov|m4v|webm|mkv|avi)$/.test(lower)) {
        return 'video';
    }
    if (/\.(wav|mp3|m4a|aac|flac|ogg)$/.test(lower)) {
        return 'audio';
    }
    if (/\.(png|jpg|jpeg|gif|webp)$/.test(lower)) {
        return 'image';
    }
    return 'other';
}

export interface AssetGroupMedia {
    kind: MaterialKind;
    mediaName?: string;
}

/** 直下に主メディアを一意に持つカテゴリだけをタイムラインへ配置できる。 */
export function resolveAssetGroupMedia(category: string | undefined, children: readonly AssetBinChildNode[]): AssetGroupMedia {
    const kind = category === 'audio' ? 'audio' : category === 'broll' ? 'video' : category === 'still' ? 'image' : 'other';
    if (kind === 'other') {
        return { kind: 'other' };
    }
    const files = children.filter(child => !child.isDirectory);
    if (category === 'still' && files.some(child => /\.html?$/i.test(child.name))) {
        return { kind: 'other' };
    }
    const media = files.filter(child => classifyMaterialKind(child.name) === kind
        && (category !== 'still' || child.name.toLowerCase() !== 'preview.png'));
    return media.length === 1 ? { kind, mediaName: media[0].name } : { kind: 'other' };
}
