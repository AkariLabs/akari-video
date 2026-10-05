#!/usr/bin/env node
// スクリーンショット 1 枚（ラッパー作成の検証スクリプト）。使い方: node shot.mjs <png>
import { screenshot } from './cdp-lib.mjs';
import { attach } from './l1-common.mjs';
const cdp = await attach(); await screenshot(cdp, process.argv[2]); cdp.close(); process.exit(0);
