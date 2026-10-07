import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { PARTNER_TERMINAL_CSS } from '../lib/browser/partner-terminal-style.js';

const catalogUrl = new URL('../src/common/partner-catalog.json', import.meta.url);

test('Command Code CLI がパートナーカタログに一意な CLI として載る', async () => {
    const catalog = JSON.parse(await readFile(catalogUrl, 'utf8'));
    const matches = catalog.filter(entry => entry.agent === 'commandcode');

    assert.deepEqual(matches, [{
        id: 'langbase/command-code-cli',
        agent: 'commandcode',
        form: 'cli',
        name: 'Command Code CLI',
        description: 'Command Code を PTY タブで直接使います',
        recommended: false
    }]);
    assert.equal(catalog.filter(entry => entry.form === 'cli').length, 10);
    assert.equal(catalog.filter(entry => entry.form === 'web').length, 1);
});

test('Command Code アイコンは公式 16px favicon のバイト列を使う', () => {
    const rule = PARTNER_TERMINAL_CSS.match(/\.akari-partner-commandcode-cli-icon \{([\s\S]*?)\}/)?.[1];
    const encoded = rule?.match(/data:image\/png;base64,([A-Za-z0-9+/=]+)/)?.[1];

    assert.ok(rule);
    assert.ok(encoded);
    assert.match(rule, /mask-image: none/);
    assert.equal(
        createHash('sha256').update(Buffer.from(encoded, 'base64')).digest('hex'),
        'a6f3eb1610207091c2c194a7c59dea8902573fd444a7b0201b78c2ab4a37ec08'
    );
});

test('Pi と Devin の CLI と DeepSeek の Web がそれぞれ一意に並ぶ', async () => {
    const catalog = JSON.parse(await readFile(catalogUrl, 'utf8'));
    for (const [agent, id, name, form] of [
        ['pi', 'earendil/pi-cli', 'Pi CLI', 'cli'],
        ['devin', 'cognition/devin-cli', 'Devin CLI', 'cli'],
        ['deepseek', 'deepseek/dsh-web', 'DeepSeek Harness', 'web']
    ]) {
        const matches = catalog.filter(entry => entry.agent === agent);
        assert.equal(matches.length, 1);
        assert.equal(matches[0].id, id);
        assert.equal(matches[0].name, name);
        assert.equal(matches[0].form, form);
    }
});

test('Pi と Devin と DeepSeek の公式 SVG は単色マスクとして埋め込まれる', () => {
    for (const agent of ['pi', 'devin', 'deepseek']) {
        const rule = PARTNER_TERMINAL_CSS.match(new RegExp(`\\.akari-partner-${agent}-cli-icon \\{([\\s\\S]*?)\\}`))?.[1];
        assert.ok(rule, agent);
        const encoded = rule.match(/data:image\/svg\+xml;base64,([A-Za-z0-9+/=]+)/)?.[1];
        assert.ok(encoded, agent);
        const svg = Buffer.from(encoded, 'base64').toString('utf8');
        if (agent === 'deepseek') {
            assert.equal(createHash('sha256').update(Buffer.from(encoded, 'base64')).digest('hex'),
                'baf5e2ecb34b0bddc5f970172e4afa15fad63a00e84ccf0be1858634340e88ab');
        }
        assert.match(svg, /fill="#fff"/);
        assert.doesNotMatch(svg, /<script\b|\son\w+\s*=|\b(?:xlink:)?href\s*=/i);
    }
});
