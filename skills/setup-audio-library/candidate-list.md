# 候補リスト HTML の生成

## 1. いつ実行するか

- 初回セットアップ時
- `catalog/audio/candidates.json` を更新したとき（新しい配布元・カテゴリの追記）
- 他レーン（audio-import 等）が `catalog/audio/` に新しいエントリを登録したあと
  （既所有のグレーアウトを最新化するため）

## 2. 実行する

```sh
node packages/audio-library-setup/bin/generate-candidates-html.mjs
```

既定の出力先は `catalog/audio/candidates.html`。引数は次を上書きできる。

```sh
node packages/audio-library-setup/bin/generate-candidates-html.mjs \
  --candidates catalog/audio/candidates.json \
  --catalog-dir catalog/audio \
  --out catalog/audio/candidates.html
```

生成後、ユーザーへ `open catalog/audio/candidates.html`（または生成された絶対パス）を
案内してブラウザで開いてもらう。

## 3. 何が起きるか

- `catalog/audio/candidates.json` の 60 候補（カテゴリ 9 種、うち BGM 19 件）をカードとして並べる
- 各カードのリンクは**ダウンロードページ URL のみ**（`target="_blank"`）。クリックすると
  配布元の正規ページが新規タブで開くだけで、音声ファイルは一切取得しない
- **「既所有」判定はスクリプト実行のたびに `catalog/audio/*/meta.json` を読んで動的に
  計算する。** 完全一致する `source.url` を持つエントリがあれば「既所有」としてグレー
  アウト、hostname だけ一致する場合は「同配布元から登録あり」と表示する。
  他レーンの登録がハードコードなしに反映されるのはこのため
- 各カードに confidence バッジ（本レーンで実在確認済み／リサーチ時点で確認済み／
  自動検証不能・要手動確認）とライセンスバッジ（クレジット要否・AI学習可否）を表示する
- **BGM（`bgm-general` カテゴリ、19件）は追加で `mood[]` / `tempo` バッジを表示する。**
  `mood` は intake の tone チップ（`真面目`・`親しみ`・`高級感`・`勢い`・`かわいい`・
  `無機質`・`エモい`・`シネマ`）と同一語彙で、各 tone に最低 2 曲を割り当ててある
  （`catalog/audio/candidates.json` の `mood_vocabulary` 参照）。将来 intake の
  tone 決定結果と `mood[]` を突き合わせて BGM を自動提案するための布石であり、
  自動選曲ロジック自体は本スキルの対象外（提示のみ）
- `credit_template` を持つ候補（MusMus・魔王魂 等、クレジット表記必須の配布元）は、
  規約に書かれている書式そのままの文言をカードに表示する。ユーザーが編集時に
  そのままコピーして使える正確さを優先し、要約や言い換えをしない

## 4. ユーザーへの案内文言（テンプレート）

```text
音源の候補リストを用意しました: catalog/audio/candidates.html
「ダウンロードページを開く」を押すと配布元の正規ページが開きます。実際の保存は
あなた自身で行ってください。保存先は ~/.config/akari-video/audio-drop/
（無ければ作成してください）に置くと、次に登録スクリプトを実行したときに自動で
拾われます。
```

## よくある間違い

- 生成した HTML のリンクを音声ファイルの直 URL に書き換える（直リンク禁止規約への
  抵触リスク）。
- 「既所有」を静的にハードコードする（他レーンの登録が反映されなくなる）。
- confidence が `blocked_unverifiable` の項目を「確認済み」であるかのように表示する。
