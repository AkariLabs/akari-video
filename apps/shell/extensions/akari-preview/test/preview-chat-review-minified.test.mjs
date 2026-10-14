import test from 'node:test';
import assert from 'node:assert/strict';
import { runInNewContext } from 'node:vm';
import { minify } from 'terser';
import { setLanguage } from '@akari-video/i18n';
import { previewChatReviewScript } from '../lib/browser/preview-chat-review.js';
import { webviewScriptText } from '../lib/common/preview-text.js';
import { reviewCaptionLabelsAt, reviewElementsAt } from '../lib/common/chat-review-attachments.js';

function node() {
  const children = new Map();
  const listeners = new Map();
  const element = {
    dataset: {}, style: {}, hidden: false, value: '12', max: '30',
    classList: { toggle() {}, add() {}, remove() {} },
    append() {}, after() {}, replaceChildren() {}, setAttribute() {}, toggleAttribute() {},
    hasAttribute() { return false; }, contains() { return true; },
    addEventListener(type, listener) { listeners.set(type, listener); },
    dispatch(type, event) { return listeners.get(type)?.(event); },
    querySelector(selector) {
      if (!children.has(selector)) children.set(selector, node());
      return children.get(selector);
    },
    querySelectorAll() { return []; },
    getBoundingClientRect() { return { left: 0, top: 0, width: 100, height: 100 }; },
    focus() {}, setSelectionRange() {}, setCustomValidity() {}, reportValidity() {},
    closest() { return null; }
  };
  return element;
}

function reviewPage() {
  const stage = node();
  const transport = node();
  const seek = node();
  const caption = node();
  caption.textContent = 'Caption';
  caption.getClientRects = () => [{ left: 45, top: 45, right: 55, bottom: 55, width: 10, height: 10 }];
  caption.cloneNode = () => ({ textContent: 'Caption', querySelectorAll: () => [] });
  const plate = node();
  plate.querySelectorAll = selector => selector === '.akari-caption__line' ? [caption] : [];
  const ids = { 'preview-stage': stage, seek };
  let created = 0;
  const document = {
    getElementById(id) { return ids[id] ?? null; },
    querySelector(selector) { return selector === '.transport' ? transport : node(); },
    querySelectorAll(selector) { return selector === '#caption-plate .caption-row-plate' ? [plate] : []; },
    createElement() {
      const element = node();
      if (++created === 2) document.createdToolbar = element;
      return element;
    },
    createTreeWalker() { return { nextNode: (() => { let once = false; return () => {
      if (once) return null;
      once = true;
      return { textContent: 'Caption', parentElement: null };
    }; })() }; },
    createRange() { return { selectNodeContents() {}, getClientRects: caption.getClientRects }; }
  };
  const listeners = new Map();
  const posted = [];
  const window = {
    __akariPreview: { kind: 'output', reviewSource: 'edit.json', summary: {
      captions: [{ at: 0, duration: 30, text: 'Caption', box: { x: .4, y: .4, w: .2, h: .2 } }],
      cuts: [{ at: 0, duration: 30, sourcePath: 'clip.mp4' }]
    } },
    akari: { reviewChatPost(message) { posted.push(message); } },
    addEventListener(type, listener) { listeners.set(type, listener); }
  };
  return { document, window, stage, transport, seek, listeners, posted };
}

test('minified output review collects pen, pin and range attachments in ja and en', async () => {
  try {
    for (const language of ['ja', 'en']) {
      setLanguage(language);
      const captionLabel = language === 'ja' ? 'テロップ「Caption」' : 'Caption “Caption”';
      const videoLabel = language === 'ja' ? '映像 clip.mp4' : 'Video clip.mp4';
      assert.deepEqual(reviewCaptionLabelsAt([{ text: 'Caption', rect: {
        left: 45, top: 45, right: 55, bottom: 55
      } }], { kind: 'point', x: 50, y: 50 }), [captionLabel]);
      assert.deepEqual(reviewCaptionLabelsAt([{ text: '$&', rect: {
        left: 45, top: 45, right: 55, bottom: 55
      } }], { kind: 'point', x: 50, y: 50 }),
      [language === 'ja' ? 'テロップ「$&」' : 'Caption “$&”']);
      assert.deepEqual(reviewElementsAt({ cuts: [{ at: 0, duration: 30, sourcePath: 'clip.mp4' }] },
        12, { x: .5, y: .5 }), [videoLabel]);
      let source = previewChatReviewScript();
      // These helpers are minified in the production bundle before Function#toString.
      for (const helper of [reviewCaptionLabelsAt, reviewElementsAt]) {
        const { code: compact } = await minify(`(${helper.toString()})`, { compress: false, mangle: true });
        assert.ok(compact);
        assert.notEqual(compact, `(${helper.toString()})`);
        assert.ok(source.includes(`(${helper.toString()})`));
        source = source.replace(`(${helper.toString()})`, compact.replace(/;$/u, ''));
      }
      source = webviewScriptText(source);
      const { code } = await minify(source, { compress: false, mangle: true });
      assert.ok(code && code.length < source.length);
      for (const tool of ['pen', 'pin', 'range']) {
        const page = reviewPage();
        runInNewContext(code, {
          ...page, TextEncoder, crypto: { randomUUID: () => 'review-1' },
          getComputedStyle: () => ({ visibility: 'visible', display: 'block' }),
          NodeFilter: { SHOW_TEXT: 4 }, setInterval() {}, setTimeout() { return 1; }, clearTimeout() {}
        });
        const button = page.document.createdToolbar?.querySelector('.review-tools');
        assert.ok(button);
        button.dispatch('click', { target: { closest: selector => selector === '[data-review-tool]'
          ? { dataset: { reviewTool: tool } } : null } });
        const pointer = { target: page.stage, button: 0, pointerId: 1, clientX: 50, clientY: 50,
          preventDefault() {}, stopImmediatePropagation() {} };
        page.listeners.get('pointerdown')(pointer);
        if (tool === 'pen') page.listeners.get('pointerup')(pointer);
        const added = page.posted.find(message => message.type === 'akari-preview-chat-review-add');
        assert.equal(added?.review.tool, tool);
        assert.ok(added.review.elements.includes(captionLabel));
        assert.ok(added.review.elements.includes(videoLabel));
      }
    }
  } finally { setLanguage(undefined); }
});
