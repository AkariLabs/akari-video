---
name: connect
description: "AKARI の道具・生成サービス・制作アプリとの接続を調べ、つないだサービスで素材を作る。『何とつながってる？』『Higgsfield で動画を作って』『Blender に渡して』で使う。"
---
# connect — 道具とサービスを使う

応答言語はユーザーの使用言語に合わせる。

## 一覧と選択

1. `akari connect list --json` を実行する。各行の `status` は「つながった」（使用可）/「見つかった」（初回に起動・受け渡しを確認）/「準備が要る」/「準備中」。`enabled: false` は使わない。`credentialSource` は `env` / `credentials.env` / `null` のどれかで、鍵の値ではない。
2. 生成サービスは `generationOrder` の順に選ぶ。`fallbackOnFailure` は既定 `false`。失敗しても別のアカウントへ勝手に切り替えない。設定の保存先は `~/.akari/connectors.json`（`AKARI_HOME` で差し替え可）で、鍵の値を書かない。
3. 有償生成の前には [manage-connections](../manage-connections/SKILL.md) の許可モデル・見積・費用承認を確認する。既存の経路を優先する。fal の画像・動画は [generate-media](../generate-media/SKILL.md) の `akari generate still` / `akari generate video`、Fish Audio の声は [generate-narration](../generate-narration/SKILL.md) の `akari narration generate` を使う。

## 公式 API を使う

Higgsfield / Runway / ElevenLabs に AKARI の生成コマンドが無い場合だけ `akari connect exec <id> -- <command…>` を使う。次の `sh -c '…'` の単引用符は重要。親シェルが鍵を展開せず、接続された子プロセスだけが環境変数を読む。API のエンドポイント・モデル・版ヘッダ・課金条件は実行前に各社の現行の公式文書で確かめる。

Higgsfield は「つなぐ」画面で API key と secret を `:` でつないだ 1 つの値として登録する（`HF_KEY`）。モデルごとに生成エンドポイントと入力が違うので[公式のモデル文書](https://docs.higgsfield.ai/docs/llms.txt)を選んでから送る。`Authorization: Key <id>:<secret>` による生成とジョブ確認の例（返った request id を `REQUEST_ID` に置き換える）:

```sh
akari connect exec higgsfield -- sh -c '
  curl --fail-with-body -sS -X POST "https://api.higgsfield.ai/higgsfield-ai/soul/v2/standard" \
    -H "Authorization: Key $HF_KEY" \
    -H "Content-Type: application/json" \
    -d "{\"prompt\":\"A quiet alpine lake at sunrise\"}"
'
akari connect exec higgsfield -- sh -c '
  curl --fail-with-body -sS "https://api.higgsfield.ai/requests/REQUEST_ID/status" \
    -H "Authorization: Key $HF_KEY"
'
```

Runway は[公式 API](https://docs.dev.runwayml.com/guides/using-the-api/)でタスクを作り、返った task id を記録して完了までポーリングする。画像 URL とモデル・版ヘッダは現行文書で確認する。例:

```sh
akari connect exec runway -- sh -c '
  curl --fail-with-body -sS -X POST "https://api.dev.runwayml.com/v1/image_to_video" \
    -H "Authorization: Bearer $RUNWAYML_API_SECRET" \
    -H "X-Runway-Version: 2024-11-06" \
    -H "Content-Type: application/json" \
    -d "{\"model\":\"gen4.5\",\"promptImage\":\"https://example.org/input.jpg\",\"promptText\":\"Slow camera move\",\"ratio\":\"1280:720\",\"duration\":5}"
'
akari connect exec runway -- sh -c '
  while :; do
    body=$(curl --fail-with-body -sS "https://api.dev.runwayml.com/v1/tasks/TASK_ID" \
      -H "Authorization: Bearer $RUNWAYML_API_SECRET" \
      -H "X-Runway-Version: 2024-11-06") || exit 1
    printf "%s\n" "$body"
    case "$body" in *SUCCEEDED*|*FAILED*|*CANCELED*) break ;; esac
    sleep 5
  done
'
```

ElevenLabs は[公式 TTS API](https://elevenlabs.io/docs/api-reference/text-to-speech/convert)へ POST する。`VOICE_ID` は選んだ声の id に置き換え、出力 mp3 は `assets/audio/` に置く。例:

```sh
mkdir -p assets/audio
akari connect exec elevenlabs -- sh -c '
  curl --fail-with-body -sS -X POST "https://api.elevenlabs.io/v1/text-to-speech/VOICE_ID" \
    -H "xi-api-key: $ELEVENLABS_API_KEY" \
    -H "Content-Type: application/json" \
    -d "{\"text\":\"おはようございます。\",\"model_id\":\"eleven_multilingual_v2\"}" \
    -o assets/audio/narration.mp3
'
```

## 素材と制作アプリ

- 生成画像・動画は `assets/generated/` に置き、[generate-media](../generate-media/SKILL.md) と同じ隣接 `<file>.meta.json` に入力・出力・状態・provider・モデル・作成時刻・出所を残す。音声を edit.json に使うなら `audio.narration[].provenance.provider` にもサービス名を記録する。再利用する素材へ昇格するときは [harvest-asset](../harvest-asset/SKILL.md) の `meta.json` と INDEX の作法に従う。分からない出所を捏造しない。
- 制作アプリが「見つかった」なら、mac では `open -a Blender` のように起動し、対象ファイルを渡せるか初回に確かめる。Blender は [bake-3d](../bake-3d/SKILL.md) の bpy レシピを使う。After Effects は環境設定の「スクリプトによるファイルの書き込み」を許可してから使う。
- 「渡す」の XML は画面では「準備中」。既存の [export-nle](../export-nle/SKILL.md) には Final Cut / Resolve / Premiere 向け XML 書き出しがあるが、実アプリでの取り込み未確認の BETA として案内する。

## 鍵の扱い

鍵をチャットに貼らせない。貼られた鍵は使わず、つなぐ画面での登録を案内する。`akari connect exec` 以外で鍵を読まない。`credentials.env` を `cat` しない。鍵を引数・ログ・成果物・出所台帳に書かない。
