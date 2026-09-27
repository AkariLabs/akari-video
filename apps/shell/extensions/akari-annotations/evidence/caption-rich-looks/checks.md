# 差し戻し 2 回目の検証

## Chrome 視認

`render-chrome.mjs` で render-cut の `generateCaptionOverlays` が返す HTML と CSS 変数を 1280×720 の Chrome ページに置き、アニメーションを止めて静止画を撮影した。専用の一時 userData を作り、Chrome を閉じてから削除した。

- `chrome-contact.png`: 7 種はそれぞれ違う。`chrome-1-c-0001.png` と `chrome-2-c-0002.png` で二重縁の内外が別色として見える。
- `chrome-3-c-0003.png`・`chrome-4-c-0004.png`・`chrome-5-c-0005.png`: 夕焼け 3 色、海 2 色、虹 3 色の明るい塗りが見える。
- `chrome-6-c-0006.png`・`chrome-7-c-0007.png`: 金と銀灰の奥行きが見える。
- `chrome-styled-gradient.png`: karaoke の語ごとの inline-block は行だけの `background-clip:text` では消えた。各 token に適用すると見える。
- `chrome-gradient-background.png`: per-line 座布団はグラデの `background-clip:text` に切られて面が見えない。設計上の扱いは `design.md` に記録。

## テスト・ビルド

| 対象 | 実測 |
|---|---|
| edit-store `node --test test/*.test.mjs` | 1008/1008 PASS（17.9 秒）。新規 rich look テスト 5 件を含む。 |
| schemas `node --test test/*.mjs` | 543 PASS、1 skip、0 fail（62.8 秒）。 |
| gpu-export `node --test test/*.test.mjs` | 480/480 PASS（8.0 秒）。 |
| render-cut `node --test --test-concurrency=1 test/caption*.test.mjs` | 163/163 PASS（9.0 秒）。 |
| akari-annotations の効果関連 3 ファイル | 37/37 PASS（1.2 秒）。 |
| akari-preview の旧 HTML ハッシュ関連 2 ファイル | 26/26 PASS（1.1 秒）。 |
| akari-preview `frame-engine-preview.test.mjs` | 18/18 PASS（0.6 秒）。 |
| preview-server の字幕関連 5 ファイル | 18/18 PASS（9.1 秒）。 |
| osr-export の字幕・page-builder 関連 4 ファイル | 35/35 PASS（1.5 秒）。 |
| shell `build:ext` / lint | ともに exit 0。lint 警告 5 件は未変更箇所。 |
| frame-engine bundle drift | preview / OSR / GPU の各 `check:frame-engine-drift` が PASS。preview-server は `npm run build` で再生成。 |
| `git diff --check` | PASS。 |

ルート `npm run test:shell` は、この差し戻しでは実行していない。Electron 実機の同時刻フレーム比較もラッパー側の作業。
