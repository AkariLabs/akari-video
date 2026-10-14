import assert from 'node:assert/strict';
import test from 'node:test';
import { setLanguage, t } from '@akari-video/i18n';
import { planCaptionStyleEdit, TEXTSTYLE_CATALOG } from '@akari-video/edit-store';
import { captionNoticeTexts } from '../lib/common/daihon-caption-notices.js';

test('英語画面でネオンの範囲通知に日本語の文字が混ざらない', () => {
  setLanguage('en');
  try {
    const { animation, ...look } = TEXTSTYLE_CATALOG.neon.style;
    const result = planCaptionStyleEdit({ captions: { captions: [{
      id: 'c-0001', text: '赤い猫', src: 's1', start: 0, end: 2,
      words: [{ text: '赤い', start: 0, end: 1 }, { text: '猫', start: 1, end: 2 }]
    }] }, targets: [{ caption_id: 'c-0001', range: { from: 2, to: 3 } }], parts: { look } });
    const messages = captionNoticeTexts(result.notice_codes, t);
    assert.ok(messages.length > 0);
    assert.ok(messages.every(message => !/[\u3040-\u30ff\u3400-\u9fff]/u.test(message)));
  } finally { setLanguage(undefined); }
});

test('日本語画面で範囲に使えない見た目を一度だけ知らせる', () => {
  setLanguage('ja');
  try {
    const messages = captionNoticeTexts([
      { code: 'run-look-omitted', params: { field: 'font_family' } },
      { code: 'run-look-omitted', params: { field: 'font_family' } },
      { code: 'other', params: { message: 'ignored' } }
    ], t);
    assert.deepEqual(messages, ['フォントは字幕全体にだけ当てられます。']);
  } finally { setLanguage(undefined); }
});

test('実測時刻が決まらない通知でも見た目が当たったと日本語と英語で伝える', () => {
  const notice = [{ code: 'anchor-unmapped' }];
  setLanguage('ja');
  try {
    assert.match(captionNoticeTexts(notice, t)[0], /見た目は当たっています/);
    setLanguage('en');
    assert.match(captionNoticeTexts(notice, t)[0], /appearance was still applied/);
  } finally { setLanguage(undefined); }
});
