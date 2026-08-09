import { pathToFileURL } from 'url';

/**
 * 「ファイルをコピー」IPC（task 2026-08-09-material-context-menu-mvp 指示7）が
 * クリップボードへ書き込む `public.file-url` の値を組み立てる純関数。スペース・日本語
 * パスのパーセントエンコードを Node 標準の `pathToFileURL` に委ね、ここでは単に
 * `.href` を返すだけに切り出す（electron-main の IPC ハンドラから DOM 非依存で
 * node --test できる形にする）。electron-main 側のみが呼ぶため、ブラウザバンドルには
 * 含まれない（このファイルを browser 側からは import しない）。
 */
export function toFileUrl(fsPath: string): string {
    return pathToFileURL(fsPath).href;
}
