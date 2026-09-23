# daihon-edit-keeps-style — 台本で 1 文字直しても強調・改行・整文が変わらない（L1 証跡）

## 何を見たか

台本パネルで字幕を 1 文字だけ直したとき、captions.json の `words` の時刻・ルートの `emphasis_words`・
`display_text`・`display_fragments` と、出力プレビューの見た目（強調 span・行・画素）が編集前後でどう変わるか。
変更前ビルド（BEFORE）と変更後ビルド（AFTER）で同じ fixture・同じ操作を流した。

## fixture（`scripts/gen-fixture.mjs`）

`display_policy`（14 字・2 行同時表示）付きの captions.json に 5 本の cue。強調は `style_preset: emphasis-red`。

| cue | 内容 | 台本での 1 文字編集 |
|---|---|---|
| c-0001 | 強調 2 か所（大事・話） | 今日 → 明日（強調の無い語） |
| c-0002 | 手動の改行 `display_fragments` 2 断片 | 淹れ → 入れ（2 断片目の中） |
| c-0003 | 整文 `display_text`「これが新しい機能です」（text は「えーと、これが…」） | これ → それ |
| c-0004 | 空白を含む文（words が `Claude` / ` Code` / ` を` …）・Claude Code に強調 | 毎日 → 毎朝 |
| c-0005 | 直す語そのものに強調（簡単） | 簡単 → 簡便 |

## 手順（`scripts/l1.mjs`）

1. Electron を専用の隔離ディレクトリ・CDP ポートで起動し、タイムライン・出力プレビュー・台本を開く
2. 各 cue の中点へシークし、プレビューの字幕の板（本文・行・強調 span）を読み、プレビュー領域を撮る（`<phase>-pre-<id>.png`）
3. 台本の行本文をダブルクリック → 入力欄を全選択 → 新しい本文を実キー入力 → Enter（`finishEdit` → `setCaptionFields`）
4. 5 本とも書いたら、もう一度 2 を撮る（`<phase>-post-<id>.png`）。台本の全体も前後で撮る（`<phase>-daihon-*.png`）
5. `scripts/pixel-diff.mjs` で前後の撮影を画素比較（再生バー等を除いた映像枠 `20,60,502,440`・しきい値 24）
6. `scripts/export-html-check.mjs` で書き出し側（render-cut の `resolveCaptionPlan` → オーバーレイ HTML）の強調 span を数える

## 結果

### captions.json（`results-*.json` の `diff`）

| cue | BEFORE: 変えていない語の時刻 | AFTER | BEFORE: 長さ 0 の語 | AFTER | BEFORE: 改行/整文 | AFTER |
|---|---|---|---|---|---|---|
| c-0001 | 0/8 一致（全語が 1 つずつずれる） | 7/8（直した語以外すべて完全一致。直した語も時刻は同じ） | 1 | 0 | — | — |
| c-0002 | 2/11 | 10/11 | 2 | 0 | fragments 削除 | `["朝のコーヒーは","挽きたての豆で入れます"]` |
| c-0003 | 6/7 | 6/7 | 0 | 0 | display_text 削除 | `"それが新しい機能です"` |
| c-0004 | 1/6 | 5/6 | 2 | 0 | — | — |
| c-0005 | 3/7 | 6/7 | 0 | 0 | — | — |

強調（ルート `emphasis_words`）: AFTER は c-0001・c-0004 の強調が同じ時刻のまま、c-0005 は `簡単 18.467–19.033` →
`簡便 18.467–19.033`（同じ文字区間へ付け替え）。

### 出力プレビュー（強調 span の文字）

| cue | BEFORE 前 → 後 | AFTER 前 → 後 |
|---|---|---|
| c-0001 | 大事・話 → **なし** | 大事・話 → 大事・話 |
| c-0002 | 改行「朝のコーヒーは / 挽きたての…」→「朝のコーヒーは挽 / きたての…」 | 改行位置そのまま |
| c-0003 | 「これが新しい機能です」→「えーと、それが新しい機能です」（整文が生テキストに戻る） | 「それが新しい機能です」 |
| c-0004 | Claude・ Code → **なし** | Claude・ Code → Claude・ Code |
| c-0005 | 簡単 → **です**（別の語に移る） | 簡単 → 簡便 |

画素差（`pixel-diff-*.json`、差のある画素の外接矩形）:

| cue | BEFORE | AFTER |
|---|---|---|
| c-0001 | 243×37 | 14×14（1 文字） |
| c-0002 | 147×33 | 14×14 |
| c-0003 | 185×14 | 12×12 |
| c-0004 | 214×68 | 13×14 |
| c-0005 | 92×34 | 34×33（強調の大きい 1 文字） |

### 書き出し側（`export-html-*.json`）

同じ編集を `updateCaptionFieldsInSource` に通した後の render-cut の HTML の強調 span:
BEFORE はカーネル経路で全部消える／「です」へ移る・従来経路で「Claude」だけ残る。
AFTER はカーネル経路・従来経路とも c-0001 大事|話・c-0004 Claude| Code・c-0005 簡便。

## 台本が編集する文字（整文の規則）

台本の入力欄は `text`（生テキスト）を出し、`text` を書く（c-0003 の入力欄の値は「えーと、これが新しい機能です」）。
`display_text` がある cue では、`text` の文字差分（前後の共通部分を除いた変更区間）を、左右の文脈で一意に決まる
`display_text` 上の位置へ同じように写す。一意に決まらないときだけ従来どおり `display_text` を外す。
