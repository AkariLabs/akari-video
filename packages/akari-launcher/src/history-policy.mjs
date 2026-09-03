/**
 * 変更履歴に何を入れるかの単一の宣言。
 *
 * `clean-manifest.mjs` が「ディスク上で消してよいか」を宣言するのに対し、本モジュールは
 * 「変更履歴に入れるか」を宣言する。この 2 つは別の軸である（納品した mp4 はディスクでは
 * 保持だが、履歴には入れない）。
 *
 * ここが単一の出所である理由: 同じ拡張子の知識が
 *   - プロジェクトの `.gitignore` 雛形（節目ごとの自動スナップショットが何を積むか）
 *   - `isInternalOrBinaryPath()`（「変更を見る」が何を差分表示しないか）
 * の 2 か所に分かれて存在し、後者だけが育っていたため、書き出した動画が履歴に積まれ続けて
 * `.git` が 4.2 GB に達した（issue #48）。以後はどちらも本モジュールから導出する。
 *
 * 置き場が akari-launcher/src なのは、`apps/shell` の akari-project 拡張が既に
 * `akari-video/src/*.mjs` を直接 import しており（依存追加もロックファイル更新も要らない）、
 * npm 配布 tarball では `src/` がそのまま同梱されるため。`packages/project-scaffold` からは
 * 相対パスで参照する（prepack が本ファイルを vendor ミラーにも焼くので、モノレポと配布物の
 * どちらでも同じ相対パスで解決できる）。
 */

/**
 * 書き出し・レンダリング・キャッシュが作る映像／音声／画像の拡張子。
 * 原本（`assets/`）はディレクトリ単位で別に除外するので、ここは「作り直せる生成物」だけを見る。
 */
export const GENERATED_MEDIA_EXTENSIONS = Object.freeze([
    '.mp4',
    '.mov',
    '.m4v',
    '.webm',
    '.mkv',
    '.avi',
    '.png',
    '.jpg',
    '.jpeg',
    '.gif',
    '.webp',
    '.bmp',
    '.wav',
    '.mp3'
]);

const GENERATED_MEDIA_EXTENSION_SET = new Set(GENERATED_MEDIA_EXTENSIONS);

/** アプリが管理する囲みの開始行。利用者が書き足した行は囲みの外に残す。 */
export const HISTORY_BLOCK_BEGIN = '# >>> AKARI Video: 変更履歴に入れないもの（この囲みの中はアプリが更新します）>>>';
/** アプリが管理する囲みの終了行。 */
export const HISTORY_BLOCK_END = '# <<< AKARI Video: ここまで <<<';

const HISTORY_BLOCK_BODY = [
    '# 元の映像と音声はディスクに残したまま、変更履歴には入れません。',
    'assets/**',
    '!assets/.gitkeep',
    '',
    '# 書き出した映像・音声・画像は edit.json と assets/ から作り直せます。',
    '# ディスクには残ります。変更履歴に入れないだけです。',
    ...GENERATED_MEDIA_EXTENSIONS.map(extension => `*${extension}`),
    '',
    '# 書き出しの一時作業領域・キャッシュ・「変更を見る」の一時ファイル。',
    '.akari/render-tmp/**',
    '.akari/cache/**',
    '.akari/diffs/**',
    '!.akari/diffs/.gitkeep',
    '',
    '# 素材の分析結果は作り直すのに手間がかかるので、変更履歴に残します。',
    '!.akari/sidecars/**',
    '',
    '# パソコンが作る一時ファイル。',
    '.DS_Store',
    'Thumbs.db'
];

/** アプリが管理する囲みそのもの（前後の空行は含まない）。 */
export const HISTORY_BLOCK = [HISTORY_BLOCK_BEGIN, ...HISTORY_BLOCK_BODY, HISTORY_BLOCK_END].join('\n');

/** 新規プロジェクトへ書く `.gitignore` の全文。 */
export const PROJECT_GITIGNORE = `${HISTORY_BLOCK}\n`;

/**
 * 囲みを導入する前の世代の `.gitignore` 全文。利用者が一切触っていなければ全文を差し替える。
 * 一致しなければ「利用者が書き換えた」と見なし、囲みを末尾へ足すだけにする。
 */
export const LEGACY_PROJECT_GITIGNORES = Object.freeze([
    [
        '# Source video and audio are intentionally kept outside the project history.',
        'assets/**',
        '!assets/.gitkeep',
        '',
        '# Temporary files used by the friendly "変更を見る" view.',
        '.akari/diffs/**',
        '!.akari/diffs/.gitkeep',
        '',
        '# Local operating-system files.',
        '.DS_Store',
        'Thumbs.db',
        ''
    ].join('\n')
]);

/**
 * 作り直せる映像／音声／画像か。パス区切りは `/` でも `\` でもよい。
 * 拡張子だけを見るので、置き場所の規則（sidecars は履歴に残す等）は呼び出し側が足す。
 */
export function hasGeneratedMediaExtension(file) {
    const value = String(file ?? '');
    const separator = Math.max(value.lastIndexOf('/'), value.lastIndexOf('\\'));
    const dot = value.lastIndexOf('.');
    if (dot <= separator + 1) {
        return false;
    }
    return GENERATED_MEDIA_EXTENSION_SET.has(value.slice(dot).toLowerCase());
}

/**
 * 既存の `.gitignore` 本文へ現行の囲みを反映した本文を返す。ファイルが無い場合は undefined を渡す。
 *
 * - 囲みがある → 囲みの中だけを差し替える（外に書き足した行はそのまま）
 * - ファイルが無い・空・旧世代の全文と完全一致 → 全文を差し替える
 * - それ以外（利用者が書き換えている） → 末尾へ囲みを足す（既存の行は消さない）
 */
export function applyHistoryPolicy(currentText) {
    if (currentText === undefined || currentText === null || String(currentText).trim() === '') {
        return { text: PROJECT_GITIGNORE, changed: true, mode: 'created' };
    }
    const text = String(currentText);
    const begin = text.indexOf(HISTORY_BLOCK_BEGIN);
    if (begin !== -1) {
        const endStart = text.indexOf(HISTORY_BLOCK_END, begin);
        if (endStart !== -1) {
            const next = text.slice(0, begin) + HISTORY_BLOCK + text.slice(endStart + HISTORY_BLOCK_END.length);
            return next === text
                ? { text, changed: false, mode: 'unchanged' }
                : { text: next, changed: true, mode: 'updated-block' };
        }
    }
    if (LEGACY_PROJECT_GITIGNORES.includes(text)) {
        return { text: PROJECT_GITIGNORE, changed: true, mode: 'replaced' };
    }
    const separator = text.endsWith('\n') ? '\n' : '\n\n';
    return { text: `${text}${separator}${HISTORY_BLOCK}\n`, changed: true, mode: 'appended' };
}
