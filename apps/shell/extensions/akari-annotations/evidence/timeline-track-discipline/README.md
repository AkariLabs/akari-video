# evidence: timeline-track-discipline

トラックの規律（空トラックが残る / 最上段より上へ行けない / 緑ラインが早すぎる）の実測記録。

## 実装の裁定（2026-08-22）

1. **空トラックを畳む範囲**: 「移動によって**今まさに空になった** `lane: "visual"` の `items[]` 段」だけを
   `tracks[]` から取り除く。字幕の `content` 段（正本は captions.json）と `lane: "audio"` 段は
   別の正本・ミックス契約を持つため自動削除しない。「トラックを追加」で明示的に作られた空段も
   **全件 sweep しない**（追加 → 配置の途中状態を壊さないため）。畳むのは当該要素の `splice` だけなので、
   残る段の相対順（= z の権威である `tracks[]` の配列順）は不変。
2. **段間挿入は廃止**: 隣接 2 段の境界では**まずその段へ入る**。新規段は visual トラック群の
   上端・下端を越えた**外側だけ**で作る。上側は beats 帯・中央寄せ余白を含めて**距離無制限**、
   下側も次の audio 段の本体に入るまで（audio が無ければ距離無制限）。
   `audio` / `captions` の**本体**に入ったときだけ従来どおりレーン越えとして拒否する。
   → visual 列に「何をしても拒否される謎の空白」が無くなり、緑ラインの表示位置と
   ドロップ結果が常に一致する。

当たり判定は `src/common/timeline-track-drop.ts` の純関数 `hitTestTimelineTrackDrop` へ切り出し、
`test/timeline-track-drop.test.mjs` で単体テストしている（`timeline-material-insert.ts` /
`audio-overlap-layout.ts` と同じ流儀）。

## fixture

`fixture/` を `templates/project-default/` の複製へ重ねて使う（実素材 `assets/source.mp4` は
`ffmpeg -f lavfi` で 6 秒ぶん生成し、検証後に破棄・コミットしない）。`tracks[]` は宣言順に:

| index | id | lane | 中身 | ねらい |
|---|---|---|---|---|
| 0 | `a-bgm` | audio | `bgm-1` | 巻き添え削除されないこと・レーン越え拒否 |
| 1 | `v-empty` | visual | `items: []` | 明示的な空段が sweep されないこと |
| 2 | `v1` | visual | `c1` | 通常段 |
| 3 | `v-lay` | visual | `L1` / `L2`（`blend: "screen"` → layers 経路） | オーナー報告の「⚠ レーンが異なるため移動できません」を出す分岐 |
| 4 | `v2` | visual | `c2` | 症状 3 の移動先 |
| 5 | `v3` | visual | `c3` | 症状 1/2/3 の移動元（1 本だけなので移動で空になる） |
| 6 | `captions` | visual | `content: { from: "captions.json" }` | `items[]` を持たない content 段（症状 2 の真因） |

画面の縦順は `tracks[]` の逆順（上から captions → v3 → v2 → v-lay → v1 → v-empty → a-bgm）。

## 再現コマンド

```sh
# 1) L0
cd apps/shell && npm run build:ext && npm run lint
cd extensions/akari-annotations && node --test test/*.test.mjs

# 2) 実機ビルド
cd apps/shell && npm run build

# 3) 隔離ワークスペースを作り Electron を CDP 付きで起動してから
node evidence/timeline-track-discipline/scripts/run-l1.mjs <cdpPort> <workspaceDir> <evidenceDir>
# 症状の再現/非再現だけを記録するプローブ（修正前ビルドでも走る）
node evidence/timeline-track-discipline/scripts/probe-symptoms.mjs <cdpPort> <ws> <ev> <label> [s31|s2|all]
node evidence/timeline-track-discipline/scripts/probe-layer.mjs   <cdpPort> <ws> <ev> <label>
```

観測は**すべて実 DOM**（`.akari-track-band` / `.akari-annotations-strip-clip` /
`[data-testid="akari-track-insert-indicator"]` / dragFeedback）と **edit.json の実差分**から取る。
`window.__akariPreview.summary` は差分更新で更新されないため使わない
（handoff-2026-08-20 §7-3 の既知の罠）。

### 検証環境の注意（製品コード無変更、ドライバ側の対応）

Electron の既定ウィンドウは実測 1120x668 で、タイムライン帯（`stripScroll`）の可視高さが
**111px しかない**（コンテンツ高 422px）。下段のトラックが viewport の外に出て `pointerdown` の
ヒットテストに当たらないため、`Emulation.setDeviceMetricsOverride` で 1440x1250 へ広げてから操作する
（Electron は `Browser.setWindowBounds` を実装していない）。`pointerdown` さえ viewport 内で成立すれば、
以降は `strip.setPointerCapture` により viewport 外の座標へのドラッグも正しく届く。

## 修正前後の実測比較（同一 fixture・同一手順）

`probe-prefix-*.json` = 修正前ビルド（HEAD の akari-annotations）、`probe-postfix*.json` = 修正後。

### 症状 3（緑ラインが早すぎる）— 再現 → 解消

`v3` の `c3` を掴み、`v2` の帯の**内側**へ寄せたときの緑ライン（挿入インジケータ）:

| プローブ位置 | 修正前 緑ライン | 修正前 feedback | 修正後 緑ライン | 修正後 feedback |
|---|---|---|---|---|
| v2 上端 +1px | **visible, top=974.4**（v2 ではなく v3 の下端） | `行 3`（新規段） | hidden | `行 2`（= V2） |
| v2 上端 +3px | **visible, top=974.4** | `行 3` | hidden | `行 2` |
| v2 上端 +8px | **visible, top=980.4** | `行 2` | hidden | `行 2` |
| v2 中央 | hidden | `行 2` | hidden | `行 2` |
| v2 下端 -3px | **visible, top=1052.4** | `行 2` | hidden | `行 2` |

修正前は v2 の帯（top=981.4 / bottom=1054.4）の**内側**にいるのに緑ラインが出ており、しかも
上端 +1/+3px では緑ラインの位置（974.4 = v3 の下端）と feedback の行番号（3）とドロップ結果
（実際には V2 へ入る）が食い違っていた。修正後は帯の内側では常に緑ラインが出ず `行 2` で一貫する。

### 症状 1（空トラックが残る）— 再現 → 解消

`c3` を `v2` へ落とした直後の `tracks[]`:

- 修正前: `a-bgm, v-empty, v1, v-lay, v2["c2","c3"], **v3[]**, captions` ← 空の `v3` が残る
- 修正後: `a-bgm, v-empty, v1, v-lay, v2["c2","c3"], captions` ← `v3` が消え、
  `v-empty`（明示的な空段）・`captions`（content 段）・`a-bgm`（audio 段）は残る

### 症状 2（最上段より上へ行けない）— 再現 → 解消

最上段の帯（captions, top=861.4）より **120px 上**（y=741.4）へ運んだとき:

| 経路 | 修正前 | 修正後 |
|---|---|---|
| cut（`c3`） | `rejected: true` / `⚠ 同じ段の中で区間が重なるか、レーンが異なります` / 緑ライン hidden / ドロップは no-op | `rejected: false` / `行 3` / 緑ライン **visible, top=860.4** / `v4` が `tracks[]` 末尾に作られ `c3` が入る |
| layer（`L1`、オーナー報告の分岐） | `rejected: true` / **`⚠ レーンが異なるため移動できません`** / 緑ライン hidden / no-op | `rejected: false` / `行 2` / 緑ライン **visible, top=860.4** / `v4` が末尾に作られ `L1` が入る（`v-lay` は `L2` が残るので畳まれない） |

緑ラインの表示位置 860.4 は最上段の帯の上端 861.4 と 1px 差で一致し、実際の挿入先
（`tracks[]` 末尾 = 画面最上段）と一致する。

## L1 総合判定: PASS

`run-log-final.json` に全アサーションの実測値付き記録（末尾 `ALL ACCEPTANCE CRITERIA PASSED`）。

| # | 受け入れ条件 | 結果 |
|---|---|---|
| 1 | 症状 1/2/3 の再現・非再現が実測で確定 | **PASS**（上表） |
| 2 | 1 本だけのトラックからクリップを他段へ移すと元の段が `tracks[]` から消える | **PASS** |
| 3 | 字幕・音のトラックが巻き添えにならない | **PASS** |
| 4 | undo でトラックとクリップの両方が戻る | **PASS**（3 ケースとも全文一致） |
| 5 | 最上段のさらに上へドロップ → 新しい最上段が作られる（拒否されない） | **PASS**（cut / layer 両経路） |
| 6 | V3 のクリップを V2 の本体へ持っていくと V2 へ入る（緑ラインで邪魔されない） | **PASS**（5 点プローブ） |
| 7 | 緑ラインの表示位置とドロップ結果が一致 | **PASS**（860.4 vs 861.4、帯内では常に非表示） |
| 8 | 段の入れ替えで z 関係が変わる既存挙動が非回帰 | **PASS**（`10/11-reorder-*.png`） |
| 9 | CDP 検証は実 DOM を読む | 本 README「観測は…実 DOM」節 |

### 非回帰（段の入れ替え = z）

字幕トラックのヘッダー行を `v3` の行へドラッグ:

```
before: a-bgm, v-empty, v1, v-lay, v2, v3, captions      (DOM 上から: captions, v3, v2, ...)
after : a-bgm, v-empty, v1, v-lay, v2, captions, v3      (DOM 上から: v3, captions, v2, ...)
```

`tracks[]` の配列順と DOM の帯順（逆順）が全ステップで完全一致することを毎回突き合わせている
（= z の権威が配列順ただ一つであることの実測）。undo で元へ戻ることも確認済み。

**範囲外**: 「字幕を映像の下へ動かしたら実際に隠れる」の合成結果そのもの（プレビュー / render-cut 側の
z 合成）は本タスクの変更対象外のため実測していない。本タスクは `tracks[]` の配列順とタイムライン
描画順が一致することまでを確認している。

### レーン規律（非回帰）

字幕帯（content 段）の**本体**・audio 段の**本体**へ映像クリップを落とそうとすると、従来どおり
`rejected: true`（緑ラインも出ない）。ドロップは no-op で、一連の操作後の edit.json は初期状態と全文一致。

## スクリーンショット

`00`〜`11` が本走行（修正後・全受け入れ条件）、`prefix-*` が修正前ビルド、`postfix-*` が
同手順の修正後プローブ。
