#!/usr/bin/env node
// CLI ラッパー: node intake-form-helper.mjs [project-root] [--port N]
// アプリなし運用（契約 §3「ブラウザ単体でも成立させる」）でも
// 進め方フォームを開けるようにする最小のローカルサーバ起動コマンド。

import path from 'node:path';
import { createIntakeFormServer } from './intake-form-server.mjs';

const HOST = '127.0.0.1';
const DEFAULT_PORT = 4610;

function parseArgs(argv) {
    const positionals = [];
    let port = DEFAULT_PORT;
    for (let index = 0; index < argv.length; index++) {
        if (argv[index] === '--port') {
            port = Number(argv[index + 1]);
            index++;
            continue;
        }
        positionals.push(argv[index]);
    }
    return { projectRoot: positionals[0] ?? process.cwd(), port };
}

const { projectRoot: rawRoot, port } = parseArgs(process.argv.slice(2));
const projectRoot = path.resolve(rawRoot);

if (!Number.isInteger(port) || port <= 0) {
    console.error('Usage: node packages/intake-form/intake-form-helper.mjs [project-root] [--port N]');
    process.exit(2);
}

const server = createIntakeFormServer(projectRoot);
server.listen(port, HOST, () => {
    console.log(`intake-form: http://${HOST}:${port}/  (project: ${projectRoot})`);
});
