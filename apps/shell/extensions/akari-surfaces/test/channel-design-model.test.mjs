import test from 'node:test';
import assert from 'node:assert/strict';
import {
    QUESTION_KEYS, CHANNEL_QUESTIONS, CHANNEL_TYPES, rankTypes, buildChannelMarkdown,
    parseChannelMarkdown, summarizeAnswers, channelDesignPartnerPrompt
} from '../lib/browser/channel/channel-design-model.js';

test('6 問の構成と 12 の型', () => {
    assert.deepEqual(QUESTION_KEYS, ['genre', 'who', 'plat', 'len', 'tone', 'every']);
    assert.deepEqual(CHANNEL_QUESTIONS.map(question => question.options.length), [8, 5, 6, 4, 5, 6]);
    assert.equal(CHANNEL_TYPES.length, 12);
});

test('ジャンルと長さを重く見て、同点なら free、定義順に並ぶ', () => {
    const ranked = rankTypes({ genre: ['料理'], plat: ['Instagram リール'], len: ['縦ショート 60 秒まで'] });
    assert.equal(ranked[0].name, '料理ショート 15 秒');
    assert.equal(ranked[1].name, '縦ショート 60 秒');
    assert.equal(ranked.length, 3);
    assert.equal(rankTypes({ tone: ['明るい'] })[0].tier, 'free');
    assert.equal(rankTypes({ genre: ['料理'], who: ['同じ趣味の人'] })[0].name, '料理ショート 15 秒');
});

test('未回答の見出しを省き、型と未知の見出しを往復できる', () => {
    const answers = { genre: ['料理'], plat: ['Instagram リール'], len: ['縦ショート 60 秒まで'], every: ['顔は出さない'] };
    const markdown = buildChannelMarkdown(answers, '料理の部屋', '料理ショート 15 秒', '## 独自のメモ\nあとで決める');
    assert.match(markdown, /## ジャンル\n料理/);
    assert.doesNotMatch(markdown, /## 誰に/);
    assert.match(markdown, /## チャンネルの型\n料理ショート 15 秒/);
    const parsed = parseChannelMarkdown(markdown);
    assert.deepEqual(parsed.answers, answers);
    assert.equal(parsed.appliedType, '料理ショート 15 秒');
    assert.equal(parsed.rest, '## 独自のメモ\nあとで決める');
    assert.equal(buildChannelMarkdown(parsed.answers, '料理の部屋', parsed.appliedType, parsed.rest), markdown);
});

test('回答の要約は質問順に 1 行で並ぶ', () => {
    const answers = { genre: ['料理'], plat: ['YouTube', 'TikTok'] };
    assert.equal(summarizeAnswers(answers), '料理 / YouTube、TikTok');
    assert.equal(channelDesignPartnerPrompt(answers), '/channel-design 料理 / YouTube、TikTok');
});
