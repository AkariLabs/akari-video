# 検証とレポート生成

## 1. interpretation.json を検証する

`interpretation.json.tmp` に書いてから検証し、PASS したものだけを `interpretation.json` へ
原子的に置き換える。

```sh
node packages/schemas/bin/validate-interpretation.mjs <interpretation.json のパス>
```

exit code 0 かつ `OK: ...` の出力を確認する。schema 単体では表せない意味制約（`assets[].ref` と
`inputs.analyses[].ref` の 1:1 対応、`arc[].refs[].asset`/`relations[].target` のダングリング
参照、`section` の `end > start`、`flag` の start/end 対関係、`open_questions[].status` と
`answer` の整合）もこの CLI が検証する。fail した場合は黙って緩めず、原因を直して再検証する。

## 2. レポートを生成する

```sh
node packages/analysis-report/render-analysis-report.mjs \
  --analysis <ref1>=<analysis1.json のパス> \
  --analysis <ref2>=<analysis2.json のパス> \
  --interpretation <interpretation.json のパス> \
  --out <report.html の出力先>
```

- **`--analysis` は必ず `<ref>=<path>` の明示形で渡す**（`ref` は `collect.md` で決めた
  `interpretation.assets[].ref` と一致させる）。bare path のみの指定も CLI は受け付けるが、
  それは `inputs.analyses[].path` との一意な文字列照合に頼る劣化経路であり、複数素材プロジェクト
  では取り違えのリスクが増える（2026-07-22 改訂前の位置対応づけ規約で silent data corruption が
  実証されている）。**analyze-project は常に明示 `ref=path` 形式を使う**。
- `interpretation.assets[]` の全 `ref` に対応する `--analysis` が過不足なく必要。renderer は
  `inputs.analyses[].ref` との 1:1 対応・path のクロスチェックをハードエラーで検証し、
  通らない場合は何も書き出さない。
- 生成前に `interpretation.json` は 1. で PASS 済みであること。renderer 自身も内部で
  `validate-interpretation.mjs` を呼ぶため、二重に検証されるが省略しない。

## 3. 開く

生成した HTML はテンプレ + データ分離・自己完結（外部 CSS/font/script/remote image 参照なし）
なので、そのままブラウザで開ける。

```sh
open <report.html の出力先>
```

`open` が使えない環境ではファイルパスを人間に提示し、ブラウザで開いてもらう。

## 4. レポートの読み方（確認観点）

- 全カード/行に 事実 / 解釈 のラベルが付いている（テーゼ 2 の可視化）。解釈側は
  `relations[].evidence`/`flags[].evidence` を「根拠を見る」で開示できる。
- 節構成は事実 + 素材の読み + 客観的関係 + 取材台帳 + 来歴に限定される。**構成案（arc）は
  表示されない**（interpretation.json のデータとしては存在する。[interpretation.md](interpretation.md#arc-は内部データレポート非表示) 参照）。
- 決定 UI（選択肢・ツマミ・確定ボタン）が無いことを確認する。あればテンプレ側の regression。
- `open_questions` が 0 件の場合は「取材事項なし」の空状態文言が出る（「まだ分析していない」
  という誤解を招く空白表示にならないことを確認する）。

## よくある間違い

- `--analysis` を bare path のまま複数渡し、renderer の一意照合に頼る（明示 `ref=path` を使う）。
- validate 前の `.tmp` を確定版として扱う。
- renderer が拒否したのに手で HTML を編集して辻褄を合わせる。
- `arc` が表示されないことを理由に `interpretation.json` へ `arc` を書かずに済ませる
  （schema は `arc` を必須にしている。表示されないのは意図的な仕様であり、データとしての省略は
  許されない）。
