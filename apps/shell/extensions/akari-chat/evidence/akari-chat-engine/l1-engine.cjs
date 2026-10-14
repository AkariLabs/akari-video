// L1: ビルド済みの lib/ の RPC を直接呼んで §8.1 の動きを実機の CLI で確かめる（画面は使わない）。
// 使い方: node l1-engine.cjs <agent> [--skill]   （agent = claude | codex | opencode）
// HOME は本人のまま。~/.akari/chat/defaults.json は試験の前の状態へ戻す。プロジェクトは一時フォルダ。
const fs = require('fs');
const os = require('os');
const path = require('path');
const { AkariChatServiceImpl } = require('../../lib/node/akari-chat-service.js');

const agent = process.argv[2];
const trySkill = process.argv.includes('--skill');
const repoSkill = path.resolve(__dirname, '../../../../../../skills/edit-lint');
const defaultsFile = path.join(os.homedir(), '.akari', 'chat', 'defaults.json');
const plan = {
    claude: { defaults: { model: 'haiku' }, switchTo: 'sonnet', back: 'haiku', count: '1 から 30 までの数字を半角スペース区切りで 1 行で書いてください。ほかは何も書かないこと。' },
    codex: { defaults: { effort: 'low' }, count: '1 から 30 までの数字を半角スペース区切りで 1 行で書いてください。ほかは何も書かないこと。道具は使わないこと。' },
    opencode: { defaults: undefined, count: '1 から 30 までの数字を半角スペース区切りで 1 行で書いてください。ほかは何も書かないこと。道具は使わないこと。' }
}[agent];

(async () => {
    const hadDefaults = fs.existsSync(defaultsFile);
    const originalDefaults = hadDefaults ? fs.readFileSync(defaultsFile, 'utf8') : undefined;
    const hadDir = fs.existsSync(path.dirname(defaultsFile));
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'akari-chat-l1-'));
    // 実際のプロジェクトと同じ形: 実体は .claude/skills、.agents/skills はそこへの symlink
    fs.mkdirSync(path.join(cwd, '.claude', 'skills'), { recursive: true });
    fs.cpSync(repoSkill, path.join(cwd, '.claude', 'skills', 'edit-lint'), { recursive: true });
    fs.mkdirSync(path.join(cwd, '.agents'), { recursive: true });
    fs.symlinkSync(path.join('..', '.claude', 'skills'), path.join(cwd, '.agents', 'skills'));
    const service = new AkariChatServiceImpl();
    const result = { agent };
    const events = [];
    const waiters = [];
    const t0 = Date.now();
    const s = t => Math.round((t - t0) / 100) / 10;
    let chatId;
    service.setClient({ onEvent: (id, event) => {
        if (chatId && id !== chatId) return;
        events.push({ t: Date.now(), event });
        for (const w of [...waiters]) if (w.match(event)) { waiters.splice(waiters.indexOf(w), 1); w.resolve({ t: Date.now(), event }); }
    } });
    const waitFor = (match, ms = 240000) => new Promise((resolve) => {
        const found = events.find(item => item.t >= (waitFor.since || 0) && match(item.event));
        if (found) return resolve(found);
        const w = { match, resolve };
        waiters.push(w);
        setTimeout(() => { if (waiters.includes(w)) { waiters.splice(waiters.indexOf(w), 1); resolve(undefined); } }, ms);
    });
    const turn = async (text) => {
        const from = Date.now();
        waitFor.since = from;
        const sending = service.send(chatId, text, []);
        const end = await waitFor(e => e.type === 'turn.end');
        await sending.catch(error => { result.sendError = String(error); });
        const slice = events.filter(item => item.t >= from);
        const firstText = slice.find(item => item.event.type === 'message.delta' && item.event.text);
        return {
            ok: end?.event.ok ?? null, reason: end?.event.reason,
            firstTextSec: firstText ? Math.round((firstText.t - from) / 100) / 10 : null,
            messageDeltas: slice.filter(item => item.event.type === 'message.delta').length,
            thinkingDeltas: slice.filter(item => item.event.type === 'thinking.delta').length,
            text: slice.filter(item => item.event.type === 'message.delta').map(item => item.event.text).join('').slice(0, 160),
            errors: slice.filter(item => item.event.type === 'error').map(item => `${item.event.kind}: ${String(item.event.message).slice(0, 160)}`),
            tools: slice.filter(item => item.event.type === 'tool').map(item => `${item.event.kind}:${item.event.title}`).slice(0, 8)
        };
    };
    try {
        if (plan.defaults) {
            await service.setDefaults(agent, plan.defaults);
            result.defaultsRoundTrip = JSON.stringify(await service.getDefaults(agent)) === JSON.stringify(plan.defaults);
            result.defaultsFileHasAgent = !!JSON.parse(fs.readFileSync(defaultsFile, 'utf8'))[agent];
            // 別のインスタンス（= アプリの再起動相当）からも読めるか
            result.defaultsAfterRestart = await new AkariChatServiceImpl().getDefaults(agent);
        }
        const started = await service.start({ agent, cwd, permission: 'auto' });
        chatId = started.chatId;
        result.startReturnedSec = s(Date.now());
        // ready 前に送る（キュー）
        const readyBeforeSend = events.some(item => item.event.type === 'ready');
        result.sentBeforeReady = !readyBeforeSend;
        const turnPromise = turn(plan.count);
        const ready = await waitFor(e => e.type === 'ready' || e.type === 'error');
        result.readySec = ready ? s(ready.t) : null;
        result.readyEvent = ready?.event.type;
        if (ready?.event.type === 'error') result.readyError = ready.event.message.slice(0, 200);
        result.turn1 = await turnPromise;
        const caps = events.find(item => item.event.type === 'capabilities');
        result.capabilitiesSec = caps ? s(caps.t) : null;
        const allModels = caps?.event.capabilities.models.map(m => m.id) || [];
        const models = allModels;
        result.models = models.slice(0, 12);
        result.currentModel = caps?.event.capabilities.currentModel;
        result.context1 = await service.contextInfo(chatId);
        // モデルを即時に切り替える（次の送信を待たずに model イベント）
        // 今のモデルと同じ提供元の別モデルへ（鍵の無い提供元を選ばないため）
        const current = result.currentModel || result.context1.model || '';
        const provider = current.includes('/') ? current.split('/')[0] + '/' : '';
        const sameProvider = allModels.filter(m => m !== current && (!provider || m.startsWith(provider)));
        const target = process.env.L1_SWITCH_TO || plan.switchTo || sameProvider.find(m => /free|nano|mini/.test(m)) || sameProvider[0];
        result.sameProviderModels = sameProvider.slice(0, 30);
        if (target) {
            const from = Date.now();
            waitFor.since = from;
            const modelEvent = waitFor(e => e.type === 'model', 60000);
            await service.setModel(chatId, target);
            const got = await modelEvent;
            result.modelSwitch = { to: target, eventSec: got ? Math.round((got.t - from) / 100) / 10 : null, event: got?.event };
            if (plan.back) {
                await new Promise(r => setTimeout(r, 1500));
                waitFor.since = Date.now();
                const back = waitFor(e => e.type === 'model', 60000);
                await service.setModel(chatId, plan.back);
                result.modelBack = (await back)?.event;
            }
            result.turn2 = await turn('さっき書いた数字のうち最後の数字だけを書いてください。');
            result.context2 = await service.contextInfo(chatId);
        }
        const commands = await service.listCommands(chatId);
        result.commandCount = commands.length;
        result.editLint = commands.find(c => c.name === 'edit-lint' || c.name.endsWith(':edit-lint')) || null;
        if (trySkill) {
            const name = result.editLint?.name || 'edit-lint';
            result.skillTurn = await turn(`/${name}`);
        }
        await service.close(chatId);
        const rows = await service.loadTranscript(cwd, chatId);
        result.transcript = {
            rows: rows.length,
            users: rows.filter(r => r.event.type === 'user').map(r => r.event.text.slice(0, 40)),
            types: [...new Set(rows.map(r => r.event.type))],
            fromFreshInstance: (await new AkariChatServiceImpl().loadTranscript(cwd, chatId)).length
        };
        // 履歴から開き直す: 同じ id で再開し、記録が読めること（送らない）
        const reopened = await service.resume(cwd, chatId);
        result.resume = { sameId: reopened.chatId === chatId, transcriptRows: (await service.loadTranscript(cwd, reopened.chatId)).length };
        await service.close(reopened.chatId);
        result.history = (await service.listHistory(cwd)).map(h => ({ id: h.id === chatId, agent: h.agent, model: h.model, hasRef: !!h.sessionRef }));
    } catch (error) {
        result.fatal = String(error && error.stack || error).slice(0, 400);
    } finally {
        if (hadDefaults) fs.writeFileSync(defaultsFile, originalDefaults);
        else { fs.rmSync(defaultsFile, { force: true }); if (!hadDir) fs.rmSync(path.dirname(defaultsFile), { recursive: true, force: true }); }
        fs.rmSync(cwd, { recursive: true, force: true });
    }
    console.log(JSON.stringify(result, null, 1));
    process.exit(0);
})();
