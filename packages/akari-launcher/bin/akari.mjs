#!/usr/bin/env node
import { run, runUpdateCommand } from '../src/cli.mjs';
import { runInitCommand } from '../src/init-command.mjs';
import { runNewCommand } from '../src/new-command.mjs';
import { runNarrationCommand } from '../src/narration-command.mjs';
import { runInternalCommand } from '../src/internal-command.mjs';
import { runSoundsCommand } from '../src/sounds-setup.mjs';
import { runStatusCommand } from '../src/status-command.mjs';
import { runAcceptCommand } from '../src/accept-command.mjs';
import { runCapabilityCommand } from '../src/capability-command.mjs';
import { runStoreCommand } from '../src/store-command.mjs';
import { runAssetsCommand } from '../src/assets-command.mjs';
import { maybeApplyPendingUpdateOnLaunch, readOwnVersion } from '../src/update-check.mjs';
import { describeCliHelp } from '../src/messages.mjs';

// `akari --version` / `-v`: インストール済みの版を表示するだけの最小コマンド
// （タスク契約 2026-08-11-update-u4-cli-self-update の受け入れ条件 —
// `akari update` / `--rollback` 後にインストール先の版を観測する手段として必要）。
async function printVersion() {
  console.log(`v${readOwnVersion()}`);
  return { exitCode: 0 };
}

// `akari --help` / `-h`: 引数なしのトップレベル一覧を表示するだけの最小コマンド
// （タスク契約 2026-08-11-onboarding-o3-firstrun-plain §4。それ以前はこの分岐が無く、
// `--help` は claude/opencode へそのまま転送されてしまっていた — AKARI Video 自身の
// コマンド一覧が一度も出ない行き止まりだったため新設した）。
async function printCliHelp() {
  for (const line of describeCliHelp()) {
    console.log(line);
  }
  return { exitCode: 0 };
}

// 起動の頭で保留中の自動適用があれば適用する（契約 §11・タスク契約
// 2026-08-11-update-u5-cli-auto-update）。すべてのサブコマンド分岐より前に置く —
// 「起動」＝ akari バイナリの実行そのものであり、`--version` や `akari update` の
// 入口でも既に新版へ切り替わっている必要がある（受け入れ条件: 2 回目の起動で
// `akari --version` が新版を返す。スワップは rename ベースで `~/.akari/app` の
// 実体を差し替えるだけなので、このプロセス自身がこの後 `readOwnVersion()` を
// 読み直せば新版の内容を観測できる — 同一 argv での re-exec はしない設計判断
// （理由は report.md 参照）)。失敗は他の起動時副作用と同じく握りつぶし、
// claude/opencode 起動やサブコマンド実行を止めない。
try {
  maybeApplyPendingUpdateOnLaunch({ env: process.env, log: (line) => console.log(line) });
} catch (error) {
  console.error(`自動更新の適用確認でエラーが発生しました（続行します）: ${error instanceof Error ? error.message : String(error)}`);
}

const argv = process.argv.slice(2);
// `akari update` / `akari init` / `akari new` / `akari narration` / `akari internal` /
// `akari sounds` / `akari status` / `akari accept` / `akari capability` / `akari store` /
// `akari assets` は claude へ転送せず、専用のサブコマンドとして扱う（契約 §4-1 /
// タスク契約 launcher-init（内部リポ）/ 音源カタログ既定化のオーナー裁定 2026-08-03 /
// AKARI Store 連携 / タスク契約 2026-08-09-agent-assets-discovery）。
// それ以外の引数はすべて従来どおり claude へ転送する。
const invoke = (argv[0] === '--version' || argv[0] === '-v') ? printVersion()
  : (argv[0] === '--help' || argv[0] === '-h') ? printCliHelp()
  : argv[0] === 'update' ? runUpdateCommand(argv.slice(1))
  : argv[0] === 'init' ? runInitCommand(argv.slice(1))
  : argv[0] === 'new' ? runNewCommand(argv.slice(1))
  : argv[0] === 'narration' ? runNarrationCommand(argv.slice(1))
  : argv[0] === 'internal' ? runInternalCommand(argv.slice(1))
  : argv[0] === 'sounds' ? runSoundsCommand(argv.slice(1))
  : argv[0] === 'status' ? runStatusCommand(argv.slice(1))
  : argv[0] === 'accept' ? runAcceptCommand(argv.slice(1))
  : argv[0] === 'capability' ? runCapabilityCommand(argv.slice(1))
  : argv[0] === 'store' ? runStoreCommand(argv.slice(1))
  : argv[0] === 'assets' ? runAssetsCommand(argv.slice(1))
  : run(argv);

const result = await invoke.catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  return { exitCode: 1 };
});

process.exitCode = result.exitCode ?? 0;
