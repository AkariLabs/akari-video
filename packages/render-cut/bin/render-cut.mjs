#!/usr/bin/env node

import { runCli } from "../src/render-cut.mjs";

process.exitCode = await runCli(process.argv.slice(2));
