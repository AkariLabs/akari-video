---
name: connect
description: "AKARI の道具と、実際に呼び出せる素材サービスの状態を調べる。『何が使える？』『fal の鍵を設定したい』『3D の設定を使いたい』で使う。"
---
# connect — 道具と素材サービスを使う

応答言語はユーザーの使用言語に合わせる。

## 一覧と選択

1. `akari connect list --json` で状態を確認する。表示する群は「AKARI の道具」と「素材を作る」。状態は「使える」「鍵が必要」「準備中」、3D の設定だけは Blender が無い場合に「Blender が必要」。`enabled: false` は使わない。`credentialSource` は鍵の値を含まない。
2. `generationOrder` と `fallbackOnFailure` は既存設定を保つ。既定では失敗時に別アカウントへ自動で切り替えない。保存先は `~/.akari/connectors.json`（`AKARI_HOME` で変更可）で、鍵の値は書かない。
3. 有償生成の前には [manage-connections](../manage-connections/SKILL.md) の許可モデル・見積・費用承認を確認する。

## 実在する経路

- fal の画像・動画生成は [generate-media](../generate-media/SKILL.md) の `akari generate still` / `akari generate video` を使う。fal の読み上げ、Fish Audio と Google AI の読み上げは [generate-narration](../generate-narration/SKILL.md) のエンジン選択と `akari narration generate` を使う。
- ElevenLabs（Scribe）と Groq の文字起こしは [analyze-footage](../analyze-footage/SKILL.md) の文字起こし経路を使う。ElevenLabs のカードを読み上げの案内に使わない。
- 3D の設定は [bake-3d](../bake-3d/SKILL.md) と `assets/scene3d/*/scene.py` を使う。Blender が必要。インストール済みなら「使える」と表示する。
- 生成した素材の記録と再利用は各制作スキルと [harvest-asset](../harvest-asset/SKILL.md) に従う。出所を捏造しない。

## 鍵の扱い

鍵をチャットに貼らせない。つなぐ画面から登録し、既存の `credentials.env` に保存する。`akari connect exec` で鍵を渡すときは子プロセスに限る。鍵を引数・ログ・成果物に書かない。
