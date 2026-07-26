#!/usr/bin/env node
import { run, runUpdateCommand } from '../src/cli.mjs';

const argv = process.argv.slice(2);
// `akari update` は claude へ転送せず、更新の案内だけを行う専用サブコマンド
// （契約 §4-1）。それ以外の引数はすべて従来どおり claude へ転送する。
const invoke = argv[0] === 'update' ? runUpdateCommand(argv.slice(1)) : run(argv);

const result = await invoke.catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  return { exitCode: 1 };
});

process.exitCode = result.exitCode ?? 0;
