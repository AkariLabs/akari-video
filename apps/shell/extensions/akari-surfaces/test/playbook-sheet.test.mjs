import test from 'node:test';
import assert from 'node:assert/strict';
import { setLanguage } from '@akari-video/i18n';
import { buildPlaybookSheetRows } from '../lib/browser/home/playbook-sheet.js';
import { contractExample } from './playbook-contract-example.mjs';

test('契約の例から 9 行を描き、道具不足と own の見本なしを示す', () => {
    setLanguage('ja');
    try {
        const tools = { platform: 'darwin', checkedAt: '', tools: [{ id: 'voicevox', tier: 'recommended', available: false }] };
        const rows = buildPlaybookSheetRows(contractExample, tools);
        assert.equal(rows.length, 9);
        assert.deepEqual(rows.map(row => row.key), ['identity', 'depth', 'steps', 'settings', 'placeholders', 'parts', 'tools', 'license', 'provenance']);
        assert.match(rows[0].items[0], /解説.*9:16.*60 秒/);
        assert.doesNotMatch(rows[0].items[0], /analyze-footage/);
        assert.match(rows.find(row => row.key === 'steps').summary, /4 工程（確認点 1）/);
        assert.match(rows.find(row => row.key === 'steps').items[1], /ここで確認/);
        assert.deepEqual(rows.find(row => row.key === 'settings').settingPairs[0], ['aspect', '9:16']);
        const required = rows.find(row => row.key === 'tools').items.join(' ');
        assert.match(required, /CLI >=1\.4\.0/);
        assert.match(required, /edit-plan/);
        assert.match(required, /render-cut/);
        assert.match(required, /voicevox · 無い/);
        const slots = rows.find(row => row.key === 'placeholders').items;
        assert.match(slots[0], /話している本人の寄り.*見本あり/);
        assert.match(slots[1], /画面収録.*見本なし/);
        assert.match(slots[2], /軽めの BGM.*見本あり/);
        const own = structuredClone(contractExample);
        own.placeholders.push({ id: 'own-sample', role: '作者の映像', kind: 'video', sample: { category: 'video', id: 'own-clip', source: 'own' } });
        const ownRows = buildPlaybookSheetRows(own, tools);
        assert.match(ownRows.find(row => row.key === 'placeholders').items.at(-1), /作者の映像.*見本なし/);
    } finally { setLanguage(undefined); }
});
