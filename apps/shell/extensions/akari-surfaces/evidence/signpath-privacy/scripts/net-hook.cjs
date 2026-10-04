// 検証専用: Node 側（Theia バックエンド・子プロセス）の外向き TCP 接続を 1 行 1 件で記録する。
// NODE_OPTIONS=--require=<このファイル> と AKARI_NET_HOOK_LOG=<出力先> で読み込む。
// http / https / undici（fetch）はいずれも net.Socket.prototype.connect を通る。
// 製品コードには組み込まない（l1-privacy.mjs が環境変数で差し込むだけ）。
'use strict';
const fs = require('node:fs');
const net = require('node:net');

const log = process.env.AKARI_NET_HOOK_LOG;
if (log) {
    const write = record => {
        try { fs.appendFileSync(log, `${JSON.stringify({ t: Date.now(), pid: process.pid, ...record })}\n`); } catch { /* 記録できなくても本体は止めない */ }
    };
    write({ kind: 'loaded', argv: process.argv.slice(0, 3), type: process.type ?? 'node' });
    const original = net.Socket.prototype.connect;
    net.Socket.prototype.connect = function connect(...args) {
        try {
            let first = args[0];
            if (Array.isArray(first)) { first = first[0]; }
            let host;
            let port;
            let ipc;
            if (first && typeof first === 'object') {
                host = first.host; port = first.port; ipc = first.path;
            } else if (typeof first === 'number') {
                port = first; host = typeof args[1] === 'string' ? args[1] : undefined;
            } else if (typeof first === 'string') {
                ipc = first;
            }
            if (!ipc) { write({ kind: 'connect', host: host ?? 'localhost', port }); }
        } catch { /* 記録の失敗で接続を壊さない */ }
        return original.apply(this, args);
    };
}
