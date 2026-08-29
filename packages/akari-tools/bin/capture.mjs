#!/usr/bin/env node
import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { CAPTURE_USAGE } from "../src/capture/arguments.mjs";
import { runCapture } from "../src/capture/run.mjs";

export async function main(argv = process.argv.slice(2), io = console) {
  try {
    const result = await runCapture(argv);
    if (result.help) {
      io.log(CAPTURE_USAGE);
      return 0;
    }
    for (const record of result.records) io.log(JSON.stringify(record));
    return 0;
  } catch (error) {
    io.error(error instanceof Error ? error.message : String(error));
    return 1;
  }
}

let isEntrypoint = false;
try {
  isEntrypoint = realpathSync(fileURLToPath(import.meta.url)) === realpathSync(process.argv[1]);
} catch {}
if (isEntrypoint) process.exitCode = await main();
