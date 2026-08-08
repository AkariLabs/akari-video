# CLI 寄せの判定基準（2026-08-08）

## 判定基準

複数のスキルまたはアプリから呼ばれる実行コードだけを、CLI の `akari-launcher` または
`akari-tools` へ寄せる。1 スキルだけが使う `bin/` は、そのスキルのディレクトリに残す。

`akari-launcher` は Node.js 組み込みモジュールだけで動く依存ゼロ側とする。外部 npm 依存が
必要な実行コードは `akari-tools` に置き、launcher からはパスを遅延解決して子プロセスとして
起動する。launcher 自身は `akari-tools` や `puppeteer-core` を import しない。

## 今回の移設

| 元のスキル | 公開入口 | 実装の移設先 |
|---|---|---|
| `create-project` | `akari new` | `packages/akari-launcher/src/new-command.mjs` |
| `generate-narration` | `akari narration generate` | `packages/akari-launcher/src/narration-command.mjs` |
| `beat-sync-edit` | `akari internal beat-sync-*` | `packages/akari-tools/bin/` の `beatmap.mjs`・`probe-frame.mjs`・`render-when-idle.sh` |

移設対象は 3 スキル分で、依存ゼロ側の launcher に 2 本、依存あり側の tools に 1 組
（実行ファイルは 3 本）を置いた。各スキルから `bin/` は撤去し、手順書から上記 `akari`
コマンドを呼ぶ形に統一した。

残り 18 スキルには触れていない。このうち自己完結した `bin/` を持つ 6 スキルも、判定基準どおり
スキルディレクトリに残した。
