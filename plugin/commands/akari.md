---
description: AKARI Video の接続状態を確認し、状態に応じて次の一手を日本語で案内する
allowed-tools: Bash(node:*), Bash(ls:*), Bash(test:*), Read
disable-model-invocation: false
---

AKARI Video の状態を確認し、利用者に次の一手を案内する。内部の仕組み（JSON・git・
スキーマ名）ではなく、利用者の言葉（素材・企画・書き出し・やること・尺・おまかせ度）で話す。

手順:

1. カレントディレクトリに `.akari/` があるか確認する（`ls -la .akari` または同等の方法）。
   - **無ければ**: このフォルダーはまだ AKARI Video プロジェクトとしてセットアップされて
     いないと伝える。案内する導線は 2 つ:
     - ターミナルで `akari` コマンド（ランチャー）を実行すれば、接続確認 → 雛形作成 →
       このセッションと同じ入口に到達できる
     - このセッションのままなら `create-project` スキルで雛形を作成できる
       （リポ checkout なら `skills/create-project/SKILL.md`、プロジェクト内なら
       `.claude/skills/create-project/SKILL.md` を参照）
     - どちらを選ぶか、または何を作りたいか（素材から / テンプレから / 過去プロジェクトを
       参考に / 相談しながら）を尋ねる
   - **あれば**: 次のステップへ進む。

2. `.akari/connections.json` があれば、`manage-connections` スキルの実行順リーフに従って
   doctor（`node <スキルのディレクトリ>/bin/doctor.mjs` をプロジェクトルートで実行）を
   実行し、接続状態を要約する。**キーの値・HTTP 応答本文は絶対に表示しない**
   （`manage-connections` の FORBIDDEN 級ハードルールを継承する）。

3. `.akari/intake.json` を読み、`status` を確認する。
   - `draft` なら: 進め方（やること・尺・おまかせ度）がまだ未確定だと伝え、intake フォーム
     を開くか、対話でヒアリングして確定させることを提案する。
   - `submitted` なら: `tasks`（スキルカタログ対応の安定 ID。表示は日本語ラベルに変換して
     伝える — 例 `transcribe-captions` → 「文字起こし・テロップ」）・`target`・`autonomy`
     を要約し、その内容で作業を続けてよいか確認する。`autonomy` が `checkpoint`（既定）なら
     企画承認・書き出し前などの要所で必ず人に確認することも伝える。

4. `.akari/events/` に記録があれば、直近のイベント種別に応じた次の一手を一言添える
   （例: `report-generated` ならレポートの承認を促す、`report-approved` なら編集を進める、
   `edit-completed` なら仕上がり確認と telop 調整を促す、`export-completed` なら書き出し
   結果の確認を促す、`video-added` なら分析開始を促す）。記録が無ければ「まだ節目の記録は
   ありません」と伝える。

5. 最後に、次に何をすればよいかを 1〜2 文で明確に伝える。長い説明は避け、次の一手を
   はっきり示すことを優先する。
