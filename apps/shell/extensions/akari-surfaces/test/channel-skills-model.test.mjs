import test from 'node:test';
import assert from 'node:assert/strict';
import {
    validateSkillSlug, buildSkillMd, parseSkillMd, PRESET_CHANNEL_SKILLS, copiedSkillMd
} from '../lib/browser/channel/channel-skills-model.js';

test('呼び名は英小文字・数字・区切りのハイフンだけを受け付ける', () => {
    for (const slug of ['Write-Description', '', 'a--b']) assert.match(validateSkillSlug(slug), /呼び名は英小文字/);
    assert.equal(validateSkillSlug('write-description'), undefined);
});

test('SKILL.md の書式と読み戻し', () => {
    const draft = {
        slug: 'write-description', title: '説明欄を書く', description: '書き出したあとに使う。',
        steps: '1. 確かめる\n2. 書く\n3. 見直す', reads: ['channel.md', '辞書とメモ']
    };
    const text = buildSkillMd(draft);
    assert.match(text, /^---\nname: write-description\ndescription: 書き出したあとに使う。\n---\n\n# 説明欄を書く\n\n/);
    assert.match(text, /読むもの: channel\.md・辞書とメモ\n$/);
    assert.deepEqual(parseSkillMd(text), { slug: draft.slug, title: draft.title, description: draft.description });
    assert.equal(parseSkillMd('本文だけ'), undefined);
    assert.deepEqual(parseSkillMd(buildSkillMd({ ...draft, copiedFrom: 'original' })), {
        slug: draft.slug, title: draft.title, description: draft.description, copiedFrom: 'original'
    });
});

test('用意された 7 件に日本語の手順がある', () => {
    assert.deepEqual(PRESET_CHANNEL_SKILLS.map(skill => skill.slug), [
        'write-description', 'title-ideas', 'thumbnail-copy', 'cut-shorts', 'add-chapters', 'final-check', 'fix-opening'
    ]);
    for (const skill of PRESET_CHANNEL_SKILLS) assert.ok(skill.steps.split('\n').length >= 3);
});

test('Akari のスキルは名前と写しの出所を変え、本文を残す', () => {
    const source = '---\nname: original\ndescription: 説明\n---\n\n# 元の本文\n\n続きの手順\n';
    const copied = copiedSkillMd('original', source);
    assert.match(copied, /name: my-original/);
    assert.match(copied, /---\n\n写し: \/original\n\n# 元の本文\n\n続きの手順/);
    assert.equal(parseSkillMd(copied)?.copiedFrom, 'original');
});
