# akari-chat-engine — 温めて速く始める・即時のモデル切替・既定・会話の記録・文字を流す

設計契約 §8.1 の engine 側（node / common）。画面は別レーンが作り中のため、L1 はビルド済みの `lib/` の RPC を node から直接呼んで確かめた（HOME は本人・プロジェクトは一時フォルダ・`~/.akari/chat/defaults.json` は試験前の状態へ戻す）。

## スクリプト

| ファイル | 何を見るか |
|---|---|
| `measure-first-text.cjs <agent> [model]` | 「チャットを開く → 相手を選ぶ（= start）→ 5 秒後に送る」で、送ってから最初の文字までの秒数 |
| `l1-engine.cjs <agent> [--skill]` | defaults の往復 / start → ready / ready 前の send / 即時の `model` イベント / 切替後の送信 / contextInfo / listCommands（edit-lint）/ `/edit-lint` / transcript / resume |
| `switch-then-send.cjs <agent> [pattern]` | 送る前にモデルを切り替えて 1 回送る（切替が相手に効いていること） |

一時プロジェクトは実際のプロジェクトと同じ形（実体 `.claude/skills/edit-lint`、`.agents/skills` はその symlink）。

## 計測（指示 9）

改修前 = 統合ブランチの build、改修後 = 本ブランチの build。同じスクリプト・同じ文面（「はい」とだけ返す）。高負荷の機械での実測（load average を併記）。

| 相手 | | start が返るまで | ready | 送信（開始から） | 送ってから最初の文字 | load |
|---|---|---|---|---|---|---|
| Claude（haiku） | 改修前 1 | 0.0 秒 | — | 5.0 秒 | **5.3 秒** | 約 35 |
| Claude（haiku） | 改修前 2 | 0.0 秒 | — | 5.0 秒 | **4.1 秒** | 約 35 |
| Claude（haiku） | 改修後 1 | 0.0 秒 | 0.0 秒 | 5.1 秒 | **2.3 秒** | 約 50 |
| Claude（haiku） | 改修後 2 | 0.0 秒 | 0.0 秒 | 5.0 秒 | **2.0 秒** | 約 50 |
| opencode（既定 big-pickle） | 改修前 1 | 5.9 秒 | — | 5.9 秒 | **4.6 秒** | 約 35 |
| opencode | 改修前 2 | 2.9 秒 | — | 5.0 秒 | **3.0 秒** | 約 35 |
| opencode | 改修後 1 | 0.0 秒 | 5.3 秒 | 5.0 秒（ready 前・キュー） | **4.4 秒** | 約 45 |
| opencode | 改修後 2 | 0.0 秒 | 3.3 秒 | 5.0 秒 | **3.4 秒** | 約 45 |

- Claude: 改修前は送ってから claude を起こしていた（SessionStart の hook 込みの起動待ちが毎回見える）。改修後は start で裏に起こしておくので、送ってからの待ちは返事の生成分だけになった（約 4〜5 秒 → 約 2 秒）
- opencode: 改修前も start の中で ACP の initialize / session/new まで待っていたので、送ってからの秒数はほぼ同じ。違いは start が即座に返ること（画面が「起動しています…」で止まらない）と、ready 前に送っても engine 側のキューに積まれて届くこと（改修後 1）

## L1 の結果（改修後）

| 確かめたこと | Claude（haiku） | Codex | opencode |
|---|---|---|---|
| start → ready | 0.0〜0.1 秒（プロセスを起こした時点） | 1.6〜8.0 秒（thread/start まで） | 2.4〜67.5 秒（load 100 で initialize が遅い回あり） |
| ready 前の send が届く | ○ | ○ | ○（67.5 秒待ちの回も届いた） |
| モデル切替 → `model` イベント（送信を待たない） | 0 秒（sonnet → haiku、裏で `--resume` 付き再起動） | 0 秒（次の turn/start に反映。app-server に会話中の設定変更 RPC は無い） | 0 秒（session/set_model 等）。切替後の送信で相手が新しいモデルで応答（廃止済みモデルを選ぶと相手がそのモデル名でエラー = 切替が効いている） |
| 切替後の送信で文脈が続く | ○（「30」） | ○（「30」） | ○（free モデルへ切替後「はい」） |
| defaults の往復・別インスタンスから読める | ○（model: haiku） | ○（effort: low） | — |
| 文字が流れる（message.delta 複数回） | ○（1〜30 の数字で 8 回、`/edit-lint` で 64 回） | ○（59 回） | ○（10 回） |
| listCommands に edit-lint | ○ kind: skill（init の skills） | ○ kind: skill（skills/list） | ○ kind: skill（available_commands_update をプロジェクトのスキルと照合） |
| `/edit-lint` で発動 | ○（スキル本文に沿って edit.json / captions.json / analysis.json を探した） | ○（`skill` の道具行「使っています edit-lint」） | （一覧のみ確認） |
| transcript から過去が読める・別インスタンスでも同じ | ○（3 往復 34 行。delta まとめ書き前は 54 行） | ○（2 往復 18 行。まとめ書き前は 3 往復 174 行） | ○（15 行） |
| resume が同じ id を返し記録が読める | ○ | ○ | ○ |

- agy（Antigravity）は単体テストのみ（L1 の対象外）
