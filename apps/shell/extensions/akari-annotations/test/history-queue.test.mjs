import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('../lib/browser/akari-annotations-widget.js',import.meta.url),'utf8');
function method(name){const at=source.indexOf(`    ${name}(`),rest=source.slice(at);assert.ok(at>=0);return rest.slice(0,rest.indexOf('\n    }')+6);}
test('rapid undo and redo wait for the previous write to finish',async()=>{
 const Widget=new Function(`return class {${method('performUndo')} ${method('performRedo')}}`)();const calls=[];
 const w=Object.assign(new Widget(),{historyActionTail:Promise.resolve(),async performUndoNow(){calls.push('undo:start');await Promise.resolve();calls.push('undo:end')},async performRedoNow(){calls.push('redo:start');await Promise.resolve();calls.push('redo:end')}});
 await Promise.all([w.performUndo(),w.performRedo(),w.performUndo()]);assert.deepEqual(calls,['undo:start','undo:end','redo:start','redo:end','undo:start','undo:end']);
});
