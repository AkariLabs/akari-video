import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveDeliveryTarget } from '../lib/common/delivery-target.js';
import { PARTNER_CATALOG } from '../lib/browser/partner-catalog.js';

const target = (cliAgent, visibleWidgetIds) => resolveDeliveryTarget({ cliAgent, visibleWidgetIds, catalog: PARTNER_CATALOG });

test('CLI チャネルを優先し、画面上の拡張ビューを見分ける', () => {
  const claude = 'plugin-view-container:workbench.view.extension.claude-sidebar';
  const codex = 'plugin-view-container:workbench.view.extension.codexViewContainer';
  assert.deepEqual(target('claude', [codex]), { form: 'cli', agent: 'claude' });
  assert.deepEqual(target(undefined, [claude]), { form: 'extension', agent: 'claude', focusCommandId: 'claude-vscode.focus' });
  assert.deepEqual(target(undefined, [codex]), { form: 'extension', agent: 'codex', focusCommandId: 'chatgpt.openSidebar' });
  assert.deepEqual(target(undefined, []), { form: 'none' });
  assert.deepEqual(target(undefined, ['workbench.view.extension.claude-sidebar']), { form: 'none' });
});
