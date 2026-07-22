# 素材収集

## 原則

素材ごとの事実抽出（1 パス目）と、素材横断の解釈（2 パス目）を分離する。1 パス目は
[analyze-footage](../analyze-footage/SKILL.md) の役割のまま変えず、このスキルは「揃っているか
確認し、無ければ埋める」だけを行う。同じ素材を 2 回分析しない。

## 1. プロジェクトの素材を列挙する

対象プロジェクトディレクトリ（明示された場合はそれ、無指定なら `assets/` 配下・プロジェクト
直下の動画/静止画/音声ファイル）を列挙する。列挙対象が不明な場合は、ユーザーに対象パスを
確認してから進む（これは判断質問ではなく、作業対象を確定するための入力確認）。

## 2. 素材ごとに既存分析の有無を確認する

[edit-plan/workflow.md §2](../edit-plan/workflow.md#2-素材の有無で分岐する) と同じ探索順序を使う。

1. ユーザーが明示した `analysis.json`
2. `<source-dir>/analysis/<source-stem>/analysis.json`
3. 素材専用ディレクトリであると確認できる場合だけ `<source-dir>/analysis/analysis.json`

`source` が対象素材を指すことを確認してから再利用する。素材が更新された疑いがあれば
再分析するか、人間へ差分を示す（鮮度の推測はしない）。

## 3. 無い素材だけ analyze-footage を実行する

有効な分析がない素材は、1 素材 = 1 実行として [analyze-footage](../analyze-footage/SKILL.md) を
呼ぶ。複数素材なら並列に割り当ててから全件を待つ。各依頼には source の絶対パス・リポジトリ
ルート・analyze-footage の SKILL.md を渡し、他素材や本スキルの成果物を編集させない。

## 4. 素材参照表（ref 表）を作る

全素材について、プロジェクト内で一意な `ref`（例: 素材ファイル名の stem、または
プロジェクト固有の呼称）と、対応する analysis.json への絶対または相対パスを対応付ける。
この対応表がそのまま `interpretation.json` の `inputs.analyses[]`（`ref` / `path` / `source`）に
なり、[validate-and-render.md](validate-and-render.md) の renderer 呼び出し
（`--analysis <ref>=<path>`）の `ref` としてもそのまま使う。

`ref` は 1 度決めたら 2 パス目・レポート生成・取材の全工程で一貫させる（`assets[].ref` /
`arc[].refs[].asset` / `relations[].target` すべてがこの `ref` を参照するため、途中で
書き換えると FK が壊れる）。

## よくある間違い

- 分析済みの素材を再度 analyze-footage にかける（1 パス目の再実行はしない）。
- 複数素材を 1 回の analyze-footage 実行にまとめる（素材ごとの証拠境界が失われる）。
- `ref` をファイルパスそのものにして、後で相対パスの基準が変わると参照が壊れる状態にする
  （`ref` は場所に依存しない安定 ID にする）。
- `analysis.json` から見た相対パス（`source` や `keyframes[].path`）を、プロジェクト直下から
  見た相対パスとして解決し直す。
