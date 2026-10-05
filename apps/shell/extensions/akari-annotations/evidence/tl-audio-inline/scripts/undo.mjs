#!/usr/bin/env node
// Cmd+Z を 1 手送る（ラッパー作成の検証スクリプト）。
import { UNDO, attach, evalOn, key, sleep } from './l1-common.mjs';
const cdp = await attach(); await evalOn(cdp, `(()=>{document.activeElement?.blur?.();return true})()`); await key(cdp, UNDO); await sleep(1500); cdp.close(); process.exit(0);
