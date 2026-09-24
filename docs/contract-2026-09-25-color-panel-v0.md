# 色パネル v0 契約（インスペクターの色の欄・色を作る窓・ブランドキット）

## 位置と開き方

- 色の欄は**インスペクターの列の中**にある。色の行の丸（字幕の 文字 / 縁取り / 座布団 / 効果の色、オーバーレイの色のつまみ）を押すと、同じ列の中身が色パネルに切り替わる。左上の戻るボタンで元の列へ戻る。選択が変わると閉じる。
- 色番号の入力欄は行にも残る（直接打てる。プレビューからの「欄を開く」もこの入力欄へ焦点を当てる）。
- ほかの部品（上のバーの色の丸など）はコマンドで開く:

```
akari.inspector.openColorPanel({
  target: { kind: 'field', field: '<data-akari-field の値>' }      // 今の選択のインスペクターの色の行
        | { kind: 'item', itemId: '<item id>', path: '<ドット区切り>' }, // edit.json の item の中（例 source.params.fill）
  allowGradient?: boolean,     // 既定 false。図形・ラインの塗り / 枠 / 線だけ true
  allowTransparent?: boolean,  // 既定 false。塗りだけ true
  title?: string,              // 見出し（省略時は行の名前。「色」だけの行は「<節>の色」）
  toggle?: boolean             // 同じ対象で開いていたら閉じる（バーの色の丸をもう一度押したとき）
}) → boolean（開いたら true）
akari.inspector.closeColorPanel()
```

- `item` の書き込みは edit-store の `updateItem` で行い、`path` の一番上の鍵（例 `source`）を丸ごと作り直して渡す（`updateItem` は source の中を浅くしか混ぜないため）。**書く前に `readEditV2` で読み直して検査し、その項目の契約が受け付けない値は書かずに断る**（例: 図形の契約がまだ文字列だけの版では、グラデーションを「この項目には、まだグラデーションを保存できません。」で断り、edit.json は変えない）。

## 値の形

図形の塗り・枠の契約（shape item v1）と同じ形を使う。

| 値 | 形 |
|---|---|
| 単色 | `#RRGGBB` か `#RRGGBBAA`（大文字にそろえる。AA = FF は落とす） |
| 透明（塗りだけ） | `'none'` = 中抜き |
| グラデーション | `{ type: 'linear', angle, stops }` / `{ type: 'radial', stops }`。`stops = [{ color: '#RRGGBB(AA)', offset: 0..1 }]`・2〜5 色・色ごとの透明度は color の AA |

- `angle` は CSS の `linear-gradient` と同じ向き（0 = 下から上・90 = 左から右・180 = 上から下）。
- 色を作る窓のスタイル 5 種はこの 2 型で表す: 横 = linear 90 / 縦 = linear 180 / 斜め ↘ = linear 135 / 放射 = radial / 斜め ↗ = linear 45。
- 色を足す・外すと `offset` は均等に振り直す（0, 1/(n-1), …, 1）。
- 純関数とテスト: `apps/shell/extensions/akari-annotations/src/browser/inspector/color-model.ts`。

## パネルの並び（上から）

1. 検索: 色の名前（「青」「あお」など・既定の単色の名前に当てる）/ 色番号（「#00c4cc」・3 / 6 / 8 桁）
2. 虹の ＋（色を作る窓）・スポイト（`EyeDropper`。使えない環境では一言）・透明（`allowTransparent` のときだけ）・**使った色の履歴**（新しい順に 8 個・グラデーションも 1 つの丸・今の色に印。今の色が履歴に無ければ先頭に並べる）
3. **このデザインの色**: edit.json と captions の器のファイルから、色らしい鍵（color / fill / stroke / background を含む）の値を使われている回数の多い順に最大 14
4. **ブランドキット**: 「＋ ブランドカラーを追加」で今の単色を入れる。「編集」で外す
5. **写真の色**: 置いた画像（どのトラックでも）と B-roll（一番上の visual トラック以外の動画）から、最大 4 本・各 5 色。画素を 64px に縮め、各チャンネル 4bit の箱で数えて多い順に「既に選んだ色と十分に離れた色」を拾う（決定論）
6. **デフォルトの単色**: 4 段 28 色（すべて表示で 6 段 42 色）
7. **デフォルトのグラデーション**（`allowGradient` のときだけ）: 3 段 21 種（すべて表示で 5 段 35 種）

押した色はその場で書き込み、パネルは開いたまま。色の四角・色相・透明度の帯のドラッグは見た目だけ先に動かし、**離したときに 1 回だけ書く**。書き込みに失敗したら元の値へ戻して理由を出す。

## 色を作る窓

- タブ 単色 / グラデーション（`allowGradient` のときだけタブを出す）。
- 単色: 色の四角（鮮やかさ × 明るさ）・色相の帯・色番号・スポイト。
- グラデーション: 色の丸（＋ で足す・最大 5 色）・スタイル 5 種。色の丸を押すと、その色だけを直す**小窓**（色の四角・色相・透明度の帯・ゴミ箱〔2 色のときは押せない〕・色番号 + 透明度 %・スポイト）。小窓は **外を押す / Esc / 同じ丸をもう一度** で閉じ、中でドラッグしている間は閉じない。

## 保存の置き場

| もの | 置き場 | 範囲 |
|---|---|---|
| ブランドキット | `AKARI_HOME/brand-kit.json`（`{ schema: 'akari-brand-kit/v0', colors: ['#RRGGBB(AA)'] }`・最大 60 色） | 利用者ごと。どのプロジェクトからも同じ 1 つ（★ お気に入りと同じ置き場）。ライブラリ › マイ › ブランドキット も同じファイルを読む |
| 使った色の履歴 | アプリのローカル保存（`akari.colorPanel.history.v0`） | 利用者ごと |
| 色そのもの | 各項目の保存先（字幕 = captions の textStyle・item = edit.json） | プロジェクト |

ブランドキットの読み書きは akari-project が次のコマンドで出す（拡張をまたぐので文字列の id で呼ぶ）:
`akari.library.brandKit.get()` → `string[]` / `akari.library.brandKit.addColor(color)` → `string[]` / `akari.library.brandKit.removeColor(color)` → `string[]`。

## 今の版でつないでいる所・まだの所

- つないでいる: 字幕の色の行（文字・縁取り・座布団・効果の色。グラデーション・透明は出さない）、オーバーレイの色のつまみ（単色）。
- まだ: 図形の塗り・枠・線（上のバーの色の丸・インスペクターの図形の行）。図形の契約がグラデーションと `'none'` を受け付けた後に、`{ kind: 'item', itemId, path: 'source.params.fill' | 'source.params.stroke' }` と `allowGradient: true`（塗りは `allowTransparent: true` も）で呼ぶ。
