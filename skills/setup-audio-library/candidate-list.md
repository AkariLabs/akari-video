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

- ページ先頭に**既定ソース AKARI Sounds のバナー**（トラック数・一括取得コマンド・
  Release リンク）を表示する。BGM・ジングルの既定はこちら（[first-party.md](first-party.md)）
- `catalog/audio/candidates.json`（v2・2026-08-03 オーナー裁定）の 13 候補カード
  （カテゴリ 3 種: 拍手 / 失敗音 / ヒット・ドンの和風/バトル系 — いずれも AKARI Sounds に
  無い系統だけ）をカードとして並べる。v1 の 68 カード（外部 BGM 27 カード・
  被り SFX カードを含む）は `catalog/audio/candidates-legacy.json` に原文のまま
  レガシー保存されている（HTML には出さない）
- 各カードのリンクは**ダウンロードページ URL のみ**（`target="_blank"`）。クリックすると
  配布元の正規ページが新規タブで開くだけで、音声ファイルは一切取得しない
- **「既所有」判定はスクリプト実行のたびに `catalog/audio/*/meta.json` を読んで動的に
  計算する。** 完全一致する `source.url` を持つエントリがあれば「既所有」としてグレー
  アウト、hostname だけ一致する場合は「同配布元から登録あり」と表示する。
  他レーンの登録がハードコードなしに反映されるのはこのため
- 各カードに confidence バッジ（本レーンで実在確認済み／リサーチ時点で確認済み／
  自動検証不能・要手動確認）とライセンスバッジ（クレジット要否・AI学習可否）を表示する
- `credit_template` を持つ候補（クレジット表記必須の配布元）は、
  規約に書かれている書式そのままの文言をカードに表示する。ユーザーが編集時に
  そのままコピーして使える正確さを優先し、要約や言い換えをしない
- 補足: v1 にあった BGM の `mood[]` / `tempo` バッジ・`songs[]` 折りたたみ表示の描画は
  generator に現存する（`songs[]` を持つカードが将来復活してもそのまま出る）。
  mood 語彙と BGM 構成比の設計はレガシー JSON 側の記録を参照

## 4. ユーザーへの案内文言（テンプレート）

```text
音源の候補リストを用意しました: catalog/audio/candidates.html
「ダウンロードページを開く」を押すと配布元の正規ページが開きます。ご自身で保存する場合は
~/.akari/audio-drop/（無ければ作成してください）に置くと、次に登録スクリプトを
実行したときに自動で拾われます。
「取得して」と指示いただければ、保存までこちらで代行することもできます
（取得できなかった配布元はその場でお伝えします）。
```

## よくある間違い

- 生成した HTML のリンクを音声ファイルの直 URL に書き換える（リンクは常に配布ページ URL）。
- 「既所有」を静的にハードコードする（他レーンの登録が反映されなくなる）。
- confidence が `blocked_unverifiable` の項目を「確認済み」であるかのように表示する。
