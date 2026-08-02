#!/usr/bin/env node
import { run, runUpdateCommand } from '../src/cli.mjs';
import { runInitCommand } from '../src/init-command.mjs';

const argv = process.argv.slice(2);
// `akari update` / `akari init` は claude へ転送せず、専用のサブコマンドとして扱う
// （契約 §4-1、および `akari init` はタスク契約 tasks/2026-08-02-launcher-init）。
// それ以外の引数はすべて従来どおり claude へ転送する。
const invoke = argv[0] === 'update' ? runUpdateCommand(argv.slice(1))
  : argv[0] === 'init' ? runInitCommand(argv.slice(1))
  : run(argv);

const result = await invoke.catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  return { exitCode: 1 };
});

process.exitCode = result.exitCode ?? 0;
