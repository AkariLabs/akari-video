import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import * as unorganized from '../lib/common/unorganized-materials.js';
const source=readFileSync(new URL('../lib/browser/akari-role-buckets-widget.js',import.meta.url),'utf8');
const at=source.indexOf('    handleMaterialsFileChange('),rest=source.slice(at),method=rest.slice(0,rest.indexOf('\n    }')+6);
function check(path){let schedules=0;const Widget=new Function('unorganized_materials_1','setTimeout',`return class {${method}}`)(unorganized,()=>{schedules++;return 1});const w=Object.assign(new Widget(),{workflow:{current:{tree:{hidden:['.akari'],sidecarSuffixes:['.analysis.json']}}}});const resource={toString:()=>path,parent:{toString:()=>path.slice(0,path.lastIndexOf('/'))},path:{base:path.split('/').pop()}};w.handleMaterialsFileChange({toString:()=>'/project'},{isEqualOrParent:r=>r.toString()==='/project/assets'||r.toString().startsWith('/project/assets/')},{changes:[{resource}]});return schedules;}
test('timeline saves and cache updates do not reload the materials panel',()=>{for(const name of ['edit.json','edit.json.123.tmp','captions.json','review.json','.akari','.akari/cache/thumb.jpg'])assert.equal(check('/project/'+name),0,name)});
test('asset changes and root media still reload the materials panel',()=>{for(const name of ['assets','assets/red.webm','assets/group/meta.json','new.mov'])assert.equal(check('/project/'+name),1,name)});
