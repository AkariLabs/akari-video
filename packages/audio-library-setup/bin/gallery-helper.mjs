#!/usr/bin/env node
// 試聴ギャラリーの起動 CLI。decision-cards/report-helper.mjs と同じ流儀
// （127.0.0.1 のみ・起動後に HELPER: URL を標準出力へ 1 行出す）。
//
// Usage: node bin/gallery-helper.mjs [--library-root path] [--port N]

import { resolveAssetLibraryRoots } from '../../creator-root/src/index.mjs';
import path from 'node:path';
import { createGalleryServer } from '../gallery-server.mjs';

const HOST = '127.0.0.1';

function parseArguments(argv) {
    if (argv.includes('--help') || argv.includes('-h')) {
        console.log(`Usage: node bin/gallery-helper.mjs [--library-root <path>] [--port <N>]
  -h, --help  このヘルプを表示する`);
        process.exit(0);
    }
    function valueAfter(index, option, example) {
        const value = argv[index + 1];
        if (value === undefined || value.startsWith('--')) {
            console.error(`${option} には値が必要です（例: ${example}）`);
            process.exit(1);
        }
        return value;
    }
    const options = {
        libraryRoot: path.join(resolveAssetLibraryRoots().write, 'audio'),
        port: 0,
    };
    for (let i = 0; i < argv.length; i += 1) {
        const arg = argv[i];
        if (arg === '--library-root') { options.libraryRoot = path.resolve(valueAfter(i++, arg, '--library-root <path>')); continue; }
        if (arg === '--port') { options.port = Number(valueAfter(i++, arg, '--port <N>')); continue; }
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
