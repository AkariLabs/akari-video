# インスペクターの書き込み先 = 選択を出したタイムライン — 実機 L1 の証跡

タスク: `task/2026-09-23-inspector-write-owner`。

実機: 専用の CDP ポート 9483・一時ディレクトリの `--user-data-dir` / `THEIA_CONFIG_DIR` / `AKARI_HOME`（名前に `inspector-write-owner` を含む）。
操作はすべて CDP の実マウス・実キーボード（タイムラインの字幕の札のクリック・⌘クリック・タブのクリック・タブの × ・インスペクターの欄への入力・台本の「T この行から文字を置く」）。
DI コンテナからは読み取りだけ（選択のスナップショット・書き込みの口の持ち主）。持ち主は、各タイムラインの `handleInspectorWrite` を一時的に目印へ差し替えて `requestWrite` を 1 回呼び、どのタイムラインに届いたかで判定する（ファイルは書かない）。

## ファイル

| ファイル | 内容 |
|---|---|
| `scripts/gen-fixture.mjs` | fixture 5 案件: `two`（edit.json + captions.json / edit.short.json + captions.short.json。`c-0001` は両方にある = 取り違えが黙って起きるかを見る）/ `one`（1 本・回帰の基準）/ `zero-missing`（captions.json 無し）/ `zero-empty`（`{"captions": []}`）/ `zero-two`（captions.json 無し + タイムライン 2 本）。映像は ffmpeg |
| `scripts/l1.mjs` | L1 本体（`before` = 記録のみ / `after` = `judge.mjs` で判定）。シナリオ: two / one / zero-missing / zero-empty / zero-two / zero-cold（タイムラインを開かずに台本から置く）/ notify |
| `scripts/judge.mjs` | AFTER の受け入れ条件の判定 |
| `scripts/cdp-lib.mjs` / `scripts/l1-lib.mjs` | 既存の L1 証跡（inspector-caption-style-panel）の写し |
| `results-before.json` / `results-after.json` | 実測値（操作ごとの: 選択 / 口の持ち主 / 書き換わったファイル / 通知の文言 / 読み直した値） |
| `before-*.png` / `after-*.png` | スクリーンショット |

## BEFORE（変更前のビルド = 公開 main `489a2160`）— 手順 0 の再現

| 操作 | 口の持ち主 | 書き換わったファイル | 欄の通知 |
|---|---|---|---|
| 2 本を開いた直後 | **edit.short.json 側**（edit.json のタブが前面でも） | — | — |
| (a) edit.json 側 c-0002 の色 | short | なし | **字幕 c-0002 が見つかりません。** |
| (a) edit.json 側 c-0001 の色（同じ id が captions.short.json にもある） | short | **captions.short.json**（黙って別のタイムラインを書き換え） | なし |
| (c) short 側 s-0002 の色 | short | captions.short.json | なし |
| (c) タブを戻して edit.json 側 c-0002 の色 | short（切り替えても取り戻さない） | なし | 字幕 c-0002 が見つかりません。 |
| (c) short 側 c-0001 の色 | short | captions.short.json | なし |
| short で s-0002 を選んだまま short を閉じる | なし（口が消える） | — | 選択は空になった |
| (b) 閉じた後 edit.json 側 c-0002 の色 / 文字・置いた文字 c-0101 の色 / 文字・複数選択の色（5 操作） | なし | なし | **書き込み機能が利用できません。**（5 回とも） |
| (d) 1 本の案件: 色 / 文字 / 置いた文字 / 複数選択 | edit.json 側 | captions.json | なし |
| 0 行（captions.json 無し / 空・1 本）: 台本から置いた直後の大きさ / 色 / 文字 | edit.json 側 | captions.json | なし（1 本では再現しない） |
| **0 行 + タイムライン 2 本（zero-two）**: 台本から置いた直後の大きさ / 色 / 文字 | short | なし | **字幕 c-0001 が見つかりません。**（3 回とも = オーナー所見「字幕 C001 が見つかりません」の再現） |
| 書き込み失敗（テスト環境で書き込み処理を例外に） | edit.json 側 | なし | 欄の帯だけ（4 秒で消える）。右下の通知は出ない |

- オーナー所見「0 行から置いた直後に見つかりません」の原因は、captions.json の作成を読み直さないこと（契約 1b の (ii)）ではなく、**2 本目のタイムラインが書き込みの口を握っていること**だった（1 本の案件では captions.json 無し / 空とも正常）。読み込み・監視のコードは変えていない。
- 注記: 記録している BEFORE の最終回では、zero-missing の 3 操作が高負荷で遅れた（大きさの書き込みが 1.8 秒の読み取り窓を過ぎてから書かれ、欄の通知は出ていない）。同じビルドでの 1 つ前の回では 3 操作とも captions.json に書かれていた。
- BEFORE の 4 枚（`before-notify-throw.png` / `before-zero-cold-placed.png` / `before-zero-empty-placed.png` / `before-zero-two-placed.png`）はホームのカードに出る一時ディレクトリの絶対パスを後から塗りつぶした。以後の撮影は `l1.mjs` の `shot()` が画面上のパスを伏せてから撮る。

## AFTER（最終ビルド）

`results-after.json`: **18 項目すべて pass**。

| 操作 | 口の持ち主 | 書き換わったファイル | 通知 |
|---|---|---|---|
| (a) edit.json 側 c-0002 の色 `#FF0000` | edit.json 側 | captions.json のみ | なし |
| (a) edit.json 側 c-0001 の色 `#00AA00` | edit.json 側 | captions.json のみ（captions.short.json の c-0001 は色なしのまま） | なし |
| (c) short 側 s-0002 → edit.json 側 c-0002 → short 側 c-0001（タブを実クリックで切り替え） | short → edit.json → short | captions.short.json → captions.json → captions.short.json（captions.json の c-0001 は `#00AA00` のまま） | なし |
| short で s-0002 を選んだまま short を閉じる | なし | — | 選択は空（`null`） |
| (b) 閉じた後: c-0002 の色 `#FF8800` / 文字・置いた文字 c-0101 の色 `#22CC22` / 文字・複数選択 c-0001 + c-0002 の色 `#3344FF` | edit.json 側 | captions.json（5 操作とも値を読み直して一致） | なし（「書き込み機能が利用できません。」0 回） |
| (d) 1 本の案件 | edit.json 側 | BEFORE と同じ（ファイル・値・通知・選択が一致） | なし |
| 0 行: zero-missing / zero-empty / zero-two / zero-cold の置いた直後の大きさ 60 / 色 `#FF0000` / 文字 | edit.json 側 | captions.json（4 案件 × 3 操作とも値が一致） | なし（「見つかりません」0 回） |
| 書き込み失敗（テスト環境で書き込み処理を例外に）× 2 回 | edit.json 側 | なし | 欄の帯 + **右下の通知（error）**。2 回続けても右下は 1 件（ベルの件数 1） |

スクリーンショット: `after-two-a.png`（(a) の後）/ `after-two-c.png`（(c) の後）/ `after-two-b-closed.png`（short を閉じた直後）/ `after-two-b.png`（(b) の後）/ `after-one.png` / `after-zero-*-placed.png`・`after-zero-*-after-writes.png` / **`after-notify-throw.png`・`after-notify-throw-twice.png`（右下の通知）**。

## 再現手順

```sh
node scripts/gen-fixture.mjs            # 一時ディレクトリへ fixture（ffmpeg が要る）
node scripts/l1.mjs after               # apps/shell を npm run build 済みで
```
