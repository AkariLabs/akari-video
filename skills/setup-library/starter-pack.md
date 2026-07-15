# カタログ閲覧とスターターパック提案

## 1. catalog/INDEX.md から辿る

`catalog/INDEX.md` → 各カテゴリの `catalog/<category>/INDEX.md` → 個々の `catalog/<category>/<id>/meta.json`（`remote: true`）の順で読む。`assets/` の LLM Wiki と同じ経路を踏む。

カテゴリが「整備中」で `INDEX.md` にエントリ行が無い場合、そのカテゴリに提案できる素材はまだ無いとそのまま報告する。「後で追加予定」という記述を在庫の代わりに提案しない。存在しない id・url・license を発明しない。

既存の `assets/<category>/INDEX.md` も合わせて確認し、同種の素材が既にローカルにあるなら重複提案しない。

## 2. ユーザーの用途を聞く

導出できない情報は必ず聞く。提案前に次を確認する。

- 動画のジャンル・シーン（例: 製品デモ、インタビュー、B-roll 補完、テロップ強化）
- 想定アスペクト比（16:9 / 9:16 / 両方）
- 予算感（無料のみか、`acquisition: purchase` を含めてよいか）
- ログインが要る取得元（`acquisition: login`）を許容するか

## 3. CC0 優先でスターターパックを組む

契約の CC0 ファースト方針に従う。

- `source.license_at_source` が CC0 相当（帰属表示不要・商用利用可・改変可）のエントリを優先する
- `source.attribution_required: true` のエントリを含めてもよいが、提案時に必ず明示する
- `source.acquisition` が `login` / `purchase` のエントリは、ユーザーが許容した場合のみ候補に含める
- 実際に `catalog/` に存在するエントリだけを列挙する

## 4. 提案フォーマット

カテゴリごとに、id・タイトル・license_at_source・acquisition・一言理由を並べて提示する。

```text
[telop] lower-third-clean は既存 assets/ に既にあるため対象外。
[font]  <id> — <title>（license: CC0 1.0 / acquisition: direct）— 日本語見出し向け
[3d]    <id> — <title>（license: CC-BY 4.0 / acquisition: direct / ⚠ attribution 必須）— 製品モックアップ
```

`⚠ attribution 必須` などの注記は省略しない。ユーザーが一覧だけ見て許容判断できる情報量にする。

## 5. 人間の明示承認を得る

「この一覧のうち、どれを取得しますか？」と問い、YES/NO または対象の絞り込みを明示的に得る。承認が得られるまで [fetch-and-validate.md](fetch-and-validate.md) の工程へ進まない。

- 返信の話題転換・沈黙を承認とみなさない
- 一部だけ承認された場合、承認された id だけを次工程の対象にする
- 承認内容（対象 id 一覧）を次工程へそのまま引き継ぐ

## よくある間違い

- `catalog/` に存在しないカテゴリ・エントリを、需要に応えるためだけに提案する。
- ユーザーの用途を聞かずに「とりあえず全部」提案する。
- `attribution_required` や `acquisition: purchase` を隠して、または注記なしで提示する。
- 明示的な YES を得ずに「承認されたはず」で次工程へ進む。
- 既に `assets/` にある素材と同種のものを重複提案する。
