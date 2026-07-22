# 分析収集と統合ワークフロー

## 原則

素材ごとの観察と、素材横断の編集判断を分離する。各分析はその素材だけを扱い、統合エージェントだけがサムネイル、方向性、カット、素材計画を比較する。

## 1. 入力と出力先を固定する

入力として、素材パス、既存 `analysis.json`、希望する出力先を列挙する。出力先の指定がなければ、素材群の共通プロジェクトディレクトリ直下の `edit-plan/` を提案し、採用理由を完了報告に残す。別プロジェクトの既存レポートや `decision-log.md` を混ぜない。

標準出力は次の形とする（2026-07-22 改訂: `editing-report.html` は生成しない。分析レポートは
[analyze-project](../analyze-project/SKILL.md) がプロジェクト直下に作る `analysis-report.html` を
指し、edit-plan はそれを読む側になる）。

```text
<plan-dir>/
├── decision-log.md            # analyze-project と共有・追記専用（判断記録）
├── edit.json                  # 実行承認後だけ
├── overlays/                  # 実行承認後だけ
└── generated/                 # 生成した静止画等の原本（provenance 込み）
```

生成物の原本と provenance は再検証できるよう残す。方針・素材計画の証拠は analyze-project の
分析レポート（読み取り専用・自己完結 HTML）を参照する。

## 2. 素材の有無で分岐する

### 録画素材がある場合

素材ごとに次の順で既存分析を探す。

1. ユーザーが明示した `analysis.json`
2. `<source-dir>/analysis/<source-stem>/analysis.json`
3. 素材専用ディレクトリであると確認できる場合だけ `<source-dir>/analysis/analysis.json`

相対 `source`、`keyframes[].path`、`tracks.person_matte` は、それぞれの `analysis.json` 所在ディレクトリを基準に解決する。パス文字列を分析レポートや `decision-log.md` の場所から解決し直さない。

有効な分析がない素材は、1 素材 = 1 サブエージェントとして `analyze-footage` を実行する。複数素材なら、利用可能なサブエージェントへ同時に割り当ててから全件を待つ。各依頼には source の絶対パス、リポジトリルート、[analyze-footage](../analyze-footage/SKILL.md) を渡し、他素材や共有成果物を編集させない。逐次実行へ変えた場合は理由を報告する。

既存分析を再利用するときも `source` が対象素材を指すことを確認する。新旧判定に必要な hash や解析日時は v0 Schema にないため、鮮度を推測しない。素材が更新された疑いがあれば再分析するか、人間へ差分を示す。

### 素材がゼロの場合

`analysis.json` を捏造しない。「リサーチ → 台本 → 生成計画」モードとし、録画素材がないこと・
採用した根拠・台本の版をチャットで提示し、`decision-log.md` に記録する（analyze-project は
素材の analysis.json を前提とするスキルであり、素材ゼロのこの分岐では使わない）。静止コンセプト
も同様にチャットで提示し、動画生成は承認工程まで保留する。生成後に複数クリップとなる場合も、
実行時には [execution.md](execution.md) の単一 source 制約を適用する。

方針決めは [plan-json.md](plan-json.md) の手順で行う: 選択肢式の質問対話で深掘り、確定した構成ビートと制約を `<plan-dir>/plan.json`（仮枠タイムライン。[contract-2026-07-20-plan-json-v0.md](../../docs/contract-2026-07-20-plan-json-v0.md)）へ落としてからチャットでの方針提示に入る（[report-guide.md](report-guide.md) 参照）。以降の提示は plan.json の slot id を根拠として参照する。

## 3. 各 analysis.json を検証する

[analysis.schema.json](../../packages/schemas/analysis.schema.json) を Draft 2020-12 対応 validator で検証する。validator を得るための無断ネットワーク導入はしない。併せて次を確認する。

- `source` と全 keyframe path が解決できる。
- すべての区間で `end > start`、時刻が source duration 内である。
- face box の `x + width <= 1`、`y + height <= 1` が成立する。
- transcript、event、track の speaker ID が矛盾しない。
- `transcript: []` が「無発話」なのか「文字起こし未取得」なのか、分析エージェントの報告で区別できる。

不正な分析を黙って修復して統合しない。再分析、当該素材の除外、根拠不足のまま限定利用、の得失を示し、人間の選択を `decision-log.md` に追記する。

## 4. 素材横断の証拠索引を作る

素材 ID、source path、duration、transcript 区間、keyframe、event を対応付ける表を作る。チャット提示や `decision-log.md` から参照できる安定した ID を割り当て、引用箇所を明確にする。

カット候補は source ごとに keep/drop と根拠 event を作る。この時点では `edit.json` を作らない。複数素材を 1 本のタイムラインへ並べる順序も、編集方針の承認対象にする。

## 5. チェックポイントを進める

段階の運びは変わらないが、各段階の証拠は「レポートを更新する」のではなく「analyze-project の
分析レポートを読み、チャットで提示する」形に変わった（[report-guide.md](report-guide.md) 参照）。

1. サムネイル案・編集方針・カット案をチャットで提示し、Checkpoint 1（方針）で停止する。
2. 承認された方針に沿って素材計画（BGM/字幕/SFX/B ロールの三択）と静止プレビューをチャットで
   提示し、Checkpoint 2（素材計画）で停止する。
3. 出力仕様、単一 source への落とし方、生成・conform・overlay の実行一覧を提示し、
   Checkpoint 3（実行）で停止する。
4. 承認後だけ `edit.json` と最終 overlay を作る。

各チェックポイントの承認内容・修正指示は `decision-log.md` へ追記する（既存行は変更・削除
せず、新しい行を末尾へ追加する）。カット判断一覧（素材 ID・source の start/end・keep/drop・
根拠 event・理由）と素材計画の三択結果（あれば提案 / なければ生成 / 使わない）は、
`decision-log.md` の該当 category（`cut`/`material`）の下に一覧として記録し、`edit.json` 生成時
の一次証拠にする。

## よくある間違い

- 複数素材を 1 サブエージェントへ渡し、素材ごとの証拠境界を失う。
- `analysis.json` から見た相対パスを、分析レポートや `decision-log.md` から見た相対パスとして開く。
- `transcript: []` を無音と断定する。
- 素材ゼロなのに架空の分析 event を作る。
- チャットでの提示より先に `edit.json` や最終 overlay を作る。
- analyze-project の分析レポートを読まずに方針を組み立てる（根拠のない推奨案を作る）。
