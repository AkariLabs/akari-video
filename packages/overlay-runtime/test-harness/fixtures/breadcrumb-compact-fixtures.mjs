import { SHELL_BOX_FRAGMENTS } from './element-box-fixtures.mjs';

export const BREADCRUMB_TREE = [
  { id: 'outer', parentId: null, kind: 'group', label: 'Outer group' },
  { id: 'inner', parentId: 'outer', kind: 'group', label: 'Inner group' },
  { id: 'bars', parentId: 'inner', kind: 'leaf', label: 'Bars' }
];

export const BREADCRUMB_FRAGMENT = `<div class="fragment-root"><div class="outer-card" style="position:absolute;left:50px;top:35px;width:540px;height:275px;background:#203040">
  <div class="inner-card" style="position:absolute;left:60px;top:45px;width:360px;height:160px;background:#405060">
    <div class="target-bar" style="position:absolute;left:120px;top:50px;width:75px;height:65px;background:#18a878"></div>
  </div>
</div></div>`;

export const BREADCRUMB_SHELL_PROJECT = { id: 'bars', fragment: BREADCRUMB_FRAGMENT,
  tree: BREADCRUMB_TREE };
export const BREADCRUMB_SHELL_ROOT = { id: 'bars', fragment: SHELL_BOX_FRAGMENTS.bars };
