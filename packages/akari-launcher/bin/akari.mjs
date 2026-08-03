#!/usr/bin/env node
import { run, runUpdateCommand } from '../src/cli.mjs';
import { runInitCommand } from '../src/init-command.mjs';
import { runSoundsCommand } from '../src/sounds-setup.mjs';
import { runStoreCommand } from '../src/store-command.mjs';

const argv = process.argv.slice(2);
// `akari update` / `akari init` / `akari sounds` / `akari store` は claude へ転送せず、
// 専用のサブコマンドとして扱う（契約 §4-1 / タスク契約 tasks/2026-08-02-launcher-init /
// 音源カタログ既定化のオーナー裁定 2026-08-03 / AKARI Store 連携）。
// それ以外の引数はすべて従来どおり claude へ転送する。
const invoke = argv[0] === 'update' ? runUpdateCommand(argv.slice(1))
  : argv[0] === 'init' ? runInitCommand(argv.slice(1))
  : argv[0] === 'sounds' ? runSoundsCommand(argv.slice(1))
  : argv[0] === 'store' ? runStoreCommand(argv.slice(1))
  : run(argv);

const result = await invoke.catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  return { exitCode: 1 };
});

process.exitCode = result.exitCode ?? 0;
