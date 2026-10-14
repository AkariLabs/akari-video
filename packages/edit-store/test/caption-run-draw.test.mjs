import test from 'node:test';
import assert from 'node:assert/strict';
import { runInNewContext } from 'node:vm';
import { captionRenderInputFromV1, resolveCaptionRunLook,
  applyCaptionRunsToHtml, validateCaptionsSemantics, sliceCaptionRuns,
  planCaptionLookMigration, TEXTSTYLE_CATALOG } from '../lib/index.js';

const line = text => `<div><style></style><p class="akari-caption__line">${text}</p></div>`;
const plate = { color: '#ffd948', opacity: 0.8, padding_px: 8, radius_px: 3 };
const look = { scale: 1.5, stroke: { color: '#ffffff', width_px: 2 },
  shadow: { color: '#000000', distance_px: 4, blur_px: 6, opacity: 0.5 },
  background: plate };
const plateRun = (from, to, color) => ({ from, to,
  resolved_look: { plate: { ...plate, color, opacity: 1 } } });
const fragmentStyles = html => [...html.matchAll(/<span class="akari-caption__run-frag"[^>]* style="([^"]+)"/gu)]
  .map(match => match[1]);
const visibleText = html => html.replace(/<style>[\s\S]*?<\/style>/gu, '').replace(/<[^>]+>/gu, '');

test('a later surrounding plate covers each earlier inner fragment without splitting it', () => {
  const red = plateRun(6, 9, '#ff0000');
  const yellow = plateRun(3, 9, '#ffff00');
  for (const [source, text, runs, count, covered] of [
    [line('ABCDEFGHIJ'), 'ABCDEFGHIJ', [red, yellow], 2, 1],
    [line('ABCDEFGHIJ'), 'ABCDEFGHIJ', [plateRun(5, 7, '#ff0000'), yellow], 2, 1],
    [line('ABCDE') + line('FGHIJ'), 'ABCDEFGHIJ', [red, yellow], 3, 1],
    [line('ABCDE') + line('FGHIJ'), 'ABCDEFGHIJ',
      [plateRun(3, 8, '#ff0000'), plateRun(1, 9, '#ffff00')], 4, 2],
  ]) {
    const html = applyCaptionRunsToHtml(source, text, runs);
    const styles = fragmentStyles(html);
    assert.equal(styles.length, count);
    assert.equal(styles.filter(style => style.includes('background-image:linear-gradient(rgba(255,255,0,1),rgba(255,255,0,1))')).length,
      covered);
    assert.ok(styles.some(style => style.includes('background:rgba(255,0,0,1);background-image:linear-gradient(')));
    assert.equal(visibleText(html), text);
  }
  const triple = applyCaptionRunsToHtml(line('ABCDEFGHIJ'), 'ABCDEFGHIJ', [
    red, yellow, plateRun(2, 10, '#0000ff')]);
  assert.match(fragmentStyles(triple).find(style => style.includes('background:rgba(255,0,0,1)')),
    /background-image:linear-gradient\(rgba\(0,0,255,1\),rgba\(0,0,255,1\)\),linear-gradient\(rgba\(255,255,0,1\),rgba\(255,255,0,1\)\)/u);
});

test('inner later, equal, crossing and shadow-only runs add no covering image', () => {
  const cases = [
    [plateRun(3, 9, '#ff0000'), plateRun(6, 9, '#ffff00')],
    [plateRun(3, 9, '#ff0000'), plateRun(3, 9, '#ffff00')],
    [plateRun(3, 7, '#ff0000'), plateRun(5, 9, '#ffff00')],
    [plateRun(6, 9, '#ff0000'), { from: 3, to: 9, resolved_look: { text_shadow: 'none' } }],
    [plateRun(6, 9, '#ff0000'), plateRun(-1, 10, '#ffff00')],
  ];
  for (const runs of cases) {
    const html = applyCaptionRunsToHtml(line('ABCDEFGHIJ'), 'ABCDEFGHIJ', runs);
    assert.ok(fragmentStyles(html).length >= 2);
    assert.ok(fragmentStyles(html).every(style => !style.includes('background-image:')));
    assert.equal(visibleText(html), 'ABCDEFGHIJ');
  }
});

test('nested and crossing fragments stay in their outer context on gradient and layered lines', () => {
  const source = line('ABCDEFGHIJ');
  for (const mode of ['gradient', 'layers']) {
    const render = runs => applyCaptionRunsToHtml(source, 'ABCDEFGHIJ', mode === 'gradient'
      ? runs.map(run => ({ ...run, resolved_look: { ...run.resolved_look,
        gradient: 'linear-gradient(90deg, #ffffff, #000000)' } })) : runs,
    false, mode === 'layers');
    for (const ranges of [
      [[3, 9], [5, 7]], [[5, 7], [3, 9]], [[3, 7], [5, 9]], [[3, 9], [3, 9]],
    ]) {
      const html = render(ranges.map(([from, to], index) => plateRun(from, to,
        index ? '#ffff00' : '#ff0000')));
      const styles = fragmentStyles(html);
      assert.ok(styles.length >= 2);
      assert.match(styles[0], /position:relative;z-index:-(?:1000000|999999)/u);
      assert.ok(styles.slice(1).some(style => !style.includes('z-index:')));
      if (ranges[0][0] > ranges[1][0]) assert.ok(styles.some(style =>
        style.includes('background:rgba(255,0,0,1);background-image:linear-gradient(rgba(255,255,0,1),rgba(255,255,0,1))')));
      assert.equal(visibleText(html), 'ABCDEFGHIJ');
    }
    const separate = render([plateRun(0, 2, '#ff0000'), plateRun(5, 7, '#ffff00')]);
    assert.deepEqual(fragmentStyles(separate), [
      'display:inline;position:relative;z-index:-1000000;line-height:1;background:rgba(255,0,0,1);border-radius:3px;padding:8px;margin:-8px;-webkit-box-decoration-break:clone;box-decoration-break:clone;pointer-events:none',
      'display:inline;position:relative;z-index:-999999;line-height:1;background:rgba(255,255,0,1);border-radius:3px;padding:8px;margin:-8px;-webkit-box-decoration-break:clone;box-decoration-break:clone;pointer-events:none',
    ]);
  }
});

test('run px values use the line reference height and run scale exactly once', () => {
  for (const [reference, expected] of [[1080, 1.5], [1920, 0.84375]]) {
    const resolved = resolveCaptionRunLook(look, { reference_height_px: reference },
      { width: 1920, height: 1080 });
    assert.equal(resolved.style.stroke.width_px, 2 * expected);
    assert.equal(resolved.resolved_look.plate.padding_px, 8 * expected);
    assert.match(resolved.resolved_look.text_shadow,
      new RegExp(`${Number((6 * expected).toFixed(6))}px rgba\\(0,0,0,0.5\\)`));
  }
  const layout = { mode: 'reference-pixel', reference_width_px: 1920,
    reference_height_px: 1080, left_px: 0, width_px: 1920, bottom_px: 0,
    text_align: 'center', max_lines: 1 };
  assert.equal(resolveCaptionRunLook(look, { layout }, { width: 3840, height: 2160 })
    .resolved_look.plate.padding_px, 24);
});

test('document errors are removed before rendering, and resolved values survive slicing', () => {
  const row = { id: 'c', text: 'ABCDE', runs: [
    { id: 'good', from: 0, to: 3, look: { background: plate } },
    { id: 'outside', from: 4, to: 8, look: { background: plate } },
    { id: 'duplicate', from: 1, to: 2, look: { background: plate } },
    { id: 'duplicate', from: 2, to: 3, look: { background: plate } },
    { id: 'spoken', from: 3, to: 4, fire: 'spoken', look: { background: plate } }
  ] };
  const [resolved] = captionRenderInputFromV1({ captions: [row] }).captions;
  assert.deepEqual(resolved.runs.map(run => run.id), ['good']);
  const sliced = sliceCaptionRuns(row.text, resolved.runs, 1, 3);
  assert.deepEqual(sliced[0].resolved_look, resolved.runs[0].resolved_look);
});

test('one plate is drawn per line fragment and the injected renderer is self-contained', () => {
  const runs = captionRenderInputFromV1({ captions: [{ text: 'ABCD', runs: [
    { id: 'one', from: 1, to: 3, look: { background: plate,
      shadow: { color: '#000000', distance_px: 2 } } }
  ] }] }).captions[0].runs;
  const html = applyCaptionRunsToHtml(line('ABCD'), 'ABCD', runs);
  assert.equal((html.match(/data-akari-plate="true"/g) ?? []).length, 1);
  assert.equal((html.match(/class="akari-caption__run-frag"/g) ?? []).length, 1);
  assert.match(html, /class="akari-caption__run"[^>]*data-akari-shadow-text="B"/);
  assert.match(html, /class="akari-caption__run-ink" style="position:relative">B/);
  assert.doesNotMatch(html, /akari-caption__run-plate|aria-hidden="true"/);
  assert.equal(html.replace(/<style>[\s\S]*?<\/style>/g, '').replace(/<[^>]+>/g, ''), 'ABCD');
  const isolated = runInNewContext(`(${applyCaptionRunsToHtml.toString()})`);
  assert.equal(isolated(line('ABCD'), 'ABCD', runs), html);
  const twoLines = line('AB') + line('CD');
  assert.equal((applyCaptionRunsToHtml(twoLines, 'ABCD', runs)
    .match(/data-akari-plate="true"/g) ?? []).length, 2);
});

test('nested plates retain run order, and whole karaoke token has one plate', () => {
  for (const ranges of [[[0, 4], [1, 3]], [[1, 3], [0, 4]],
    [[0, 3], [0, 4]], [[1, 4], [0, 4]]]) {
    const runs = ranges.map(([from, to], index) => ({ from, to,
      style: { color: '#ffffff' }, resolved_look: { plate: { ...plate,
        color: index === 0 ? '#ff0000' : '#0000ff' } }, id: `r${index}` }));
    const html = applyCaptionRunsToHtml(line('ABCD'), 'ABCD', runs);
    assert.equal((html.match(/data-akari-plate="true"/g) ?? []).length, 2);
    assert.doesNotMatch(html, /z-index:/);
    const first = html.indexOf('class="akari-caption__run-frag"');
    const second = html.indexOf('class="akari-caption__run-frag"', first + 1);
    assert.ok(first >= 0 && second > first);
    const firstIsOuter = ranges[0][0] <= ranges[1][0] && ranges[0][1] >= ranges[1][1];
    assert.ok(html.slice(first, second).includes(firstIsOuter
      ? 'background:rgba(255,0,0' : 'background:rgba(0,0,255'));
  }
  const forward = applyCaptionRunsToHtml(line('ABCDE'), 'ABCDE', [
    { from: 0, to: 3, style: { color: '#fff' }, resolved_look: { plate: { ...plate, color: '#ff0000' } } },
    { from: 2, to: 5, style: { color: '#fff' }, resolved_look: { plate: { ...plate, color: '#0000ff' } } }
  ]);
  const reverse = applyCaptionRunsToHtml(line('ABCDE'), 'ABCDE', [
    { from: 2, to: 5, style: { color: '#fff' }, resolved_look: { plate: { ...plate, color: '#0000ff' } } },
    { from: 0, to: 3, style: { color: '#fff' }, resolved_look: { plate: { ...plate, color: '#ff0000' } } }
  ]);
  assert.notEqual(forward, reverse);
  const beforeC = html => html.slice(0, html.indexOf('>C</span>'));
  assert.ok(beforeC(forward).lastIndexOf('background:rgba(0,0,255')
    > beforeC(forward).lastIndexOf('background:rgba(255,0,0'));
  assert.ok(beforeC(reverse).lastIndexOf('background:rgba(255,0,0')
    > beforeC(reverse).lastIndexOf('background:rgba(0,0,255'));
  const runs = [{ from: 1, to: 3, style: { color: '#ffffff' },
    resolved_look: { plate } }];
  const html = applyCaptionRunsToHtml(line('A<span class="akari-caption__tok">BC</span>D'), 'ABCD', runs);
  assert.equal((html.match(/data-akari-plate="true"/g) ?? []).length, 1);
  const crossing = applyCaptionRunsToHtml(line('ABCDE'), 'ABCDE', [
    { from: 0, to: 3, style: { color: '#fff' }, resolved_look: { plate } },
    { from: 2, to: 5, style: { color: '#fff' }, resolved_look: { plate } }
  ]);
  assert.match(crossing, /data-akari-plate-split="true"/);
  assert.equal((crossing.match(/data-akari-plate="true"/g) ?? []).length, 3);
});

test('migration leaves unscaled legacy stroke runs alone and never creates style plus look', () => {
  const original = { default_text_style: { reference_height_px: 1080 }, captions: [
    { id: 'a', text: 'AB', runs: [
      { from: 0, to: 1, style: { stroke: { width_px: 2, color: '#ffffff' } } },
      { from: 1, to: 2, style: { color: '#ff0000' } }
    ] }
  ] };
  const result = planCaptionLookMigration(original, TEXTSTYLE_CATALOG);
  const [legacy, migrated] = result.next.captions[0].runs;
  assert.equal(legacy.style.stroke.width_px, 2);
  assert.equal(legacy.look, undefined);
  assert.equal(migrated.style, undefined);
  assert.equal(migrated.look.color, '#ff0000');
  assert.equal(result.notices.filter(item => item.includes('自動で移せません')).length, 1);
});

test('run shadow inherits line extras and keeps the stroke width', () => {
  const style = { stroke: { color: '#ffffff', width_px: 2 },
    stroke_inner: { color: '#ff0000', width_px: 1 },
    extrude: { color: '#000000', angle_deg: 0, depth_px: 2 },
    shadow: { color: '#000000', distance_px: 3 } };
  const inherited = resolveCaptionRunLook({ glow: {} }, style);
  const explicit = resolveCaptionRunLook({ shadow: { ...style.shadow }, glow: {} }, style);
  assert.equal(inherited.resolved_look.text_shadow, explicit.resolved_look.text_shadow);
  assert.match(inherited.resolved_look.text_shadow, /#ff0000/u);
  const html = applyCaptionRunsToHtml(line('AB'), 'AB', [{ from: 0, to: 2,
    ...inherited }]);
  assert.match(html, /-webkit-text-stroke-color:transparent/u);
  assert.match(html, /data-akari-shadow-text="A"/u);
});

test('GPU path diagnoses word tiles with rich runs and split plates', () => {
  const row = { text: 'ABCD', style: 'reveal',
    words: [{ text: 'AB' }, { text: 'CD' }], runs: [
      { from: 1, to: 3, look: { background: plate } }
    ] };
  const diagnostics = validateCaptionsSemantics({ captions: { captions: [row] }, path: 'gpu' });
  assert.ok(diagnostics.some(item => item.code === 'captions.style.unsupported-path'));
  assert.ok(diagnostics.some(item => item.code === 'captions.run.plate-split'));
});

test('GPU path diagnoses typewriter run effects after look resolution', () => {
  const row = { text: 'AB', text_style: { animation: { in: { id: 'typewriter' } } },
    runs: [{ from: 0, to: 1, resolved_look: { plate } }] };
  const diagnostics = validateCaptionsSemantics({ captions: { captions: [row] }, path: 'gpu' });
  assert.equal(diagnostics.filter(item => item.code === 'captions.style.unsupported-path').length, 1);
});

test('GPU path ignores explicit zero run effects and keeps active effects', () => {
  const zero = { color: '#ff3355', stroke: { width_px: 0 },
    shadow: { color: '#000000', opacity: 0 }, glow: { color: '#000000', density: 0 } };
  for (const key of ['stroke', 'shadow', 'glow']) {
    const resolved = resolveCaptionRunLook({ [key]: zero[key] }, {});
    assert.equal(resolved.resolved_look?.outside_effect ?? false, false);
  }
  const cases = [
    { style: 'karaoke', words: [{ text: 'AB' }], look: zero, unsupported: false },
    { style: 'karaoke', words: [{ text: 'AB' }],
      look: { ...zero, background: { color: '#ffffff', opacity: 0 } }, unsupported: false },
    { style: 'karaoke', words: [{ text: 'AB' }],
      look: { ...zero, background: { color: '#ffffff' } }, unsupported: true },
    { text_style: { animation: { in: { id: 'typewriter' } } }, look: zero, unsupported: false },
    { text_style: { animation: { in: { id: 'typewriter' } } },
      look: { ...zero, shadow: { color: '#000000', opacity: 0.9 } }, unsupported: true },
  ];
  for (const item of cases) {
    const resolved = resolveCaptionRunLook(item.look, {});
    assert.equal(resolved.resolved_look?.outside_effect, item.unsupported);
    const row = { text: 'AB', style: item.style, words: item.words, text_style: item.text_style,
      runs: [{ id: 'r-0001', from: 0, to: 2, look: item.look, ...resolved }] };
    const diagnostics = validateCaptionsSemantics({ captions: { captions: [row] }, path: 'gpu' });
    assert.equal(diagnostics.some(entry => entry.code === 'captions.style.unsupported-path'),
      item.unsupported);
  }
});

test('wrapped zero-effect fragments keep rotation warning without a GPU path error', () => {
  const look = { rotate_deg: 8, stroke: { width_px: 0 },
    shadow: { color: '#000000', opacity: 0 }, glow: { color: '#000000', density: 0 } };
  const resolved = resolveCaptionRunLook(look, {});
  assert.equal(resolved.resolved_look?.outside_effect, false);
  const row = { text: 'AB', style: 'karaoke', words: [{ text: 'AB' }],
    text_style: { wrap_width_pct: 30 }, runs: [{ from: 0, to: 2, look, ...resolved }] };
  const diagnostics = validateCaptionsSemantics({ captions: { captions: [row] }, path: 'gpu' });
  assert.equal(diagnostics.filter(item => item.code === 'captions.run.rotation-wrap'
    && item.severity === 'warning').length, 1);
  assert.equal(diagnostics.filter(item => item.code === 'captions.style.unsupported-path').length, 0);
});

test('GPU path diagnoses emphasis word tiles on the same source and time', () => {
  const caption = { text: 'AB', src: 'main', start: 1, end: 2,
    words: [{ text: 'AB', start: 1, end: 2 }],
    runs: [{ from: 0, to: 2, look: { background: plate } }] };
  const emphasis = { id: 'e-0001', word: 'AB', emotion: 'emphasis',
    src: 'main', t_start: 1.2, t_end: 1.8 };
  const diagnose = item => validateCaptionsSemantics({ captions: { captions: [caption],
    emphasis_words: [item] }, path: 'gpu' }).filter(entry => entry.code === 'captions.style.unsupported-path');
  assert.equal(diagnose(emphasis).length, 1);
  assert.equal(diagnose({ ...emphasis, src: 'other' }).length, 0);
  assert.equal(diagnose({ ...emphasis, t_start: 3, t_end: 4 }).length, 0);
});

test('decorated lines leave v0 untouched and draw only v1 color and effects', () => {
  for (const decoration of ['underline', 'strikethrough']) for (const policy of [false, true]) {
    const source = line('今日は黄色のラベルを試します')
      .replace('class="akari-caption__line"', 'class="akari-caption__line" data-decoration-text="今日は黄色のラベルを試します"')
      .replace('<div>', `<div class="${policy ? 'akari-caption--single-line' : 'akari-caption'}">`);
    const from = 6; const to = 9;
    const shaped = [{ from, to, style: { scale: 1.5, color: '#ff3355', rotate_deg: 8,
      baseline_shift_em: -.2, font_weight: 800, italic: true, letter_spacing_em: .2 } }];
    const color = [{ from, to, style: { color: '#ff3355' } }];
    assert.equal(applyCaptionRunsToHtml(source, '今日は黄色のラベルを試します', shaped), source);
    assert.equal(applyCaptionRunsToHtml(source, '今日は黄色のラベルを試します', color), source);
    const warnings = validateCaptionsSemantics({ captions: { captions: [{ text: '今日は黄色のラベルを試します',
      text_style: { [decoration]: true }, runs: shaped }] } });
    assert.equal(warnings.filter(item => item.code === 'captions.run.decoration-shape').length, 0);
    assert.match(applyCaptionRunsToHtml(source, '今日は黄色のラベルを試します',
      [{ from, to, look: { color: '#ff3355' }, resolved_look: { plate }, style: { color: '#ff3355' } }]), /data-akari-plate="true"/);
    const v1 = [{ from, to, look: shaped[0].style, style: shaped[0].style }];
    assert.equal(validateCaptionsSemantics({ captions: { captions: [{ text: '今日は黄色のラベルを試します',
      text_style: { [decoration]: true }, runs: v1 }] } }).filter(item =>
      item.code === 'captions.run.decoration-shape').length, 1);
    assert.match(applyCaptionRunsToHtml(line('今日は黄色のラベルを試します'),
      '今日は黄色のラベルを試します', shaped), /font-size:1\.5em/);
  }
});

test('decorated lines keep whitespace outside v1 character spans and ignore mixed v0 runs', () => {
  const text = '今日は黄色の\nラベルを試します';
  const source = line(text).replace('class="akari-caption__line"',
    'class="akari-caption__line" data-decoration-text="今日は黄色の&#10;ラベルを試します"');
  const v0 = { from: 4, to: 9, style: { color: '#ff0000', scale: 1.4 } };
  const v1 = { from: 4, to: 10, look: { color: '#ffd948' }, style: { color: '#ffd948' } };
  assert.equal(applyCaptionRunsToHtml(source, text, [v0]), source);
  const html = applyCaptionRunsToHtml(source, text, [v0, v1]);
  assert.doesNotMatch(html, /color:#ff0000/u);
  assert.match(html, /color:#ffd948/u);
  assert.doesNotMatch(html, /class="akari-caption__run"[^>]*>\s+<\/span>/u);
  assert.equal(visibleText(html), text);
});

test('v0 ranges keep legacy markup across a display policy line break and preserve spaces', () => {
  const styled = character => `<span class="akari-caption__run" style="display:inline-block;vertical-align:baseline;line-height:1;color:#ff3355">${character}</span>`;
  for (const newline of ['\n', '\r\n']) {
    const text = `今日は黄色の${newline}ラベルを試します`;
    const expected = line(`<span class="akari-caption__tok">今日は黄${styled('色')}${styled('の')}${styled(newline)}${styled('ラ')}${styled('ベ')}ルを試します</span>`);
    assert.equal(applyCaptionRunsToHtml(line(text), text,
      [{ from: 4, to: 9, style: { color: '#ff3355' } }]), expected);
  }

  const english = applyCaptionRunsToHtml(line('A B\tC'), 'A B\tC',
    [{ from: 1, to: 4, style: { color: '#ff3355' } }]);
  assert.match(english, /class="akari-caption__run"[^>]*white-space:pre[^>]*> <\/span>/u);
  assert.match(english, /class="akari-caption__run"[^>]*white-space:pre[^>]*>\t<\/span>/u);
});

test('v1 plate spans both sides of a display policy line break without wrapping the newline', () => {
  for (const newline of ['\n', '\r\n']) {
    const text = `今日は黄色の${newline}ラベルを試します`;
    const html = applyCaptionRunsToHtml(line(text), text, [{ from: 3, to: 10,
      look: { background: plate, color: '#ffd948' }, style: { color: '#ffd948' },
      resolved_look: { plate } }]);
    const fragment = html.match(/data-akari-plate="true"[^>]*>([\s\S]*?)<span class="akari-caption__run-lift"[^>]*>を/u)?.[1];
    assert.ok(fragment);
    assert.equal(visibleText(fragment), `黄色の${newline}ラベル`);
    assert.equal((html.match(/data-akari-plate="true"/gu) ?? []).length, 1);
    assert.doesNotMatch(html, /class="akari-caption__run"[^>]*>\r?\n<\/span>/u);
    assert.equal(visibleText(html), text);
  }
});

test('manual line breaks advance v1 fragments while leaving v0-only HTML intact', () => {
  const text = '今日は黄色の\nラベルを試します';
  const source = line('今日は黄色の') + line('ラベルを試します');
  const v1 = captionRenderInputFromV1({ captions: [{ text, runs: [{ id: 'r-0001',
    from: 7, to: 10, look: { background: plate, color: '#ffd948',
      stroke: { width_px: 0 }, shadow: { color: '#000000', opacity: 0 },
      glow: { color: '#000000', density: 0 } } }] }] }).captions[0].runs[0];
  const html = applyCaptionRunsToHtml(source, text, [v1]);
  const fragment = html.match(/data-akari-plate="true"[^>]*>([\s\S]*?)<span class="akari-caption__run-lift"/u)?.[1];
  assert.ok(fragment);
  assert.deepEqual([...fragment.matchAll(/data-akari-shadow-text="([^"]+)"/gu)].map(match => match[1]),
    ['ラ', 'ベ', 'ル']);
  assert.equal((fragment.match(/color:#ffd948/gu) ?? []).length, 3);
  assert.equal((html.match(/data-akari-plate="true"/gu) ?? []).length, 1);
  assert.equal(visibleText(html), text.replace('\n', ''));
  const old = { from: 7, to: 10, style: { color: '#ff3355' } };
  assert.equal(applyCaptionRunsToHtml(source, text, [old]),
    source.replace('今日は黄色の</p>', '<span class="akari-caption__tok">今日は黄色の</span></p>')
      .replace('ラベルを試します</p>', '<span class="akari-caption__tok">ラベルを試します</span></p>'));
  const mixed = applyCaptionRunsToHtml(source, text, [old, v1]);
  assert.doesNotMatch(mixed, /color:#ff3355/u);
  assert.match(mixed, /color:#ffd948/u);
  for (const [three, range, count] of [
    ['甲乙\n丙丁\n戊己', [6, 8], 1],
    ['甲乙\n丙丁\n戊己', [4, 7], 2],
  ]) {
    const lines = three.split('\n').map(line).join('');
    const fragments = applyCaptionRunsToHtml(lines, three,
      [{ ...v1, from: range[0], to: range[1] }]);
    assert.equal((fragments.match(/data-akari-plate="true"/gu) ?? []).length, count);
    assert.equal(visibleText(fragments), three.replaceAll('\n', ''));
  }
});

test('layer crossings omit the later plate and warn once', () => {
  const make = (from, to, color) => ({ from, to, look: { background: { ...plate, color },
    color }, style: { color }, resolved_look: { plate: { ...plate, color } } });
  const source = line('ABCDEFG');
  const first = make(1, 4, '#ff0000');
  const later = make(3, 6, '#0000ff');
  const crossing = applyCaptionRunsToHtml(source, 'ABCDEFG', [first, later], false, true);
  assert.equal((crossing.match(/data-akari-plate="true"/gu) ?? []).length, 1);
  assert.match(crossing, /color:#0000ff/u);
  assert.doesNotMatch(crossing, /background:rgba\(0,0,255/u);
  assert.equal(validateCaptionsSemantics({ captions: { captions: [{ text: 'ABCDEFG',
    text_style: { fill: { type: 'solid', color: '#ffffff' }, strokes: [] },
    runs: [first, later] }] } }).filter(item => item.code === 'captions.run.layer-crossing').length, 1);
  const nested = applyCaptionRunsToHtml(source, 'ABCDEFG', [first, make(2, 3, '#0000ff')], false, true);
  assert.equal((nested.match(/data-akari-plate="true"/gu) ?? []).length, 2);
});

test('gradient with line effects drops run replacements before drawing', () => {
  const lineStyle = { fill_gradient: { colors: ['#ffee00', '#ff2200'], angle_deg: 90 },
    stroke: { color: '#000000', width_px: 4 } };
  const full = resolveCaptionRunLook({ color: '#ff3355', background: plate,
    glow: { color: '#00e5ff', density: 80 } }, lineStyle);
  const plain = resolveCaptionRunLook({ color: '#ff3355' }, lineStyle);
  assert.equal(full.resolved_look, undefined);
  assert.deepEqual(full.style.color, plain.style.color);
  const source = line('AB');
  assert.equal(applyCaptionRunsToHtml(source, 'AB', [{ from: 0, to: 1, ...full }]),
    applyCaptionRunsToHtml(source, 'AB', [{ from: 0, to: 1, ...plain }]));
  assert.ok(resolveCaptionRunLook({ background: plate }, { fill_gradient: lineStyle.fill_gradient }).resolved_look?.plate);
});

test('flow drawing lifts plain text in every line without a run z index', () => {
  const html = applyCaptionRunsToHtml(line('AB') + line('CD'), 'ABCD', [{
    from: 2, to: 3, style: { color: '#ffffff' }, resolved_look: { plate },
  }]);
  assert.doesNotMatch(html, /z-index:/u);
  assert.match(html, /class="akari-caption__run-lift" style="position:relative">AB<\/span>/u);
  assert.match(html, /class="akari-caption__run-lift" style="position:relative">D<\/span>/u);
  assert.match(html, /data-akari-run-flow="true"/u);
  assert.equal(html.replace(/<style>[\s\S]*?<\/style>/gu, '').replace(/<[^>]+>/gu, ''), 'ABCD');
});

test('all token boundaries preserve nesting and visible text', () => {
  const text = 'ABCDEFGHIJ';
  const tokens = [text, 'ABC|DEFG|HIJ', 'AB|CD|EF|GH|IJ'];
  for (const value of tokens) {
    const source = value.split('|').map(word => `<span class="akari-caption__tok">${word}</span>`).join('');
    for (let from = 0; from < text.length; from++) for (let to = from + 1; to <= text.length; to++) {
      const html = applyCaptionRunsToHtml(line(source), text,
        [{ from, to, style: { color: '#ffffff' }, resolved_look: { plate } }]);
      const stack = [];
      for (const match of html.matchAll(/<\/?(?:div|p|span|style)\b[^>]*>/g)) {
        const tag = /^<\/?([a-z]+)/.exec(match[0])[1];
        if (match[0].startsWith('</')) assert.equal(stack.pop(), tag, `${value}: ${from}-${to}`);
        else stack.push(tag);
      }
      assert.deepEqual(stack, [], `${value}: ${from}-${to}`);
      assert.equal(html.replace(/<style>[\s\S]*?<\/style>/g, '').replace(/<[^>]+>/g, ''), text);
      const boundaries = [0];
      for (const word of value.split('|')) boundaries.push(boundaries[boundaries.length - 1] + word.length);
      const oneToken = boundaries.some((start, i) => i + 1 < boundaries.length
        && start <= from && to <= boundaries[i + 1]);
      const wholeTokens = boundaries.includes(from) && boundaries.includes(to);
      if (oneToken || wholeTokens) assert.equal((html.match(/data-akari-plate="true"/g) ?? []).length, 1,
        `${value}: ${from}-${to}`);
    }
  }
});

test('overlapping runs keep valid nesting at shared and crossing edges', () => {
  const text = 'ABCDEF';
  for (const words of ['ABCDEF', 'AB|CD|EF', 'ABC|DEF']) {
    const source = words.split('|').map(word => `<span class="akari-caption__tok">${word}</span>`).join('');
    for (let a = 0; a < 6; a++) for (let b = a + 1; b <= 6; b++)
      for (let c = 0; c < 6; c++) for (let d = c + 1; d <= 6; d++) {
        const html = applyCaptionRunsToHtml(line(source), text, [[a, b], [c, d]].map(([from, to]) =>
          ({ from, to, style: { color: '#ffffff' }, resolved_look: { plate } })));
        const stack = [];
        for (const match of html.matchAll(/<\/?(?:div|p|span|style)\b[^>]*>/g)) {
          const tag = /^<\/?([a-z]+)/.exec(match[0])[1];
          if (match[0].startsWith('</')) assert.equal(stack.pop(), tag, `${words} ${a}-${b},${c}-${d}`);
          else stack.push(tag);
        }
        assert.deepEqual(stack, [], `${words} ${a}-${b},${c}-${d}`);
        assert.equal(html.replace(/<style>[\s\S]*?<\/style>/g, '').replace(/<[^>]+>/g, ''), text);
      }
  }
});

test('GPU char wrappers stay outside run decoration with every range', () => {
  const text = 'ABCDEF';
  const wrap = part => [...part].map(char => `<span class="akari-caption__char">${char}</span>`).join('');
  for (const source of [wrap(text), ['AB', 'CD', 'EF'].map(word =>
    `<span class="akari-caption__tok">${wrap(word)}</span>`).join('')]) {
    for (let from = 0; from < 6; from++) for (let to = from + 1; to <= 6; to++) {
      const html = applyCaptionRunsToHtml(line(source), text,
        [{ from, to, style: { color: '#ffffff' }, resolved_look: { plate } }]);
      const stack = [];
      for (const match of html.matchAll(/<\/?(?:div|p|span|style)\b[^>]*>/g)) {
        const tag = /^<\/?([a-z]+)/.exec(match[0])[1];
        if (match[0].startsWith('</')) assert.equal(stack.pop(), tag);
        else stack.push(tag);
      }
      assert.deepEqual(stack, []);
      assert.equal(html.replace(/<style>[\s\S]*?<\/style>/g, '').replace(/<[^>]+>/g, ''), text);
      assert.doesNotMatch(html, /akari-caption__char[^>]*>\s*<span class="akari-caption__run-frag"/u);
    }
  }
});

test('nine-field look and v0 style keep identical HTML, including scale and rotation', () => {
  const style = { color: '#ff0000', font_weight: 700, italic: true, underline: true,
    letter_spacing_em: 0.05, scale: 1.5, baseline_shift_em: -0.1, rotate_deg: 8,
    stroke: { color: '#ffffff', width_px: 3 } };
  const old = applyCaptionRunsToHtml(line('AB'), 'AB', [{ from: 0, to: 2, style }]);
  const look = { ...style, stroke: { ...style.stroke, width_px: 2 } };
  const runs = captionRenderInputFromV1({ captions: [{ text: 'AB', runs: [
    { id: 'r-0001', from: 0, to: 2, look }
  ] }] }).captions[0].runs;
  assert.equal(applyCaptionRunsToHtml(line('AB'), 'AB', runs), old);
});

test('unused run background geometry produces one warning', () => {
  const diagnostics = validateCaptionsSemantics({ captions: { captions: [{ text: 'A', runs: [
    { id: 'r', from: 0, to: 1, look: { background: { color: '#fff', width_pct: 20,
      height_pct: 30, fit: 'frame', offset_x: 3, offset_y: 4, mode: 'block' } } }
  ] }] } });
  assert.equal(diagnostics.filter(item => item.code === 'captions.run.background-unused').length, 1);
});
