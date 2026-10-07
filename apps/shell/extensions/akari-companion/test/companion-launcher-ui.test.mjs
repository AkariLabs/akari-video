import assert from 'node:assert/strict';
import { readFile, access } from 'node:fs/promises';
import test from 'node:test';
import loader from './fixtures/load-browser.cjs';
const { load } = loader;
const toolbarModule = load('browser/companion-toolbar-contribution.js');
const { AkariCompanionContribution } = load('browser/akari-companion-contribution.js', {
  './companion-toolbar-contribution': toolbarModule,
  './akari-companion-client': {},
  './companion-annotate': {},
  './akari-companion-preferences': { AKARI_COMPANION_ENABLED: 'akari.companion.enabled' },
  './companion-state-collector': {}
});
const { AkariCompanionPreferenceContribution } = load('browser/akari-companion-preferences.js', {
  '@theia/core/lib/common/preferences': { PreferenceScope: { User: 1 } }
});

function ui(t) {
  const previous = globalThis.document;
  globalThis.document = {};
  t.after(() => { if (previous === undefined) delete globalThis.document; else globalThis.document = previous; });
  const app = new AkariCompanionContribution();
  const warnings = [];
  let mounted = false, hidden = false, toggles = 0, starts = 0;
  app.toolbar = { refresh() {} };
  app.panel = {
    toggleHidden() { hidden = !hidden; toggles++; },
    mount() { mounted = true; hidden = false; },
    unmount() { mounted = false; },
    isMounted: () => mounted, isHidden: () => hidden
  };
  app.messages = { warn: message => warnings.push(message) };
  app.service = { setEnabled: async () => {}, start: async () => { starts++; return false; } };
  app.preferences = { inspect: () => undefined };
  return { app, warnings, starts: () => starts, toggles: () => toggles, mounted: () => mounted, hidden: () => hidden };
}

test('toolbar stays visible while disconnected and hides only when disabled', () => {
  const toolbar = new toolbarModule.CompanionToolbarContribution();
  let enabled = true, starting = false, open = false;
  toolbar.setState({ enabled: () => enabled, starting: () => starting, open: () => open });
  const button = { style: {}, dataset: {}, attributes: {}, setAttribute(key, value) { this.attributes[key] = value; } };
  const doc = { querySelectorAll: () => [button] };
  for (const state of [
    { enabled: true, starting: false, open: false },
    { enabled: true, starting: true, open: false },
    { enabled: true, starting: false, open: true },
    { enabled: false, starting: false, open: false }
  ]) {
    ({ enabled, starting, open } = state);
    const rendered = toolbar.renderButton();
    toolbar.refresh(doc);
    assert.equal(rendered.props.style.display, enabled ? 'inline-flex' : 'none');
    assert.equal(button.style.display, rendered.props.style.display);
    assert.equal(rendered.props['data-starting'], String(starting));
    assert.equal(button.dataset.starting, String(starting));
    assert.equal(button.attributes['aria-busy'], String(starting));
    assert.equal(button.dataset.open, String(open));
    assert.equal(rendered.props['aria-pressed'], open);
    assert.equal(rendered.props.title, 'AKARI バイブ');
    assert.equal(rendered.props['aria-label'], toolbarModule.COMPANION_TOGGLE_LABEL);
  }
});

test('enabled defaults to true and only user preferences disable it', async t => {
  const { app } = ui(t);
  const values = [];
  app.service.setEnabled = async value => values.push(value);
  assert.equal(new AkariCompanionPreferenceContribution().schema.properties['akari.companion.enabled'].default, true);
  for (const preference of [undefined, { workspaceValue: false, workspaceFolderValue: false }, { globalValue: false }, { globalValue: true }]) {
    app.preferences.inspect = () => preference;
    await app.applyEnabled();
  }
  assert.deepEqual(values, [true, true, false, true]);
});

test('disconnected click starts once, opens on connection and then toggles the panel', async t => {
  const u = ui(t);
  let resolveStart, starts = 0;
  u.app.service.start = () => { starts++; return new Promise(resolve => { resolveStart = resolve; }); };
  const pending = u.app.togglePanel();
  assert.equal(u.app.starting, true);
  await u.app.togglePanel();
  assert.equal(starts, 1);
  u.app.onConnectionState(true, { port: 1, panelPath: '/panel' });
  resolveStart(true);
  await pending;
  assert.equal(u.app.starting, false);
  assert.equal(u.mounted(), true);
  assert.equal(u.hidden(), false);
  await u.app.togglePanel();
  assert.equal(u.toggles(), 1);
  assert.equal(starts, 1);
  u.app.onConnectionState(false);
  assert.equal(u.mounted(), false);
});

test('starting label appears after five seconds and resets after failure or success', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const u = ui(t);
  const toolbar = new toolbarModule.CompanionToolbarContribution();
  const button = { style: {}, dataset: {}, attributes: {}, setAttribute(key, value) { this.attributes[key] = value; } };
  globalThis.document = { querySelectorAll: () => [button] };
  toolbar.setState({ enabled: () => u.app.enabled, starting: () => u.app.starting, open: () => false });
  u.app.toolbar = toolbar;
  for (const succeeded of [false, true]) {
    let resolveStart;
    u.app.service.start = () => new Promise(resolve => { resolveStart = resolve; });
    const pending = u.app.togglePanel();
    assert.equal(button.dataset.starting, 'true');
    t.mock.timers.tick(toolbarModule.COMPANION_STARTING_LABEL_DELAY_MS - 1);
    assert.equal(button.attributes.title, toolbarModule.COMPANION_TOGGLE_LABEL);
    t.mock.timers.tick(1);
    assert.equal(button.attributes.title, toolbarModule.COMPANION_STARTING_LABEL);
    assert.equal(button.attributes['aria-label'], toolbarModule.COMPANION_STARTING_LABEL);
    assert.equal(toolbar.renderButton().props.title, toolbarModule.COMPANION_STARTING_LABEL);
    resolveStart(succeeded);
    await pending;
    assert.equal(button.dataset.starting, 'false');
    assert.equal(button.attributes.title, toolbarModule.COMPANION_TOGGLE_LABEL);
    assert.equal(button.attributes['aria-label'], toolbarModule.COMPANION_TOGGLE_LABEL);
  }
  assert.deepEqual(u.warnings, ['AKARI バイブを起動できませんでした']);
});

test('missing executable or RPC failure shows startup notice and allows retry', async t => {
  const u = ui(t);
  await u.app.togglePanel();
  await u.app.togglePanel();
  assert.equal(u.starts(), 2);
  u.app.service.start = async () => { throw new Error('transport unavailable'); };
  await assert.doesNotReject(u.app.togglePanel());
  assert.deepEqual(u.warnings, Array(3).fill('AKARI バイブを起動できませんでした'));
  assert.equal(u.app.starting, false);
  u.app.enabled = false;
  await u.app.togglePanel();
  assert.equal(u.warnings.length, 3);
});

test('first Vibe activation explains the data sent and does not repeat it', async t => {
  const previous = globalThis.window;
  const stored = new Map();
  globalThis.window = { localStorage: {
    getItem: key => stored.get(key), setItem: (key, value) => stored.set(key, value)
  } };
  t.after(() => { if (previous === undefined) delete globalThis.window; else globalThis.window = previous; });
  const u = ui(t);
  const notices = [];
  u.app.messages.info = message => { notices.push(message); };
  u.app.preferences.inspect = () => ({ globalValue: true });
  await u.app.applyEnabled(true);
  await u.app.togglePanel();
  await u.app.togglePanel();
  assert.equal(notices.length, 1);
  assert.match(notices[0], /字幕の文字は先頭 20 文字まで/);
  assert.match(notices[0], /OpenRouter キー/);
});

test('settings command accepts known sections and rejects unknown or extra args', async t => {
  const { app } = ui(t);
  const executed = [];
  app.commands = { executeCommand: async (...args) => executed.push(args) };
  const dispatch = args => app.dispatchCommand({ id: 'settings', kind: 'command', command: { commandId: 'akari.settings.open', args } });
  assert.equal((await dispatch({ section: 'connections' })).ok, true);
  assert.equal((await dispatch({ section: 'appearance' })).ok, true);
  assert.equal((await dispatch({ section: 'tools' })).ok, true);
  assert.deepEqual(executed, [
    ['akari.settings.open', { section: 'connections' }],
    ['akari.settings.open', { section: 'appearance' }],
    ['akari.settings.open', { section: 'tools' }]
  ]);
  for (const args of [{ section: 'unknown' }, { section: 'connections', extra: true }, undefined, {}, null, []]) {
    assert.equal((await dispatch(args)).error, 'invalid-args');
  }
  assert.equal(executed.length, 3);
});

test('command session が違えば実行前に拒否し、省略時は通す', async t => {
  const { app } = ui(t);
  const executed = [];
  app.projectSessionId = 'current';
  app.commands = { executeCommand: async (...args) => executed.push(args) };
  const dispatch = projectSessionId => app.dispatchCommand({
    id: 'session', kind: 'command', command: {
      commandId: 'akari.settings.open', args: { section: 'appearance' }, projectSessionId
    }
  });
  assert.equal((await dispatch('old')).error, 'stale-session');
  assert.equal(executed.length, 0);
  assert.equal((await dispatch(undefined)).ok, true);
  assert.equal((await dispatch('current')).ok, true);
  assert.equal(executed.length, 2);
});

test('public label is AKARI バイブ and obsolete word prohibition test is removed', async () => {
  assert.equal(toolbarModule.COMPANION_TOGGLE_LABEL, 'AKARI バイブ');
  const frame = await readFile(new URL('../src/browser/companion-panel-frame.ts', import.meta.url), 'utf8');
  assert.match(frame, /AKARI バイブをしまう/);
  await assert.rejects(access(new URL('./companion-forbidden-words.test.mjs', import.meta.url)), { code: 'ENOENT' });
});
