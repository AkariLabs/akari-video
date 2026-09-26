/**
  * ライブラリ主要タイルの 2 枚重ねカードの絵（表 = front / 裏 = back）。
  *
  * 正本: 内部リポ `planning/notes-2026-09-27-library-tile-cards-mock.html`
  * （オーナー検収 2026-09-27。第 5 稿）。手触り・寸法・角度はすべてそのモックが正で、
  * ここはその写し。
  *
  * 設計の決まりごと:
  * - 台座（色の四角）は CSS 側（`style/library-tiles.css`）が描く。ここが持つのは
  *   **台座に載るオブジェクトだけ**。48×48 の viewBox で、光源は必ず左上。
  * - 台座の色 `c1`/`c2` は **両テーマ共通**（アプリのアイコンと同じ考え方）。
  *   周りの面・線・角丸だけが akari-surface-tokens 経由でテーマに追従する。
  * - グラデ・フィルタ・クリップの id には `{I}` を必ず入れる。描画側が台座 1 枚ごとに
  *   通し番号へ置換するので、同じ絵を何枚並べても定義が衝突しない。
  * - グラデは `gradientUnits="userSpaceOnUse"`。複数の図形でできた絵（音符の符頭と
  *   符幹など）でも光の向きが揃い、継ぎ目が出ない。
  * - DOM に触れないので node --test で検査できる（`test/library-tile-art.test.mjs`）。
  */

/** 1 種ぶんの絵。front = 表のカード、back = 裏のカード（別の絵）。 */
export interface LibraryTileArt {
        readonly front: string;
        readonly back: string;
}

/**
  * 全種で共通のグラデ・影。各絵の先頭へ連結して使う（`{I}` は描画側が置換する）。
  * `w` = 白い立体面 / `d` = その影側 / `r` = 球用の放射 / `st` = 星用
  * / `sh` = 硬めの落ち影 / `sf` = 柔らかい落ち影。
  */
export const LIBRARY_TILE_SHARED_DEFS =
    '<defs>'
    + '<linearGradient id="w{I}" gradientUnits="userSpaceOnUse" x1="11" y1="7" x2="37" y2="41">'
    + '<stop offset="0" stop-color="#ffffff"/><stop offset=".48" stop-color="#f3f7fe"/>'
    + '<stop offset="1" stop-color="#c8d3e7"/></linearGradient>'
    + '<linearGradient id="d{I}" gradientUnits="userSpaceOnUse" x1="11" y1="7" x2="37" y2="41">'
    + '<stop offset="0" stop-color="#a8b4c9"/><stop offset="1" stop-color="#707d94"/></linearGradient>'
    + '<radialGradient id="r{I}" gradientUnits="userSpaceOnUse" cx="18" cy="16" r="28">'
    + '<stop offset="0" stop-color="#ffffff"/><stop offset="1" stop-color="#bcc8dc"/></radialGradient>'
    + '<linearGradient id="st{I}" gradientUnits="userSpaceOnUse" x1="14" y1="7" x2="36" y2="41">'
    + '<stop offset="0" stop-color="#ffffff"/><stop offset=".55" stop-color="#f6faff"/>'
    + '<stop offset="1" stop-color="#c4daff"/></linearGradient>'
    + '<filter id="sh{I}" x="-50%" y="-50%" width="200%" height="210%">'
    + '<feDropShadow dx="0" dy="1.7" stdDeviation="1.5" flood-color="#080d18" flood-opacity=".38"/></filter>'
    + '<filter id="sf{I}" x="-60%" y="-60%" width="220%" height="230%">'
    + '<feDropShadow dx="0" dy="1" stdDeviation="2.6" flood-color="#080d18" flood-opacity=".3"/></filter>'
    + '</defs>';

export const LIBRARY_TILE_ART: Readonly<Record<string, LibraryTileArt>> = {
    /* 文字 — 押し出した A / 段落 */
    text: {
        front:
            '<path fill="url(#d{I})" d="M25.7 12.2 38 39.4h-6.1l-2.3-5.6h-7.7l-2.3 5.6h-6.1z"/>'
        + '<path fill="url(#w{I})" fill-rule="evenodd" filter="url(#sh{I})"'
        + ' d="M24 9.8 36.3 37h-6.1l-2.3-5.6h-7.8L17.8 37h-6.1zM22 26.6h4L24 20.9z"/>'
        + '<path fill="#ffffff" opacity=".55" d="M24 9.8l2 4.4-7.2 16-1.8-1.2z"/>',
        back:
            '<g filter="url(#sh{I})">'
        + '<rect fill="url(#w{I})" x="10.2" y="12.4" width="27.6" height="5.8" rx="2.9"/>'
        + '<rect fill="url(#w{I})" x="10.2" y="21.1" width="20.6" height="5.8" rx="2.9" opacity=".82"/>'
        + '<rect fill="url(#w{I})" x="10.2" y="29.8" width="24.8" height="5.8" rx="2.9" opacity=".62"/></g>'
        + '<g fill="#ffffff" opacity=".5"><rect x="11.8" y="13.3" width="24.4" height="1.3" rx=".65"/>'
        + '<rect x="11.8" y="22" width="17.4" height="1.3" rx=".65"/></g>'
    },

    /* 図形 — 押し出した三角 / 球と板 */
    shapes: {
        front:
            '<path fill="url(#d{I})" d="M24 14.6 36.6 36.4a3 3 0 0 1-2.6 4.5H14a3 3 0 0 1-2.6-4.5z"/>'
        + '<path fill="url(#w{I})" filter="url(#sh{I})" d="M24 11.6 36.6 33.4a3 3 0 0 1-2.6 4.5H14a3 3 0 0 1-2.6-4.5z"/>'
        + '<path fill="#ffffff" opacity=".5" d="M24 11.6 30 21.9H18z"/>',
        back:
            '<circle filter="url(#sh{I})" fill="url(#r{I})" cx="18.4" cy="18.2" r="9"/>'
        + '<ellipse fill="#ffffff" opacity=".6" cx="15.4" cy="14.8" rx="2.8" ry="2" transform="rotate(-32 15.4 14.8)"/>'
        + '<rect filter="url(#sh{I})" fill="url(#w{I})" x="21" y="21" width="16.6" height="16.6" rx="4.4" opacity=".94"/>'
        + '<rect fill="#ffffff" opacity=".5" x="23.2" y="23.2" width="12.2" height="1.4" rx=".7"/>'
    },

    /* イラスト — 花 / 葉と星 */
    stamps: {
        front:
            '<defs><radialGradient id="ct{I}" gradientUnits="userSpaceOnUse" cx="21.4" cy="20.8" r="11">'
        + '<stop offset="0" stop-color="#ffe89b"/><stop offset="1" stop-color="#df8109"/></radialGradient></defs>'
        + '<g filter="url(#sh{I})" fill="url(#w{I})">'
        + '<ellipse cx="24" cy="13.6" rx="6.2" ry="7.1"/>'
        + '<ellipse cx="33.4" cy="20.6" rx="6.2" ry="7.1" transform="rotate(72 33.4 20.6)"/>'
        + '<ellipse cx="29.8" cy="31.8" rx="6.2" ry="7.1" transform="rotate(144 29.8 31.8)"/>'
        + '<ellipse cx="18.2" cy="31.8" rx="6.2" ry="7.1" transform="rotate(216 18.2 31.8)"/>'
        + '<ellipse cx="14.6" cy="20.6" rx="6.2" ry="7.1" transform="rotate(288 14.6 20.6)"/></g>'
        + '<circle fill="url(#ct{I})" cx="24" cy="23.2" r="6.9"/>'
        + '<ellipse fill="#ffffff" opacity=".5" cx="21.6" cy="20.9" rx="2.2" ry="1.6" transform="rotate(-34 21.6 20.9)"/>',
        back:
            '<defs><linearGradient id="lf{I}" gradientUnits="userSpaceOnUse" x1="20" y1="10" x2="34" y2="32">'
        + '<stop offset="0" stop-color="#b9efb8"/>'
        + '<stop offset="1" stop-color="#2f8f58"/></linearGradient>'
        + '<linearGradient id="sy{I}" gradientUnits="userSpaceOnUse" x1="7" y1="20" x2="24" y2="38">'
        + '<stop offset="0" stop-color="#fff3b8"/><stop offset="1" stop-color="#ef9f1e"/></linearGradient></defs>'
        + '<path filter="url(#sh{I})" fill="url(#lf{I})" d="M37 11c1.5 13.6-7.2 21.2-18.6 20.6C17.4 18.8 25.2 11.6 37 11z"/>'
        + '<path fill="#ffffff" opacity=".4" d="M33.6 14.6c-6.2 3.6-10.6 9-12.8 16"/>'
        + '<path fill="none" stroke="#ffffff" stroke-opacity=".45" stroke-width="1.5" stroke-linecap="round"'
        + ' d="M33.6 14.6c-6.4 3.8-10.8 9.4-12.8 16.6"/>'
        + '<path filter="url(#sh{I})" fill="url(#sy{I})" d="M14.2 19.6 17.4 27l8 .6-6.1 5.3 1.9 7.8-7-4.2-7 4.2 1.9-7.8L3 27.6l8-.6z"/>'
    },

    /* 画像 — 風景写真 / 人物写真 */
    image: {
        front:
            '<defs><clipPath id="cp{I}"><rect x="10.7" y="13.9" width="26.6" height="20.2" rx="2.6"/></clipPath>'
        + '<linearGradient id="sky{I}" gradientUnits="userSpaceOnUse" x1="24" y1="13.9" x2="24" y2="34.1">'
        + '<stop offset="0" stop-color="#a9dcff"/><stop offset=".62" stop-color="#d7ecff"/>'
        + '<stop offset="1" stop-color="#ffd9a8"/></linearGradient>'
        + '<radialGradient id="sun{I}" gradientUnits="userSpaceOnUse" cx="16.6" cy="18.8" r="6">'
        + '<stop offset="0" stop-color="#fffbe0"/><stop offset="1" stop-color="#ffb02e"/></radialGradient></defs>'
        + '<g filter="url(#sh{I})"><rect fill="url(#w{I})" x="7.6" y="10.8" width="32.8" height="26.4" rx="4.8"/></g>'
        + '<g clip-path="url(#cp{I})">'
        + '<rect fill="url(#sky{I})" x="10.7" y="13.9" width="26.6" height="20.2"/>'
        + '<circle fill="url(#sun{I})" cx="17.2" cy="19.4" r="3.9"/>'
        + '<path fill="#86d7a8" d="M6 36 20.6 21.6 35.2 36z"/>'
        + '<path fill="#3a9a6d" d="M16 36 28.2 24.4 40.4 36z"/>'
        + '<path fill="#2b7c57" d="M28.2 24.4 34.2 30.4 22.2 30.4z"/></g>'
        + '<rect fill="none" stroke="#ffffff" stroke-opacity=".6" x="8.2" y="11.4" width="31.6" height="25.2" rx="4.2"/>',
        back:
            '<defs><clipPath id="cp{I}"><rect x="10.7" y="13.9" width="26.6" height="20.2" rx="2.6"/></clipPath>'
        + '<linearGradient id="bd{I}" gradientUnits="userSpaceOnUse" x1="24" y1="13.9" x2="24" y2="34.1">'
        + '<stop offset="0" stop-color="#9fc2ff"/><stop offset="1" stop-color="#e2ecff"/></linearGradient>'
        + '<linearGradient id="sk{I}" gradientUnits="userSpaceOnUse" x1="19" y1="16" x2="30" y2="34">'
        + '<stop offset="0" stop-color="#ffe0c2"/><stop offset="1" stop-color="#e79b66"/></linearGradient></defs>'
        + '<g filter="url(#sh{I})"><rect fill="url(#w{I})" x="7.6" y="10.8" width="32.8" height="26.4" rx="4.8" opacity=".9"/></g>'
        + '<g clip-path="url(#cp{I})">'
        + '<rect fill="url(#bd{I})" x="10.7" y="13.9" width="26.6" height="20.2"/>'
        + '<path fill="url(#sk{I})" d="M24 28.2c6.6 0 11.2 4.2 12.2 7.6H11.8c1-3.4 5.6-7.6 12.2-7.6z"/>'
        + '<circle fill="url(#sk{I})" cx="24" cy="21.6" r="5.4"/>'
        + '<ellipse fill="#ffffff" opacity=".35" cx="21.6" cy="19.4" rx="1.8" ry="1.3" transform="rotate(-30 21.6 19.4)"/></g>'
        + '<rect fill="none" stroke="#ffffff" stroke-opacity=".5" x="8.2" y="11.4" width="31.6" height="25.2" rx="4.2"/>'
    },

    /* 動画 — 再生 / フィルム */
    video: {
        front:
            '<defs><linearGradient id="pl{I}" gradientUnits="userSpaceOnUse" x1="20" y1="17" x2="33" y2="31">'
        + '<stop offset="0" stop-color="#a75ae6"/><stop offset="1" stop-color="#5f1c9e"/></linearGradient></defs>'
        + '<g filter="url(#sh{I})"><rect fill="url(#w{I})" x="7.8" y="11.4" width="32.4" height="25.2" rx="5.6"/></g>'
        + '<path fill="url(#pl{I})" d="M20.4 17.2 32.6 24 20.4 30.8z"/>'
        + '<path fill="#ffffff" opacity=".3" d="M20.4 17.2 32.6 24l-3 1.7-9.2-5.2z"/>'
        + '<rect fill="#ffffff" opacity=".55" x="10.4" y="13.2" width="27.2" height="1.5" rx=".75"/>',
        back:
            '<defs><linearGradient id="fr{I}" gradientUnits="userSpaceOnUse" x1="17" y1="17" x2="32" y2="31">'
        + '<stop offset="0" stop-color="#8c4cd0"/><stop offset="1" stop-color="#4c1580"/></linearGradient></defs>'
        + '<g filter="url(#sh{I})"><rect fill="url(#w{I})" x="7.4" y="12.4" width="33.2" height="23.2" rx="3.8" opacity=".95"/></g>'
        + '<rect fill="url(#fr{I})" x="16.6" y="16.6" width="14.8" height="14.8" rx="2.2"/>'
        + '<g fill="#6a2aa8" opacity=".82">'
        + '<rect x="10" y="15.2" width="4.4" height="4.4" rx="1.4"/><rect x="10" y="28.4" width="4.4" height="4.4" rx="1.4"/>'
        + '<rect x="33.6" y="15.2" width="4.4" height="4.4" rx="1.4"/><rect x="33.6" y="28.4" width="4.4" height="4.4" rx="1.4"/></g>'
        + '<rect fill="#ffffff" opacity=".3" x="17.8" y="17.8" width="12.4" height="1.4" rx=".7"/>'
    },

    /* BGM — 連桁の八分音符（符頭と符幹をひと繋ぎにして段差を消した） / レコード */
    bgm: {
        front:
            // 符幹を 3.4 まで太くし、符頭は「右端が符幹の右端に揃う」位置まで
            // 右へ寄せる（左 17.5 / 右 29.0）。棒と玉が離れて見えていたのは
            // 符頭が符幹の左へはみ出しすぎていたため。
            '<g filter="url(#sh{I})" fill="url(#w{I})">'
        + '<path d="M19.2 33.4V12.8L34 10v20.8h-3.4V14.6L22.6 16.4v17z"/>'
        + '<ellipse cx="17.5" cy="33.4" rx="5.5" ry="4.4" transform="rotate(-20 17.5 33.4)"/>'
        + '<ellipse cx="29" cy="30.8" rx="5.5" ry="4.4" transform="rotate(-20 29 30.8)"/></g>'
        + '<path fill="#ffffff" opacity=".6" d="M19.2 12.8 34 10v2.2L19.2 15z"/>'
        + '<ellipse fill="#ffffff" opacity=".4" cx="15.6" cy="31.8" rx="2.2" ry="1.4" transform="rotate(-20 15.6 31.8)"/>',
        back:
            '<defs><radialGradient id="vi{I}" gradientUnits="userSpaceOnUse" cx="18" cy="16" r="28">'
        + '<stop offset="0" stop-color="#5a6070"/><stop offset=".55" stop-color="#2a2f3a"/>'
        + '<stop offset="1" stop-color="#101219"/></radialGradient>'
        + '<radialGradient id="lb{I}" gradientUnits="userSpaceOnUse" cx="22" cy="22" r="7">'
        + '<stop offset="0" stop-color="#ffe6a3"/><stop offset="1" stop-color="#ef8a24"/></radialGradient></defs>'
        + '<circle filter="url(#sh{I})" fill="url(#vi{I})" cx="24" cy="24" r="13.6"/>'
        + '<g fill="none" stroke="#ffffff" stroke-opacity=".16" stroke-width="1">'
        + '<circle cx="24" cy="24" r="11"/><circle cx="24" cy="24" r="8.8"/><circle cx="24" cy="24" r="6.8"/></g>'
        + '<path fill="#ffffff" opacity=".2" d="M14.4 14.4a13.6 13.6 0 0 1 19.2 0l-2.8 2.8a9.6 9.6 0 0 0-13.6 0z"/>'
        + '<circle fill="url(#lb{I})" cx="24" cy="24" r="4.7"/>'
        + '<circle fill="#2a2f3a" cx="24" cy="24" r="1.2"/>'
    },

    /* SFX — スピーカー / 波形 */
    sfx: {
        front:
            '<g filter="url(#sh{I})">'
        + '<path fill="url(#w{I})" d="M11 19h5.5l8.3-6.7a1.6 1.6 0 0 1 2.6 1.2v21a1.6 1.6 0 0 1-2.6 1.2L16.5 29H11a2.1 2.1 0 0 1-2.1-2.1v-5.8A2.1 2.1 0 0 1 11 19z"/></g>'
        + '<path fill="#ffffff" opacity=".5" d="M24.8 12.3a1.6 1.6 0 0 1 2.6 1.2v2.1l-2.6 2z"/>'
        + '<g fill="none" stroke="url(#w{I})" stroke-linecap="round">'
        + '<path stroke-width="2.9" d="M30.8 18.8a7.7 7.7 0 0 1 0 10.4"/>'
        + '<path stroke-width="2.7" opacity=".55" d="M35.4 14.4a13.8 13.8 0 0 1 0 19.2"/></g>',
        back:
            '<g filter="url(#sh{I})" fill="url(#w{I})">'
        + '<rect x="9.2" y="20.2" width="4.5" height="7.6" rx="2.25"/>'
        + '<rect x="15.9" y="14.4" width="4.5" height="19.2" rx="2.25"/>'
        + '<rect x="22.6" y="10.2" width="4.5" height="27.6" rx="2.25"/>'
        + '<rect x="29.3" y="16.2" width="4.5" height="15.6" rx="2.25"/>'
        + '<rect x="36" y="20.8" width="4.5" height="6.4" rx="2.25"/></g>'
        + '<g fill="#ffffff" opacity=".45">'
        + '<rect x="10.3" y="21.2" width="1.4" height="5.6" rx=".7"/><rect x="17" y="15.4" width="1.4" height="17.2" rx=".7"/>'
        + '<rect x="23.7" y="11.2" width="1.4" height="25.6" rx=".7"/></g>'
    },

    /* オーバーレイ — 重なるガラス板 / 大きなきらめき（星を大きくした） */
    overlay: {
        front:
            '<defs><linearGradient id="g1{I}" gradientUnits="userSpaceOnUse" x1="9" y1="10" x2="32" y2="33">'
        + '<stop offset="0" stop-color="#ffffff" stop-opacity=".42"/><stop offset="1" stop-color="#ffffff" stop-opacity=".12"/></linearGradient>'
        + '<linearGradient id="g2{I}" gradientUnits="userSpaceOnUse" x1="17" y1="15" x2="40" y2="39">'
        + '<stop offset="0" stop-color="#ffffff" stop-opacity=".92"/><stop offset="1" stop-color="#d6e3f8" stop-opacity=".62"/></linearGradient></defs>'
        + '<rect filter="url(#sf{I})" fill="url(#g1{I})" x="8.4" y="9.8" width="23.2" height="23.2" rx="5.6"/>'
        + '<rect fill="none" stroke="#ffffff" stroke-opacity=".55" x="8.9" y="10.3" width="22.2" height="22.2" rx="5.1"/>'
        + '<rect filter="url(#sf{I})" fill="url(#g2{I})" x="16.4" y="15.2" width="23.2" height="23.2" rx="5.6"/>'
        + '<rect fill="none" stroke="#ffffff" stroke-opacity=".75" x="16.9" y="15.7" width="22.2" height="22.2" rx="5.1"/>'
        + '<path fill="#ffffff" opacity=".5" d="M17.6 20.4a3.2 3.2 0 0 1 3.2-3.2h13.6z"/>',
        back:
            '<path filter="url(#sh{I})" fill="url(#st{I})"'
        + ' d="M24 4.6c2.1 11.1 6.2 15.2 17.3 17.3-11.1 2.1-15.2 6.2-17.3 17.3-2.1-11.1-6.2-15.2-17.3-17.3C17.8 19.8 21.9 15.7 24 4.6z"/>'
        + '<path fill="#ffffff" opacity=".45" d="M24 4.6c2.1 11.1 6.2 15.2 17.3 17.3-10.4-1-16.3-6.9-17.3-17.3z"/>'
        + '<path filter="url(#sh{I})" fill="#ffffff" opacity=".78"'
        + ' d="M36.4 32.2c.8 4.1 2.3 5.6 6.4 6.4-4.1.8-5.6 2.3-6.4 6.4-.8-4.1-2.3-5.6-6.4-6.4 4.1-.8 5.6-2.3 6.4-6.4z"/>'
    },

    /* 3D — 立方体（3 面を別階調に）/ 球 */
    scene3d: {
        front:
            '<defs><linearGradient id="tp{I}" gradientUnits="userSpaceOnUse" x1="12" y1="9" x2="36" y2="25">'
        + '<stop offset="0" stop-color="#ffffff"/><stop offset="1" stop-color="#dfe8f7"/></linearGradient>'
        + '<linearGradient id="lt{I}" gradientUnits="userSpaceOnUse" x1="10" y1="18" x2="24" y2="40">'
        + '<stop offset="0" stop-color="#c7d2e4"/><stop offset="1" stop-color="#96a3ba"/></linearGradient>'
        + '<linearGradient id="rt{I}" gradientUnits="userSpaceOnUse" x1="24" y1="20" x2="38" y2="40">'
        + '<stop offset="0" stop-color="#8f9cb2"/><stop offset="1" stop-color="#63708a"/></linearGradient></defs>'
        + '<g filter="url(#sh{I})">'
        + '<path fill="url(#tp{I})" d="M24 8.6 38.2 16.8 24 25 9.8 16.8z"/>'
        + '<path fill="url(#lt{I})" d="M9.8 16.8 24 25v14.8L9.8 31.6z"/>'
        + '<path fill="url(#rt{I})" d="M38.2 16.8 24 25v14.8l14.2-8.2z"/></g>'
        + '<path fill="none" stroke="#ffffff" stroke-opacity=".6" d="M24 8.6 38.2 16.8 24 25 9.8 16.8z"/>'
        + '<path fill="#ffffff" opacity=".35" d="M9.8 16.8 24 25v3L9.8 19.8z"/>',
        back:
            '<defs><radialGradient id="sp{I}" gradientUnits="userSpaceOnUse" cx="17.6" cy="16.4" r="27">'
        + '<stop offset="0" stop-color="#ffffff"/><stop offset=".55" stop-color="#d3dcec"/>'
        + '<stop offset="1" stop-color="#7d8ba4"/></radialGradient></defs>'
        + '<circle filter="url(#sh{I})" fill="url(#sp{I})" cx="24" cy="24" r="13.6"/>'
        + '<ellipse fill="none" stroke="#ffffff" stroke-opacity=".5" stroke-width="1.3" cx="24" cy="24" rx="13.6" ry="5"/>'
        + '<path fill="none" stroke="#ffffff" stroke-opacity=".42" stroke-width="1.3"'
        + ' d="M24 10.4a13.6 13.6 0 0 1 0 27.2 13.6 13.6 0 0 1 0-27.2z"/>'
        + '<ellipse fill="#ffffff" opacity=".62" cx="18.8" cy="18.2" rx="4" ry="2.9" transform="rotate(-32 18.8 18.2)"/>'
    },

    /* LUT — 暖色と寒色のチップ / トーンカーブ */
    lut: {
        front:
            '<defs><linearGradient id="wm{I}" gradientUnits="userSpaceOnUse" x1="9" y1="11" x2="30" y2="32">'
        + '<stop offset="0" stop-color="#ffdd7a"/><stop offset="1" stop-color="#ef6236"/></linearGradient>'
        + '<linearGradient id="cl{I}" gradientUnits="userSpaceOnUse" x1="19" y1="17" x2="40" y2="38">'
        + '<stop offset="0" stop-color="#8fe0ff"/><stop offset="1" stop-color="#3160e8"/></linearGradient></defs>'
        + '<rect filter="url(#sh{I})" fill="url(#wm{I})" x="8.2" y="10.8" width="21.4" height="21.4" rx="5.6"/>'
        + '<rect fill="none" stroke="#ffffff" stroke-opacity=".45" x="8.7" y="11.3" width="20.4" height="20.4" rx="5.1"/>'
        + '<rect filter="url(#sh{I})" fill="url(#cl{I})" x="18.4" y="16.6" width="21.4" height="21.4" rx="5.6" opacity=".9"/>'
        + '<rect fill="none" stroke="#ffffff" stroke-opacity=".6" x="18.9" y="17.1" width="20.4" height="20.4" rx="5.1"/>'
        + '<path fill="#ffffff" opacity=".35" d="M19.6 21.6a3.2 3.2 0 0 1 3.2-3.2h14.2z"/>',
        back:
            '<defs><linearGradient id="pn{I}" gradientUnits="userSpaceOnUse" x1="10" y1="11" x2="38" y2="37">'
        + '<stop offset="0" stop-color="#333c52"/><stop offset="1" stop-color="#151a26"/></linearGradient>'
        + '<linearGradient id="cu{I}" gradientUnits="userSpaceOnUse" x1="12" y1="34" x2="36" y2="18">'
        + '<stop offset="0" stop-color="#ffd166"/><stop offset=".5" stop-color="#ffffff"/>'
        + '<stop offset="1" stop-color="#5ad4ff"/></linearGradient></defs>'
        + '<rect filter="url(#sh{I})" fill="url(#pn{I})" x="8.6" y="11.2" width="30.8" height="25.6" rx="4.2"/>'
        + '<g stroke="#ffffff" stroke-opacity=".16" stroke-width="1">'
        + '<path d="M18.8 11.2v25.6M29 11.2v25.6M8.6 19.7h30.8M8.6 28.3h30.8"/></g>'
        + '<path fill="none" stroke="url(#cu{I})" stroke-width="3.1" stroke-linecap="round"'
        + ' d="M12.4 32.6c5.6-.9 6.2-13.6 11.6-13.6s6.4 8.5 11.6 6.6"/>'
        + '<circle fill="#ffffff" cx="12.4" cy="32.6" r="2.3"/><circle fill="#ffffff" cx="35.6" cy="25.6" r="2.3"/>'
    },

    /* トランジション — 場面の送り / フェード */
    transition: {
        front:
            '<defs><linearGradient id="ar{I}" gradientUnits="userSpaceOnUse" x1="19" y1="19" x2="29" y2="29">'
        + '<stop offset="0" stop-color="#38a9e8"/><stop offset="1" stop-color="#0a5b96"/></linearGradient></defs>'
        + '<g filter="url(#sh{I})">'
        + '<rect fill="url(#w{I})" x="7.6" y="12.2" width="19.6" height="23.6" rx="3.9" opacity=".72"/>'
        + '<rect fill="url(#w{I})" x="20.8" y="12.2" width="19.6" height="23.6" rx="3.9"/></g>'
        + '<rect fill="#ffffff" opacity=".5" x="22.4" y="13.6" width="16.4" height="1.4" rx=".7"/>'
        + '<circle filter="url(#sh{I})" fill="url(#ar{I})" cx="24" cy="24" r="6"/>'
        + '<path fill="none" stroke="#ffffff" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round" d="M22.4 21.4 25 24l-2.6 2.6"/>'
        + '<path fill="#ffffff" opacity=".25" d="M24 18a6 6 0 0 1 5.6 3.8A6 6 0 0 0 24 18z"/>',
        back:
            '<defs><linearGradient id="fd{I}" gradientUnits="userSpaceOnUse" x1="9" y1="24" x2="40" y2="24">'
        + '<stop offset="0" stop-color="#ffffff" stop-opacity="1"/><stop offset=".55" stop-color="#e6eefb" stop-opacity=".62"/>'
        + '<stop offset="1" stop-color="#c7d8f2" stop-opacity=".16"/></linearGradient></defs>'
        + '<g filter="url(#sf{I})" fill="url(#fd{I})">'
        + '<rect x="8.8" y="12.8" width="5.4" height="22.4" rx="2.7"/>'
        + '<rect x="16.4" y="12.8" width="5.4" height="22.4" rx="2.7"/>'
        + '<rect x="24" y="12.8" width="5.4" height="22.4" rx="2.7"/>'
        + '<rect x="31.6" y="12.8" width="5.4" height="22.4" rx="2.7"/></g>'
        + '<rect fill="#ffffff" opacity=".55" x="10" y="13.8" width="1.6" height="20.4" rx=".8"/>'
    },

    /* エフェクト — 発光する玉と放射（玉と光条を離して重なりを解消）/ 魔法の杖 */
    fx: {
        front:
            '<defs><radialGradient id="gw{I}" gradientUnits="userSpaceOnUse" cx="24" cy="24" r="17">'
        + '<stop offset="0" stop-color="#ffffff" stop-opacity=".55"/><stop offset=".55" stop-color="#ffffff" stop-opacity=".14"/>'
        + '<stop offset="1" stop-color="#ffffff" stop-opacity="0"/></radialGradient>'
        + '<radialGradient id="ob{I}" gradientUnits="userSpaceOnUse" cx="20.8" cy="20.8" r="13">'
        + '<stop offset="0" stop-color="#ffffff"/><stop offset=".6" stop-color="#fff6d2"/>'
        + '<stop offset="1" stop-color="#ffcf63"/></radialGradient></defs>'
        + '<circle fill="url(#gw{I})" cx="24" cy="24" r="17"/>'
        + '<circle filter="url(#sh{I})" fill="url(#ob{I})" cx="24" cy="24" r="7.8"/>'
        + '<ellipse fill="#ffffff" opacity=".75" cx="21.2" cy="21.2" rx="2.6" ry="1.9" transform="rotate(-38 21.2 21.2)"/>'
        + '<g stroke="#ffffff" stroke-linecap="round">'
        + '<path stroke-width="2.7" stroke-opacity=".9" d="M24 6.6v4.6M24 36.8v4.6M6.6 24h4.6M36.8 24h4.6"/>'
        + '<path stroke-width="2.2" stroke-opacity=".5" d="m12.3 12.3 3.2 3.2M32.5 32.5l3.2 3.2M35.7 12.3l-3.2 3.2M15.5 32.5l-3.2 3.2"/></g>',
        back:
            '<defs><linearGradient id="wd{I}" gradientUnits="userSpaceOnUse" x1="11" y1="39" x2="31" y2="19">'
        + '<stop offset="0" stop-color="#9aa7bd"/><stop offset=".45" stop-color="#ffffff"/>'
        + '<stop offset="1" stop-color="#d6dfee"/></linearGradient></defs>'
        + '<g filter="url(#sh{I})">'
        + '<path fill="url(#wd{I})" d="M11.4 38.9a2.7 2.7 0 0 1 0-3.8l17.1-17.1 3.8 3.8-17.1 17.1a2.7 2.7 0 0 1-3.8 0z"/></g>'
        + '<path fill="#ffffff" opacity=".5" d="m28.5 18 1.9 1.9-17.1 17.1-1.9-1.9z"/>'
        + '<path filter="url(#sh{I})" fill="url(#st{I})"'
        + ' d="M32 7.4c1.3 6.4 3.4 8.5 9.8 9.8-6.4 1.3-8.5 3.4-9.8 9.8-1.3-6.4-3.4-8.5-9.8-9.8 6.4-1.3 8.5-3.4 9.8-9.8z"/>'
        + '<path fill="#ffffff" opacity=".85" d="M13.4 9.2c.6 2.9 1.5 3.8 4.4 4.4-2.9.6-3.8 1.5-4.4 4.4-.6-2.9-1.5-3.8-4.4-4.4 2.9-.6 3.8-1.5 4.4-4.4z"/>'
    },

    /* モーション — 灯りが走る軌跡（黄）/ キーフレーム（選択中が黄） */
    motion: {
        front:
            '<defs><linearGradient id="tj{I}" gradientUnits="userSpaceOnUse" x1="10" y1="35" x2="37" y2="25">'
        + '<stop offset="0" stop-color="#ffffff" stop-opacity=".1"/>'
        + '<stop offset=".45" stop-color="#fff0c0" stop-opacity=".5"/>'
        + '<stop offset="1" stop-color="#ffc93c" stop-opacity=".95"/></linearGradient>'
        + '<radialGradient id="bl{I}" gradientUnits="userSpaceOnUse" cx="34.6" cy="24.2" r="9">'
        + '<stop offset="0" stop-color="#fffdf0"/><stop offset=".5" stop-color="#ffd970"/>'
        + '<stop offset="1" stop-color="#ee9f0c"/></radialGradient>'
        + '<radialGradient id="gl{I}" gradientUnits="userSpaceOnUse" cx="36.6" cy="26.2" r="12">'
        + '<stop offset="0" stop-color="#ffd970" stop-opacity=".55"/>'
        + '<stop offset="1" stop-color="#ffd970" stop-opacity="0"/></radialGradient></defs>'
        + '<circle fill="url(#gl{I})" cx="36.6" cy="26.2" r="12"/>'
        + '<path fill="none" stroke="url(#tj{I})" stroke-width="3.3" stroke-linecap="round"'
        + ' d="M10.6 35.4c7.1-1 6-19.6 13.4-19.6s7.9 13 13.2 10.2"/>'
        + '<circle fill="#fff6d8" opacity=".3" cx="10.6" cy="35.4" r="3"/>'
        + '<circle fill="#ffe9a8" opacity=".55" cx="17.4" cy="23.6" r="3.7"/>'
        + '<circle filter="url(#sh{I})" fill="url(#bl{I})" cx="36.6" cy="26.2" r="5.9"/>'
        + '<ellipse fill="#fffdf0" opacity=".85" cx="34.8" cy="24.4" rx="2" ry="1.5" transform="rotate(-34 34.8 24.4)"/>',
        back:
            '<defs><linearGradient id="ky{I}" gradientUnits="userSpaceOnUse" x1="18" y1="18" x2="30" y2="30">'
        + '<stop offset="0" stop-color="#fff3c8"/><stop offset="1" stop-color="#f0a80e"/></linearGradient></defs>'
        + '<path fill="none" stroke="#ffffff" stroke-opacity=".34" stroke-width="2" stroke-linecap="round" d="M9.6 24h28.8"/>'
        + '<g filter="url(#sh{I})">'
        + '<path fill="url(#w{I})" opacity=".62" d="M14.2 17 21.2 24l-7 7-7-7z"/>'
        + '<path fill="url(#ky{I})" d="M24 17.4 30.6 24 24 30.6 17.4 24z"/>'
        + '<path fill="url(#w{I})" opacity=".5" d="M34 19.2 38.8 24 34 28.8 29.2 24z"/></g>'
        + '<path fill="#fffdf0" opacity=".6" d="M24 17.4 30.6 24l-1.7 1.7L24 20.8z"/>'
    },

    /* マイスタイル — 星を付けた札 / 保存した色 */
    mystyle: {
        front:
            '<defs><linearGradient id="gd{I}" gradientUnits="userSpaceOnUse" x1="22" y1="20" x2="38" y2="38">'
        + '<stop offset="0" stop-color="#fff0ae"/><stop offset=".5" stop-color="#ffcb47"/>'
        + '<stop offset="1" stop-color="#e09305"/></linearGradient>'
        + '<linearGradient id="ln{I}" gradientUnits="userSpaceOnUse" x1="13" y1="16" x2="30" y2="26">'
        + '<stop offset="0" stop-color="#b3bdd0"/><stop offset="1" stop-color="#7c8aa2"/></linearGradient></defs>'
        + '<g filter="url(#sh{I})"><rect fill="url(#w{I})" x="9.4" y="10.6" width="29.2" height="26.4" rx="4.8"/></g>'
        + '<rect fill="#ffffff" opacity=".55" x="11.2" y="12.4" width="25.6" height="1.5" rx=".75"/>'
        + '<g fill="url(#ln{I})"><rect x="13.2" y="16.4" width="15.4" height="2.8" rx="1.4"/>'
        + '<rect x="13.2" y="21.6" width="10.6" height="2.8" rx="1.4"/></g>'
        + '<path filter="url(#sh{I})" fill="url(#gd{I})"'
        + ' d="M29.8 19.8 33 26.3l7.2 1-5.2 5.1 1.2 7.1-6.4-3.4-6.4 3.4 1.2-7.1-5.2-5.1 7.2-1z"/>'
        + '<path fill="#fffbe8" opacity=".55" d="M29.8 19.8 33 26.3l-1.8.6-1.4-7.1z"/>',
        back:
            '<g filter="url(#sh{I})"><rect fill="url(#w{I})" x="9.4" y="10.6" width="29.2" height="26.4" rx="4.8" opacity=".94"/></g>'
        + '<g><rect fill="#f2685f" x="12.8" y="14.4" width="9.6" height="9.6" rx="2.8"/>'
        + '<rect fill="#4aa5ff" x="25.6" y="14.4" width="9.6" height="9.6" rx="2.8"/>'
        + '<rect fill="#3fbf8a" x="12.8" y="26.6" width="9.6" height="6.6" rx="2.3"/>'
        + '<rect fill="#8b6cff" x="25.6" y="26.6" width="9.6" height="6.6" rx="2.3"/></g>'
        + '<g fill="#ffffff" opacity=".4"><rect x="13.9" y="15.5" width="7.4" height="1.3" rx=".65"/>'
        + '<rect x="26.7" y="15.5" width="7.4" height="1.3" rx=".65"/>'
        + '<rect x="13.9" y="27.6" width="7.4" height="1.2" rx=".6"/>'
        + '<rect x="26.7" y="27.6" width="7.4" height="1.2" rx=".6"/></g>'
    },

    /* パック — 束ねた素材 / 扇に開いた札 */
    pack: {
        front:
            '<defs><linearGradient id="bn{I}" gradientUnits="userSpaceOnUse" x1="20" y1="9" x2="28" y2="41">'
        + '<stop offset="0" stop-color="#96a3ba"/><stop offset=".45" stop-color="#6d7a90"/>'
        + '<stop offset="1" stop-color="#4b5668"/></linearGradient></defs>'
        + '<g filter="url(#sh{I})">'
        + '<rect fill="url(#w{I})" x="9.8" y="11.2" width="28.4" height="9" rx="3.3" opacity=".55"/>'
        + '<rect fill="url(#w{I})" x="9.8" y="20.5" width="28.4" height="9" rx="3.3" opacity=".78"/>'
        + '<rect fill="url(#w{I})" x="9.8" y="29.8" width="28.4" height="9" rx="3.3"/></g>'
        + '<rect filter="url(#sh{I})" fill="url(#bn{I})" x="20.3" y="9" width="7.4" height="32" rx="2.5"/>'
        + '<rect fill="#ffffff" opacity=".3" x="21.5" y="9" width="1.7" height="32"/>',
        back:
            '<g filter="url(#sh{I})">'
        + '<rect fill="url(#w{I})" x="12" y="14" width="24" height="20" rx="4.2" opacity=".48" transform="rotate(-14 24 24)"/>'
        + '<rect fill="url(#w{I})" x="12" y="14" width="24" height="20" rx="4.2" opacity=".74" transform="rotate(-4.5 24 24)"/>'
        + '<rect fill="url(#w{I})" x="12" y="14" width="24" height="20" rx="4.2" transform="rotate(6 24 24)"/></g>'
        + '<rect fill="#ffffff" opacity=".5" x="14.4" y="16.4" width="14" height="1.5" rx=".75" transform="rotate(6 24 24)"/>'
    },

    /* テンプレート — 2 段組の雛形 / 別の雛形 */
    template: {
        front:
            '<defs><linearGradient id="sl{I}" gradientUnits="userSpaceOnUse" x1="14" y1="12" x2="34" y2="36">'
        + '<stop offset="0" stop-color="#aab5c9"/><stop offset="1" stop-color="#697490"/></linearGradient></defs>'
        + '<g filter="url(#sh{I})"><rect fill="url(#w{I})" x="10" y="8.2" width="28" height="31.6" rx="4.4"/></g>'
        + '<g fill="url(#sl{I})">'
        + '<rect x="13.6" y="11.8" width="20.8" height="8.2" rx="2.5"/>'
        + '<rect x="13.6" y="22.4" width="9.4" height="13.6" rx="2.5"/>'
        + '<rect x="25" y="22.4" width="9.4" height="13.6" rx="2.5"/></g>'
        + '<rect fill="#ffffff" opacity=".45" x="11.6" y="9.8" width="24.8" height="1.4" rx=".7"/>',
        back:
            '<defs><linearGradient id="sl{I}" gradientUnits="userSpaceOnUse" x1="14" y1="12" x2="34" y2="36">'
        + '<stop offset="0" stop-color="#b4bece"/><stop offset="1" stop-color="#74809a"/></linearGradient></defs>'
        + '<g filter="url(#sh{I})"><rect fill="url(#w{I})" x="10" y="8.2" width="28" height="31.6" rx="4.4" opacity=".9"/></g>'
        + '<g fill="url(#sl{I})">'
        + '<rect x="13.6" y="11.8" width="20.8" height="14.4" rx="2.5"/>'
        + '<rect x="13.6" y="29" width="5.9" height="6.6" rx="2"/>'
        + '<rect x="21.1" y="29" width="5.9" height="6.6" rx="2"/>'
        + '<rect x="28.5" y="29" width="5.9" height="6.6" rx="2"/></g>'
        + '<rect fill="#ffffff" opacity=".4" x="11.6" y="9.8" width="24.8" height="1.4" rx=".7"/>'
    }
};
