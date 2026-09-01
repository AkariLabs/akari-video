#!/usr/bin/env node
const { createHash } = require('node:crypto');
const { execFileSync } = require('node:child_process');
const { existsSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } = require('node:fs');
const { tmpdir } = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

// Theia frontend modules touch a few DOM globals while loading, although prepareHtml itself is pure.
// A callable deep stub is enough to load the class without introducing a browser implementation.
let domStub;
domStub = new Proxy(function () { return domStub; }, {
  get: (_target, property) => property === Symbol.toPrimitive ? () => '' : domStub,
  set: () => true,
  construct: () => domStub
});
globalThis.document = domStub;
globalThis.window = globalThis;
globalThis.location = { href: 'http://localhost/' };
globalThis.localStorage = domStub;
globalThis.matchMedia = domStub;
globalThis.addEventListener = domStub;
globalThis.navigator = { platform: '', userAgent: '' };
globalThis.Element = class {};
globalThis.HTMLElement = globalThis.Element;
globalThis.Node = class {};
globalThis.Event = class {};
globalThis.DragEvent = globalThis.Event;
globalThis.MouseEvent = globalThis.Event;
globalThis.KeyboardEvent = globalThis.Event;
globalThis.CustomEvent = globalThis.Event;
globalThis.UIEvent = globalThis.Event;
globalThis.FocusEvent = globalThis.Event;
globalThis.PointerEvent = globalThis.Event;
globalThis.InputEvent = globalThis.Event;

const [baseRoot, outputPath] = process.argv.slice(2);
if (!baseRoot || !outputPath) throw new Error('usage: compare-html-sha.cjs <base-root> <output-json>');

const repositoryRoot = path.resolve(__dirname, '../../../../../..');
const shellModules = path.join(repositoryRoot, 'apps/shell/node_modules');
const baseShellModules = path.join(path.resolve(baseRoot), 'apps/shell/node_modules');
if (!existsSync(baseShellModules)) symlinkSync(shellModules, baseShellModules, 'dir');
process.env.NODE_PATH = shellModules;
require('node:module').Module._initPaths();
const scratch = mkdtempSync(path.join(tmpdir(), 'akari-item-keyframes-html-'));
const bundle = (entry, name) => {
  const output = path.join(scratch, `${name}.cjs`);
  execFileSync(path.join(shellModules, '.bin/esbuild'), [
    entry, '--bundle', '--platform=node', '--format=cjs', '--loader:.css=empty',
    '--external:jsonc-parser', `--outfile=${output}`
  ]);
  // Browser bootstrap normally sets this before frontend modules load. The pure prepareHtml probe
  // has no bootstrap, so make archived/current bundles use the same inert fallback.
  const source = readFileSync(output, 'utf8').replace(
    'throw new Error("The configuration is not set. Did you call FrontendApplicationConfigProvider#set?");',
    'return { applicationName: "AKARI Video" };'
  );
  writeFileSync(output, source);
  return require(output);
};
const loadRuntime = (root, name) => ({
  Handler: bundle(path.join(
    root, 'apps/shell/extensions/akari-preview/src/browser/akari-preview-open-handler.ts'
  ), `${name}-handler`).AkariPreviewOpenHandler,
  readPreviewInternalEdit: bundle(path.join(
    root, 'apps/shell/extensions/akari-preview/src/common/preview-items.ts'
  ), `${name}-items`).readPreviewInternalEdit,
  expandBagOverlays: bundle(path.join(
    root, 'apps/shell/extensions/akari-preview/src/common/preview-parts.ts'
  ), `${name}-parts`).expandBagOverlays,
  migrateEditToV2: bundle(path.join(
    root, 'packages/edit-store/src/migrate/index.ts'
  ), `${name}-migrate`).migrateEditToV2
});
const current = loadRuntime(repositoryRoot, 'current');
const base = loadRuntime(path.resolve(baseRoot), 'base');

const assets = {
  threeJavaScript: '', threeTextJavaScript: '', threeRuntimeJavaScript: '', videoFxJavaScript: '',
  runtimeJavaScript: '/* keyframes injection excluded */', interactionJavaScript: '', interactionCss: '',
  webviewKernelJavaScript: '', captionFontDataUri: 'data:font/woff2;base64,AA=='
};
const syntheticCases = [
  { name: 'empty', output: { width: 1920, height: 1080, fps: 30 }, overlays: [] },
  { name: 'inline-html-static', output: { width: 1920, height: 1080, fps: 30 },
    overlays: [{ id: 'title', html: '<div>Title</div>', start: 0, duration: 2,
      track: 0, trackId: 'v1', transform: { x: 20, y: 5, scale: 1, rotate: 0 }, vars: {}, params: {} }] },
  { name: 'bag-child-static', output: { width: 1920, height: 1080, fps: 30 },
    overlays: [{ id: 'card.B', html: '<div data-akari-part="B">B</div>', start: 1,
      duration: 3, track: 1, trackId: 'v2', transform: {}, vars: { '--tone': 'blue' }, params: {},
      part: 'B', parentId: 'card' }] }
];
// 内部リポ（akari-video-internal）の fieldtest ディレクトリ。公開リポにローカル配置を書かず環境変数で受ける。
const fieldtestRoot = process.env.AKARI_FIELDTEST_ROOT ?? '<internal>/fieldtest';
const fieldtestNames = [
  '2026-08-03-akari-video-pv',
  '2026-08-05-telop-html-board',
  '2026-08-11-tomosu-pv-remake'
];
const hasKeyframes = value => {
  if (Array.isArray(value)) return value.some(hasKeyframes);
  if (!value || typeof value !== 'object') return false;
  return Object.hasOwn(value, 'keyframes') || Object.values(value).some(hasKeyframes);
};
const projectFieldtest = (runtime, projectDir) => {
  const source = readFileSync(path.join(projectDir, 'edit.json'), 'utf8');
  const raw = JSON.parse(source);
  if (hasKeyframes(raw)) throw new Error(`fieldtest unexpectedly contains keyframes: ${projectDir}`);
  const hasCaptions = existsSync(path.join(projectDir, 'captions.json'));
  let previewSource = source;
  if (raw.version !== 2) {
    const migrated = runtime.migrateEditToV2(raw, { hasCaptions });
    if (!migrated.ok) throw new Error(`fieldtest migration blocked: ${migrated.blockers.join(' / ')}`);
    previewSource = JSON.stringify(migrated.doc);
  }
  const internal = runtime.readPreviewInternalEdit(previewSource, hasCaptions);
  const trackIds = new Map();
  const visit = (item, trackId) => {
    trackIds.set(item.id, trackId);
    for (const child of item.children ?? []) visit(child, trackId);
  };
  for (const track of internal.tracks) for (const item of track.items) visit(item, track.id);
  const handler = new runtime.Handler();
  const overlays = runtime.expandBagOverlays(internal, reference => {
    if (reference.trimStart().startsWith('<')) return reference;
    return readFileSync(path.resolve(projectDir, reference), 'utf8');
  }).map(value => ({
    id: String(value?.id ?? ''),
    html: typeof value?.html === 'string' ? value.html : '',
    start: handler.finiteNumber(value?.start, 0),
    duration: handler.finiteNumber(value?.duration, 0),
    track: Number.isInteger(value?.track) && value.track >= 0 ? value.track : 0,
    trackId: trackIds.get(String(value?.id ?? ''))
      ?? trackIds.get(String(value?.parentId ?? '')) ?? '',
    transform: handler.transform(value?.transform),
    vars: handler.stringRecord(value?.vars),
    params: handler.stringRecord(value?.params),
    ...(typeof value?.part === 'string' ? { part: value.part } : {}),
    ...(typeof value?.parentId === 'string' ? { parentId: value.parentId } : {})
  }));
  return { output: internal.output, overlays };
};
const digest = value => createHash('sha256').update(value).digest('hex');
const render = (runtime, name, projected) => {
  const sourceUri = { toString: () => pathToFileURL(`/private/tmp/${name}/source.mp4`).href };
  const handler = new runtime.Handler();
  const model = {
    summary: {
      output: projected.output, overlays: projected.overlays, layers: [], filters: [], cuts: [],
      indicators: [], tracks: { cuts: [], layers: [], audio: [] }, timelineTracks: []
    },
    sourceUri,
    sourcesById: new Map([['main', { uri: sourceUri }]]),
    overlayUris: [], assetUris: [], assetStreamIds: [], captions: [], emphasisWords: []
  };
  return handler.prepareHtml(sourceUri, 'http://127.0.0.1:9000/source.mp4', model, assets);
};
const compare = (name, kind, beforeProjection, afterProjection) => {
  const before = render(base, name, beforeProjection);
  const after = render(current, name, afterProjection);
  return { name, kind, before: digest(before), after: digest(after), equal: before === after };
};

const comparisons = syntheticCases.map(entry => compare(entry.name, 'synthetic', entry, entry));
const usedFieldtests = [];
for (const name of fieldtestNames) {
  const projectDir = path.join(fieldtestRoot, name);
  if (!existsSync(path.join(projectDir, 'edit.json'))) continue;
  const beforeProjection = projectFieldtest(base, projectDir);
  const afterProjection = projectFieldtest(current, projectDir);
  comparisons.push(compare(name, 'fieldtest', beforeProjection, afterProjection));
  usedFieldtests.push(name);
}
if (usedFieldtests.length > 0 && usedFieldtests.length < 3) {
  throw new Error(`only ${usedFieldtests.length}/3 readable fieldtests: ${usedFieldtests.join(', ')}`);
}
if (!comparisons.every(entry => entry.equal)) throw new Error(JSON.stringify(comparisons));
writeFileSync(outputPath, `${JSON.stringify({
  base: '9387ad3e',
  injection: 'excluded by identical sentinel',
  fieldtests: {
    requested: fieldtestNames,
    used: usedFieldtests,
    fallbackToSynthetic: usedFieldtests.length === 0
  },
  comparisons
}, null, 2)}\n`);
rmSync(scratch, { recursive: true, force: true });
console.log(JSON.stringify(comparisons));
