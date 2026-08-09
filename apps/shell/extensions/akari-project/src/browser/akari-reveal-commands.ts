import { Command } from '@theia/core/lib/common';
import { isOSX } from '@theia/core/lib/common/os';

/**
 * 「Finder で表示」/「フォルダを開く」のラベル分岐点（task 2026-08-09-reveal-in-finder）。
 * v0 は macOS のみ実装確認済み。他 OS はラベルだけ分岐させ、実体は
 * `shell.showItemInFolder`（Electron が OS ごとの等価物を吸収する）に委ねる。
 * ボタンの title/aria-label 用の一文を組み立てる（「を」の二重化を避けて OS ごとに文型を変える）。
 */
export function revealInFileManagerActionLabel(subject: string): string {
    return isOSX ? `${subject} を Finder で表示` : `${subject} のフォルダを開く`;
}

/**
 * 単一の対象（URI）をファイルマネージャで選択表示する内部コマンド。ラベル無し
 * = コマンドパレットには出さない（URI 引数が必須で、パレットからは呼べないため）。
 * 実行は `AkariProjectContribution#revealInFileManager` が担う。
 * 他拡張（akari-surfaces のホームなど）は ID 文字列のミラーで呼ぶ
 * （`akari-partner` の command-id ミラー流儀 — akari-project-contribution.ts 冒頭コメント参照）。
 */
export const AKARI_REVEAL_IN_FILE_MANAGER: Command = {
    id: 'akari.project.revealInFileManager'
};

/** File メニューの「プロジェクトフォルダを Finder で表示」。現在のワークスペースルートが対象。 */
export const AKARI_REVEAL_PROJECT_ROOT: Command = {
    id: 'akari.project.revealProjectRoot',
    label: isOSX ? 'プロジェクトフォルダを Finder で表示' : 'プロジェクトフォルダを開く'
};

/**
 * 素材カードの「素材の情報を表示」から呼ぶ内部コマンド（task 2026-08-10-material-menu-r2）。
 * URI 引数必須・ラベル無し = コマンドパレットには出さない（AKARI_REVEAL_IN_FILE_MANAGER と
 * 同じ流儀）。実行は `AkariProjectContribution#showAssetInfo` が担う — 素材の情報パネル
 * （`akari-asset-inspector-widget`）を reveal/activate してから `showAsset(uri)` を呼ぶ。
 */
export const AKARI_SHOW_ASSET_INFO: Command = {
    id: 'akari.project.showAssetInfo'
};
