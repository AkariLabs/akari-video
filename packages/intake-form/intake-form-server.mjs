// 進め方フォーム（intake サーフェス）の standalone HTTP サーバ本体。
// decision-cards（packages/decision-cards/report-helper.mjs）と同じ流儀:
// 127.0.0.1 のみ・外部 npm 依存ゼロ・node:http のみ。
//
// decision-cards との違い: あちらは任意の report.html の隣に
// `<report>.decisions.json` というサイドカーを作る汎用機構。intake フォームは
// 対象ファイルが `.akari/intake.json` に固定されているため、サイドカー命名
// ではなく素直に `<projectRoot>/.akari/intake.json` を直接読み書きする。
//
// `createIntakeFormServer` はリッスンしない `http.Server` を返す（テストや
// CLI ラッパーから使い回せるように分離。副作用は listen() 呼び出し側の責任）。

import { createServer } from 'node:http';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const TEMPLATE_PATH = path.join(path.dirname(fileURLToPath(import.meta.url)), 'intake-form-template.html');

export function intakePathFor(projectRoot) {
    return path.join(projectRoot, '.akari', 'intake.json');
}

async function readBody(req) {
    const chunks = [];
    for await (const chunk of req) {
        chunks.push(chunk);
    }
    return Buffer.concat(chunks).toString('utf8');
}

function sendJson(res, status, body) {
    const text = JSON.stringify(body);
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(text) });
    res.end(text);
}

/**
 * @param {string} projectRoot 進め方フォームの対象プロジェクトルート（絶対パス）
 */
export function createIntakeFormServer(projectRoot) {
    const intakePath = intakePathFor(projectRoot);

    return createServer(async (req, res) => {
        try {
            const url = new URL(req.url ?? '/', 'http://127.0.0.1');

            if (req.method === 'GET' && url.pathname === '/') {
                const html = await readFile(TEMPLATE_PATH, 'utf8');
                res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
                res.end(html);
                return;
            }

            if (req.method === 'GET' && url.pathname === '/api/state') {
                if (!existsSync(intakePath)) {
                    sendJson(res, 404, { error: 'not_found' });
                    return;
                }
                const raw = await readFile(intakePath, 'utf8');
                res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
                res.end(raw);
                return;
            }

            if (req.method === 'POST' && url.pathname === '/api/state') {
                const raw = await readBody(req);
                let parsed;
                try {
                    parsed = JSON.parse(raw);
                } catch {
                    sendJson(res, 400, { error: 'invalid_json' });
                    return;
                }
                if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
                    sendJson(res, 400, { error: 'invalid_body' });
                    return;
                }
                await mkdir(path.dirname(intakePath), { recursive: true });
                await writeFile(intakePath, `${JSON.stringify(parsed, null, 2)}\n`, 'utf8');
                sendJson(res, 200, { ok: true });
                return;
            }

            sendJson(res, 404, { error: 'not_found' });
        } catch (error) {
            sendJson(res, 500, { error: 'internal_error', message: error instanceof Error ? error.message : String(error) });
        }
    });
}
