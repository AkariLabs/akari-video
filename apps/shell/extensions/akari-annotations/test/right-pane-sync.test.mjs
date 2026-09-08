import assert from 'node:assert/strict';
import test from 'node:test';
import {AKARI_INSPECTOR_WIDGET_ID,PARTNER_WIDGET_ID,resolveRightPaneSyncAction} from '../lib/common/right-pane-sync.js';
test('inspector stays visible whether an item is selected or not',()=>{
 for(const selected of [true,false])assert.equal(resolveRightPaneSyncAction(AKARI_INSPECTOR_WIDGET_ID,selected),'skip');
});
test('selection never switches away from a manually chosen panel',()=>{
 for(const current of [undefined,PARTNER_WIDGET_ID,'akari-review-panel-widget','plugin-panel']){
  assert.equal(resolveRightPaneSyncAction(current,true),'attach-inspector');
  assert.equal(resolveRightPaneSyncAction(current,false),'skip');
 }
});
