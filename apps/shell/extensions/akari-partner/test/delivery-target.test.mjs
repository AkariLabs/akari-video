import { after as afterI18n } from 'node:test';
import { setLanguage } from '@akari-video/i18n';
setLanguage('ja');
afterI18n(() => setLanguage(undefined));
import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveDeliveryTarget } from '../lib/common/delivery-target.js';
import { PARTNER_CATALOG } from '../lib/browser/partner-catalog.js';

const target = (cliAgent, visibleWidgetIds, webAgent) => resolveDeliveryTarget({ cliAgent, visibleWidgetIds, webAgent, catalog: PARTNER_CATALOG });

test('CLI チャネルを優先し、画面上の拡張ビューを見分ける', () => {
  const claude = 'plugin-view-container:workbench.view.extension.claude-sidebar';
  const codex = 'plugin-view-container:workbench.view.extension.codexViewContainer';
  assert.deepEqual(target('claude', [codex]), { form: 'cli', agent: 'claude' });
  assert.deepEqual(target(undefined, [claude]), { form: 'extension', agent: 'claude', focusCommandId: 'claude-vscode.focus' });
  assert.deepEqual(target(undefined, [codex]), { form: 'extension', agent: 'codex', focusCommandId: 'chatgpt.openSidebar' });
  assert.deepEqual(target('claude', [codex], 'deepseek'), { form: 'cli', agent: 'claude' });
  assert.deepEqual(target(undefined, [claude], 'deepseek'), { form: 'extension', agent: 'claude', focusCommandId: 'claude-vscode.focus' });
  assert.deepEqual(target(undefined, [], 'deepseek'), { form: 'web', agent: 'deepseek' });
  assert.deepEqual(target(undefined, []), { form: 'none' });
  assert.deepEqual(target(undefined, ['workbench.view.extension.claude-sidebar']), { form: 'none' });
});
