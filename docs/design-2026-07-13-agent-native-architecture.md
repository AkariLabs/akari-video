# AKARI Video 新実装 — agent-native アーキテクチャ設計

- 日付: 2026-07-13
- 状態: 承認済み（オーナーレビュー済み）

## 1. ビジョン

**「動画を投げるだけでいい感じに編集してくれる。人間は開いて確認し、微修正するだけ。」**

- 編集の主体はエージェント（Claude 等）。アプリは「編集する場所」ではなく「確認して直す場所」
- エージェントは**セーブデータ（edit.json + HTML 断片）を直接書く**。
  MCP ツールコールの積み重ねは遅く・壊れやすいため主経路にしない（読み取り/実行系のみに縮小）
- 表現（字幕・テロップ・図形・3D）は**プリセットを用意せず、AI が HTML/CSS/Three.js で自由に描く**。
  「受け口は広いが、エンジンは合成だけ」

## 2. 根拠となった実験（Step 1、2026-07-13）

62 分の未編集録画に対し、アプリ不使用で以下を完走：

1. ローカル whisper.cpp で文字起こし（180 秒 → 61 セグメント）
2. Claude がカット判断（段取り/トラブル/フィラー除去）を edit.json として直接記述
   → 165 秒 → 108 秒（34% 短縮）、keep-range 8 本
3. 字幕 32 枚 + 章テロップカードを **1 枚の HTML シート**として Claude が記述、
   headless ブラウザで 1 回スクショ → ffmpeg colorkey + crop + overlay で合成
4. Claude 自身が検証フレームを視認して品質確認

備考: 使用した ffmpeg ビルドに libass/drawtext が無く、テキスト描画を HTML に寄せざるを
得なかったことが、逆に「テキスト描画は全部 HTML」構成の実証になった。

## 3. 競合状況

競合状況・差別化戦略の分析は非公開の内部 research で管理する（本リポには置かない方針）。
本設計はその分析を前提に承認済み。

## 4. アーキテクチャ（サンドイッチ 3 層 + 手）

```
┌─────────────────────────────────────────────┐
│ 透明 WKWebView（表現プレーン）                 │ ← HTML/CSS/SVG/Three.js
│  - 字幕・テロップ・図形・3D（AI が書く）        │    選択ハンドル・編集 UI もここ
│  - Web Animations API で時刻同期               │
├─────────────────────────────────────────────┤
│ AVPlayerLayer（映像プレーン・ネイティブ）       │ ← AVMutableComposition
│  - カットリストのギャップレス再生               │    サンプル精度同期・4K HW デコード
├─────────────────────────────────────────────┤
│ 手（CLI）                                     │ ← ffmpeg / whisper.cpp /
│  - カット・プロキシ・エンコード・書き出し        │    HyperFrames / Akari Cloud API
└─────────────────────────────────────────────┘
```

### なぜこの分担か

- **映像 = ネイティブ**: `<video>` の currentTime ジャンプではカット境界にヒッチが出る。
  AVMutableComposition はギャップレス + サンプル精度同期 + HW デコード。
  旧実装が WebCodecs 手動デコードで戦った領域は OS に任せる
- **表現 = Web**: LLM の学習データ量で HTML/CSS/Three.js が圧倒的（= プリセット不要の源泉）。
  ブラウザ compositor は DOM 合成に最適化済みでオーバーレイはほぼタダ
- **旧実装で不可能だった理由**: 旧設計は Canvas 合成（preview=export SSOT）のため映像の
  ピクセルアクセスが必須で、不透明な AVPlayerLayer は使えなかった。
  本設計は「WYSIWYG は同一 HTML を書き出しでも通すことで保証」に転換したため、
  JS が映像ピクセルに触る必要が消え、ネイティブ映像プレーンが可能になった

### プレビューと書き出しの分担

| | プレビュー | 書き出し |
|---|---|---|
| 映像 | AVMutableComposition 再生 | ffmpeg（原本からカット・エンコード） |
| 表現 | ライブ DOM（即時・触れる） | HyperFrames フレーム毎キャプチャ（決定的） |
| 精度 | 近似（±数十 ms 許容） | フレーム正確 |

## 5. 編集モデル — 「人間は HTML を編集しない」

編集の受け口は 3 層：

1. **タイミング・配置**（調整の 9 割）: `data-start`/`data-duration` とルート transform。
   タイムライン UI とドラッグで完結、HTML の中身に触れない
2. **宣言されたツマミ**: AI は調整可能な値を CSS 変数で書く規約。ビューワーが変数を発見して
   スライダー/カラーピッカーを自動生成。テキストはダブルクリック → contenteditable
3. **見た目の大改造**: 自然言語 → AI が HTML を書き換え

書き戻しの規律: 人間の操作は必ずデータ（edit.json / data 属性 / CSS 変数）に着地。
AI は read-modify-write でそれを尊重。人間と AI が同じセーブデータ上で衝突しない。

コード完結型フレームワークが props エディタ止まりになるのは配置もアニメも全部コードに入れる思想だから
（ピクセル → コードの逆写像が無い）。本設計は配置・タイミングをコードの外に構造として
持たせることで直接操作を成立させる。

## 6. 技術スタック

| 層 | 技術 | 備考 |
|---|---|---|
| シェル | Tauri v2（Rust） | ウィンドウ・FS・プロセス起動 |
| 映像プレーン | Swift/ObjC + AVFoundation（FFI ブリッジ or objc2） | `ns_window()` 経由で透明 WebView の下に sublayer 差し込み。唯一の本格ネイティブ工事 |
| 表現プレーン | HTML/CSS/SVG + WAAPI、3D は Three.js + glTF | 動画テクスチャ = VideoTexture（プロキシ） |
| セーブデータ | edit.json + オーバーレイ HTML 断片 | agent が直接編集する SSOT |
| 手 | ffmpeg / whisper.cpp / HyperFrames CLI / Akari Cloud API | 全部ローカル CLI（生成系のみ cloud） |

### 性能原則

- 見えている分だけデコード（プレイヘッド可視クリップのみ。マルチトラック ≠ 同時デコード）
- プロキシ第一（取り込み時に 720p を裏で生成。プレビューは常にプロキシ、書き出しは原本）
- オーバーレイ規約: transform/opacity アニメ中心、4K 上の blur/backdrop-filter 禁止

### 移植性

映像プレーンは薄いインターフェース（load/play/pause/seek/currentTime 通知）の裏に隔離。
Windows は将来: v1 = WebView `<video>` フォールバック（書き出し品質は同一）、
v2 = Media Foundation。今は macOS のみ。

## 7. MVP マイルストーン

- **M0**: サンドイッチ POC — Tauri v2 + 透明 WebView + AVPlayerLayer で動画 1 本の上に DOM
- **M1**: edit.json cuts → AVMutableComposition ギャップレス再生
- **M2**: オーバーレイランタイム（data 属性同期・シーク・CSS 変数）
- **M3**: インタラクション層（選択・ドラッグ・contenteditable → 書き戻し）
- **M4**: 書き出しパイプライン（HyperFrames + ffmpeg）

スコープ外（描画基盤の後）: 文字起こし統合・スタイル学習・生成系・Windows・shell/Pool 統合。

## 8. 参照

- Step 1 実験成果物: 編集 JSON + 仮組み動画（セッション成果物）
- 調査レポート: 非公開の内部 research で管理（本リポには置かない方針）
- HyperFrames: https://github.com/heygen-com/hyperframes
