import assert from 'node:assert/strict';
import test from 'node:test';
import { planReplacement, replaceMaterial, materialSwapTarget } from '../lib/common/material-replacement.js';
const cases = [
 [6.592, 6, { out: 6, freeze: null, mismatch_s: 0.592, warn: true }],
 [4.9, 6, { out: 4.9, freeze: { at_sec: 4.9, duration_sec: 1.1 }, mismatch_s: 1.1, warn: true }],
 [6, 6, { out: 6, freeze: null, mismatch_s: 0, warn: false }],
 [5.7, 6, { out: 5.7, freeze: { at_sec: 5.7, duration_sec: 0.3 }, mismatch_s: 0.3, warn: false }],
];
for (const [actualDurationS, cutsDurationS, expected] of cases) test(`planReplacement: ${actualDurationS} / ${cutsDurationS}`, () => {
 assert.deepEqual(planReplacement({ actualDurationS, cutsDurationS }), { in: 0, ...expected });
});
const fixture = (lane = 'visual', path = 'assets/broll/old/a.mp4') => ({ version: 2, output: { fps: 30 }, sources: [{ id: 'old', path }],
 tracks: [{ id: 'track', lane, items: [{ id: 'item', at: 30, duration: 180, transform: { scale: 1.5 }, adjust: { exposure: 1 }, gain_db: -4, fade_in: 0.2,
 source: { kind: 'media', src: 'old', in: 1, out: 7, mute: false, framing: { fit: 'cover' } } }] }] });
test('B-roll preserves placement, settings and mute, and leaves input untouched', () => {
 const doc = fixture(), before = structuredClone(doc);
 const next = replaceMaterial(doc, { itemId: 'item', relativePath: 'new.mp4', kind: 'video', actualDurationS: 4.9 });
 assert.deepEqual(doc, before);
 assert.deepEqual(next.sources, [...doc.sources, { id: 'src-1', path: 'new.mp4' }]);
 assert.deepEqual(next.tracks[0].items[0], { ...doc.tracks[0].items[0], source: {
 ...doc.tracks[0].items[0].source, src: 'src-1', in: 0, out: 4.9, freeze: { at_sec: 4.9, duration_sec: 1.1 } } });
});
test('audio stops at next item; image keeps duration; sources are reused', () => {
 const doc = fixture('audio', 'old.wav'); doc.sources.push({ id: 'src-1', path: 'new.wav' });
 doc.tracks[0].items.push({ id: 'next', at: 75, duration: 30, source: { kind: 'media', src: 'old' } });
 const next = replaceMaterial(doc, { itemId: 'item', relativePath: 'new.wav', kind: 'audio', actualDurationS: 10 });
 assert.equal(next.tracks[0].items[0].duration, 45); assert.equal(next.tracks[0].items[0].source.out, 1.5); assert.equal(next.sources.length, 2);
 assert.equal(replaceMaterial(fixture(), { itemId: 'item', relativePath: 'new.png', kind: 'image' }).tracks[0].items[0].duration, 180);
});
test('fractional audio duration never reads beyond media end', () => {
 const next = replaceMaterial(fixture('audio', 'old.wav'), { itemId: 'item', relativePath: 'new.wav', kind: 'audio', actualDurationS: 1.019 });
 assert.equal(next.tracks[0].items[0].duration, 30); assert.equal(next.tracks[0].items[0].source.out, 1);
});
test('main footage, non-media, and legacy BGM do not qualify', () => {
 assert.equal(materialSwapTarget(fixture('audio', 'old.wav'), 'item').kind, 'audio');
 assert.equal(materialSwapTarget(fixture('visual', 'old.png'), 'item').kind, 'visual');
 assert.equal(materialSwapTarget(fixture('visual', 'footage/main.mp4'), 'item'), undefined);
 for (const kind of ['html', 'caption', 'transition', 'effect']) {
 const doc = fixture(); doc.tracks[0].items[0].source.kind = kind; assert.equal(materialSwapTarget(doc, 'item'), undefined); }
 assert.equal(materialSwapTarget({ audio: { bgm: { path: 'bgm.mp3' } } }, 'bgm'), undefined);
 const bgm = fixture('audio', 'bgm.mp3'); bgm.tracks[0].items[0].role = 'bgm';
 assert.equal(materialSwapTarget(bgm, 'item'), undefined);
});
test('invalid duration and locked tracks fail', () => {
 for (const actualDurationS of [NaN, Infinity, -1]) assert.throws(() => planReplacement({ actualDurationS, cutsDurationS: 6 }));
 const doc = fixture(); doc.tracks[0].locked = true;
 assert.throws(() => replaceMaterial(doc, { itemId: 'item', relativePath: 'new.png', kind: 'image' }), /ロック/);
});

test('nested audio respects the next leaf on the same track in output frames', () => {
 const doc = fixture('audio', 'old.wav');
 const item = doc.tracks[0].items[0];
 doc.tracks[0].items = [{ id: 'group', at: 60, duration: 240, source: { kind: 'group' }, items: [item] },
  { id: 'next', at: 150, duration: 30, source: { kind: 'media', src: 'old' } }];
 const next = replaceMaterial(doc, { itemId: 'item', relativePath: 'new.wav', kind: 'audio', actualDurationS: 20 });
 assert.equal(next.tracks[0].items[0].items[0].at, 30);
 assert.equal(next.tracks[0].items[0].items[0].duration, 60);
 assert.equal(next.tracks[0].items[0].items[0].source.out, 2);
});

test('main cuts remain excluded after track reorder', () => {
 const doc = fixture('visual', 'footage/main.mp4');
 doc.tracks.unshift({ id: 'other', lane: 'visual', items: [{ ...doc.tracks[0].items[0], id: 'other' }] });
 assert.equal(materialSwapTarget(doc, 'item'), undefined);
});

test('video → still removes video-only window state, and still → short video restores a real window plus freeze',()=>{
 const doc=fixture();Object.assign(doc.tracks[0].items[0].source,{freeze:{at_sec:2,duration_sec:4},speed:1.5});
 const still=replaceMaterial(doc,{itemId:'item',relativePath:'assets/still/br-photo/broll.png',kind:'image'});
 const item=still.tracks[0].items[0];assert.equal(item.duration,180);
 assert.equal(item.source.in,0);assert.equal(item.source.out,6);
 for(const key of ['freeze','speed','mute'])assert.equal(key in item.source,false,key);
 assert.deepEqual(item.transform,doc.tracks[0].items[0].transform);
 const video=replaceMaterial(still,{itemId:'item',relativePath:'assets/broll/br-short/clip.mp4',kind:'video',actualDurationS:2});
 assert.equal(video.tracks[0].items[0].duration,180);
 assert.equal(video.tracks[0].items[0].source.out,2);
 assert.deepEqual(video.tracks[0].items[0].source.freeze,{at_sec:2,duration_sec:4});
});

test('both visual directions pass the actual edit-lint media and source-range checks',async t=>{
 const {mkdtemp,mkdir,writeFile,rm}=await import('node:fs/promises');
 const {tmpdir}=await import('node:os');const {join}=await import('node:path');
 const {execFileSync}=await import('node:child_process');
 const {lintProject}=await import('../../../../../packages/edit-lint/src/edit-lint.mjs');
 const root=await mkdtemp(join(tmpdir(),'akari-swap-cross-media-'));
 t.after(()=>rm(root,{recursive:true,force:true}));
 const paths=['assets/broll/br-old/clip.mp4','assets/still/br-photo/broll.png','assets/broll/br-short/clip.mp4'];
 for(const path of paths)await mkdir(join(root,path,'..'),{recursive:true});
 for(const [index,path] of paths.entries()){
  execFileSync('ffmpeg',['-v','error','-y','-filter_threads','1','-f','lavfi','-i','color=c=blue:s=320x180:r=30',
   ...(index===1?['-frames:v','1']:['-t',index===2?'2':'6','-c:v','libx264','-pix_fmt','yuv420p']),'-threads','1',join(root,path)]);
 }
 const doc={version:2,output:{width:320,height:180,fps:30},sources:[{id:'old',path:paths[0]}],tracks:[{id:'v',lane:'visual',items:[
  {id:'item',at:0,duration:180,source:{kind:'media',src:'old',in:0,out:2,freeze:{at_sec:2,duration_sec:4},mute:false}}
 ]}]};
 const still=replaceMaterial(doc,{itemId:'item',relativePath:paths[1],kind:'image'});
 const video=replaceMaterial(still,{itemId:'item',relativePath:paths[2],kind:'video',actualDurationS:2});
 for(const value of [still,video]){
  await writeFile(join(root,'edit.json'),JSON.stringify(value));
  const result=await lintProject(root,{media:true,writeReports:false});
  const errors=result.findings.filter(f=>f.severity==='error');
  assert.deepEqual(errors,[],JSON.stringify(errors));assert.equal(result.verdict,'pass');
  assert.equal(result.findings.filter(f=>f.check==='media.source-range').length,0);
 }
});
