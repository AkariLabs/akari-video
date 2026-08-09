import test from 'node:test';
import assert from 'node:assert/strict';
import { composeAgentContextPacket, composeMaterialAskAgentPrompt, composeOutputAskAgentPrompt } from '../lib/common/agent-context-packet.js';

// composer 単体テスト（task.md L0: 要素の有無 4 パターン — 分析済み/未分析 × 入力の改行畳み込み）。

test('composeMaterialAskAgentPrompt: 分析済み・改行なし入力 — 5 要素すべて出る', () => {
    const packet = composeMaterialAskAgentPrompt(
        {
            relativePath: 'assets/clip.mp4',
            analyzed: true,
            durationSeconds: 6,
            analysisRelativePath: '.akari/sidecars/assets/clip.mp4.analysis/analysis.json'
        },
        'この素材を要約して'
    );
    assert.equal(
        packet,
        '【素材】assets/clip.mp4（尺 0:06・分析済み・analysis: .akari/sidecars/assets/clip.mp4.analysis/analysis.json）について: この素材を要約して'
    );
    assert.equal(/[\r\n]/.test(packet), false, 'パケットは 1 行でなければならない');
});

test('composeMaterialAskAgentPrompt: 分析済み・改行を含む入力 — 空白に畳まれる', () => {
    const packet = composeMaterialAskAgentPrompt(
        {
            relativePath: 'assets/clip.mp4',
            analyzed: true,
            durationSeconds: 66,
            analysisRelativePath: '.akari/sidecars/assets/clip.mp4.analysis/analysis.json'
        },
        '1行目\n2行目\r\n3行目'
    );
    assert.equal(
        packet,
        '【素材】assets/clip.mp4（尺 1:06・分析済み・analysis: .akari/sidecars/assets/clip.mp4.analysis/analysis.json）について: 1行目 2行目 3行目'
    );
    assert.equal(/[\r\n]/.test(packet), false, 'パケットは 1 行でなければならない');
});

test('composeMaterialAskAgentPrompt: 未分析・改行なし入力 — 尺不明/未分析・analysis 要素なし', () => {
    const packet = composeMaterialAskAgentPrompt(
        { relativePath: 'assets/raw.mov', analyzed: false },
        'これを分析して'
    );
    assert.equal(packet, '【素材】assets/raw.mov（尺不明・未分析）について: これを分析して');
    assert.equal(packet.includes('analysis:'), false, '未分析では analysis パス要素が出てはいけない');
});

test('composeMaterialAskAgentPrompt: 未分析・改行を含む入力 — 空白に畳まれ analysis 要素なし', () => {
    const packet = composeMaterialAskAgentPrompt(
        { relativePath: 'assets/raw.mov', analyzed: false },
        '何を\nすればいい？'
    );
    assert.equal(packet, '【素材】assets/raw.mov（尺不明・未分析）について: 何を すればいい？');
    assert.equal(packet.includes('analysis:'), false, '未分析では analysis パス要素が出てはいけない');
    assert.equal(/[\r\n]/.test(packet), false, 'パケットは 1 行でなければならない');
});

test('composeAgentContextPacket: フィールド 0 件は例外', () => {
    assert.throws(() => composeAgentContextPacket('素材', [], '依頼文'));
});

test('composeAgentContextPacket: 汎用シグネチャ（対象種別 + フィールド辞書 + 依頼文）は素材以外の対象種別にも使える', () => {
    const packet = composeAgentContextPacket(
        'プラン',
        [{ value: 'planning/plan.json#shot-3' }, { label: '状態', value: 'draft' }],
        '尺を詰めて'
    );
    assert.equal(packet, '【プラン】planning/plan.json#shot-3（状態 draft）について: 尺を詰めて');
});

// できたもの（export 行）版 composer（task 2026-08-09-material-context-menu-mvp 指示8）。

test('composeOutputAskAgentPrompt: relativePath が含まれる', () => {
    const packet = composeOutputAskAgentPrompt({ relativePath: 'exports/cut-01.mp4' }, 'テロップの誤字を直して');
    assert.equal(packet.includes('exports/cut-01.mp4'), true);
    assert.equal(packet, '【書き出し済みの成果物】exports/cut-01.mp4について: テロップの誤字を直して');
});

test('composeOutputAskAgentPrompt: 改行を含む依頼文は 1 行に畳まれる', () => {
    const packet = composeOutputAskAgentPrompt({ relativePath: 'exports/cut-01.mp4' }, '1行目\n2行目');
    assert.equal(packet, '【書き出し済みの成果物】exports/cut-01.mp4について: 1行目 2行目');
    assert.equal(/[\r\n]/.test(packet), false, 'パケットは 1 行でなければならない');
});
