import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const source=readFileSync(new URL('../lib/browser/akari-annotations-widget.js',import.meta.url),'utf8');
function method(name){const start=source.indexOf(`    ${name}(`);assert.ok(start>=0,name);const rest=source.slice(start);return rest.slice(0,rest.indexOf('\n    }')+6);}
const renderStart=source.indexOf('    renderStrip()');
const paintPrefix=source.slice(renderStart,source.indexOf('        this.strip.replaceChildren();',renderStart))+'    }';
const Widget=new Function(`const MIN_VIEW_DURATION_FRAMES=4,ZOOM_SLIDER_RESOLUTION=1000;return class {${[
 'totalDuration','visibleDuration','zoomPercent','minViewDurationSeconds','sliderValueToViewDuration',
 'viewDurationToSliderValue','pinTimelineViewport','fitTimeline','applyViewDuration','setViewStart'
].map(method).join('\n')} ${paintPrefix} };`)();
function fixture(){return Object.assign(new Widget(),{end:4,viewStart:0,fps:30,contentEndDuration(){return this.end}});}
test('fit view stays at the same seconds, percentage and slider position when media extent changes',()=>{
 const w=fixture();w.fitTimeline();const before={duration:w.visibleDuration(),percent:w.zoomPercent(),slider:w.viewDurationToSliderValue(w.visibleDuration())};
 for(const end of [12,1,30,4]){w.end=end;w.renderStrip();assert.deepEqual({duration:w.visibleDuration(),percent:w.zoomPercent(),slider:w.viewDurationToSliderValue(w.visibleDuration())},before);assert.equal(w.viewStart,0);}
});
test('zoomed/panned view does not jump back when the last clip moves earlier or is removed',()=>{
 const w=fixture();w.fitTimeline();w.end=30;w.applyViewDuration(4,10,.5);assert.equal(w.viewStart,8);
 const percent=w.zoomPercent();w.end=1;w.renderStrip();assert.equal(w.viewStart,8);assert.equal(w.visibleDuration(),4);assert.equal(w.zoomPercent(),percent);
});
test('only an explicit fit or zoom gesture changes the viewport',()=>{
 const w=fixture();w.fitTimeline();w.end=12;w.renderStrip();assert.equal(w.visibleDuration(),8);
 w.applyViewDuration(4,2,.5);assert.equal(w.visibleDuration(),4);assert.equal(w.zoomPercent(),200);
 w.fitTimeline();assert.equal(w.visibleDuration(),24);assert.equal(w.zoomPercent(),100);assert.equal(w.viewStart,0);
});
test('a drag starting during initial loading pins the current window immediately',()=>{
 const w=fixture();assert.equal(w.viewDuration,undefined);w.pinTimelineViewport();assert.equal(w.viewDuration,8);
 w.end=20;w.renderStrip();assert.equal(w.visibleDuration(),8);assert.equal(w.zoomPercent(),100);
});
