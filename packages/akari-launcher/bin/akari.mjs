#!/usr/bin/env node
import { run } from '../src/cli.mjs';

const result = await run(process.argv.slice(2)).catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  return { exitCode: 1 };
});

process.exitCode = result.exitCode ?? 0;
