// フォーカス中の要素に当たっている outline 系の CSS ルール（セレクタと出どころ）を CDP CSS ドメインで列挙する。
// usage: CDP_PORT=9451 node outline-rules.mjs <out.json>
import { connectMain } from './cdp-lib.mjs';
import { writeFile } from 'node:fs/promises';
const cdp = await connectMain(Number(process.env.CDP_PORT || 9451));
await cdp.send('CSS.enable');
const { root } = await cdp.send('DOM.getDocument', { depth: 0 });
const { result } = await cdp.send('Runtime.evaluate', { expression: 'document.activeElement' });
const { nodeId } = await cdp.send('DOM.requestNode', { objectId: result.objectId });
await cdp.send('CSS.forcePseudoState', { nodeId, forcedPseudoClasses: ['focus', 'focus-visible'] });
const m = await cdp.send('CSS.getMatchedStylesForNode', { nodeId });
const rules = (m.matchedCSSRules || []).map(r => ({ selector: r.rule.selectorList.text, origin: r.rule.origin, props: r.rule.style.cssProperties.filter(p => /^outline/.test(p.name) && p.value).map(p => `${p.name}: ${p.value}${p.important ? ' !important' : ''}`) })).filter(r => r.props.length);
await writeFile(process.argv[2], JSON.stringify({ root: root.nodeName, rules }, null, 1));
for (const r of rules) console.log(r.origin, '|', r.selector.slice(0, 160), '|', r.props.join('; '));
cdp.close(); process.exit(0);
