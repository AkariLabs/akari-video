#!/usr/bin/env node
if (!process.argv.includes('--serve')) {
    console.error('使い方: akari-vibe --serve');
    process.exit(2);
}
await import('../live/live.mjs');
