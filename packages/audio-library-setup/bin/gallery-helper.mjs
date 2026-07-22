#!/usr/bin/env node
// 試聴ギャラリーの起動 CLI。decision-cards/report-helper.mjs と同じ流儀
// （127.0.0.1 のみ・起動後に HELPER: URL を標準出力へ 1 行出す）。
//
// Usage: node bin/gallery-helper.mjs [--library-root path] [--port N]

import os from 'node:os';
import path from 'node:path';
import { createGalleryServer } from '../gallery-server.mjs';

const HOST = '127.0.0.1';

function parseArguments(argv) {
    const options = {
        libraryRoot: path.join(os.homedir(), '.akari-video', 'assets', 'audio'),
        port: 0,
    };
    for (let i = 0; i < argv.length; i += 1) {
        const arg = argv[i];
        if (arg === '--library-root') { options.libraryRoot = path.resolve(argv[++i]); continue; }
        if (arg === '--port') { options.port = Number(argv[++i]); continue; }
        throw new Error(`Unknown option: ${arg}`);
    }
    return options;
}

const options = parseArguments(process.argv.slice(2));
const server = createGalleryServer(options.libraryRoot);

server.listen(options.port, HOST, () => {
    const address = server.address();
    console.log(`HELPER: http://localhost:${address.port}/`);
    console.log(`library-root: ${options.libraryRoot}`);
});
