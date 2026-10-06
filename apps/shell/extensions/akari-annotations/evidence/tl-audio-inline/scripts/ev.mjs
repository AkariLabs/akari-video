#!/usr/bin/env node
// 実機のページで式を 1 つ評価して JSON を出す（ラッパー作成の検証スクリプト）。使い方: node ev.mjs '<expr>'
import { attach, evalOn } from './l1-common.mjs';
const cdp = await attach(); console.log(JSON.stringify(await evalOn(cdp, process.argv[2]))); cdp.close(); process.exit(0);
