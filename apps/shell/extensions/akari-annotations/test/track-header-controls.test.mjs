import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';
import ts from 'typescript';

const require = createRequire(import.meta.url);
const { trackHeaderControls } = require('../lib/common/track-header-controls.js');
const source = ts.createSourceFile('widget.ts', readFileSync(
  new URL('../src/browser/akari-annotations-widget.ts', import.meta.url), 'utf8'
), ts.ScriptTarget.Latest, true);
const widget = source.statements.find(node => ts.isClassDeclaration(node) && node.name?.text === 'AkariAnnotationsWidget');
const methods = ['trackHeaderRow', 'trackHeaderButton', 'eyeSvg', 'speakerSvg'].map(name => {
  const method = widget.members.find(member => member.name?.getText(source) === name);
  assert.ok(method, name);
  return method.getText(source);
});
const code = ts.transpileModule(`class Handler { ${methods.join('\n')} }`, {
  compilerOptions: { target: ts.ScriptTarget.ES2021 },
}).outputText;
const document = {
  createElement: tag => ({
    tag, dataset: {}, style: {}, children: [], attributes: {}, listeners: {},
    append(...children) { this.children.push(...children); },
    appendChild(child) { this.children.push(child); },
    setAttribute(name, value) { this.attributes[name] = value; },
    addEventListener(name, action) { this.listeners[name] = action; },
  }),
};
const Handler = new Function('document', 'trackHeaderControls', `${code}\nreturn Handler;`)(document, trackHeaderControls);

for (const [kind, visibility, mute] of [
  ['video', true, true], ['overlay', true, true], ['layer', true, true],
  ['audio', false, true], ['caption', true, false], ['beat', true, false],
]) {
  test(`track controls and real row buttons: ${kind}`, () => {
    assert.deepEqual(trackHeaderControls(kind), { visibility, mute });
    const handler = new Handler();
    handler.trackKindSvg = () => '';
    for (const enabled of [true, false]) {
      const toggled = [];
      const row = handler.trackHeaderRow('Track', kind, 'lane', 10, 48, enabled,
        () => toggled.push('visibility'), enabled, () => toggled.push('mute'));
      const buttons = row.children.filter(child => child.tag === 'button');
      const expected = [...(visibility ? ['visibility'] : []), ...(mute ? ['mute'] : [])];
      assert.deepEqual(buttons.map(button => button.dataset.akariToggle), expected);
      assert.equal(buttons.some(button => button.innerHTML === handler.eyeSvg()), visibility);
      assert.equal(buttons.some(button => button.innerHTML === handler.speakerSvg()), mute);
      for (const button of buttons) {
        assert.equal(button.attributes['aria-pressed'], String(enabled));
        button.listeners.click({ stopPropagation() {} });
      }
      assert.deepEqual(toggled, expected);
    }
  });
}

test('derived audio retains its disabled mute button and resize handle', () => {
  const handler = new Handler();
  handler.trackKindSvg = () => '';
  handler.timelineTracks = [];
  handler.timelineTrackItemCount = () => 0;
  handler.trackHeightResizeHandle = () => ({ tag: 'handle' });
  const track = { id: 'derived-audio', kind: 'audio' };
  const row = handler.trackHeaderRow('Audio', 'audio', track.id, 0, 48, true, () => {}, true, () => {}, 0, track);
  const buttons = row.children.filter(child => child.tag === 'button');
  assert.equal(buttons.length, 1);
  assert.equal(buttons[0].dataset.akariToggle, 'mute');
  assert.equal(buttons[0].disabled, true);
  assert.equal(row.children.at(-1).tag, 'handle');
});
