import { ProjectTreePolicy, shouldShowProjectPath } from './project-tree-policy';

export type UnorganizedMaterialKind = 'video' | 'audio' | 'image';

/**
 * 未整理セクションが拾う拡張子（task.md 指定: 動画 mp4/mov/webm・音声 wav/mp3/m4a・
 * 画像 png/jpg/jpeg/webp）。素材タブの通常分類（classifyKind）より狭い専用規約。
 */
const UNORGANIZED_MEDIA_PATTERNS: ReadonlyArray<readonly [UnorganizedMaterialKind, RegExp]> = [
    ['video', /\.(mp4|mov|webm)$/i],
    ['audio', /\.(wav|mp3|m4a)$/i],
    ['image', /\.(png|jpg|jpeg|webp)$/i]
];

/** プロジェクトルート直下契約ファイル（各自の契約文書が正本）。未整理判定から常に除外する。 */
const ROOT_CONTRACT_FILE_NAMES = new Set(['edit.json', 'captions.json', 'review.json']);

export function classifyUnorganizedMediaKind(name: string): UnorganizedMaterialKind | undefined {
    return UNORGANIZED_MEDIA_PATTERNS.find(([, pattern]) => pattern.test(name))?.[0];
}

export interface RootEntryCandidate {
    name: string;
    isDirectory: boolean;
}

/**
 * プロジェクトルート直下（非再帰）の未整理素材判定。project-tree-policy.ts の既存ノイズ判定
 * （`.akari/` 等の hidden・サイドカー拡張子）と矛盾させず、それに「ルート直下契約 JSON
 * （edit.json 等）の除外」を重ねる。ディレクトリ（assets/exports/.akari 等）は非再帰スキャンの
 * 対象外として常に除外する。
 */
export function isUnorganizedRootEntry(entry: RootEntryCandidate, policy: ProjectTreePolicy): boolean {
    if (entry.isDirectory) {
        return false;
    }
    if (ROOT_CONTRACT_FILE_NAMES.has(entry.name)) {
        return false;
    }
    if (!shouldShowProjectPath(entry.name, policy, false)) {
        return false;
    }
    return classifyUnorganizedMediaKind(entry.name) !== undefined;
}
