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
import { readOwnVersion } from '../src/update-check.mjs';

// `akari --version` / `-v`: インストール済みの版を表示するだけの最小コマンド
// （タスク契約 2026-08-11-update-u4-cli-self-update の受け入れ条件 —
// `akari update` / `--rollback` 後にインストール先の版を観測する手段として必要）。
async function printVersion() {
  console.log(`v${readOwnVersion()}`);
  return { exitCode: 0 };
}

const argv = process.argv.slice(2);
// `akari update` / `akari init` / `akari new` / `akari narration` / `akari internal` /
// `akari sounds` / `akari status` / `akari accept` / `akari capability` / `akari store` /
// `akari assets` は claude へ転送せず、専用のサブコマンドとして扱う（契約 §4-1 /
// タスク契約 launcher-init（内部リポ）/ 音源カタログ既定化のオーナー裁定 2026-08-03 /
// AKARI Store 連携 / タスク契約 2026-08-09-agent-assets-discovery）。
// それ以外の引数はすべて従来どおり claude へ転送する。
const invoke = (argv[0] === '--version' || argv[0] === '-v') ? printVersion()
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
