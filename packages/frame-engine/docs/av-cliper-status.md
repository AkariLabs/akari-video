# @webav/av-cliper 保守現況（2026-08-27 調査）

- npm の最新版は **1.2.8** で、本パッケージも同版へ固定している（[npm search](https://www.npmjs.com/search?q=keywords%3Acliper)）。
- 開発元の WebAV mono-repo は 2026 年にも更新があり、`av-cliper` は引き続き基礎 SDK として案内されている（[WebAV repository](https://github.com/WebAV-Tech/WebAV)）。
- 公式な後継パッケージは示されていない。`@webav/av-canvas` は `av-cliper` に依存する上位 UI 層であり代替ではない（[package README](https://github.com/WebAV-Tech/WebAV/blob/main/packages/av-cliper/README.md)）。
- 既知の注意点は codec 対応範囲と MP4Box 基盤で、追加 codec 要望と Mediabunny への置換提案が open。現行の逐次 `tick()`・decoder error guard・末尾 GOP 防御は当面ラッパー側で維持する（[open issues](https://github.com/WebAV-Tech/WebAV/issues)）。
