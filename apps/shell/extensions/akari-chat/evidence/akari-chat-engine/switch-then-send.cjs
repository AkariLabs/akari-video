// L1 補助: 相手を起こし、送る前にモデルを切り替えて 1 回だけ送る（切替後の送信が通ること・失敗時はエラー文を出す）。
// 使い方: node switch-then-send.cjs <agent> [pattern]   pattern = 切替先モデル id の正規表現（既定 free）
const fs = require('fs'); const os = require('os'); const path = require('path');
const { AkariChatServiceImpl } = require('../../lib/node/akari-chat-service.js');
(async () => {
    const [agent, pattern = 'free'] = process.argv.slice(2);
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'akari-chat-switch-'));
    const service = new AkariChatServiceImpl();
    const events = []; let chatId; const t0 = Date.now();
    service.setClient({ onEvent: (id, event) => { if (!chatId || id === chatId) events.push({ t: Date.now() - t0, event }); } });
    const until = async (pred, ms = 300000) => { const end = Date.now() + ms; while (Date.now() < end) { const f = events.find(e => pred(e.event)); if (f) return f; await new Promise(r => setTimeout(r, 200)); } };
    const out = { agent };
    try {
        chatId = (await service.start({ agent, cwd, permission: 'auto' })).chatId;
        const caps = await until(e => e.type === 'capabilities');
        const current = caps?.event.capabilities.currentModel || '';
        const provider = current.includes('/') ? current.split('/')[0] + '/' : '';
        const ids = (caps?.event.capabilities.models || []).map(m => m.id).filter(id => id !== current && id.startsWith(provider));
        out.current = current; out.candidates = ids.filter(id => new RegExp(pattern).test(id));
        const target = out.candidates[0];
        if (target) {
            const from = Date.now() - t0;
            await service.setModel(chatId, target);
            const ev = await until(e => e.type === 'model', 30000);
            out.switch = { to: target, modelEventAfterSec: ev ? Math.round((ev.t - from) / 100) / 10 : null };
        }
        const sent = Date.now() - t0;
        await service.send(chatId, '「はい」とだけ返してください。', []);
        const end = await until(e => e.type === 'turn.end');
        const after = events.filter(e => e.t >= sent);
        out.turn = { ok: end?.event.ok, text: after.filter(e => e.event.type === 'message.delta').map(e => e.event.text).join('').slice(0, 80),
            errors: after.filter(e => e.event.type === 'error').map(e => `${e.event.kind}: ${String(e.event.message).slice(0, 200)}`) };
        out.context = await service.contextInfo(chatId);
        await service.close(chatId);
    } catch (error) { out.fatal = String(error).slice(0, 300); }
    fs.rmSync(cwd, { recursive: true, force: true });
    console.log(JSON.stringify(out));
    process.exit(0);
})();
