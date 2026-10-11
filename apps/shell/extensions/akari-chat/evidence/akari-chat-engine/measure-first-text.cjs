// 計測: 「チャットを開く → 相手を選ぶ（= start）→ 5 秒後に送る」で、送ってから最初の文字が出るまでの秒数。
// 使い方: node measure-first-text.cjs <agent> [model] [delaySec]
// ビルド済みの lib/ を直接呼ぶ（画面は使わない）。プロジェクトは一時フォルダ。
const { mkdtempSync, rmSync } = require('fs');
const { tmpdir } = require('os');
const { join } = require('path');
const { AkariChatServiceImpl } = require('../../lib/node/akari-chat-service.js');

(async () => {
    const [agent, model, delayArg] = process.argv.slice(2);
    const delay = Number(delayArg || 5) * 1000;
    const cwd = mkdtempSync(join(tmpdir(), 'akari-chat-measure-'));
    const service = new AkariChatServiceImpl();
    const t0 = Date.now();
    const sec = t => t === undefined ? null : Math.round((t - t0) / 100) / 10;
    const marks = {};
    let chatId;
    let resolveFirst, resolveEnd;
    const firstText = new Promise(r => { resolveFirst = r; });
    const turnEnd = new Promise(r => { resolveEnd = r; });
    const deltas = { message: 0, thinking: 0 };
    service.setClient({ onEvent: (id, event) => {
        if (chatId && id !== chatId) return;
        if (event.type === 'ready' && marks.ready === undefined) marks.ready = Date.now();
        if (event.type === 'message.delta') { deltas.message++; if (event.text && marks.firstText === undefined) { marks.firstText = Date.now(); resolveFirst(); } }
        if (event.type === 'thinking.delta') deltas.thinking++;
        if (event.type === 'error') marks.error = event.kind + ': ' + String(event.message).slice(0, 120);
        if (event.type === 'turn.end') { marks.turnEnd = Date.now(); resolveEnd(); }
    } });
    const started = await service.start({ agent, cwd, model: model || undefined, permission: 'auto' });
    chatId = started.chatId;
    marks.startReturned = Date.now();
    const wait = Math.max(0, t0 + delay - Date.now());
    await new Promise(r => setTimeout(r, wait));
    marks.send = Date.now();
    await service.send(chatId, 'こんにちは。「はい」とだけ返してください。', []);
    marks.sendReturned = Date.now();
    const timeout = new Promise(r => setTimeout(r, 300000));
    await Promise.race([Promise.all([firstText, turnEnd]), timeout]);
    await service.close(chatId).catch(() => undefined);
    rmSync(cwd, { recursive: true, force: true });
    const out = {
        agent, model: model || null,
        startReturnedSec: sec(marks.startReturned), readySec: sec(marks.ready), sendSec: sec(marks.send),
        firstTextAfterSendSec: marks.firstText === undefined ? null : Math.round((marks.firstText - marks.send) / 100) / 10,
        turnEndAfterSendSec: marks.turnEnd === undefined ? null : Math.round((marks.turnEnd - marks.send) / 100) / 10,
        messageDeltas: deltas.message, thinkingDeltas: deltas.thinking, error: marks.error || null
    };
    console.log(JSON.stringify(out));
    process.exit(0);
})().catch(error => { console.error(String(error)); process.exit(1); });
