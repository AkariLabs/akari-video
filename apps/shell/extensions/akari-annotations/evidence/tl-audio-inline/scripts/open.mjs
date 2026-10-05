#!/usr/bin/env node
// 起動済みの実機にアタッチしてタイムラインを開く（ラッパー作成の検証スクリプト）。
import { attach, openTimeline } from './l1-common.mjs';
const cdp = await attach();
await openTimeline(cdp);
cdp.close(); console.log('ready'); process.exit(0);
