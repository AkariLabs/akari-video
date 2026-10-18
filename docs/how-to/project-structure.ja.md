[English](./project-structure.md) | **日本語**

# プロジェクト構成 — .akari/ の中身を知る

AKARI Video のプロジェクトは「ファイル契約」で動きます。エージェント・アプリ・人間が
同じファイルを読み書きすることで、どの入口からでも同じ状態に到達できます。
このページは日常で目にするファイルの役割一覧です（正確なスキーマは
[Reference](../README.ja.md#reference) を参照）。

## プロジェクトルート直下

| ファイル | 役割 |
|---|---|
| `edit.json` | **編集のセーブデータ（SSOT）**。カット・素材の置き方・動く部品・音声・ビート・演出。v2（オブジェクトの木） |
| `captions.json` | 字幕データ。行ごとの見た目と、文字の範囲に当てる見た目（runs v1・字幕スタイル）を持つ |
| `review.json` | 注釈（ペン・ピン・範囲・添付）のサイドカー。右パネルの「<!-- F ui.annotation.handToAi -->AI に渡す<!-- /F -->」の元データ |
| `decision-log.md` | analyze-project と edit-plan が共有する追記専用の判断履歴 |
| `analysis-report.html` | analyze-project が生成する素材横断の正式な分析レポート |

ルート直下に置いてよい生成物はこの契約ファイルだけです。それ以外の生成物は
役割ごとの置き場に入ります（散らかさない規約）。

## ディレクトリ

| 場所 | 役割 |
|---|---|
| `assets/` | 素材置き場（`assets/<カテゴリ>/<id>/` + meta.json）。平らに置き、フォルダは切らない。AI が作った仮枠や生成物は `assets/generated/`（由来は `<file>.meta.json`） |
| `planning/` | 企画・計画文書。下の表を参照 |
| `exports/` | 書き出し先。NLE 用の書き出しは `exports/nle/` |
| `motion/` | edit.json から参照するキーフレーム曲線の**正本**（再生成不可） |
| `scenes/` | シーンを持つプロジェクトだけ。入れ子はこの 1 段まで（下の「シーン」） |

### planning/ の中

| ファイル | 役割 |
|---|---|
| `research-plan.json` / `plan.json` | 企画・承認済みの計画 |
| `playbook.md` + `playbook.json` | **作り方**。1 本ぶんの手順・確認点・設定・仮枠・使った部品・要る道具。`record-playbook` スキルが終わったプロジェクトから書き出す。`akari new --from` で始めたプロジェクトには写しが入り、出どころが `provenance` に残る |
| `playbook-preview/frames/` | 作り方の重要な場面のコマ（任意） |
| `script.json` | 台本パネルの**予定とメモ**の行（時刻つき）。字幕は `captions.json` が正本のまま。無ければ台本パネルは字幕だけで動く。作り方の内訳（`beats`）から予定の行が作られる |
| `frames/<名前>.scene.json` | 仮枠の中身を書いたシーン JSON。仮枠の絵（png）と meta は `assets/generated/` |
| `world-map.json` | ワールドマップ（使う場合） |

作り方（`playbook.md` / `playbook.json`）は、プロジェクトの外の棚にも置けます。
手元の棚は `~/.akari/playbooks/<id>/`、チャンネルの棚は `channels/<チャンネル>/playbooks/<id>/` です。
一覧と始めるときの解決順は「チャンネル → 手元」の 2 つだけです。

**テンプレート**（作り込み済みのまとまり 1 つ。映像だけ空いていて差し替えて使う）も、作り方と同じ棚に入ります。
棚の `<id>/template/` に断片 `item.json` と素材の実体 `media/` を持つ作り方（深さ 3）で、
ライブラリの「テンプレート」の棚からタイムラインへ置くと、edit.json の中の 1 つのまとまりになります。
プロジェクトの中に専用の置き場は増えません。自分のプロジェクトから棚へ書き出すには `akari template export`
（または `akari playbook template`）を使います。配布中の v1.5.0 では `akari playbook template` だけで、`akari template export` は次の版からです。旧名は別名として残ります。

### シーン

シーンを持つプロジェクトでは、`scenes/<シーン>/` が 1 本のプロジェクトと同じ構成
（`edit.json`・`captions.json`・`assets/`・`.akari/`）になります。`scenes/` の下に層を足すことはできません。

- `akari project scene add <id>` で `scenes/<id>/` を作り、`.akari/manifest.json` にシーンを足す
- アプリはシーンのフォルダをそのまま作業フォルダとして開く。ホームの「シーンの一覧」から開き、
  タイトルバーの「シーンの一覧（プロジェクト）」から一覧へ戻れる
- プロジェクト共通の `assets/` の素材をシーンで使うときは、そのシーンの `assets/` へ**ハードリンクで取り込む**
  （同じボリュームでなければ複写）。どのシーンが共通の素材を使っているかは `.akari/manifest.json` の線で見る
- 「シーン / 構成 / 関係」のタブで、シーンの一覧・プロジェクト → シーン → カットの木・相関図を見られる

1 本のプロジェクトは `scenes/` を持たず、これまでどおりルートの `edit.json` で動きます。

## .akari/ 配下

| ファイル / ディレクトリ | 役割 |
|---|---|
| `.akari/intake.json` | 進め方フォーム（やること / 尺 / おまかせ度）。`title`（人間向け表示名。フォルダ名とは別）は企画（intake）が決まった時点でエージェントが書く。`language` は**動画の中身の言語**（BCP 47。例 `en`）で、画面や会話の言語とは独立。字幕・ナレーション・文字起こしの言語に使われ、無ければ文字起こしの結果から決まり、それも無ければ `ja` |
| `.akari/manifest.json` | **依存の目録**。このプロジェクトに何が（素材・スタイル・シーン・人物・道具の出力…）どの版で関わり、誰が誰を使うかを持つ。実体や編集の中身は持たない。`akari project sync` で素材とスタイルの台帳から生成（手で足した項目は残る）、`akari project check` で欠落・未取得・壊れを検査（結果は `.akari/reports/manifest-check.json`）。無くても従来どおり動く |
| `.akari/asset-references.json` | 使っている素材の参照台帳 |
| `.akari/style-usage.json` | 当てたスタイルの利用台帳 |
| `.akari/tasks.json` | 注釈・リント・提案から起こした作業の運用情報（未送信 → 送信済み → 確認 → 完了）。本文や位置は `review.json` が正本。履歴に残る |
| `.akari/connections.json` | 接続レジストリ（API キー参照・モデル選択・コスト承認ポリシー） |
| `.akari/workflow.json` | プロジェクトのロール定義 |
| `.akari/sidecars/` | 素材ごとの `analysis.json`（分析の事実層） |
| `.akari/events/` | 節目の記録（1 件 1 ファイル・追記のみ。「続きから」の合図）。エージェントの「やったこと」（`agent-action`）と確認待ち（`gate-requested` / `gate-resolved`）もここに残る |
| `.akari/memory/` | このプロジェクトの記憶。単語帳（`word-book.json`）など。チャンネルや作業場の `.akari/memory/` へ昇格できる |
| `.akari/lint.json` | edit-lint の検査結果の正本 |
| `.akari/render.json` | 書き出しの計画・実行結果の正本 |
| `.akari/diffs/` | 「変更を見る」で生成される比較用スナップショット |
| `.akari/render-tmp/` | 書き出し中に使う一時作業領域 |
| `.akari/work/` | エージェントの作業領域。使い捨ては `tmp/`、作り直せないものは `keep/` に置く |
| `.akari/reports/` | 検証証跡・レポート HTML（**削除しない** — 人間確認の記録）。`manifest-check.json`、作り方で始めたときの確認シート `playbook-sheet.html`、絵コンテ `storyboard/` などが入る |
| `.akari/backup/` | `akari migrate` が作る移行前の退避 |
| `.akari/cache/` | サムネ・プロキシ等のキャッシュ（削除安全） |

### 「やったこと」と確認待ち

エージェントが見ていないあいだに進めた作業は、`.akari/events/` に「やったこと」として残ります。
戻せない・外に出る・お金や権利に触れる操作（公開、Lab への提出、有償の生成、外部への送信、元素材の削除、
ライセンスの疑義、作り方が宣言した確認点など）は、どのおまかせ度でも止まって確認待ちになります。
プロジェクトのホームの「やったこと」で一覧を見て、「変更を見る」「ここまで戻す」を選べます。
`akari status` にも件数が出ます（[続きから再開する](./resume-session.ja.md)）。

## 削除していいもの・いけないもの

`akari clean [project-dir]` を実行すると、削除可能・保持・判断保留を容量付きで一覧できます。
既定は一覧のみです。`--yes`（または対話での承認）の後も削除可能なものだけを削除し、直近に
更新された候補とシンボリックリンクは判断保留のまま残します。

- **削除可能**: `.akari/cache/`・`.akari/render-tmp/`・`.akari/diffs/` の中身、`exports/` の
  書き出し中間物（`*.gpu-video.mp4`・`*.osr-video.mp4`・`run.json`）、`.akari/work/tmp/`、
  書き込み中の一時ロック（`.akari/tasks.json.lock`）。実行中でなければ一覧されます
- `.akari/work/` では、使い捨てを `tmp/`、計画・生成器・手編集ファイル等を `keep/` に置きます。
  空の目印 `.akari-disposable` / `.akari-keep` は置いたディレクトリ配下に効き、keep が優先です。
  目印のない既存内容は判断保留になります
- **保持**: `edit.json`・`captions.json`・`review.json`・`plan.json`・`motion/`・`assets/`・`planning/`
  （作り方・台本の予定とメモを含む）・納品用の `exports/*.mp4` と `exports/nle/`・`.akari/reports/`・
  `.akari/sidecars/`・`.akari/events/`・`.akari/backup/`・`.akari/` 直下の `*.json`
  （`manifest.json`・`tasks.json` など）・`.claude/`・`.opencode/`・`AGENTS.md`・`CLAUDE.md`・`akari.sh`・`.gitignore`
  は、証跡・原本・プロジェクトの記憶なので保持します。git 管理を推奨します
- **判断保留**: 宣言表に分類がないもの（`scenes/`・`.akari/memory/` など）。消す前に中身を確かめてください

## プロジェクトの外にあるもの

| 場所 | 役割 |
|---|---|
| <!-- F paths.credentials -->`~/.akari/credentials.env`<!-- /F --> | API キーの実体（プロジェクトに入れない） |
| `~/.akari-video/assets/` | 個人スコープの素材ライブラリ |
| `~/.akari/playbooks/` | 手元の作り方・テンプレートの棚 |

## git との相性

セーブデータはすべてテキスト（JSON / HTML）なので、コミットすれば編集履歴が
そのままバージョン管理になります。「昨日の編集に戻して」が `git diff` と revert で成立します。

書き出した動画・画像・音声は、ディスクには残したまま**変更履歴には入れません**。
節目ごとの自動スナップショットが 1 本 100 MB 級の mp4 を積み続けると、40 秒の動画 1 本で
`.git` が数 GB に達するためです。新しいプロジェクトの土台の `.gitignore` がこれを引き受けます。

| 変更履歴に入るもの | 入らないもの |
|---|---|
| `edit.json` / `captions.json` / `review.json` / `planning/` / `.akari/events/` / `.akari/manifest.json` / `.akari/tasks.json` / `.akari/reports/` の JSON・HTML | `assets/` の原本 |
| `exports/nle/` の書き出し設定 | 書き出した映像・画像・音声（`*.mp4` `*.png` `*.wav` など） |
| `motion/` のキーフレーム曲線 | `.akari/render-tmp/` `.akari/cache/` `.akari/diffs/` |
| `.akari/sidecars/` の分析結果（作り直すのに手間がかかるため、映像でも残します） | |

`.gitignore` のうちアプリが管理するのは `# >>> AKARI Video ... >>>` から
`# <<< ... <<<` までの囲みだけです。囲みの外に書き足した行はそのまま残ります。

古いプロジェクトを開くと、`.gitignore` を現行の内容へ揃え、対象になった生成物を
変更履歴から外して 1 本コミットします。**ディスク上のファイルは消しません**。
過去のコミットは書き換えないので、これだけでは `.git` の大きさは変わりません。

過去分まで回収したいときは `git filter-repo` 等を自分で実行してください。1 点だけ注意点が
あります。この種の道具は**コミットしか書き換えない**ため、tree を直接指す ref（一部の AI
コーディングツールが作るチェックポイント等）が古いデータを掴んだままになり、期待の半分程度で
縮小が止まります。`git for-each-ref` で心当たりのない ref が無いか確認してから gc してください。

<!-- BEGIN GENERATED facts:stamp -->
この文書は AKARI Video v1.5.0（2026-10-17 公開）時点の説明です。
<!-- END GENERATED facts:stamp -->
