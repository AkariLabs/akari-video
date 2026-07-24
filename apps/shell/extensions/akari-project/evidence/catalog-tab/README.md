---
layer: wiki
tier: 30_products
type: product
status: active
updated: 2026-07-25
---

# catalog-tab L1 検証手法・証跡

タスク: `2026-07-25-catalog-tab`（カタログタブ GUI — 検索 + カテゴリ + カード +
エージェント動詞 2 本）の実機検証記録。

## 手法

`verify` スキルの L1 節（Electron 直接起動 + CDP）に従った。依存追加なし
（Node 22+ 組み込みの `fetch`/`WebSocket` のみ）。`cdp-lib.mjs` は
`card-ask-agent`（f740707）/ `export-button`（c309560）と同じ共有ヘルパー
（様式踏襲・中身無改変）。

1. `apps/shell` を `npm run build`（`build:ext` → `theia build --mode production`）でビルド
2. `templates/project-default/` を隔離ワークスペース（リポ外の scratchpad）へコピーし、
   `.akari/intake.json`（`status: "submitted"`）でホーム v2 の home-flow ゲートを解放。
   `assets/regression-clip.mp4` は ffmpeg で生成した実 2 秒動画（素材タブ回帰確認用）
3. フィクスチャカタログを別ディレクトリに新規構成（`catalog/` は読み取り専用のため
   一切書き換えていない）: `catalog/3d/vintage-camera/meta.json` と
   `catalog/3d/modern-smartphone/meta.json`、`catalog/audio/corporate-upbeat-bgm/meta.json`、
   `catalog/audio/cozy-lofi-bgm/meta.json` の実物 4 件をそのままコピー（2 カテゴリ・4 アイテム）。
   加えて `3d/broken-item/meta.json`（構文的に壊れた JSON）と `3d/no-meta-item/`
   （meta.json 自体が無いディレクトリ）を追加し、拾い漏れ 2 件を意図的に混在させた。
   **`source.preview_url` だけは全アイテムで到達不能な URL
   （`http://127.0.0.1:1/unreachable-preview.png`）へ差し替えた**——実行環境の
   実回線状態に依存せず「オフライン/失敗時のプレースホルダフォールバック」を
   決定論的に再現するため（他のフィールドは実物のまま無改変）
4. `node_modules/electron/dist/Electron.app/Contents/MacOS/Electron <apps/shell 絶対パス>
   <隔離ワークスペース絶対パス> --remote-debugging-port=<port> --user-data-dir=<隔離dir>
   --no-sandbox` で直接起動。dev-layout フォールバック実測のため、起動時の shell cwd は
   本 worktree のリポジトリルートに揃えた（`resolveCatalogRoot` の候補パス
   `resolve(process.cwd(), 'catalog')` が本物の `catalog/` を指すようにするため）
5. パートナー端末バッファへの到達確認（「取り込む」「頼む」の実測）だけは、実
   claude/codex CLI のネットワーク越しブートストラップを避けるため、
   `AkariRoleBucketsWidget`（本タスクが所有する akari-project 側のファイル）の
   postConstruct に一時デバッグフック `globalThis.__akariRoleBucketsWidgetDebug = this`
   + 一時 `WidgetManager` 注入を追加し、`widgetManager.getOrCreateWidget('akari-partner-onboarding')`
   （card-ask-agent/export-button と同じ「文字列 id だけ知っている」パターン）で
   実行中の `AkariPartnerWidget` シングルトンを取得、`terminalService.newTerminal()` +
   `attachTerminal()`（`begin()` の成功パスが呼ぶのと同じ本番コードそのもの）で
   ダミーの echo CLI を接続した。akari-partner 側のファイルは一切編集していない
6. **検証中の事故と復旧（透明性のため記録）**: `akari.catalog.root` を
   フィクスチャへ切り替える手段として、当初は本番 API である
   `preferences.set(key, value, PreferenceScope.User)` をデバッグフック越しに
   呼んだ。ところがこの呼び出しは `--user-data-dir` による隔離を受けず、
   この開発機で全 Theia セッション共有の実ファイル `~/.theia/settings.json`
   （`EnvVariablesServer.getConfigDirUri()` が `apps/shell/data/user-data` 不在時に
   `homedir()/.theia` へフォールバックする実装のため）へ書き込んでしまうことが
   実測で判明した——実際に `akari.catalog.root` キーが同ファイルに書き込まれて
   いるのを検出し、**直後に該当キーだけを削除して原状回復した**（他のキーは
   一切変更していない。復旧後の同ファイル内容は本 README 末尾に記録）。
   これは本タスクの実装コード自体の欠陥ではなく、検証ドライバの手段選択の
   誤りである。再発防止のため、以降は `preferences.set` を一切呼ばず、
   `widget.preferences.get` だけを対象キーに限定してその場でモンキーパッチし
   （ファイル I/O 皆無）、`loadCatalog()`（本番コードそのもの）を明示的に呼ぶ
   方式に変更した。この変更後に**フィクスチャ用ワークスペース丸ごと作り直した
   上で再実測**し、`~/.theia/settings.json` が汚染されないことも確認した
7. デバッグフックは証跡取得後（`run-l1.mjs` 実行後）に完全に削除してから
   `npm run build` を再実行し、フック不在の最終ビルドに対して `final-smoke.mjs`
   でフック不要な項目（カード表示/検索/カテゴリ絞り込み/missingCount 耐性/
   未接続トースト/回帰）をもう一度実測した（card-ask-agent/export-button と
   同じ手順。端末バッファ到達確認だけはフックが無いと再現できないため
   `run-l1.mjs` 側でのみ実測）
8. 送信・受信は実 UI 操作のみで検証: カード上の「取り込む」「頼む」ボタンの
   実クリック + quick-input への `Input.insertText` による実キーボード入力 +
   Enter/Escape の実キーイベント + 検索ボックスへの実テキスト入力。
   文脈パケット全文の到達確認は、xterm.js の `Terminal.buffer.active` を
   走査してターミナルバッファの生テキストを再構成する方式
   （折り返し行は `line.isWrapped` で連結）
9. 後片付け: 起動した Electron は実 PID を指定して kill。**1 回目は main
   プロセスの kill だけでは `lib/backend/main.js` の Electron Helper が
   孤児化することを `ps aux` で実際に検出し、当該 PID を個別に `kill -9`
   した**（以降の起動では毎回 `ps aux` で `catalog-tab-l1` を含むプロセスの
   残存ゼロを確認してから次を起動）。さらに**全実行終了後、ワークスペース
   パスを含まない `lib/backend/plugin-host` 孤児プロセス（cmdline にはこの
   worktree の `apps/shell` パスのみが残り、隔離ワークスペース/user-data-dir
   の文字列を含まないため、ワークスペースパスだけで grep する簡易チェックでは
   見逃していた）が最大 4 件累積して残っていたことをマシン全体の `ps aux`
   スイープで検出し、該当 PID をすべて `kill -9` して残存ゼロを確認した**。
   task.md の「plugin-host 孤児まで確認」という指示どおり、ワークスペース
   パスだけでなく `apps/shell/lib/backend/plugin-host` パスそのものでの
   grep も併用しないと見逃しうることを実地で確認した教訓として記録する

## 実測結果（詳細は `run-log.json` / `final-smoke-log.json` / スクリーンショット）

| # | 項目 | 結果 |
|---|---|---|
| ボーナス | `akari.catalog.root` 未設定時のリポ開発配置フォールバック（実 `catalog/`） | `01-dev-layout-autodetect.png` + `final-smoke-00/01`。実測 24 件 / 5 カテゴリ（3d・audio・broll・font・luts）・missingCount 36（telop = meta.json 非対応の実物構成をそのまま反映）。preferences.set を一切呼ばない final-smoke でも再現し、開発配置探索ロジック単体の健全性を確認 |
| L1-1 | fixture カタログ（2 カテゴリ・4 アイテム）でカードが title/カテゴリ/tags/ライセンスバッジ付きで並ぶ | `03-fixture-catalog-cards.png`。実測: `itemCount=4, missingCount=2`。vintage-camera カードの実測テキスト `ヴィンテージカメラ 3D モデル 3d product-demo vintage camera CC0-1.0 取り込む 頼む` |
| L1-1 (続) | `preview_url` 失敗時はプレースホルダへ黙ってフォールバックし console error 0 | 同上。全アイテムの `preview_url` を到達不能 URL に差し替えた状態で `thumbnailErrorDelta: 0`（サムネ読み込み前後の `window.__errCount` 差分） |
| L1-2 | 検索 1 語でカードが絞れる（件数実測） | `04-search-filtered.png`。クエリ `スマートフォン` → 4 件中 1 件（`3d/modern-smartphone`）に絞込み。final-smoke でも実カタログに対し `ヴィンテージ` → `3d/vintage-camera` を含む結果で再確認 |
| L1-2 | カテゴリチップで絞れる（件数実測） | `05-category-filtered.png`。チップ `3d` → 4 件中 2 件（`vintage-camera`・`modern-smartphone`）。`All` へ戻すと 4 件に復帰 |
| L1-3 | 「取り込む」→ 端末バッファに固定パケット全文（id/category/title/source.url/license/依頼文） | `07-import-injection.png`。実測パケット: `【カタログ素材】vintage-camera（category 3d・title ヴィンテージカメラ 3D モデル・source: https://polyhaven.com/a/Camera_01・license: CC0-1.0）について: この素材をカタログの参照情報から取得し、ライセンス表記を確認の上プロジェクトへ配置してください（setup-library 系スキルの手順に従う）`。PTY ローカルエコー + ダミー CLI の `ECHO:` 応答の両方に全文一致で出現 |
| L1-4 | 「頼む」→ quick-input 実入力 → 端末到達（when_to_use 断片 + 入力文） | `08-ask-agent-injection.png`。実測パケット: `【カタログ素材】modern-smartphone（category 3d・title 現代的なスマートフォン 3D モデル（縁なしスクリーン）・source: https://opengameart.org/content/smartphone-2・license: CC0-1.0・用途: アプリ紹介・UI 解説・プロダクトデモで、実機に画面を映し込んだモックアップ映像を作るとき）について: 配置してから使いたい`（入力文は実キーボード入力） |
| L1-5 | 壊れ meta.json / meta.json 無しアイテム混在 → 例外なく他カードは表示・拾い漏れ件数記録 | `03-fixture-catalog-cards.png` と同一実行。`missingCount=2`（`3d/broken-item` の構文エラー JSON + `3d/no-meta-item` の meta.json 不在）が正確に計上され、有効な 4 件は通常どおり表示・console error 0。final-smoke でも実カタログの telop 36 件（meta.json 非対応）が同じ経路で missingCount に計上されることを再確認 |
| L1-6 回帰 | 素材タブ（ドロップゾーン/カード/lint バッジ）・プランタブ空状態・書き出しボタン | `09〜11.png` + `final-smoke-05/06.png`。ドロップゾーン健在、`regression-clip.mp4` カード表示（未分析バッジ `--:--`）、プランタブの空状態文言 `プランはここに入ります…` 無変更、akari-shell-strip の「書き出し」ボタン（他 extension・読み取りのみ確認）健在 |
| 未接続トースト | パートナー未接続で「取り込む」→ 実文言トースト、注入なし | `02-not-connected-toast.png` + `final-smoke-04-not-connected-toast.png`（デバッグフック不在の最終ビルドでも再現）。実測トースト文言: `パートナー未接続。ホームの「パートナーに接続する」から接続してください`（④⑤と同一文言） |
| キャンセル | 「頼む」の quick-input を Escape | トースト件数不変・quick-input は非表示に復帰。注入コマンドは呼ばれない（no-op） |
| 隔離・後片付け | 実 Electron 隔離起動 + 終了時 kill + 孤児プロセス確認 | 各回 `ps aux` で `catalog-tab-l1` を含むプロセス残存ゼロを確認（1 回目は backend helper の孤児化を検出し個別 kill、以降は解消） |

## L0（単体テスト・静的検査）

- `npm run build:ext`: exit 0
- `npm run lint`: exit 0
- `apps/shell/extensions/akari-project` の `npm test`: **25/25 pass**
  （既存 6 件 + 新規 19 件: `parseCatalogItemMeta` 7 件〔必須 3 フィールドのみ/欠落/空文字/壊れJSON/非オブジェクト/未知フィールド許容/license・source欠落〕・`filterCatalogItems` 7 件〔検索対象=名前・description・tags、カテゴリ絞込、複合絞込、0件〕・`composeCatalogImportPrompt`/`composeCatalogAskAgentPrompt` 5 件〔全要素・欠落要素・when_to_use先頭1文・複文の先頭1文のみ・when_to_use欠落〕）

## 拾い漏れ件数（実測・task.md 指定の記録項目）

- **fixture カタログ**（`3d`×2 有効 + `broken-item` + `no-meta-item`、`audio`×2 有効）: 拾い漏れ **2 件**
  （`3d/broken-item`: 構文的に壊れた JSON、`3d/no-meta-item`: meta.json 自体が不在）
- **実カタログ**（本 worktree の `catalog/`。dev-layout フォールバックで自動検出）: 拾い漏れ **36 件**
  （すべて `telop/` 配下 — 本版の設計どおり meta.json 非対応〔`index.jsonl` + `template.json` 方式〕のため一覧に出ない。task.md 記載の想定どおり）

## 既知のノイズ（catalog-tab のコードとは無関係）

`run-l1.mjs` の最終 `finalConsoleErrorCount` は 1
（`window.error: Uncaught Error: This API only accepts integers`）。これは
**xterm.js**（`node_modules/xterm/lib/xterm.js`）内部の resize 処理に由来し、
`export-button`（c309560）の評価記録と同一の既知ノイズ——L1-3/L1-4 証跡取得
専用のダミー partner 端末アタッチ（この経路にのみ登場する xterm インスタンスの
初期 resize）でのみ観測される。catalog-tab が追加した
`catalog-reader.ts`/`catalog-context-packet.ts`/`akari-role-buckets-widget.tsx`
のいずれにも一致しない。サムネイルフォールバック固有の
`thumbnailErrorDelta` は 0（= catalog-tab のコード自身は無エラー）。
ダミー端末を使わない `final-smoke.mjs`（デバッグフック不在の最終ビルド）では
`finalConsoleErrorCount: 0` — 実運用コードパスにこのノイズは存在しない。

## preferences.set 事故の復旧確認（透明性のため記録）

事故発生時に `~/.theia/settings.json` に書き込まれたのは `akari.catalog.root`
キー 1 件のみ（値は隔離 scratchpad 内のフィクスチャパス）。検出直後に当該
キーだけを削除し、他のキー（`security.workspace.trust.trustedFolders` /
`akari.developerMode` / `workbench.colorTheme` / `akari.cloud.account`）は
一切変更していない。復旧後の内容（本 README 作成時点で再確認済み）:

```json
{
    "security.workspace.trust.trustedFolders": [
        "file:///Users/ryoma/_edit/30_products/akari-video-internal/lab/theia-poc/sandbox-project",
        "file:///private/tmp/claude-501/-Users-ryoma--edit-30-products-akari-video-internal/77763a52-f140-4375-9e43-b628cd5765df/scratchpad/fresh-ws"
    ],
    "akari.developerMode": false,
    "workbench.colorTheme": "dark",
    "akari.cloud.account": ""
}
```

以降のすべての起動（`run-l1.mjs` の再実行・`final-smoke.mjs`）でこのファイルが
変化しないことを毎回 `cat` で確認済み。

## 設計裁定の実装確認

- カタログルート解決順: preference `akari.catalog.root`（設定されていればそれ
  のみを検証・見つからなければ空状態） → 未設定時はリポ開発配置探索
  （`resolve(__dirname, '../catalog')` / `resolve(process.cwd(), '../../catalog')` /
  `resolve(process.cwd(), 'catalog')` / パッケージ版 `__dirname` 相対、の 4 候補）
  → どちらも無ければ空状態文言 `カタログの場所が未設定です（設定 akari.catalog.root）`
- カード動詞 2 本はいずれも `agent-context-packet.ts` の
  `composeAgentContextPacket` を再利用し `akari.partner.injectPrompt`
  （f740707 で新設済み・ID 文字列呼び出しのみ・akari-partner 側は無改造）へ注入
- 取得・配置・catalog/ への書き込みは一切実装していない（読み取り専用の参照データ）

## 未確認事項

- 実 claude/codex CLI（実ネットワーク越しのインストール・実ログイン）を使った検証は
  本環境では実施していない（ダミー CLI での代替は task.md 明記の許容範囲）
- Windows/Linux での再現性は未確認（macOS darwin-arm64 のみで検証）
- `akari.catalog.root` に「設定されているが存在しないディレクトリ」を指定した
  場合の挙動（本実装ではフォールバックせず空状態のまま）は task.md の L1
  必須項目に含まれないため、L0 のコードレビュー範囲でのみ確認しており実機
  クリック検証はしていない
- Theia の User スコープ設定が `--user-data-dir` で隔離されない挙動
  （`apps/shell/data/user-data` が存在すればそちらが優先される実装）は今回
  代替手段への切替で回避しただけで、恒久的な隔離手段の確立はしていない
  （将来の同種検証への申し送り事項）
