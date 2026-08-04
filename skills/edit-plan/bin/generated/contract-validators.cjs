"use strict";
exports.validateAnalysis = validate20;
const schema31 = {"$schema":"https://json-schema.org/draft/2020-12/schema","title":"AKARI Video analysis.json v0","description":"素材 1 本の分析結果を表す中間契約。","$comment":"意味制約として、start/end を持つ全区間では end > start とする。Draft 2020-12 標準では兄弟プロパティ間を比較できないため、この条件は生成・検証手順で確認する。","type":"object","additionalProperties":false,"required":["version","source","transcript","keyframes","events","tracks"],"properties":{"version":{"const":0},"source":{"type":"string","minLength":1,"description":"分析対象素材へのパス。相対パスは analysis.json の所在ディレクトリを基準に解決する。"},"transcript":{"type":"array","items":{"$ref":"#/$defs/transcriptSegment"}},"keyframes":{"type":"array","items":{"$ref":"#/$defs/keyframe"}},"events":{"type":"array","items":{"$ref":"#/$defs/event"}},"tracks":{"$ref":"#/$defs/tracks"}},"$defs":{"seconds":{"type":"number","minimum":0},"word":{"$comment":"M5 契約例で省略されている words の要素を、区間・本文を持つ最小形として定義する。","type":"object","additionalProperties":false,"required":["start","end","text"],"properties":{"start":{"$ref":"#/$defs/seconds"},"end":{"$ref":"#/$defs/seconds"},"text":{"type":"string","minLength":1}}},"transcriptSegment":{"type":"object","additionalProperties":false,"required":["start","end","text"],"properties":{"start":{"$ref":"#/$defs/seconds"},"end":{"$ref":"#/$defs/seconds"},"text":{"type":"string","minLength":1},"speaker":{"type":"string","minLength":1},"words":{"type":"array","items":{"$ref":"#/$defs/word"}}}},"keyframe":{"type":"object","additionalProperties":false,"required":["t","path","note"],"properties":{"t":{"$ref":"#/$defs/seconds"},"path":{"type":"string","minLength":1,"description":"キーフレーム画像へのパス。相対パスは analysis.json の所在ディレクトリを基準に解決する。"},"note":{"type":"string","minLength":1},"origin":{"enum":["scene","interval","transcript"],"description":"採用元の抽出系統（2026-07-14 追加・任意）。scene = 映像変化検出、interval = 一定間隔、transcript = 発話由来（highlight 等の時刻から抽出）。候補と note の対応トレーサビリティにも使う。"}}},"fillerEvent":{"type":"object","additionalProperties":false,"required":["type","start","end"],"properties":{"type":{"const":"filler"},"start":{"$ref":"#/$defs/seconds"},"end":{"$ref":"#/$defs/seconds"}}},"troubleEvent":{"type":"object","additionalProperties":false,"required":["type","start","end","note"],"properties":{"type":{"const":"trouble"},"start":{"$ref":"#/$defs/seconds"},"end":{"$ref":"#/$defs/seconds"},"note":{"type":"string","minLength":1}}},"chapterEvent":{"type":"object","additionalProperties":false,"required":["type","t","title"],"properties":{"type":{"const":"chapter"},"t":{"$ref":"#/$defs/seconds"},"title":{"type":"string","minLength":1}}},"hookScore":{"type":"object","additionalProperties":false,"required":["hook","self_contained","emotion","density","punch"],"properties":{"hook":{"$ref":"#/$defs/scoreValue"},"self_contained":{"$ref":"#/$defs/scoreValue"},"emotion":{"$ref":"#/$defs/scoreValue"},"density":{"$ref":"#/$defs/scoreValue"},"punch":{"$ref":"#/$defs/scoreValue"}}},"scoreValue":{"$comment":"1〜5 の整数尺度は analysis.json v0 の運用仮定。採用閾値は M5 契約どおり運用で調整する。","type":"integer","minimum":1,"maximum":5},"hookEvent":{"type":"object","additionalProperties":false,"required":["type","start","end","score"],"properties":{"type":{"const":"hook"},"start":{"$ref":"#/$defs/seconds"},"end":{"$ref":"#/$defs/seconds"},"score":{"$ref":"#/$defs/hookScore"}}},"highlightEvent":{"$comment":"2026-07-14 追加（後方互換の追加語彙）。ショート向けの hook と異なり、決定事項・結論・数字・強い主張など編集判断全般の根拠になる重要発言を記録する。","type":"object","additionalProperties":false,"required":["type","start","end","quote","reason"],"properties":{"type":{"const":"highlight"},"start":{"$ref":"#/$defs/seconds"},"end":{"$ref":"#/$defs/seconds"},"quote":{"type":"string","minLength":1,"description":"transcript の実発言に忠実な引用。要約・創作をしない。"},"reason":{"type":"string","minLength":1,"description":"なぜ重要か（決定事項・結論・数値/実績・強い主張などの根拠カテゴリと内容）。"},"importance":{"$ref":"#/$defs/scoreValue"}}},"event":{"oneOf":[{"$ref":"#/$defs/fillerEvent"},{"$ref":"#/$defs/troubleEvent"},{"$ref":"#/$defs/chapterEvent"},{"$ref":"#/$defs/highlightEvent"},{"$ref":"#/$defs/hookEvent"}]},"speakerSpan":{"type":"array","prefixItems":[{"$ref":"#/$defs/seconds"},{"$ref":"#/$defs/seconds"}],"items":false,"minItems":2,"maxItems":2},"speakerTrack":{"type":"object","additionalProperties":false,"required":["id","spans"],"properties":{"id":{"type":"string","minLength":1},"spans":{"type":"array","items":{"$ref":"#/$defs/speakerSpan"}}}},"faceBox":{"description":"素材フレームに対する [x, y, width, height] 順の正規化座標。各要素は 0〜1。","$comment":"意味制約として x + width <= 1 かつ y + height <= 1 とする。Draft 2020-12 標準では配列要素間を加算・比較できないため、この条件は生成・検証手順で確認する。","type":"array","prefixItems":[{"type":"number","minimum":0,"maximum":1},{"type":"number","minimum":0,"maximum":1},{"type":"number","minimum":0,"maximum":1},{"type":"number","minimum":0,"maximum":1}],"items":false,"minItems":4,"maxItems":4},"faceTrackPoint":{"type":"object","additionalProperties":false,"required":["speaker","t","box"],"properties":{"speaker":{"type":"string","minLength":1},"t":{"$ref":"#/$defs/seconds"},"box":{"$ref":"#/$defs/faceBox"}}},"personMatteTrack":{"$comment":"2026-07-23 追加（docs/contract-2026-07-23-analysis-person-matte.md）。実体は VP9 alpha WebM（コンテナに alpha_mode=1）。意味制約として、マット動画の時刻 0 は素材の時刻 0 と一致し、fps はマット動画の実 fps と一致する。Draft 2020-12 標準では外部ファイルを参照できないため、この条件は生成・検証手順で確認する。","type":"object","additionalProperties":false,"required":["path","fps"],"properties":{"path":{"type":"string","minLength":1,"description":"マット動画（VP9 alpha WebM）へのパス。相対パスは analysis.json の所在ディレクトリを基準に解決し、区切りは / を使う。"},"fps":{"type":"number","exclusiveMinimum":0,"description":"マット動画の fps。元素材の fps と一致しなくてよい。"},"quality":{"type":"string","minLength":1,"description":"生成品質。fast / balanced / accurate を例示するが、enum 強制はしない（beats[].kind と同じ流儀）。"},"generated_at":{"type":"string","minLength":1,"description":"生成時刻（ISO8601）。"},"tool":{"type":"string","minLength":1,"description":"生成手段の記録。vision-person-segmentation を例示する。"}}},"tracks":{"type":"object","additionalProperties":false,"required":["speakers","faces","person_matte"],"properties":{"speakers":{"type":"array","items":{"$ref":"#/$defs/speakerTrack"}},"faces":{"type":"array","items":{"$ref":"#/$defs/faceTrackPoint"}},"person_matte":{"description":"生成済み人物マット。未生成なら null。object 形が正（2026-07-23 追加）。string 形は { path } の糖衣として後方互換で受ける（非推奨）。相対パスは analysis.json の所在ディレクトリを基準に解決する。","oneOf":[{"type":"null"},{"type":"string","minLength":1},{"$ref":"#/$defs/personMatteTrack"}]}}}},"$id":"urn:akari-video:schema:analysis:v0"};
const func1 = require("./runtime/ucs2length.cjs").default;
const schema32 = {"type":"object","additionalProperties":false,"required":["start","end","text"],"properties":{"start":{"$ref":"#/$defs/seconds"},"end":{"$ref":"#/$defs/seconds"},"text":{"type":"string","minLength":1},"speaker":{"type":"string","minLength":1},"words":{"type":"array","items":{"$ref":"#/$defs/word"}}}};
const schema33 = {"type":"number","minimum":0};
const schema35 = {"$comment":"M5 契約例で省略されている words の要素を、区間・本文を持つ最小形として定義する。","type":"object","additionalProperties":false,"required":["start","end","text"],"properties":{"start":{"$ref":"#/$defs/seconds"},"end":{"$ref":"#/$defs/seconds"},"text":{"type":"string","minLength":1}}};

function validate22(data, {instancePath="", parentData, parentDataProperty, rootData=data, dynamicAnchors={}}={}){
let vErrors = null;
let errors = 0;
const evaluated0 = validate22.evaluated;
if(evaluated0.dynamicProps){
evaluated0.props = undefined;
}
if(evaluated0.dynamicItems){
evaluated0.items = undefined;
}
if(data && typeof data == "object" && !Array.isArray(data)){
if(data.start === undefined){
const err0 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "start"},message:"must have required property '"+"start"+"'"};
if(vErrors === null){
vErrors = [err0];
}
else {
vErrors.push(err0);
}
errors++;
}
if(data.end === undefined){
const err1 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "end"},message:"must have required property '"+"end"+"'"};
if(vErrors === null){
vErrors = [err1];
}
else {
vErrors.push(err1);
}
errors++;
}
if(data.text === undefined){
const err2 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "text"},message:"must have required property '"+"text"+"'"};
if(vErrors === null){
vErrors = [err2];
}
else {
vErrors.push(err2);
}
errors++;
}
for(const key0 in data){
if(!(((key0 === "start") || (key0 === "end")) || (key0 === "text"))){
const err3 = {instancePath,schemaPath:"#/additionalProperties",keyword:"additionalProperties",params:{additionalProperty: key0},message:"must NOT have additional properties"};
if(vErrors === null){
vErrors = [err3];
}
else {
vErrors.push(err3);
}
errors++;
}
}
if(data.start !== undefined){
let data0 = data.start;
if(typeof data0 == "number"){
if(data0 < 0 || isNaN(data0)){
const err4 = {instancePath:instancePath+"/start",schemaPath:"#/$defs/seconds/minimum",keyword:"minimum",params:{comparison: ">=", limit: 0},message:"must be >= 0"};
if(vErrors === null){
vErrors = [err4];
}
else {
vErrors.push(err4);
}
errors++;
}
}
else {
const err5 = {instancePath:instancePath+"/start",schemaPath:"#/$defs/seconds/type",keyword:"type",params:{type: "number"},message:"must be number"};
if(vErrors === null){
vErrors = [err5];
}
else {
vErrors.push(err5);
}
errors++;
}
}
if(data.end !== undefined){
let data1 = data.end;
if(typeof data1 == "number"){
if(data1 < 0 || isNaN(data1)){
const err6 = {instancePath:instancePath+"/end",schemaPath:"#/$defs/seconds/minimum",keyword:"minimum",params:{comparison: ">=", limit: 0},message:"must be >= 0"};
if(vErrors === null){
vErrors = [err6];
}
else {
vErrors.push(err6);
}
errors++;
}
}
else {
const err7 = {instancePath:instancePath+"/end",schemaPath:"#/$defs/seconds/type",keyword:"type",params:{type: "number"},message:"must be number"};
if(vErrors === null){
vErrors = [err7];
}
else {
vErrors.push(err7);
}
errors++;
}
}
if(data.text !== undefined){
let data2 = data.text;
if(typeof data2 === "string"){
if(func1(data2) < 1){
const err8 = {instancePath:instancePath+"/text",schemaPath:"#/properties/text/minLength",keyword:"minLength",params:{limit: 1},message:"must NOT have fewer than 1 characters"};
if(vErrors === null){
vErrors = [err8];
}
else {
vErrors.push(err8);
}
errors++;
}
}
else {
const err9 = {instancePath:instancePath+"/text",schemaPath:"#/properties/text/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err9];
}
else {
vErrors.push(err9);
}
errors++;
}
}
}
else {
const err10 = {instancePath,schemaPath:"#/type",keyword:"type",params:{type: "object"},message:"must be object"};
if(vErrors === null){
vErrors = [err10];
}
else {
vErrors.push(err10);
}
errors++;
}
validate22.errors = vErrors;
return errors === 0;
}
validate22.evaluated = {"props":true,"dynamicProps":false,"dynamicItems":false};


function validate21(data, {instancePath="", parentData, parentDataProperty, rootData=data, dynamicAnchors={}}={}){
let vErrors = null;
let errors = 0;
const evaluated0 = validate21.evaluated;
if(evaluated0.dynamicProps){
evaluated0.props = undefined;
}
if(evaluated0.dynamicItems){
evaluated0.items = undefined;
}
if(data && typeof data == "object" && !Array.isArray(data)){
if(data.start === undefined){
const err0 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "start"},message:"must have required property '"+"start"+"'"};
if(vErrors === null){
vErrors = [err0];
}
else {
vErrors.push(err0);
}
errors++;
}
if(data.end === undefined){
const err1 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "end"},message:"must have required property '"+"end"+"'"};
if(vErrors === null){
vErrors = [err1];
}
else {
vErrors.push(err1);
}
errors++;
}
if(data.text === undefined){
const err2 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "text"},message:"must have required property '"+"text"+"'"};
if(vErrors === null){
vErrors = [err2];
}
else {
vErrors.push(err2);
}
errors++;
}
for(const key0 in data){
if(!(((((key0 === "start") || (key0 === "end")) || (key0 === "text")) || (key0 === "speaker")) || (key0 === "words"))){
const err3 = {instancePath,schemaPath:"#/additionalProperties",keyword:"additionalProperties",params:{additionalProperty: key0},message:"must NOT have additional properties"};
if(vErrors === null){
vErrors = [err3];
}
else {
vErrors.push(err3);
}
errors++;
}
}
if(data.start !== undefined){
let data0 = data.start;
if(typeof data0 == "number"){
if(data0 < 0 || isNaN(data0)){
const err4 = {instancePath:instancePath+"/start",schemaPath:"#/$defs/seconds/minimum",keyword:"minimum",params:{comparison: ">=", limit: 0},message:"must be >= 0"};
if(vErrors === null){
vErrors = [err4];
}
else {
vErrors.push(err4);
}
errors++;
}
}
else {
const err5 = {instancePath:instancePath+"/start",schemaPath:"#/$defs/seconds/type",keyword:"type",params:{type: "number"},message:"must be number"};
if(vErrors === null){
vErrors = [err5];
}
else {
vErrors.push(err5);
}
errors++;
}
}
if(data.end !== undefined){
let data1 = data.end;
if(typeof data1 == "number"){
if(data1 < 0 || isNaN(data1)){
const err6 = {instancePath:instancePath+"/end",schemaPath:"#/$defs/seconds/minimum",keyword:"minimum",params:{comparison: ">=", limit: 0},message:"must be >= 0"};
if(vErrors === null){
vErrors = [err6];
}
else {
vErrors.push(err6);
}
errors++;
}
}
else {
const err7 = {instancePath:instancePath+"/end",schemaPath:"#/$defs/seconds/type",keyword:"type",params:{type: "number"},message:"must be number"};
if(vErrors === null){
vErrors = [err7];
}
else {
vErrors.push(err7);
}
errors++;
}
}
if(data.text !== undefined){
let data2 = data.text;
if(typeof data2 === "string"){
if(func1(data2) < 1){
const err8 = {instancePath:instancePath+"/text",schemaPath:"#/properties/text/minLength",keyword:"minLength",params:{limit: 1},message:"must NOT have fewer than 1 characters"};
if(vErrors === null){
vErrors = [err8];
}
else {
vErrors.push(err8);
}
errors++;
}
}
else {
const err9 = {instancePath:instancePath+"/text",schemaPath:"#/properties/text/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err9];
}
else {
vErrors.push(err9);
}
errors++;
}
}
if(data.speaker !== undefined){
let data3 = data.speaker;
if(typeof data3 === "string"){
if(func1(data3) < 1){
const err10 = {instancePath:instancePath+"/speaker",schemaPath:"#/properties/speaker/minLength",keyword:"minLength",params:{limit: 1},message:"must NOT have fewer than 1 characters"};
if(vErrors === null){
vErrors = [err10];
}
else {
vErrors.push(err10);
}
errors++;
}
}
else {
const err11 = {instancePath:instancePath+"/speaker",schemaPath:"#/properties/speaker/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err11];
}
else {
vErrors.push(err11);
}
errors++;
}
}
if(data.words !== undefined){
let data4 = data.words;
if(Array.isArray(data4)){
const len0 = data4.length;
for(let i0=0; i0<len0; i0++){
if(!(validate22(data4[i0], {instancePath:instancePath+"/words/" + i0,parentData:data4,parentDataProperty:i0,rootData,dynamicAnchors}))){
vErrors = vErrors === null ? validate22.errors : vErrors.concat(validate22.errors);
errors = vErrors.length;
}
}
}
else {
const err12 = {instancePath:instancePath+"/words",schemaPath:"#/properties/words/type",keyword:"type",params:{type: "array"},message:"must be array"};
if(vErrors === null){
vErrors = [err12];
}
else {
vErrors.push(err12);
}
errors++;
}
}
}
else {
const err13 = {instancePath,schemaPath:"#/type",keyword:"type",params:{type: "object"},message:"must be object"};
if(vErrors === null){
vErrors = [err13];
}
else {
vErrors.push(err13);
}
errors++;
}
validate21.errors = vErrors;
return errors === 0;
}
validate21.evaluated = {"props":true,"dynamicProps":false,"dynamicItems":false};

const schema38 = {"type":"object","additionalProperties":false,"required":["t","path","note"],"properties":{"t":{"$ref":"#/$defs/seconds"},"path":{"type":"string","minLength":1,"description":"キーフレーム画像へのパス。相対パスは analysis.json の所在ディレクトリを基準に解決する。"},"note":{"type":"string","minLength":1},"origin":{"enum":["scene","interval","transcript"],"description":"採用元の抽出系統（2026-07-14 追加・任意）。scene = 映像変化検出、interval = 一定間隔、transcript = 発話由来（highlight 等の時刻から抽出）。候補と note の対応トレーサビリティにも使う。"}}};

function validate25(data, {instancePath="", parentData, parentDataProperty, rootData=data, dynamicAnchors={}}={}){
let vErrors = null;
let errors = 0;
const evaluated0 = validate25.evaluated;
if(evaluated0.dynamicProps){
evaluated0.props = undefined;
}
if(evaluated0.dynamicItems){
evaluated0.items = undefined;
}
if(data && typeof data == "object" && !Array.isArray(data)){
if(data.t === undefined){
const err0 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "t"},message:"must have required property '"+"t"+"'"};
if(vErrors === null){
vErrors = [err0];
}
else {
vErrors.push(err0);
}
errors++;
}
if(data.path === undefined){
const err1 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "path"},message:"must have required property '"+"path"+"'"};
if(vErrors === null){
vErrors = [err1];
}
else {
vErrors.push(err1);
}
errors++;
}
if(data.note === undefined){
const err2 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "note"},message:"must have required property '"+"note"+"'"};
if(vErrors === null){
vErrors = [err2];
}
else {
vErrors.push(err2);
}
errors++;
}
for(const key0 in data){
if(!((((key0 === "t") || (key0 === "path")) || (key0 === "note")) || (key0 === "origin"))){
const err3 = {instancePath,schemaPath:"#/additionalProperties",keyword:"additionalProperties",params:{additionalProperty: key0},message:"must NOT have additional properties"};
if(vErrors === null){
vErrors = [err3];
}
else {
vErrors.push(err3);
}
errors++;
}
}
if(data.t !== undefined){
let data0 = data.t;
if(typeof data0 == "number"){
if(data0 < 0 || isNaN(data0)){
const err4 = {instancePath:instancePath+"/t",schemaPath:"#/$defs/seconds/minimum",keyword:"minimum",params:{comparison: ">=", limit: 0},message:"must be >= 0"};
if(vErrors === null){
vErrors = [err4];
}
else {
vErrors.push(err4);
}
errors++;
}
}
else {
const err5 = {instancePath:instancePath+"/t",schemaPath:"#/$defs/seconds/type",keyword:"type",params:{type: "number"},message:"must be number"};
if(vErrors === null){
vErrors = [err5];
}
else {
vErrors.push(err5);
}
errors++;
}
}
if(data.path !== undefined){
let data1 = data.path;
if(typeof data1 === "string"){
if(func1(data1) < 1){
const err6 = {instancePath:instancePath+"/path",schemaPath:"#/properties/path/minLength",keyword:"minLength",params:{limit: 1},message:"must NOT have fewer than 1 characters"};
if(vErrors === null){
vErrors = [err6];
}
else {
vErrors.push(err6);
}
errors++;
}
}
else {
const err7 = {instancePath:instancePath+"/path",schemaPath:"#/properties/path/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err7];
}
else {
vErrors.push(err7);
}
errors++;
}
}
if(data.note !== undefined){
let data2 = data.note;
if(typeof data2 === "string"){
if(func1(data2) < 1){
const err8 = {instancePath:instancePath+"/note",schemaPath:"#/properties/note/minLength",keyword:"minLength",params:{limit: 1},message:"must NOT have fewer than 1 characters"};
if(vErrors === null){
vErrors = [err8];
}
else {
vErrors.push(err8);
}
errors++;
}
}
else {
const err9 = {instancePath:instancePath+"/note",schemaPath:"#/properties/note/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err9];
}
else {
vErrors.push(err9);
}
errors++;
}
}
if(data.origin !== undefined){
let data3 = data.origin;
if(!(((data3 === "scene") || (data3 === "interval")) || (data3 === "transcript"))){
const err10 = {instancePath:instancePath+"/origin",schemaPath:"#/properties/origin/enum",keyword:"enum",params:{allowedValues: schema38.properties.origin.enum},message:"must be equal to one of the allowed values"};
if(vErrors === null){
vErrors = [err10];
}
else {
vErrors.push(err10);
}
errors++;
}
}
}
else {
const err11 = {instancePath,schemaPath:"#/type",keyword:"type",params:{type: "object"},message:"must be object"};
if(vErrors === null){
vErrors = [err11];
}
else {
vErrors.push(err11);
}
errors++;
}
validate25.errors = vErrors;
return errors === 0;
}
validate25.evaluated = {"props":true,"dynamicProps":false,"dynamicItems":false};

const schema40 = {"oneOf":[{"$ref":"#/$defs/fillerEvent"},{"$ref":"#/$defs/troubleEvent"},{"$ref":"#/$defs/chapterEvent"},{"$ref":"#/$defs/highlightEvent"},{"$ref":"#/$defs/hookEvent"}]};
const schema41 = {"type":"object","additionalProperties":false,"required":["type","start","end"],"properties":{"type":{"const":"filler"},"start":{"$ref":"#/$defs/seconds"},"end":{"$ref":"#/$defs/seconds"}}};

function validate28(data, {instancePath="", parentData, parentDataProperty, rootData=data, dynamicAnchors={}}={}){
let vErrors = null;
let errors = 0;
const evaluated0 = validate28.evaluated;
if(evaluated0.dynamicProps){
evaluated0.props = undefined;
}
if(evaluated0.dynamicItems){
evaluated0.items = undefined;
}
if(data && typeof data == "object" && !Array.isArray(data)){
if(data.type === undefined){
const err0 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "type"},message:"must have required property '"+"type"+"'"};
if(vErrors === null){
vErrors = [err0];
}
else {
vErrors.push(err0);
}
errors++;
}
if(data.start === undefined){
const err1 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "start"},message:"must have required property '"+"start"+"'"};
if(vErrors === null){
vErrors = [err1];
}
else {
vErrors.push(err1);
}
errors++;
}
if(data.end === undefined){
const err2 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "end"},message:"must have required property '"+"end"+"'"};
if(vErrors === null){
vErrors = [err2];
}
else {
vErrors.push(err2);
}
errors++;
}
for(const key0 in data){
if(!(((key0 === "type") || (key0 === "start")) || (key0 === "end"))){
const err3 = {instancePath,schemaPath:"#/additionalProperties",keyword:"additionalProperties",params:{additionalProperty: key0},message:"must NOT have additional properties"};
if(vErrors === null){
vErrors = [err3];
}
else {
vErrors.push(err3);
}
errors++;
}
}
if(data.type !== undefined){
if("filler" !== data.type){
const err4 = {instancePath:instancePath+"/type",schemaPath:"#/properties/type/const",keyword:"const",params:{allowedValue: "filler"},message:"must be equal to constant"};
if(vErrors === null){
vErrors = [err4];
}
else {
vErrors.push(err4);
}
errors++;
}
}
if(data.start !== undefined){
let data1 = data.start;
if(typeof data1 == "number"){
if(data1 < 0 || isNaN(data1)){
const err5 = {instancePath:instancePath+"/start",schemaPath:"#/$defs/seconds/minimum",keyword:"minimum",params:{comparison: ">=", limit: 0},message:"must be >= 0"};
if(vErrors === null){
vErrors = [err5];
}
else {
vErrors.push(err5);
}
errors++;
}
}
else {
const err6 = {instancePath:instancePath+"/start",schemaPath:"#/$defs/seconds/type",keyword:"type",params:{type: "number"},message:"must be number"};
if(vErrors === null){
vErrors = [err6];
}
else {
vErrors.push(err6);
}
errors++;
}
}
if(data.end !== undefined){
let data2 = data.end;
if(typeof data2 == "number"){
if(data2 < 0 || isNaN(data2)){
const err7 = {instancePath:instancePath+"/end",schemaPath:"#/$defs/seconds/minimum",keyword:"minimum",params:{comparison: ">=", limit: 0},message:"must be >= 0"};
if(vErrors === null){
vErrors = [err7];
}
else {
vErrors.push(err7);
}
errors++;
}
}
else {
const err8 = {instancePath:instancePath+"/end",schemaPath:"#/$defs/seconds/type",keyword:"type",params:{type: "number"},message:"must be number"};
if(vErrors === null){
vErrors = [err8];
}
else {
vErrors.push(err8);
}
errors++;
}
}
}
else {
const err9 = {instancePath,schemaPath:"#/type",keyword:"type",params:{type: "object"},message:"must be object"};
if(vErrors === null){
vErrors = [err9];
}
else {
vErrors.push(err9);
}
errors++;
}
validate28.errors = vErrors;
return errors === 0;
}
validate28.evaluated = {"props":true,"dynamicProps":false,"dynamicItems":false};

const schema44 = {"type":"object","additionalProperties":false,"required":["type","start","end","note"],"properties":{"type":{"const":"trouble"},"start":{"$ref":"#/$defs/seconds"},"end":{"$ref":"#/$defs/seconds"},"note":{"type":"string","minLength":1}}};

function validate30(data, {instancePath="", parentData, parentDataProperty, rootData=data, dynamicAnchors={}}={}){
let vErrors = null;
let errors = 0;
const evaluated0 = validate30.evaluated;
if(evaluated0.dynamicProps){
evaluated0.props = undefined;
}
if(evaluated0.dynamicItems){
evaluated0.items = undefined;
}
if(data && typeof data == "object" && !Array.isArray(data)){
if(data.type === undefined){
const err0 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "type"},message:"must have required property '"+"type"+"'"};
if(vErrors === null){
vErrors = [err0];
}
else {
vErrors.push(err0);
}
errors++;
}
if(data.start === undefined){
const err1 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "start"},message:"must have required property '"+"start"+"'"};
if(vErrors === null){
vErrors = [err1];
}
else {
vErrors.push(err1);
}
errors++;
}
if(data.end === undefined){
const err2 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "end"},message:"must have required property '"+"end"+"'"};
if(vErrors === null){
vErrors = [err2];
}
else {
vErrors.push(err2);
}
errors++;
}
if(data.note === undefined){
const err3 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "note"},message:"must have required property '"+"note"+"'"};
if(vErrors === null){
vErrors = [err3];
}
else {
vErrors.push(err3);
}
errors++;
}
for(const key0 in data){
if(!((((key0 === "type") || (key0 === "start")) || (key0 === "end")) || (key0 === "note"))){
const err4 = {instancePath,schemaPath:"#/additionalProperties",keyword:"additionalProperties",params:{additionalProperty: key0},message:"must NOT have additional properties"};
if(vErrors === null){
vErrors = [err4];
}
else {
vErrors.push(err4);
}
errors++;
}
}
if(data.type !== undefined){
if("trouble" !== data.type){
const err5 = {instancePath:instancePath+"/type",schemaPath:"#/properties/type/const",keyword:"const",params:{allowedValue: "trouble"},message:"must be equal to constant"};
if(vErrors === null){
vErrors = [err5];
}
else {
vErrors.push(err5);
}
errors++;
}
}
if(data.start !== undefined){
let data1 = data.start;
if(typeof data1 == "number"){
if(data1 < 0 || isNaN(data1)){
const err6 = {instancePath:instancePath+"/start",schemaPath:"#/$defs/seconds/minimum",keyword:"minimum",params:{comparison: ">=", limit: 0},message:"must be >= 0"};
if(vErrors === null){
vErrors = [err6];
}
else {
vErrors.push(err6);
}
errors++;
}
}
else {
const err7 = {instancePath:instancePath+"/start",schemaPath:"#/$defs/seconds/type",keyword:"type",params:{type: "number"},message:"must be number"};
if(vErrors === null){
vErrors = [err7];
}
else {
vErrors.push(err7);
}
errors++;
}
}
if(data.end !== undefined){
let data2 = data.end;
if(typeof data2 == "number"){
if(data2 < 0 || isNaN(data2)){
const err8 = {instancePath:instancePath+"/end",schemaPath:"#/$defs/seconds/minimum",keyword:"minimum",params:{comparison: ">=", limit: 0},message:"must be >= 0"};
if(vErrors === null){
vErrors = [err8];
}
else {
vErrors.push(err8);
}
errors++;
}
}
else {
const err9 = {instancePath:instancePath+"/end",schemaPath:"#/$defs/seconds/type",keyword:"type",params:{type: "number"},message:"must be number"};
if(vErrors === null){
vErrors = [err9];
}
else {
vErrors.push(err9);
}
errors++;
}
}
if(data.note !== undefined){
let data3 = data.note;
if(typeof data3 === "string"){
if(func1(data3) < 1){
const err10 = {instancePath:instancePath+"/note",schemaPath:"#/properties/note/minLength",keyword:"minLength",params:{limit: 1},message:"must NOT have fewer than 1 characters"};
if(vErrors === null){
vErrors = [err10];
}
else {
vErrors.push(err10);
}
errors++;
}
}
else {
const err11 = {instancePath:instancePath+"/note",schemaPath:"#/properties/note/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err11];
}
else {
vErrors.push(err11);
}
errors++;
}
}
}
else {
const err12 = {instancePath,schemaPath:"#/type",keyword:"type",params:{type: "object"},message:"must be object"};
if(vErrors === null){
vErrors = [err12];
}
else {
vErrors.push(err12);
}
errors++;
}
validate30.errors = vErrors;
return errors === 0;
}
validate30.evaluated = {"props":true,"dynamicProps":false,"dynamicItems":false};

const schema47 = {"type":"object","additionalProperties":false,"required":["type","t","title"],"properties":{"type":{"const":"chapter"},"t":{"$ref":"#/$defs/seconds"},"title":{"type":"string","minLength":1}}};

function validate32(data, {instancePath="", parentData, parentDataProperty, rootData=data, dynamicAnchors={}}={}){
let vErrors = null;
let errors = 0;
const evaluated0 = validate32.evaluated;
if(evaluated0.dynamicProps){
evaluated0.props = undefined;
}
if(evaluated0.dynamicItems){
evaluated0.items = undefined;
}
if(data && typeof data == "object" && !Array.isArray(data)){
if(data.type === undefined){
const err0 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "type"},message:"must have required property '"+"type"+"'"};
if(vErrors === null){
vErrors = [err0];
}
else {
vErrors.push(err0);
}
errors++;
}
if(data.t === undefined){
const err1 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "t"},message:"must have required property '"+"t"+"'"};
if(vErrors === null){
vErrors = [err1];
}
else {
vErrors.push(err1);
}
errors++;
}
if(data.title === undefined){
const err2 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "title"},message:"must have required property '"+"title"+"'"};
if(vErrors === null){
vErrors = [err2];
}
else {
vErrors.push(err2);
}
errors++;
}
for(const key0 in data){
if(!(((key0 === "type") || (key0 === "t")) || (key0 === "title"))){
const err3 = {instancePath,schemaPath:"#/additionalProperties",keyword:"additionalProperties",params:{additionalProperty: key0},message:"must NOT have additional properties"};
if(vErrors === null){
vErrors = [err3];
}
else {
vErrors.push(err3);
}
errors++;
}
}
if(data.type !== undefined){
if("chapter" !== data.type){
const err4 = {instancePath:instancePath+"/type",schemaPath:"#/properties/type/const",keyword:"const",params:{allowedValue: "chapter"},message:"must be equal to constant"};
if(vErrors === null){
vErrors = [err4];
}
else {
vErrors.push(err4);
}
errors++;
}
}
if(data.t !== undefined){
let data1 = data.t;
if(typeof data1 == "number"){
if(data1 < 0 || isNaN(data1)){
const err5 = {instancePath:instancePath+"/t",schemaPath:"#/$defs/seconds/minimum",keyword:"minimum",params:{comparison: ">=", limit: 0},message:"must be >= 0"};
if(vErrors === null){
vErrors = [err5];
}
else {
vErrors.push(err5);
}
errors++;
}
}
else {
const err6 = {instancePath:instancePath+"/t",schemaPath:"#/$defs/seconds/type",keyword:"type",params:{type: "number"},message:"must be number"};
if(vErrors === null){
vErrors = [err6];
}
else {
vErrors.push(err6);
}
errors++;
}
}
if(data.title !== undefined){
let data2 = data.title;
if(typeof data2 === "string"){
if(func1(data2) < 1){
const err7 = {instancePath:instancePath+"/title",schemaPath:"#/properties/title/minLength",keyword:"minLength",params:{limit: 1},message:"must NOT have fewer than 1 characters"};
if(vErrors === null){
vErrors = [err7];
}
else {
vErrors.push(err7);
}
errors++;
}
}
else {
const err8 = {instancePath:instancePath+"/title",schemaPath:"#/properties/title/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err8];
}
else {
vErrors.push(err8);
}
errors++;
}
}
}
else {
const err9 = {instancePath,schemaPath:"#/type",keyword:"type",params:{type: "object"},message:"must be object"};
if(vErrors === null){
vErrors = [err9];
}
else {
vErrors.push(err9);
}
errors++;
}
validate32.errors = vErrors;
return errors === 0;
}
validate32.evaluated = {"props":true,"dynamicProps":false,"dynamicItems":false};

const schema49 = {"$comment":"2026-07-14 追加（後方互換の追加語彙）。ショート向けの hook と異なり、決定事項・結論・数字・強い主張など編集判断全般の根拠になる重要発言を記録する。","type":"object","additionalProperties":false,"required":["type","start","end","quote","reason"],"properties":{"type":{"const":"highlight"},"start":{"$ref":"#/$defs/seconds"},"end":{"$ref":"#/$defs/seconds"},"quote":{"type":"string","minLength":1,"description":"transcript の実発言に忠実な引用。要約・創作をしない。"},"reason":{"type":"string","minLength":1,"description":"なぜ重要か（決定事項・結論・数値/実績・強い主張などの根拠カテゴリと内容）。"},"importance":{"$ref":"#/$defs/scoreValue"}}};
const schema52 = {"$comment":"1〜5 の整数尺度は analysis.json v0 の運用仮定。採用閾値は M5 契約どおり運用で調整する。","type":"integer","minimum":1,"maximum":5};

function validate34(data, {instancePath="", parentData, parentDataProperty, rootData=data, dynamicAnchors={}}={}){
let vErrors = null;
let errors = 0;
const evaluated0 = validate34.evaluated;
if(evaluated0.dynamicProps){
evaluated0.props = undefined;
}
if(evaluated0.dynamicItems){
evaluated0.items = undefined;
}
if(data && typeof data == "object" && !Array.isArray(data)){
if(data.type === undefined){
const err0 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "type"},message:"must have required property '"+"type"+"'"};
if(vErrors === null){
vErrors = [err0];
}
else {
vErrors.push(err0);
}
errors++;
}
if(data.start === undefined){
const err1 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "start"},message:"must have required property '"+"start"+"'"};
if(vErrors === null){
vErrors = [err1];
}
else {
vErrors.push(err1);
}
errors++;
}
if(data.end === undefined){
const err2 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "end"},message:"must have required property '"+"end"+"'"};
if(vErrors === null){
vErrors = [err2];
}
else {
vErrors.push(err2);
}
errors++;
}
if(data.quote === undefined){
const err3 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "quote"},message:"must have required property '"+"quote"+"'"};
if(vErrors === null){
vErrors = [err3];
}
else {
vErrors.push(err3);
}
errors++;
}
if(data.reason === undefined){
const err4 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "reason"},message:"must have required property '"+"reason"+"'"};
if(vErrors === null){
vErrors = [err4];
}
else {
vErrors.push(err4);
}
errors++;
}
for(const key0 in data){
if(!((((((key0 === "type") || (key0 === "start")) || (key0 === "end")) || (key0 === "quote")) || (key0 === "reason")) || (key0 === "importance"))){
const err5 = {instancePath,schemaPath:"#/additionalProperties",keyword:"additionalProperties",params:{additionalProperty: key0},message:"must NOT have additional properties"};
if(vErrors === null){
vErrors = [err5];
}
else {
vErrors.push(err5);
}
errors++;
}
}
if(data.type !== undefined){
if("highlight" !== data.type){
const err6 = {instancePath:instancePath+"/type",schemaPath:"#/properties/type/const",keyword:"const",params:{allowedValue: "highlight"},message:"must be equal to constant"};
if(vErrors === null){
vErrors = [err6];
}
else {
vErrors.push(err6);
}
errors++;
}
}
if(data.start !== undefined){
let data1 = data.start;
if(typeof data1 == "number"){
if(data1 < 0 || isNaN(data1)){
const err7 = {instancePath:instancePath+"/start",schemaPath:"#/$defs/seconds/minimum",keyword:"minimum",params:{comparison: ">=", limit: 0},message:"must be >= 0"};
if(vErrors === null){
vErrors = [err7];
}
else {
vErrors.push(err7);
}
errors++;
}
}
else {
const err8 = {instancePath:instancePath+"/start",schemaPath:"#/$defs/seconds/type",keyword:"type",params:{type: "number"},message:"must be number"};
if(vErrors === null){
vErrors = [err8];
}
else {
vErrors.push(err8);
}
errors++;
}
}
if(data.end !== undefined){
let data2 = data.end;
if(typeof data2 == "number"){
if(data2 < 0 || isNaN(data2)){
const err9 = {instancePath:instancePath+"/end",schemaPath:"#/$defs/seconds/minimum",keyword:"minimum",params:{comparison: ">=", limit: 0},message:"must be >= 0"};
if(vErrors === null){
vErrors = [err9];
}
else {
vErrors.push(err9);
}
errors++;
}
}
else {
const err10 = {instancePath:instancePath+"/end",schemaPath:"#/$defs/seconds/type",keyword:"type",params:{type: "number"},message:"must be number"};
if(vErrors === null){
vErrors = [err10];
}
else {
vErrors.push(err10);
}
errors++;
}
}
if(data.quote !== undefined){
let data3 = data.quote;
if(typeof data3 === "string"){
if(func1(data3) < 1){
const err11 = {instancePath:instancePath+"/quote",schemaPath:"#/properties/quote/minLength",keyword:"minLength",params:{limit: 1},message:"must NOT have fewer than 1 characters"};
if(vErrors === null){
vErrors = [err11];
}
else {
vErrors.push(err11);
}
errors++;
}
}
else {
const err12 = {instancePath:instancePath+"/quote",schemaPath:"#/properties/quote/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err12];
}
else {
vErrors.push(err12);
}
errors++;
}
}
if(data.reason !== undefined){
let data4 = data.reason;
if(typeof data4 === "string"){
if(func1(data4) < 1){
const err13 = {instancePath:instancePath+"/reason",schemaPath:"#/properties/reason/minLength",keyword:"minLength",params:{limit: 1},message:"must NOT have fewer than 1 characters"};
if(vErrors === null){
vErrors = [err13];
}
else {
vErrors.push(err13);
}
errors++;
}
}
else {
const err14 = {instancePath:instancePath+"/reason",schemaPath:"#/properties/reason/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err14];
}
else {
vErrors.push(err14);
}
errors++;
}
}
if(data.importance !== undefined){
let data5 = data.importance;
if(!((typeof data5 == "number") && (!(data5 % 1) && !isNaN(data5)))){
const err15 = {instancePath:instancePath+"/importance",schemaPath:"#/$defs/scoreValue/type",keyword:"type",params:{type: "integer"},message:"must be integer"};
if(vErrors === null){
vErrors = [err15];
}
else {
vErrors.push(err15);
}
errors++;
}
if(typeof data5 == "number"){
if(data5 > 5 || isNaN(data5)){
const err16 = {instancePath:instancePath+"/importance",schemaPath:"#/$defs/scoreValue/maximum",keyword:"maximum",params:{comparison: "<=", limit: 5},message:"must be <= 5"};
if(vErrors === null){
vErrors = [err16];
}
else {
vErrors.push(err16);
}
errors++;
}
if(data5 < 1 || isNaN(data5)){
const err17 = {instancePath:instancePath+"/importance",schemaPath:"#/$defs/scoreValue/minimum",keyword:"minimum",params:{comparison: ">=", limit: 1},message:"must be >= 1"};
if(vErrors === null){
vErrors = [err17];
}
else {
vErrors.push(err17);
}
errors++;
}
}
}
}
else {
const err18 = {instancePath,schemaPath:"#/type",keyword:"type",params:{type: "object"},message:"must be object"};
if(vErrors === null){
vErrors = [err18];
}
else {
vErrors.push(err18);
}
errors++;
}
validate34.errors = vErrors;
return errors === 0;
}
validate34.evaluated = {"props":true,"dynamicProps":false,"dynamicItems":false};

const schema53 = {"type":"object","additionalProperties":false,"required":["type","start","end","score"],"properties":{"type":{"const":"hook"},"start":{"$ref":"#/$defs/seconds"},"end":{"$ref":"#/$defs/seconds"},"score":{"$ref":"#/$defs/hookScore"}}};
const schema56 = {"type":"object","additionalProperties":false,"required":["hook","self_contained","emotion","density","punch"],"properties":{"hook":{"$ref":"#/$defs/scoreValue"},"self_contained":{"$ref":"#/$defs/scoreValue"},"emotion":{"$ref":"#/$defs/scoreValue"},"density":{"$ref":"#/$defs/scoreValue"},"punch":{"$ref":"#/$defs/scoreValue"}}};

function validate37(data, {instancePath="", parentData, parentDataProperty, rootData=data, dynamicAnchors={}}={}){
let vErrors = null;
let errors = 0;
const evaluated0 = validate37.evaluated;
if(evaluated0.dynamicProps){
evaluated0.props = undefined;
}
if(evaluated0.dynamicItems){
evaluated0.items = undefined;
}
if(data && typeof data == "object" && !Array.isArray(data)){
if(data.hook === undefined){
const err0 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "hook"},message:"must have required property '"+"hook"+"'"};
if(vErrors === null){
vErrors = [err0];
}
else {
vErrors.push(err0);
}
errors++;
}
if(data.self_contained === undefined){
const err1 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "self_contained"},message:"must have required property '"+"self_contained"+"'"};
if(vErrors === null){
vErrors = [err1];
}
else {
vErrors.push(err1);
}
errors++;
}
if(data.emotion === undefined){
const err2 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "emotion"},message:"must have required property '"+"emotion"+"'"};
if(vErrors === null){
vErrors = [err2];
}
else {
vErrors.push(err2);
}
errors++;
}
if(data.density === undefined){
const err3 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "density"},message:"must have required property '"+"density"+"'"};
if(vErrors === null){
vErrors = [err3];
}
else {
vErrors.push(err3);
}
errors++;
}
if(data.punch === undefined){
const err4 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "punch"},message:"must have required property '"+"punch"+"'"};
if(vErrors === null){
vErrors = [err4];
}
else {
vErrors.push(err4);
}
errors++;
}
for(const key0 in data){
if(!(((((key0 === "hook") || (key0 === "self_contained")) || (key0 === "emotion")) || (key0 === "density")) || (key0 === "punch"))){
const err5 = {instancePath,schemaPath:"#/additionalProperties",keyword:"additionalProperties",params:{additionalProperty: key0},message:"must NOT have additional properties"};
if(vErrors === null){
vErrors = [err5];
}
else {
vErrors.push(err5);
}
errors++;
}
}
if(data.hook !== undefined){
let data0 = data.hook;
if(!((typeof data0 == "number") && (!(data0 % 1) && !isNaN(data0)))){
const err6 = {instancePath:instancePath+"/hook",schemaPath:"#/$defs/scoreValue/type",keyword:"type",params:{type: "integer"},message:"must be integer"};
if(vErrors === null){
vErrors = [err6];
}
else {
vErrors.push(err6);
}
errors++;
}
if(typeof data0 == "number"){
if(data0 > 5 || isNaN(data0)){
const err7 = {instancePath:instancePath+"/hook",schemaPath:"#/$defs/scoreValue/maximum",keyword:"maximum",params:{comparison: "<=", limit: 5},message:"must be <= 5"};
if(vErrors === null){
vErrors = [err7];
}
else {
vErrors.push(err7);
}
errors++;
}
if(data0 < 1 || isNaN(data0)){
const err8 = {instancePath:instancePath+"/hook",schemaPath:"#/$defs/scoreValue/minimum",keyword:"minimum",params:{comparison: ">=", limit: 1},message:"must be >= 1"};
if(vErrors === null){
vErrors = [err8];
}
else {
vErrors.push(err8);
}
errors++;
}
}
}
if(data.self_contained !== undefined){
let data1 = data.self_contained;
if(!((typeof data1 == "number") && (!(data1 % 1) && !isNaN(data1)))){
const err9 = {instancePath:instancePath+"/self_contained",schemaPath:"#/$defs/scoreValue/type",keyword:"type",params:{type: "integer"},message:"must be integer"};
if(vErrors === null){
vErrors = [err9];
}
else {
vErrors.push(err9);
}
errors++;
}
if(typeof data1 == "number"){
if(data1 > 5 || isNaN(data1)){
const err10 = {instancePath:instancePath+"/self_contained",schemaPath:"#/$defs/scoreValue/maximum",keyword:"maximum",params:{comparison: "<=", limit: 5},message:"must be <= 5"};
if(vErrors === null){
vErrors = [err10];
}
else {
vErrors.push(err10);
}
errors++;
}
if(data1 < 1 || isNaN(data1)){
const err11 = {instancePath:instancePath+"/self_contained",schemaPath:"#/$defs/scoreValue/minimum",keyword:"minimum",params:{comparison: ">=", limit: 1},message:"must be >= 1"};
if(vErrors === null){
vErrors = [err11];
}
else {
vErrors.push(err11);
}
errors++;
}
}
}
if(data.emotion !== undefined){
let data2 = data.emotion;
if(!((typeof data2 == "number") && (!(data2 % 1) && !isNaN(data2)))){
const err12 = {instancePath:instancePath+"/emotion",schemaPath:"#/$defs/scoreValue/type",keyword:"type",params:{type: "integer"},message:"must be integer"};
if(vErrors === null){
vErrors = [err12];
}
else {
vErrors.push(err12);
}
errors++;
}
if(typeof data2 == "number"){
if(data2 > 5 || isNaN(data2)){
const err13 = {instancePath:instancePath+"/emotion",schemaPath:"#/$defs/scoreValue/maximum",keyword:"maximum",params:{comparison: "<=", limit: 5},message:"must be <= 5"};
if(vErrors === null){
vErrors = [err13];
}
else {
vErrors.push(err13);
}
errors++;
}
if(data2 < 1 || isNaN(data2)){
const err14 = {instancePath:instancePath+"/emotion",schemaPath:"#/$defs/scoreValue/minimum",keyword:"minimum",params:{comparison: ">=", limit: 1},message:"must be >= 1"};
if(vErrors === null){
vErrors = [err14];
}
else {
vErrors.push(err14);
}
errors++;
}
}
}
if(data.density !== undefined){
let data3 = data.density;
if(!((typeof data3 == "number") && (!(data3 % 1) && !isNaN(data3)))){
const err15 = {instancePath:instancePath+"/density",schemaPath:"#/$defs/scoreValue/type",keyword:"type",params:{type: "integer"},message:"must be integer"};
if(vErrors === null){
vErrors = [err15];
}
else {
vErrors.push(err15);
}
errors++;
}
if(typeof data3 == "number"){
if(data3 > 5 || isNaN(data3)){
const err16 = {instancePath:instancePath+"/density",schemaPath:"#/$defs/scoreValue/maximum",keyword:"maximum",params:{comparison: "<=", limit: 5},message:"must be <= 5"};
if(vErrors === null){
vErrors = [err16];
}
else {
vErrors.push(err16);
}
errors++;
}
if(data3 < 1 || isNaN(data3)){
const err17 = {instancePath:instancePath+"/density",schemaPath:"#/$defs/scoreValue/minimum",keyword:"minimum",params:{comparison: ">=", limit: 1},message:"must be >= 1"};
if(vErrors === null){
vErrors = [err17];
}
else {
vErrors.push(err17);
}
errors++;
}
}
}
if(data.punch !== undefined){
let data4 = data.punch;
if(!((typeof data4 == "number") && (!(data4 % 1) && !isNaN(data4)))){
const err18 = {instancePath:instancePath+"/punch",schemaPath:"#/$defs/scoreValue/type",keyword:"type",params:{type: "integer"},message:"must be integer"};
if(vErrors === null){
vErrors = [err18];
}
else {
vErrors.push(err18);
}
errors++;
}
if(typeof data4 == "number"){
if(data4 > 5 || isNaN(data4)){
const err19 = {instancePath:instancePath+"/punch",schemaPath:"#/$defs/scoreValue/maximum",keyword:"maximum",params:{comparison: "<=", limit: 5},message:"must be <= 5"};
if(vErrors === null){
vErrors = [err19];
}
else {
vErrors.push(err19);
}
errors++;
}
if(data4 < 1 || isNaN(data4)){
const err20 = {instancePath:instancePath+"/punch",schemaPath:"#/$defs/scoreValue/minimum",keyword:"minimum",params:{comparison: ">=", limit: 1},message:"must be >= 1"};
if(vErrors === null){
vErrors = [err20];
}
else {
vErrors.push(err20);
}
errors++;
}
}
}
}
else {
const err21 = {instancePath,schemaPath:"#/type",keyword:"type",params:{type: "object"},message:"must be object"};
if(vErrors === null){
vErrors = [err21];
}
else {
vErrors.push(err21);
}
errors++;
}
validate37.errors = vErrors;
return errors === 0;
}
validate37.evaluated = {"props":true,"dynamicProps":false,"dynamicItems":false};


function validate36(data, {instancePath="", parentData, parentDataProperty, rootData=data, dynamicAnchors={}}={}){
let vErrors = null;
let errors = 0;
const evaluated0 = validate36.evaluated;
if(evaluated0.dynamicProps){
evaluated0.props = undefined;
}
if(evaluated0.dynamicItems){
evaluated0.items = undefined;
}
if(data && typeof data == "object" && !Array.isArray(data)){
if(data.type === undefined){
const err0 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "type"},message:"must have required property '"+"type"+"'"};
if(vErrors === null){
vErrors = [err0];
}
else {
vErrors.push(err0);
}
errors++;
}
if(data.start === undefined){
const err1 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "start"},message:"must have required property '"+"start"+"'"};
if(vErrors === null){
vErrors = [err1];
}
else {
vErrors.push(err1);
}
errors++;
}
if(data.end === undefined){
const err2 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "end"},message:"must have required property '"+"end"+"'"};
if(vErrors === null){
vErrors = [err2];
}
else {
vErrors.push(err2);
}
errors++;
}
if(data.score === undefined){
const err3 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "score"},message:"must have required property '"+"score"+"'"};
if(vErrors === null){
vErrors = [err3];
}
else {
vErrors.push(err3);
}
errors++;
}
for(const key0 in data){
if(!((((key0 === "type") || (key0 === "start")) || (key0 === "end")) || (key0 === "score"))){
const err4 = {instancePath,schemaPath:"#/additionalProperties",keyword:"additionalProperties",params:{additionalProperty: key0},message:"must NOT have additional properties"};
if(vErrors === null){
vErrors = [err4];
}
else {
vErrors.push(err4);
}
errors++;
}
}
if(data.type !== undefined){
if("hook" !== data.type){
const err5 = {instancePath:instancePath+"/type",schemaPath:"#/properties/type/const",keyword:"const",params:{allowedValue: "hook"},message:"must be equal to constant"};
if(vErrors === null){
vErrors = [err5];
}
else {
vErrors.push(err5);
}
errors++;
}
}
if(data.start !== undefined){
let data1 = data.start;
if(typeof data1 == "number"){
if(data1 < 0 || isNaN(data1)){
const err6 = {instancePath:instancePath+"/start",schemaPath:"#/$defs/seconds/minimum",keyword:"minimum",params:{comparison: ">=", limit: 0},message:"must be >= 0"};
if(vErrors === null){
vErrors = [err6];
}
else {
vErrors.push(err6);
}
errors++;
}
}
else {
const err7 = {instancePath:instancePath+"/start",schemaPath:"#/$defs/seconds/type",keyword:"type",params:{type: "number"},message:"must be number"};
if(vErrors === null){
vErrors = [err7];
}
else {
vErrors.push(err7);
}
errors++;
}
}
if(data.end !== undefined){
let data2 = data.end;
if(typeof data2 == "number"){
if(data2 < 0 || isNaN(data2)){
const err8 = {instancePath:instancePath+"/end",schemaPath:"#/$defs/seconds/minimum",keyword:"minimum",params:{comparison: ">=", limit: 0},message:"must be >= 0"};
if(vErrors === null){
vErrors = [err8];
}
else {
vErrors.push(err8);
}
errors++;
}
}
else {
const err9 = {instancePath:instancePath+"/end",schemaPath:"#/$defs/seconds/type",keyword:"type",params:{type: "number"},message:"must be number"};
if(vErrors === null){
vErrors = [err9];
}
else {
vErrors.push(err9);
}
errors++;
}
}
if(data.score !== undefined){
if(!(validate37(data.score, {instancePath:instancePath+"/score",parentData:data,parentDataProperty:"score",rootData,dynamicAnchors}))){
vErrors = vErrors === null ? validate37.errors : vErrors.concat(validate37.errors);
errors = vErrors.length;
}
}
}
else {
const err10 = {instancePath,schemaPath:"#/type",keyword:"type",params:{type: "object"},message:"must be object"};
if(vErrors === null){
vErrors = [err10];
}
else {
vErrors.push(err10);
}
errors++;
}
validate36.errors = vErrors;
return errors === 0;
}
validate36.evaluated = {"props":true,"dynamicProps":false,"dynamicItems":false};


function validate27(data, {instancePath="", parentData, parentDataProperty, rootData=data, dynamicAnchors={}}={}){
let vErrors = null;
let errors = 0;
const evaluated0 = validate27.evaluated;
if(evaluated0.dynamicProps){
evaluated0.props = undefined;
}
if(evaluated0.dynamicItems){
evaluated0.items = undefined;
}
const _errs0 = errors;
let valid0 = false;
let passing0 = null;
const _errs1 = errors;
if(!(validate28(data, {instancePath,parentData,parentDataProperty,rootData,dynamicAnchors}))){
vErrors = vErrors === null ? validate28.errors : vErrors.concat(validate28.errors);
errors = vErrors.length;
}
var _valid0 = _errs1 === errors;
if(_valid0){
valid0 = true;
passing0 = 0;
var props0 = true;
}
const _errs2 = errors;
if(!(validate30(data, {instancePath,parentData,parentDataProperty,rootData,dynamicAnchors}))){
vErrors = vErrors === null ? validate30.errors : vErrors.concat(validate30.errors);
errors = vErrors.length;
}
var _valid0 = _errs2 === errors;
if(_valid0 && valid0){
valid0 = false;
passing0 = [passing0, 1];
}
else {
if(_valid0){
valid0 = true;
passing0 = 1;
if(props0 !== true){
props0 = true;
}
}
const _errs3 = errors;
if(!(validate32(data, {instancePath,parentData,parentDataProperty,rootData,dynamicAnchors}))){
vErrors = vErrors === null ? validate32.errors : vErrors.concat(validate32.errors);
errors = vErrors.length;
}
var _valid0 = _errs3 === errors;
if(_valid0 && valid0){
valid0 = false;
passing0 = [passing0, 2];
}
else {
if(_valid0){
valid0 = true;
passing0 = 2;
if(props0 !== true){
props0 = true;
}
}
const _errs4 = errors;
if(!(validate34(data, {instancePath,parentData,parentDataProperty,rootData,dynamicAnchors}))){
vErrors = vErrors === null ? validate34.errors : vErrors.concat(validate34.errors);
errors = vErrors.length;
}
var _valid0 = _errs4 === errors;
if(_valid0 && valid0){
valid0 = false;
passing0 = [passing0, 3];
}
else {
if(_valid0){
valid0 = true;
passing0 = 3;
if(props0 !== true){
props0 = true;
}
}
const _errs5 = errors;
if(!(validate36(data, {instancePath,parentData,parentDataProperty,rootData,dynamicAnchors}))){
vErrors = vErrors === null ? validate36.errors : vErrors.concat(validate36.errors);
errors = vErrors.length;
}
var _valid0 = _errs5 === errors;
if(_valid0 && valid0){
valid0 = false;
passing0 = [passing0, 4];
}
else {
if(_valid0){
valid0 = true;
passing0 = 4;
if(props0 !== true){
props0 = true;
}
}
}
}
}
}
if(!valid0){
const err0 = {instancePath,schemaPath:"#/oneOf",keyword:"oneOf",params:{passingSchemas: passing0},message:"must match exactly one schema in oneOf"};
if(vErrors === null){
vErrors = [err0];
}
else {
vErrors.push(err0);
}
errors++;
}
else {
errors = _errs0;
if(vErrors !== null){
if(_errs0){
vErrors.length = _errs0;
}
else {
vErrors = null;
}
}
}
validate27.errors = vErrors;
evaluated0.props = props0;
return errors === 0;
}
validate27.evaluated = {"dynamicProps":true,"dynamicItems":false};

const schema62 = {"type":"object","additionalProperties":false,"required":["speakers","faces","person_matte"],"properties":{"speakers":{"type":"array","items":{"$ref":"#/$defs/speakerTrack"}},"faces":{"type":"array","items":{"$ref":"#/$defs/faceTrackPoint"}},"person_matte":{"description":"生成済み人物マット。未生成なら null。object 形が正（2026-07-23 追加）。string 形は { path } の糖衣として後方互換で受ける（非推奨）。相対パスは analysis.json の所在ディレクトリを基準に解決する。","oneOf":[{"type":"null"},{"type":"string","minLength":1},{"$ref":"#/$defs/personMatteTrack"}]}}};
const schema70 = {"$comment":"2026-07-23 追加（docs/contract-2026-07-23-analysis-person-matte.md）。実体は VP9 alpha WebM（コンテナに alpha_mode=1）。意味制約として、マット動画の時刻 0 は素材の時刻 0 と一致し、fps はマット動画の実 fps と一致する。Draft 2020-12 標準では外部ファイルを参照できないため、この条件は生成・検証手順で確認する。","type":"object","additionalProperties":false,"required":["path","fps"],"properties":{"path":{"type":"string","minLength":1,"description":"マット動画（VP9 alpha WebM）へのパス。相対パスは analysis.json の所在ディレクトリを基準に解決し、区切りは / を使う。"},"fps":{"type":"number","exclusiveMinimum":0,"description":"マット動画の fps。元素材の fps と一致しなくてよい。"},"quality":{"type":"string","minLength":1,"description":"生成品質。fast / balanced / accurate を例示するが、enum 強制はしない（beats[].kind と同じ流儀）。"},"generated_at":{"type":"string","minLength":1,"description":"生成時刻（ISO8601）。"},"tool":{"type":"string","minLength":1,"description":"生成手段の記録。vision-person-segmentation を例示する。"}}};
const schema63 = {"type":"object","additionalProperties":false,"required":["id","spans"],"properties":{"id":{"type":"string","minLength":1},"spans":{"type":"array","items":{"$ref":"#/$defs/speakerSpan"}}}};
const schema64 = {"type":"array","prefixItems":[{"$ref":"#/$defs/seconds"},{"$ref":"#/$defs/seconds"}],"items":false,"minItems":2,"maxItems":2};

function validate43(data, {instancePath="", parentData, parentDataProperty, rootData=data, dynamicAnchors={}}={}){
let vErrors = null;
let errors = 0;
const evaluated0 = validate43.evaluated;
if(evaluated0.dynamicProps){
evaluated0.props = undefined;
}
if(evaluated0.dynamicItems){
evaluated0.items = undefined;
}
if(Array.isArray(data)){
if(data.length > 2){
const err0 = {instancePath,schemaPath:"#/maxItems",keyword:"maxItems",params:{limit: 2},message:"must NOT have more than 2 items"};
if(vErrors === null){
vErrors = [err0];
}
else {
vErrors.push(err0);
}
errors++;
}
if(data.length < 2){
const err1 = {instancePath,schemaPath:"#/minItems",keyword:"minItems",params:{limit: 2},message:"must NOT have fewer than 2 items"};
if(vErrors === null){
vErrors = [err1];
}
else {
vErrors.push(err1);
}
errors++;
}
const len0 = data.length;
if(len0 > 0){
let data0 = data[0];
if(typeof data0 == "number"){
if(data0 < 0 || isNaN(data0)){
const err2 = {instancePath:instancePath+"/0",schemaPath:"#/$defs/seconds/minimum",keyword:"minimum",params:{comparison: ">=", limit: 0},message:"must be >= 0"};
if(vErrors === null){
vErrors = [err2];
}
else {
vErrors.push(err2);
}
errors++;
}
}
else {
const err3 = {instancePath:instancePath+"/0",schemaPath:"#/$defs/seconds/type",keyword:"type",params:{type: "number"},message:"must be number"};
if(vErrors === null){
vErrors = [err3];
}
else {
vErrors.push(err3);
}
errors++;
}
}
if(len0 > 1){
let data1 = data[1];
if(typeof data1 == "number"){
if(data1 < 0 || isNaN(data1)){
const err4 = {instancePath:instancePath+"/1",schemaPath:"#/$defs/seconds/minimum",keyword:"minimum",params:{comparison: ">=", limit: 0},message:"must be >= 0"};
if(vErrors === null){
vErrors = [err4];
}
else {
vErrors.push(err4);
}
errors++;
}
}
else {
const err5 = {instancePath:instancePath+"/1",schemaPath:"#/$defs/seconds/type",keyword:"type",params:{type: "number"},message:"must be number"};
if(vErrors === null){
vErrors = [err5];
}
else {
vErrors.push(err5);
}
errors++;
}
}
const len1 = data.length;
if(!(len1 <= 2)){
const err6 = {instancePath,schemaPath:"#/items",keyword:"items",params:{limit: 2},message:"must NOT have more than 2 items"};
if(vErrors === null){
vErrors = [err6];
}
else {
vErrors.push(err6);
}
errors++;
}
}
else {
const err7 = {instancePath,schemaPath:"#/type",keyword:"type",params:{type: "array"},message:"must be array"};
if(vErrors === null){
vErrors = [err7];
}
else {
vErrors.push(err7);
}
errors++;
}
validate43.errors = vErrors;
return errors === 0;
}
validate43.evaluated = {"items":true,"dynamicProps":false,"dynamicItems":false};


function validate42(data, {instancePath="", parentData, parentDataProperty, rootData=data, dynamicAnchors={}}={}){
let vErrors = null;
let errors = 0;
const evaluated0 = validate42.evaluated;
if(evaluated0.dynamicProps){
evaluated0.props = undefined;
}
if(evaluated0.dynamicItems){
evaluated0.items = undefined;
}
if(data && typeof data == "object" && !Array.isArray(data)){
if(data.id === undefined){
const err0 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "id"},message:"must have required property '"+"id"+"'"};
if(vErrors === null){
vErrors = [err0];
}
else {
vErrors.push(err0);
}
errors++;
}
if(data.spans === undefined){
const err1 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "spans"},message:"must have required property '"+"spans"+"'"};
if(vErrors === null){
vErrors = [err1];
}
else {
vErrors.push(err1);
}
errors++;
}
for(const key0 in data){
if(!((key0 === "id") || (key0 === "spans"))){
const err2 = {instancePath,schemaPath:"#/additionalProperties",keyword:"additionalProperties",params:{additionalProperty: key0},message:"must NOT have additional properties"};
if(vErrors === null){
vErrors = [err2];
}
else {
vErrors.push(err2);
}
errors++;
}
}
if(data.id !== undefined){
let data0 = data.id;
if(typeof data0 === "string"){
if(func1(data0) < 1){
const err3 = {instancePath:instancePath+"/id",schemaPath:"#/properties/id/minLength",keyword:"minLength",params:{limit: 1},message:"must NOT have fewer than 1 characters"};
if(vErrors === null){
vErrors = [err3];
}
else {
vErrors.push(err3);
}
errors++;
}
}
else {
const err4 = {instancePath:instancePath+"/id",schemaPath:"#/properties/id/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err4];
}
else {
vErrors.push(err4);
}
errors++;
}
}
if(data.spans !== undefined){
let data1 = data.spans;
if(Array.isArray(data1)){
const len0 = data1.length;
for(let i0=0; i0<len0; i0++){
if(!(validate43(data1[i0], {instancePath:instancePath+"/spans/" + i0,parentData:data1,parentDataProperty:i0,rootData,dynamicAnchors}))){
vErrors = vErrors === null ? validate43.errors : vErrors.concat(validate43.errors);
errors = vErrors.length;
}
}
}
else {
const err5 = {instancePath:instancePath+"/spans",schemaPath:"#/properties/spans/type",keyword:"type",params:{type: "array"},message:"must be array"};
if(vErrors === null){
vErrors = [err5];
}
else {
vErrors.push(err5);
}
errors++;
}
}
}
else {
const err6 = {instancePath,schemaPath:"#/type",keyword:"type",params:{type: "object"},message:"must be object"};
if(vErrors === null){
vErrors = [err6];
}
else {
vErrors.push(err6);
}
errors++;
}
validate42.errors = vErrors;
return errors === 0;
}
validate42.evaluated = {"props":true,"dynamicProps":false,"dynamicItems":false};

const schema67 = {"type":"object","additionalProperties":false,"required":["speaker","t","box"],"properties":{"speaker":{"type":"string","minLength":1},"t":{"$ref":"#/$defs/seconds"},"box":{"$ref":"#/$defs/faceBox"}}};
const schema69 = {"description":"素材フレームに対する [x, y, width, height] 順の正規化座標。各要素は 0〜1。","$comment":"意味制約として x + width <= 1 かつ y + height <= 1 とする。Draft 2020-12 標準では配列要素間を加算・比較できないため、この条件は生成・検証手順で確認する。","type":"array","prefixItems":[{"type":"number","minimum":0,"maximum":1},{"type":"number","minimum":0,"maximum":1},{"type":"number","minimum":0,"maximum":1},{"type":"number","minimum":0,"maximum":1}],"items":false,"minItems":4,"maxItems":4};

function validate46(data, {instancePath="", parentData, parentDataProperty, rootData=data, dynamicAnchors={}}={}){
let vErrors = null;
let errors = 0;
const evaluated0 = validate46.evaluated;
if(evaluated0.dynamicProps){
evaluated0.props = undefined;
}
if(evaluated0.dynamicItems){
evaluated0.items = undefined;
}
if(data && typeof data == "object" && !Array.isArray(data)){
if(data.speaker === undefined){
const err0 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "speaker"},message:"must have required property '"+"speaker"+"'"};
if(vErrors === null){
vErrors = [err0];
}
else {
vErrors.push(err0);
}
errors++;
}
if(data.t === undefined){
const err1 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "t"},message:"must have required property '"+"t"+"'"};
if(vErrors === null){
vErrors = [err1];
}
else {
vErrors.push(err1);
}
errors++;
}
if(data.box === undefined){
const err2 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "box"},message:"must have required property '"+"box"+"'"};
if(vErrors === null){
vErrors = [err2];
}
else {
vErrors.push(err2);
}
errors++;
}
for(const key0 in data){
if(!(((key0 === "speaker") || (key0 === "t")) || (key0 === "box"))){
const err3 = {instancePath,schemaPath:"#/additionalProperties",keyword:"additionalProperties",params:{additionalProperty: key0},message:"must NOT have additional properties"};
if(vErrors === null){
vErrors = [err3];
}
else {
vErrors.push(err3);
}
errors++;
}
}
if(data.speaker !== undefined){
let data0 = data.speaker;
if(typeof data0 === "string"){
if(func1(data0) < 1){
const err4 = {instancePath:instancePath+"/speaker",schemaPath:"#/properties/speaker/minLength",keyword:"minLength",params:{limit: 1},message:"must NOT have fewer than 1 characters"};
if(vErrors === null){
vErrors = [err4];
}
else {
vErrors.push(err4);
}
errors++;
}
}
else {
const err5 = {instancePath:instancePath+"/speaker",schemaPath:"#/properties/speaker/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err5];
}
else {
vErrors.push(err5);
}
errors++;
}
}
if(data.t !== undefined){
let data1 = data.t;
if(typeof data1 == "number"){
if(data1 < 0 || isNaN(data1)){
const err6 = {instancePath:instancePath+"/t",schemaPath:"#/$defs/seconds/minimum",keyword:"minimum",params:{comparison: ">=", limit: 0},message:"must be >= 0"};
if(vErrors === null){
vErrors = [err6];
}
else {
vErrors.push(err6);
}
errors++;
}
}
else {
const err7 = {instancePath:instancePath+"/t",schemaPath:"#/$defs/seconds/type",keyword:"type",params:{type: "number"},message:"must be number"};
if(vErrors === null){
vErrors = [err7];
}
else {
vErrors.push(err7);
}
errors++;
}
}
if(data.box !== undefined){
let data2 = data.box;
if(Array.isArray(data2)){
if(data2.length > 4){
const err8 = {instancePath:instancePath+"/box",schemaPath:"#/$defs/faceBox/maxItems",keyword:"maxItems",params:{limit: 4},message:"must NOT have more than 4 items"};
if(vErrors === null){
vErrors = [err8];
}
else {
vErrors.push(err8);
}
errors++;
}
if(data2.length < 4){
const err9 = {instancePath:instancePath+"/box",schemaPath:"#/$defs/faceBox/minItems",keyword:"minItems",params:{limit: 4},message:"must NOT have fewer than 4 items"};
if(vErrors === null){
vErrors = [err9];
}
else {
vErrors.push(err9);
}
errors++;
}
const len0 = data2.length;
if(len0 > 0){
let data3 = data2[0];
if(typeof data3 == "number"){
if(data3 > 1 || isNaN(data3)){
const err10 = {instancePath:instancePath+"/box/0",schemaPath:"#/$defs/faceBox/prefixItems/0/maximum",keyword:"maximum",params:{comparison: "<=", limit: 1},message:"must be <= 1"};
if(vErrors === null){
vErrors = [err10];
}
else {
vErrors.push(err10);
}
errors++;
}
if(data3 < 0 || isNaN(data3)){
const err11 = {instancePath:instancePath+"/box/0",schemaPath:"#/$defs/faceBox/prefixItems/0/minimum",keyword:"minimum",params:{comparison: ">=", limit: 0},message:"must be >= 0"};
if(vErrors === null){
vErrors = [err11];
}
else {
vErrors.push(err11);
}
errors++;
}
}
else {
const err12 = {instancePath:instancePath+"/box/0",schemaPath:"#/$defs/faceBox/prefixItems/0/type",keyword:"type",params:{type: "number"},message:"must be number"};
if(vErrors === null){
vErrors = [err12];
}
else {
vErrors.push(err12);
}
errors++;
}
}
if(len0 > 1){
let data4 = data2[1];
if(typeof data4 == "number"){
if(data4 > 1 || isNaN(data4)){
const err13 = {instancePath:instancePath+"/box/1",schemaPath:"#/$defs/faceBox/prefixItems/1/maximum",keyword:"maximum",params:{comparison: "<=", limit: 1},message:"must be <= 1"};
if(vErrors === null){
vErrors = [err13];
}
else {
vErrors.push(err13);
}
errors++;
}
if(data4 < 0 || isNaN(data4)){
const err14 = {instancePath:instancePath+"/box/1",schemaPath:"#/$defs/faceBox/prefixItems/1/minimum",keyword:"minimum",params:{comparison: ">=", limit: 0},message:"must be >= 0"};
if(vErrors === null){
vErrors = [err14];
}
else {
vErrors.push(err14);
}
errors++;
}
}
else {
const err15 = {instancePath:instancePath+"/box/1",schemaPath:"#/$defs/faceBox/prefixItems/1/type",keyword:"type",params:{type: "number"},message:"must be number"};
if(vErrors === null){
vErrors = [err15];
}
else {
vErrors.push(err15);
}
errors++;
}
}
if(len0 > 2){
let data5 = data2[2];
if(typeof data5 == "number"){
if(data5 > 1 || isNaN(data5)){
const err16 = {instancePath:instancePath+"/box/2",schemaPath:"#/$defs/faceBox/prefixItems/2/maximum",keyword:"maximum",params:{comparison: "<=", limit: 1},message:"must be <= 1"};
if(vErrors === null){
vErrors = [err16];
}
else {
vErrors.push(err16);
}
errors++;
}
if(data5 < 0 || isNaN(data5)){
const err17 = {instancePath:instancePath+"/box/2",schemaPath:"#/$defs/faceBox/prefixItems/2/minimum",keyword:"minimum",params:{comparison: ">=", limit: 0},message:"must be >= 0"};
if(vErrors === null){
vErrors = [err17];
}
else {
vErrors.push(err17);
}
errors++;
}
}
else {
const err18 = {instancePath:instancePath+"/box/2",schemaPath:"#/$defs/faceBox/prefixItems/2/type",keyword:"type",params:{type: "number"},message:"must be number"};
if(vErrors === null){
vErrors = [err18];
}
else {
vErrors.push(err18);
}
errors++;
}
}
if(len0 > 3){
let data6 = data2[3];
if(typeof data6 == "number"){
if(data6 > 1 || isNaN(data6)){
const err19 = {instancePath:instancePath+"/box/3",schemaPath:"#/$defs/faceBox/prefixItems/3/maximum",keyword:"maximum",params:{comparison: "<=", limit: 1},message:"must be <= 1"};
if(vErrors === null){
vErrors = [err19];
}
else {
vErrors.push(err19);
}
errors++;
}
if(data6 < 0 || isNaN(data6)){
const err20 = {instancePath:instancePath+"/box/3",schemaPath:"#/$defs/faceBox/prefixItems/3/minimum",keyword:"minimum",params:{comparison: ">=", limit: 0},message:"must be >= 0"};
if(vErrors === null){
vErrors = [err20];
}
else {
vErrors.push(err20);
}
errors++;
}
}
else {
const err21 = {instancePath:instancePath+"/box/3",schemaPath:"#/$defs/faceBox/prefixItems/3/type",keyword:"type",params:{type: "number"},message:"must be number"};
if(vErrors === null){
vErrors = [err21];
}
else {
vErrors.push(err21);
}
errors++;
}
}
const len1 = data2.length;
if(!(len1 <= 4)){
const err22 = {instancePath:instancePath+"/box",schemaPath:"#/$defs/faceBox/items",keyword:"items",params:{limit: 4},message:"must NOT have more than 4 items"};
if(vErrors === null){
vErrors = [err22];
}
else {
vErrors.push(err22);
}
errors++;
}
}
else {
const err23 = {instancePath:instancePath+"/box",schemaPath:"#/$defs/faceBox/type",keyword:"type",params:{type: "array"},message:"must be array"};
if(vErrors === null){
vErrors = [err23];
}
else {
vErrors.push(err23);
}
errors++;
}
}
}
else {
const err24 = {instancePath,schemaPath:"#/type",keyword:"type",params:{type: "object"},message:"must be object"};
if(vErrors === null){
vErrors = [err24];
}
else {
vErrors.push(err24);
}
errors++;
}
validate46.errors = vErrors;
return errors === 0;
}
validate46.evaluated = {"props":true,"dynamicProps":false,"dynamicItems":false};


function validate41(data, {instancePath="", parentData, parentDataProperty, rootData=data, dynamicAnchors={}}={}){
let vErrors = null;
let errors = 0;
const evaluated0 = validate41.evaluated;
if(evaluated0.dynamicProps){
evaluated0.props = undefined;
}
if(evaluated0.dynamicItems){
evaluated0.items = undefined;
}
if(data && typeof data == "object" && !Array.isArray(data)){
if(data.speakers === undefined){
const err0 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "speakers"},message:"must have required property '"+"speakers"+"'"};
if(vErrors === null){
vErrors = [err0];
}
else {
vErrors.push(err0);
}
errors++;
}
if(data.faces === undefined){
const err1 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "faces"},message:"must have required property '"+"faces"+"'"};
if(vErrors === null){
vErrors = [err1];
}
else {
vErrors.push(err1);
}
errors++;
}
if(data.person_matte === undefined){
const err2 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "person_matte"},message:"must have required property '"+"person_matte"+"'"};
if(vErrors === null){
vErrors = [err2];
}
else {
vErrors.push(err2);
}
errors++;
}
for(const key0 in data){
if(!(((key0 === "speakers") || (key0 === "faces")) || (key0 === "person_matte"))){
const err3 = {instancePath,schemaPath:"#/additionalProperties",keyword:"additionalProperties",params:{additionalProperty: key0},message:"must NOT have additional properties"};
if(vErrors === null){
vErrors = [err3];
}
else {
vErrors.push(err3);
}
errors++;
}
}
if(data.speakers !== undefined){
let data0 = data.speakers;
if(Array.isArray(data0)){
const len0 = data0.length;
for(let i0=0; i0<len0; i0++){
if(!(validate42(data0[i0], {instancePath:instancePath+"/speakers/" + i0,parentData:data0,parentDataProperty:i0,rootData,dynamicAnchors}))){
vErrors = vErrors === null ? validate42.errors : vErrors.concat(validate42.errors);
errors = vErrors.length;
}
}
}
else {
const err4 = {instancePath:instancePath+"/speakers",schemaPath:"#/properties/speakers/type",keyword:"type",params:{type: "array"},message:"must be array"};
if(vErrors === null){
vErrors = [err4];
}
else {
vErrors.push(err4);
}
errors++;
}
}
if(data.faces !== undefined){
let data2 = data.faces;
if(Array.isArray(data2)){
const len1 = data2.length;
for(let i1=0; i1<len1; i1++){
if(!(validate46(data2[i1], {instancePath:instancePath+"/faces/" + i1,parentData:data2,parentDataProperty:i1,rootData,dynamicAnchors}))){
vErrors = vErrors === null ? validate46.errors : vErrors.concat(validate46.errors);
errors = vErrors.length;
}
}
}
else {
const err5 = {instancePath:instancePath+"/faces",schemaPath:"#/properties/faces/type",keyword:"type",params:{type: "array"},message:"must be array"};
if(vErrors === null){
vErrors = [err5];
}
else {
vErrors.push(err5);
}
errors++;
}
}
if(data.person_matte !== undefined){
let data4 = data.person_matte;
const _errs9 = errors;
let valid5 = false;
let passing0 = null;
const _errs10 = errors;
if(data4 !== null){
const err6 = {instancePath:instancePath+"/person_matte",schemaPath:"#/properties/person_matte/oneOf/0/type",keyword:"type",params:{type: "null"},message:"must be null"};
if(vErrors === null){
vErrors = [err6];
}
else {
vErrors.push(err6);
}
errors++;
}
var _valid0 = _errs10 === errors;
if(_valid0){
valid5 = true;
passing0 = 0;
}
const _errs12 = errors;
if(typeof data4 === "string"){
if(func1(data4) < 1){
const err7 = {instancePath:instancePath+"/person_matte",schemaPath:"#/properties/person_matte/oneOf/1/minLength",keyword:"minLength",params:{limit: 1},message:"must NOT have fewer than 1 characters"};
if(vErrors === null){
vErrors = [err7];
}
else {
vErrors.push(err7);
}
errors++;
}
}
else {
const err8 = {instancePath:instancePath+"/person_matte",schemaPath:"#/properties/person_matte/oneOf/1/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err8];
}
else {
vErrors.push(err8);
}
errors++;
}
var _valid0 = _errs12 === errors;
if(_valid0 && valid5){
valid5 = false;
passing0 = [passing0, 1];
}
else {
if(_valid0){
valid5 = true;
passing0 = 1;
}
const _errs14 = errors;
if(data4 && typeof data4 == "object" && !Array.isArray(data4)){
if(data4.path === undefined){
const err9 = {instancePath:instancePath+"/person_matte",schemaPath:"#/$defs/personMatteTrack/required",keyword:"required",params:{missingProperty: "path"},message:"must have required property '"+"path"+"'"};
if(vErrors === null){
vErrors = [err9];
}
else {
vErrors.push(err9);
}
errors++;
}
if(data4.fps === undefined){
const err10 = {instancePath:instancePath+"/person_matte",schemaPath:"#/$defs/personMatteTrack/required",keyword:"required",params:{missingProperty: "fps"},message:"must have required property '"+"fps"+"'"};
if(vErrors === null){
vErrors = [err10];
}
else {
vErrors.push(err10);
}
errors++;
}
for(const key1 in data4){
if(!(((((key1 === "path") || (key1 === "fps")) || (key1 === "quality")) || (key1 === "generated_at")) || (key1 === "tool"))){
const err11 = {instancePath:instancePath+"/person_matte",schemaPath:"#/$defs/personMatteTrack/additionalProperties",keyword:"additionalProperties",params:{additionalProperty: key1},message:"must NOT have additional properties"};
if(vErrors === null){
vErrors = [err11];
}
else {
vErrors.push(err11);
}
errors++;
}
}
if(data4.path !== undefined){
let data5 = data4.path;
if(typeof data5 === "string"){
if(func1(data5) < 1){
const err12 = {instancePath:instancePath+"/person_matte/path",schemaPath:"#/$defs/personMatteTrack/properties/path/minLength",keyword:"minLength",params:{limit: 1},message:"must NOT have fewer than 1 characters"};
if(vErrors === null){
vErrors = [err12];
}
else {
vErrors.push(err12);
}
errors++;
}
}
else {
const err13 = {instancePath:instancePath+"/person_matte/path",schemaPath:"#/$defs/personMatteTrack/properties/path/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err13];
}
else {
vErrors.push(err13);
}
errors++;
}
}
if(data4.fps !== undefined){
let data6 = data4.fps;
if(typeof data6 == "number"){
if(data6 <= 0 || isNaN(data6)){
const err14 = {instancePath:instancePath+"/person_matte/fps",schemaPath:"#/$defs/personMatteTrack/properties/fps/exclusiveMinimum",keyword:"exclusiveMinimum",params:{comparison: ">", limit: 0},message:"must be > 0"};
if(vErrors === null){
vErrors = [err14];
}
else {
vErrors.push(err14);
}
errors++;
}
}
else {
const err15 = {instancePath:instancePath+"/person_matte/fps",schemaPath:"#/$defs/personMatteTrack/properties/fps/type",keyword:"type",params:{type: "number"},message:"must be number"};
if(vErrors === null){
vErrors = [err15];
}
else {
vErrors.push(err15);
}
errors++;
}
}
if(data4.quality !== undefined){
let data7 = data4.quality;
if(typeof data7 === "string"){
if(func1(data7) < 1){
const err16 = {instancePath:instancePath+"/person_matte/quality",schemaPath:"#/$defs/personMatteTrack/properties/quality/minLength",keyword:"minLength",params:{limit: 1},message:"must NOT have fewer than 1 characters"};
if(vErrors === null){
vErrors = [err16];
}
else {
vErrors.push(err16);
}
errors++;
}
}
else {
const err17 = {instancePath:instancePath+"/person_matte/quality",schemaPath:"#/$defs/personMatteTrack/properties/quality/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err17];
}
else {
vErrors.push(err17);
}
errors++;
}
}
if(data4.generated_at !== undefined){
let data8 = data4.generated_at;
if(typeof data8 === "string"){
if(func1(data8) < 1){
const err18 = {instancePath:instancePath+"/person_matte/generated_at",schemaPath:"#/$defs/personMatteTrack/properties/generated_at/minLength",keyword:"minLength",params:{limit: 1},message:"must NOT have fewer than 1 characters"};
if(vErrors === null){
vErrors = [err18];
}
else {
vErrors.push(err18);
}
errors++;
}
}
else {
const err19 = {instancePath:instancePath+"/person_matte/generated_at",schemaPath:"#/$defs/personMatteTrack/properties/generated_at/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err19];
}
else {
vErrors.push(err19);
}
errors++;
}
}
if(data4.tool !== undefined){
let data9 = data4.tool;
if(typeof data9 === "string"){
if(func1(data9) < 1){
const err20 = {instancePath:instancePath+"/person_matte/tool",schemaPath:"#/$defs/personMatteTrack/properties/tool/minLength",keyword:"minLength",params:{limit: 1},message:"must NOT have fewer than 1 characters"};
if(vErrors === null){
vErrors = [err20];
}
else {
vErrors.push(err20);
}
errors++;
}
}
else {
const err21 = {instancePath:instancePath+"/person_matte/tool",schemaPath:"#/$defs/personMatteTrack/properties/tool/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err21];
}
else {
vErrors.push(err21);
}
errors++;
}
}
}
else {
const err22 = {instancePath:instancePath+"/person_matte",schemaPath:"#/$defs/personMatteTrack/type",keyword:"type",params:{type: "object"},message:"must be object"};
if(vErrors === null){
vErrors = [err22];
}
else {
vErrors.push(err22);
}
errors++;
}
var _valid0 = _errs14 === errors;
if(_valid0 && valid5){
valid5 = false;
passing0 = [passing0, 2];
}
else {
if(_valid0){
valid5 = true;
passing0 = 2;
}
}
}
if(!valid5){
const err23 = {instancePath:instancePath+"/person_matte",schemaPath:"#/properties/person_matte/oneOf",keyword:"oneOf",params:{passingSchemas: passing0},message:"must match exactly one schema in oneOf"};
if(vErrors === null){
vErrors = [err23];
}
else {
vErrors.push(err23);
}
errors++;
}
else {
errors = _errs9;
if(vErrors !== null){
if(_errs9){
vErrors.length = _errs9;
}
else {
vErrors = null;
}
}
}
}
}
else {
const err24 = {instancePath,schemaPath:"#/type",keyword:"type",params:{type: "object"},message:"must be object"};
if(vErrors === null){
vErrors = [err24];
}
else {
vErrors.push(err24);
}
errors++;
}
validate41.errors = vErrors;
return errors === 0;
}
validate41.evaluated = {"props":true,"dynamicProps":false,"dynamicItems":false};


function validate20(data, {instancePath="", parentData, parentDataProperty, rootData=data, dynamicAnchors={}}={}){
/*# sourceURL="urn:akari-video:schema:analysis:v0" */;
let vErrors = null;
let errors = 0;
const evaluated0 = validate20.evaluated;
if(evaluated0.dynamicProps){
evaluated0.props = undefined;
}
if(evaluated0.dynamicItems){
evaluated0.items = undefined;
}
if(data && typeof data == "object" && !Array.isArray(data)){
if(data.version === undefined){
const err0 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "version"},message:"must have required property '"+"version"+"'"};
if(vErrors === null){
vErrors = [err0];
}
else {
vErrors.push(err0);
}
errors++;
}
if(data.source === undefined){
const err1 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "source"},message:"must have required property '"+"source"+"'"};
if(vErrors === null){
vErrors = [err1];
}
else {
vErrors.push(err1);
}
errors++;
}
if(data.transcript === undefined){
const err2 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "transcript"},message:"must have required property '"+"transcript"+"'"};
if(vErrors === null){
vErrors = [err2];
}
else {
vErrors.push(err2);
}
errors++;
}
if(data.keyframes === undefined){
const err3 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "keyframes"},message:"must have required property '"+"keyframes"+"'"};
if(vErrors === null){
vErrors = [err3];
}
else {
vErrors.push(err3);
}
errors++;
}
if(data.events === undefined){
const err4 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "events"},message:"must have required property '"+"events"+"'"};
if(vErrors === null){
vErrors = [err4];
}
else {
vErrors.push(err4);
}
errors++;
}
if(data.tracks === undefined){
const err5 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "tracks"},message:"must have required property '"+"tracks"+"'"};
if(vErrors === null){
vErrors = [err5];
}
else {
vErrors.push(err5);
}
errors++;
}
for(const key0 in data){
if(!((((((key0 === "version") || (key0 === "source")) || (key0 === "transcript")) || (key0 === "keyframes")) || (key0 === "events")) || (key0 === "tracks"))){
const err6 = {instancePath,schemaPath:"#/additionalProperties",keyword:"additionalProperties",params:{additionalProperty: key0},message:"must NOT have additional properties"};
if(vErrors === null){
vErrors = [err6];
}
else {
vErrors.push(err6);
}
errors++;
}
}
if(data.version !== undefined){
if(0 !== data.version){
const err7 = {instancePath:instancePath+"/version",schemaPath:"#/properties/version/const",keyword:"const",params:{allowedValue: 0},message:"must be equal to constant"};
if(vErrors === null){
vErrors = [err7];
}
else {
vErrors.push(err7);
}
errors++;
}
}
if(data.source !== undefined){
let data1 = data.source;
if(typeof data1 === "string"){
if(func1(data1) < 1){
const err8 = {instancePath:instancePath+"/source",schemaPath:"#/properties/source/minLength",keyword:"minLength",params:{limit: 1},message:"must NOT have fewer than 1 characters"};
if(vErrors === null){
vErrors = [err8];
}
else {
vErrors.push(err8);
}
errors++;
}
}
else {
const err9 = {instancePath:instancePath+"/source",schemaPath:"#/properties/source/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err9];
}
else {
vErrors.push(err9);
}
errors++;
}
}
if(data.transcript !== undefined){
let data2 = data.transcript;
if(Array.isArray(data2)){
const len0 = data2.length;
for(let i0=0; i0<len0; i0++){
if(!(validate21(data2[i0], {instancePath:instancePath+"/transcript/" + i0,parentData:data2,parentDataProperty:i0,rootData,dynamicAnchors}))){
vErrors = vErrors === null ? validate21.errors : vErrors.concat(validate21.errors);
errors = vErrors.length;
}
}
}
else {
const err10 = {instancePath:instancePath+"/transcript",schemaPath:"#/properties/transcript/type",keyword:"type",params:{type: "array"},message:"must be array"};
if(vErrors === null){
vErrors = [err10];
}
else {
vErrors.push(err10);
}
errors++;
}
}
if(data.keyframes !== undefined){
let data4 = data.keyframes;
if(Array.isArray(data4)){
const len1 = data4.length;
for(let i1=0; i1<len1; i1++){
if(!(validate25(data4[i1], {instancePath:instancePath+"/keyframes/" + i1,parentData:data4,parentDataProperty:i1,rootData,dynamicAnchors}))){
vErrors = vErrors === null ? validate25.errors : vErrors.concat(validate25.errors);
errors = vErrors.length;
}
}
}
else {
const err11 = {instancePath:instancePath+"/keyframes",schemaPath:"#/properties/keyframes/type",keyword:"type",params:{type: "array"},message:"must be array"};
if(vErrors === null){
vErrors = [err11];
}
else {
vErrors.push(err11);
}
errors++;
}
}
if(data.events !== undefined){
let data6 = data.events;
if(Array.isArray(data6)){
const len2 = data6.length;
for(let i2=0; i2<len2; i2++){
if(!(validate27(data6[i2], {instancePath:instancePath+"/events/" + i2,parentData:data6,parentDataProperty:i2,rootData,dynamicAnchors}))){
vErrors = vErrors === null ? validate27.errors : vErrors.concat(validate27.errors);
errors = vErrors.length;
}
}
}
else {
const err12 = {instancePath:instancePath+"/events",schemaPath:"#/properties/events/type",keyword:"type",params:{type: "array"},message:"must be array"};
if(vErrors === null){
vErrors = [err12];
}
else {
vErrors.push(err12);
}
errors++;
}
}
if(data.tracks !== undefined){
if(!(validate41(data.tracks, {instancePath:instancePath+"/tracks",parentData:data,parentDataProperty:"tracks",rootData,dynamicAnchors}))){
vErrors = vErrors === null ? validate41.errors : vErrors.concat(validate41.errors);
errors = vErrors.length;
}
}
}
else {
const err13 = {instancePath,schemaPath:"#/type",keyword:"type",params:{type: "object"},message:"must be object"};
if(vErrors === null){
vErrors = [err13];
}
else {
vErrors.push(err13);
}
errors++;
}
validate20.errors = vErrors;
return errors === 0;
}
validate20.evaluated = {"props":true,"dynamicProps":false,"dynamicItems":false};

exports.validateSemanticKeepPlan = validate49;
const schema71 = {"$schema":"https://json-schema.org/draft/2020-12/schema","$id":"urn:akari-video:schema:semantic-keep-plan:v1","title":"AKARI semantic keep plan v1","type":"object","additionalProperties":false,"required":["version","kind","intended_edit_version","candidate_frame_rate","sources","occurrences"],"properties":{"version":{"const":1},"kind":{"const":"akari-semantic-keep-plan-v1"},"intended_edit_version":{"enum":[0,1]},"candidate_frame_rate":{"const":30},"sources":{"type":"array","minItems":1,"maxItems":256,"items":{"$ref":"#/$defs/source"}},"occurrences":{"type":"array","maxItems":100000,"items":{"$ref":"#/$defs/occurrence"}}},"$defs":{"source":{"type":"object","additionalProperties":false,"required":["id","path"],"properties":{"id":{"oneOf":[{"type":"null"},{"type":"string","minLength":1,"pattern":"\\S"}]},"path":{"type":"string","minLength":1,"pattern":"^(?!/)(?![A-Za-z]:[\\\\/])(?![A-Za-z][A-Za-z0-9+.-]*:)(?!.*\\\\)(?!.*(?:^|/)\\.\\.(?:/|$))\\S(?:.*\\S)?$"}}},"occurrence":{"type":"object","additionalProperties":false,"required":["source_index","range"],"properties":{"source_index":{"type":"integer","minimum":0},"range":{"oneOf":[{"$ref":"#/$defs/explicitRange"},{"$ref":"#/$defs/fullSourceRange"}]}}},"explicitRange":{"type":"object","additionalProperties":false,"required":["mode","in","out"],"properties":{"mode":{"const":"explicit"},"in":{"type":"number","minimum":0},"out":{"type":"number","exclusiveMinimum":0}}},"fullSourceRange":{"type":"object","additionalProperties":false,"required":["mode"],"properties":{"mode":{"const":"full_source"}}}}};
const schema72 = {"type":"object","additionalProperties":false,"required":["id","path"],"properties":{"id":{"oneOf":[{"type":"null"},{"type":"string","minLength":1,"pattern":"\\S"}]},"path":{"type":"string","minLength":1,"pattern":"^(?!/)(?![A-Za-z]:[\\\\/])(?![A-Za-z][A-Za-z0-9+.-]*:)(?!.*\\\\)(?!.*(?:^|/)\\.\\.(?:/|$))\\S(?:.*\\S)?$"}}};
const pattern4 = new RegExp("\\S", "u");
const pattern5 = new RegExp("^(?!/)(?![A-Za-z]:[\\\\/])(?![A-Za-z][A-Za-z0-9+.-]*:)(?!.*\\\\)(?!.*(?:^|/)\\.\\.(?:/|$))\\S(?:.*\\S)?$", "u");
const schema73 = {"type":"object","additionalProperties":false,"required":["source_index","range"],"properties":{"source_index":{"type":"integer","minimum":0},"range":{"oneOf":[{"$ref":"#/$defs/explicitRange"},{"$ref":"#/$defs/fullSourceRange"}]}}};
const schema74 = {"type":"object","additionalProperties":false,"required":["mode","in","out"],"properties":{"mode":{"const":"explicit"},"in":{"type":"number","minimum":0},"out":{"type":"number","exclusiveMinimum":0}}};
const schema75 = {"type":"object","additionalProperties":false,"required":["mode"],"properties":{"mode":{"const":"full_source"}}};

function validate50(data, {instancePath="", parentData, parentDataProperty, rootData=data, dynamicAnchors={}}={}){
let vErrors = null;
let errors = 0;
const evaluated0 = validate50.evaluated;
if(evaluated0.dynamicProps){
evaluated0.props = undefined;
}
if(evaluated0.dynamicItems){
evaluated0.items = undefined;
}
if(data && typeof data == "object" && !Array.isArray(data)){
if(data.source_index === undefined){
const err0 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "source_index"},message:"must have required property '"+"source_index"+"'"};
if(vErrors === null){
vErrors = [err0];
}
else {
vErrors.push(err0);
}
errors++;
}
if(data.range === undefined){
const err1 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "range"},message:"must have required property '"+"range"+"'"};
if(vErrors === null){
vErrors = [err1];
}
else {
vErrors.push(err1);
}
errors++;
}
for(const key0 in data){
if(!((key0 === "source_index") || (key0 === "range"))){
const err2 = {instancePath,schemaPath:"#/additionalProperties",keyword:"additionalProperties",params:{additionalProperty: key0},message:"must NOT have additional properties"};
if(vErrors === null){
vErrors = [err2];
}
else {
vErrors.push(err2);
}
errors++;
}
}
if(data.source_index !== undefined){
let data0 = data.source_index;
if(!((typeof data0 == "number") && (!(data0 % 1) && !isNaN(data0)))){
const err3 = {instancePath:instancePath+"/source_index",schemaPath:"#/properties/source_index/type",keyword:"type",params:{type: "integer"},message:"must be integer"};
if(vErrors === null){
vErrors = [err3];
}
else {
vErrors.push(err3);
}
errors++;
}
if(typeof data0 == "number"){
if(data0 < 0 || isNaN(data0)){
const err4 = {instancePath:instancePath+"/source_index",schemaPath:"#/properties/source_index/minimum",keyword:"minimum",params:{comparison: ">=", limit: 0},message:"must be >= 0"};
if(vErrors === null){
vErrors = [err4];
}
else {
vErrors.push(err4);
}
errors++;
}
}
}
if(data.range !== undefined){
let data1 = data.range;
const _errs5 = errors;
let valid1 = false;
let passing0 = null;
const _errs6 = errors;
if(data1 && typeof data1 == "object" && !Array.isArray(data1)){
if(data1.mode === undefined){
const err5 = {instancePath:instancePath+"/range",schemaPath:"#/$defs/explicitRange/required",keyword:"required",params:{missingProperty: "mode"},message:"must have required property '"+"mode"+"'"};
if(vErrors === null){
vErrors = [err5];
}
else {
vErrors.push(err5);
}
errors++;
}
if(data1.in === undefined){
const err6 = {instancePath:instancePath+"/range",schemaPath:"#/$defs/explicitRange/required",keyword:"required",params:{missingProperty: "in"},message:"must have required property '"+"in"+"'"};
if(vErrors === null){
vErrors = [err6];
}
else {
vErrors.push(err6);
}
errors++;
}
if(data1.out === undefined){
const err7 = {instancePath:instancePath+"/range",schemaPath:"#/$defs/explicitRange/required",keyword:"required",params:{missingProperty: "out"},message:"must have required property '"+"out"+"'"};
if(vErrors === null){
vErrors = [err7];
}
else {
vErrors.push(err7);
}
errors++;
}
for(const key1 in data1){
if(!(((key1 === "mode") || (key1 === "in")) || (key1 === "out"))){
const err8 = {instancePath:instancePath+"/range",schemaPath:"#/$defs/explicitRange/additionalProperties",keyword:"additionalProperties",params:{additionalProperty: key1},message:"must NOT have additional properties"};
if(vErrors === null){
vErrors = [err8];
}
else {
vErrors.push(err8);
}
errors++;
}
}
if(data1.mode !== undefined){
if("explicit" !== data1.mode){
const err9 = {instancePath:instancePath+"/range/mode",schemaPath:"#/$defs/explicitRange/properties/mode/const",keyword:"const",params:{allowedValue: "explicit"},message:"must be equal to constant"};
if(vErrors === null){
vErrors = [err9];
}
else {
vErrors.push(err9);
}
errors++;
}
}
if(data1.in !== undefined){
let data3 = data1.in;
if(typeof data3 == "number"){
if(data3 < 0 || isNaN(data3)){
const err10 = {instancePath:instancePath+"/range/in",schemaPath:"#/$defs/explicitRange/properties/in/minimum",keyword:"minimum",params:{comparison: ">=", limit: 0},message:"must be >= 0"};
if(vErrors === null){
vErrors = [err10];
}
else {
vErrors.push(err10);
}
errors++;
}
}
else {
const err11 = {instancePath:instancePath+"/range/in",schemaPath:"#/$defs/explicitRange/properties/in/type",keyword:"type",params:{type: "number"},message:"must be number"};
if(vErrors === null){
vErrors = [err11];
}
else {
vErrors.push(err11);
}
errors++;
}
}
if(data1.out !== undefined){
let data4 = data1.out;
if(typeof data4 == "number"){
if(data4 <= 0 || isNaN(data4)){
const err12 = {instancePath:instancePath+"/range/out",schemaPath:"#/$defs/explicitRange/properties/out/exclusiveMinimum",keyword:"exclusiveMinimum",params:{comparison: ">", limit: 0},message:"must be > 0"};
if(vErrors === null){
vErrors = [err12];
}
else {
vErrors.push(err12);
}
errors++;
}
}
else {
const err13 = {instancePath:instancePath+"/range/out",schemaPath:"#/$defs/explicitRange/properties/out/type",keyword:"type",params:{type: "number"},message:"must be number"};
if(vErrors === null){
vErrors = [err13];
}
else {
vErrors.push(err13);
}
errors++;
}
}
}
else {
const err14 = {instancePath:instancePath+"/range",schemaPath:"#/$defs/explicitRange/type",keyword:"type",params:{type: "object"},message:"must be object"};
if(vErrors === null){
vErrors = [err14];
}
else {
vErrors.push(err14);
}
errors++;
}
var _valid0 = _errs6 === errors;
if(_valid0){
valid1 = true;
passing0 = 0;
var props0 = true;
}
const _errs15 = errors;
if(data1 && typeof data1 == "object" && !Array.isArray(data1)){
if(data1.mode === undefined){
const err15 = {instancePath:instancePath+"/range",schemaPath:"#/$defs/fullSourceRange/required",keyword:"required",params:{missingProperty: "mode"},message:"must have required property '"+"mode"+"'"};
if(vErrors === null){
vErrors = [err15];
}
else {
vErrors.push(err15);
}
errors++;
}
for(const key2 in data1){
if(!(key2 === "mode")){
const err16 = {instancePath:instancePath+"/range",schemaPath:"#/$defs/fullSourceRange/additionalProperties",keyword:"additionalProperties",params:{additionalProperty: key2},message:"must NOT have additional properties"};
if(vErrors === null){
vErrors = [err16];
}
else {
vErrors.push(err16);
}
errors++;
}
}
if(data1.mode !== undefined){
if("full_source" !== data1.mode){
const err17 = {instancePath:instancePath+"/range/mode",schemaPath:"#/$defs/fullSourceRange/properties/mode/const",keyword:"const",params:{allowedValue: "full_source"},message:"must be equal to constant"};
if(vErrors === null){
vErrors = [err17];
}
else {
vErrors.push(err17);
}
errors++;
}
}
}
else {
const err18 = {instancePath:instancePath+"/range",schemaPath:"#/$defs/fullSourceRange/type",keyword:"type",params:{type: "object"},message:"must be object"};
if(vErrors === null){
vErrors = [err18];
}
else {
vErrors.push(err18);
}
errors++;
}
var _valid0 = _errs15 === errors;
if(_valid0 && valid1){
valid1 = false;
passing0 = [passing0, 1];
}
else {
if(_valid0){
valid1 = true;
passing0 = 1;
if(props0 !== true){
props0 = true;
}
}
}
if(!valid1){
const err19 = {instancePath:instancePath+"/range",schemaPath:"#/properties/range/oneOf",keyword:"oneOf",params:{passingSchemas: passing0},message:"must match exactly one schema in oneOf"};
if(vErrors === null){
vErrors = [err19];
}
else {
vErrors.push(err19);
}
errors++;
}
else {
errors = _errs5;
if(vErrors !== null){
if(_errs5){
vErrors.length = _errs5;
}
else {
vErrors = null;
}
}
}
}
}
else {
const err20 = {instancePath,schemaPath:"#/type",keyword:"type",params:{type: "object"},message:"must be object"};
if(vErrors === null){
vErrors = [err20];
}
else {
vErrors.push(err20);
}
errors++;
}
validate50.errors = vErrors;
return errors === 0;
}
validate50.evaluated = {"props":true,"dynamicProps":false,"dynamicItems":false};


function validate49(data, {instancePath="", parentData, parentDataProperty, rootData=data, dynamicAnchors={}}={}){
/*# sourceURL="urn:akari-video:schema:semantic-keep-plan:v1" */;
let vErrors = null;
let errors = 0;
const evaluated0 = validate49.evaluated;
if(evaluated0.dynamicProps){
evaluated0.props = undefined;
}
if(evaluated0.dynamicItems){
evaluated0.items = undefined;
}
if(data && typeof data == "object" && !Array.isArray(data)){
if(data.version === undefined){
const err0 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "version"},message:"must have required property '"+"version"+"'"};
if(vErrors === null){
vErrors = [err0];
}
else {
vErrors.push(err0);
}
errors++;
}
if(data.kind === undefined){
const err1 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "kind"},message:"must have required property '"+"kind"+"'"};
if(vErrors === null){
vErrors = [err1];
}
else {
vErrors.push(err1);
}
errors++;
}
if(data.intended_edit_version === undefined){
const err2 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "intended_edit_version"},message:"must have required property '"+"intended_edit_version"+"'"};
if(vErrors === null){
vErrors = [err2];
}
else {
vErrors.push(err2);
}
errors++;
}
if(data.candidate_frame_rate === undefined){
const err3 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "candidate_frame_rate"},message:"must have required property '"+"candidate_frame_rate"+"'"};
if(vErrors === null){
vErrors = [err3];
}
else {
vErrors.push(err3);
}
errors++;
}
if(data.sources === undefined){
const err4 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "sources"},message:"must have required property '"+"sources"+"'"};
if(vErrors === null){
vErrors = [err4];
}
else {
vErrors.push(err4);
}
errors++;
}
if(data.occurrences === undefined){
const err5 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "occurrences"},message:"must have required property '"+"occurrences"+"'"};
if(vErrors === null){
vErrors = [err5];
}
else {
vErrors.push(err5);
}
errors++;
}
for(const key0 in data){
if(!((((((key0 === "version") || (key0 === "kind")) || (key0 === "intended_edit_version")) || (key0 === "candidate_frame_rate")) || (key0 === "sources")) || (key0 === "occurrences"))){
const err6 = {instancePath,schemaPath:"#/additionalProperties",keyword:"additionalProperties",params:{additionalProperty: key0},message:"must NOT have additional properties"};
if(vErrors === null){
vErrors = [err6];
}
else {
vErrors.push(err6);
}
errors++;
}
}
if(data.version !== undefined){
if(1 !== data.version){
const err7 = {instancePath:instancePath+"/version",schemaPath:"#/properties/version/const",keyword:"const",params:{allowedValue: 1},message:"must be equal to constant"};
if(vErrors === null){
vErrors = [err7];
}
else {
vErrors.push(err7);
}
errors++;
}
}
if(data.kind !== undefined){
if("akari-semantic-keep-plan-v1" !== data.kind){
const err8 = {instancePath:instancePath+"/kind",schemaPath:"#/properties/kind/const",keyword:"const",params:{allowedValue: "akari-semantic-keep-plan-v1"},message:"must be equal to constant"};
if(vErrors === null){
vErrors = [err8];
}
else {
vErrors.push(err8);
}
errors++;
}
}
if(data.intended_edit_version !== undefined){
let data2 = data.intended_edit_version;
if(!((data2 === 0) || (data2 === 1))){
const err9 = {instancePath:instancePath+"/intended_edit_version",schemaPath:"#/properties/intended_edit_version/enum",keyword:"enum",params:{allowedValues: schema71.properties.intended_edit_version.enum},message:"must be equal to one of the allowed values"};
if(vErrors === null){
vErrors = [err9];
}
else {
vErrors.push(err9);
}
errors++;
}
}
if(data.candidate_frame_rate !== undefined){
if(30 !== data.candidate_frame_rate){
const err10 = {instancePath:instancePath+"/candidate_frame_rate",schemaPath:"#/properties/candidate_frame_rate/const",keyword:"const",params:{allowedValue: 30},message:"must be equal to constant"};
if(vErrors === null){
vErrors = [err10];
}
else {
vErrors.push(err10);
}
errors++;
}
}
if(data.sources !== undefined){
let data4 = data.sources;
if(Array.isArray(data4)){
if(data4.length > 256){
const err11 = {instancePath:instancePath+"/sources",schemaPath:"#/properties/sources/maxItems",keyword:"maxItems",params:{limit: 256},message:"must NOT have more than 256 items"};
if(vErrors === null){
vErrors = [err11];
}
else {
vErrors.push(err11);
}
errors++;
}
if(data4.length < 1){
const err12 = {instancePath:instancePath+"/sources",schemaPath:"#/properties/sources/minItems",keyword:"minItems",params:{limit: 1},message:"must NOT have fewer than 1 items"};
if(vErrors === null){
vErrors = [err12];
}
else {
vErrors.push(err12);
}
errors++;
}
const len0 = data4.length;
for(let i0=0; i0<len0; i0++){
let data5 = data4[i0];
if(data5 && typeof data5 == "object" && !Array.isArray(data5)){
if(data5.id === undefined){
const err13 = {instancePath:instancePath+"/sources/" + i0,schemaPath:"#/$defs/source/required",keyword:"required",params:{missingProperty: "id"},message:"must have required property '"+"id"+"'"};
if(vErrors === null){
vErrors = [err13];
}
else {
vErrors.push(err13);
}
errors++;
}
if(data5.path === undefined){
const err14 = {instancePath:instancePath+"/sources/" + i0,schemaPath:"#/$defs/source/required",keyword:"required",params:{missingProperty: "path"},message:"must have required property '"+"path"+"'"};
if(vErrors === null){
vErrors = [err14];
}
else {
vErrors.push(err14);
}
errors++;
}
for(const key1 in data5){
if(!((key1 === "id") || (key1 === "path"))){
const err15 = {instancePath:instancePath+"/sources/" + i0,schemaPath:"#/$defs/source/additionalProperties",keyword:"additionalProperties",params:{additionalProperty: key1},message:"must NOT have additional properties"};
if(vErrors === null){
vErrors = [err15];
}
else {
vErrors.push(err15);
}
errors++;
}
}
if(data5.id !== undefined){
let data6 = data5.id;
const _errs13 = errors;
let valid5 = false;
let passing0 = null;
const _errs14 = errors;
if(data6 !== null){
const err16 = {instancePath:instancePath+"/sources/" + i0+"/id",schemaPath:"#/$defs/source/properties/id/oneOf/0/type",keyword:"type",params:{type: "null"},message:"must be null"};
if(vErrors === null){
vErrors = [err16];
}
else {
vErrors.push(err16);
}
errors++;
}
var _valid0 = _errs14 === errors;
if(_valid0){
valid5 = true;
passing0 = 0;
}
const _errs16 = errors;
if(typeof data6 === "string"){
if(func1(data6) < 1){
const err17 = {instancePath:instancePath+"/sources/" + i0+"/id",schemaPath:"#/$defs/source/properties/id/oneOf/1/minLength",keyword:"minLength",params:{limit: 1},message:"must NOT have fewer than 1 characters"};
if(vErrors === null){
vErrors = [err17];
}
else {
vErrors.push(err17);
}
errors++;
}
if(!pattern4.test(data6)){
const err18 = {instancePath:instancePath+"/sources/" + i0+"/id",schemaPath:"#/$defs/source/properties/id/oneOf/1/pattern",keyword:"pattern",params:{pattern: "\\S"},message:"must match pattern \""+"\\S"+"\""};
if(vErrors === null){
vErrors = [err18];
}
else {
vErrors.push(err18);
}
errors++;
}
}
else {
const err19 = {instancePath:instancePath+"/sources/" + i0+"/id",schemaPath:"#/$defs/source/properties/id/oneOf/1/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err19];
}
else {
vErrors.push(err19);
}
errors++;
}
var _valid0 = _errs16 === errors;
if(_valid0 && valid5){
valid5 = false;
passing0 = [passing0, 1];
}
else {
if(_valid0){
valid5 = true;
passing0 = 1;
}
}
if(!valid5){
const err20 = {instancePath:instancePath+"/sources/" + i0+"/id",schemaPath:"#/$defs/source/properties/id/oneOf",keyword:"oneOf",params:{passingSchemas: passing0},message:"must match exactly one schema in oneOf"};
if(vErrors === null){
vErrors = [err20];
}
else {
vErrors.push(err20);
}
errors++;
}
else {
errors = _errs13;
if(vErrors !== null){
if(_errs13){
vErrors.length = _errs13;
}
else {
vErrors = null;
}
}
}
}
if(data5.path !== undefined){
let data7 = data5.path;
if(typeof data7 === "string"){
if(func1(data7) < 1){
const err21 = {instancePath:instancePath+"/sources/" + i0+"/path",schemaPath:"#/$defs/source/properties/path/minLength",keyword:"minLength",params:{limit: 1},message:"must NOT have fewer than 1 characters"};
if(vErrors === null){
vErrors = [err21];
}
else {
vErrors.push(err21);
}
errors++;
}
if(!pattern5.test(data7)){
const err22 = {instancePath:instancePath+"/sources/" + i0+"/path",schemaPath:"#/$defs/source/properties/path/pattern",keyword:"pattern",params:{pattern: "^(?!/)(?![A-Za-z]:[\\\\/])(?![A-Za-z][A-Za-z0-9+.-]*:)(?!.*\\\\)(?!.*(?:^|/)\\.\\.(?:/|$))\\S(?:.*\\S)?$"},message:"must match pattern \""+"^(?!/)(?![A-Za-z]:[\\\\/])(?![A-Za-z][A-Za-z0-9+.-]*:)(?!.*\\\\)(?!.*(?:^|/)\\.\\.(?:/|$))\\S(?:.*\\S)?$"+"\""};
if(vErrors === null){
vErrors = [err22];
}
else {
vErrors.push(err22);
}
errors++;
}
}
else {
const err23 = {instancePath:instancePath+"/sources/" + i0+"/path",schemaPath:"#/$defs/source/properties/path/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err23];
}
else {
vErrors.push(err23);
}
errors++;
}
}
}
else {
const err24 = {instancePath:instancePath+"/sources/" + i0,schemaPath:"#/$defs/source/type",keyword:"type",params:{type: "object"},message:"must be object"};
if(vErrors === null){
vErrors = [err24];
}
else {
vErrors.push(err24);
}
errors++;
}
}
}
else {
const err25 = {instancePath:instancePath+"/sources",schemaPath:"#/properties/sources/type",keyword:"type",params:{type: "array"},message:"must be array"};
if(vErrors === null){
vErrors = [err25];
}
else {
vErrors.push(err25);
}
errors++;
}
}
if(data.occurrences !== undefined){
let data8 = data.occurrences;
if(Array.isArray(data8)){
if(data8.length > 100000){
const err26 = {instancePath:instancePath+"/occurrences",schemaPath:"#/properties/occurrences/maxItems",keyword:"maxItems",params:{limit: 100000},message:"must NOT have more than 100000 items"};
if(vErrors === null){
vErrors = [err26];
}
else {
vErrors.push(err26);
}
errors++;
}
const len1 = data8.length;
for(let i1=0; i1<len1; i1++){
if(!(validate50(data8[i1], {instancePath:instancePath+"/occurrences/" + i1,parentData:data8,parentDataProperty:i1,rootData,dynamicAnchors}))){
vErrors = vErrors === null ? validate50.errors : vErrors.concat(validate50.errors);
errors = vErrors.length;
}
}
}
else {
const err27 = {instancePath:instancePath+"/occurrences",schemaPath:"#/properties/occurrences/type",keyword:"type",params:{type: "array"},message:"must be array"};
if(vErrors === null){
vErrors = [err27];
}
else {
vErrors.push(err27);
}
errors++;
}
}
}
else {
const err28 = {instancePath,schemaPath:"#/type",keyword:"type",params:{type: "object"},message:"must be object"};
if(vErrors === null){
vErrors = [err28];
}
else {
vErrors.push(err28);
}
errors++;
}
validate49.errors = vErrors;
return errors === 0;
}
validate49.evaluated = {"props":true,"dynamicProps":false,"dynamicItems":false};

exports.validateCutCandidates = validate52;
const schema76 = {"$schema":"https://json-schema.org/draft/2020-12/schema","$id":"urn:akari-video:schema:cut-candidates:v1","title":"AKARI cut candidate report v1","type":"object","additionalProperties":false,"required":["version","kind","policy","inputs","tool","candidates","skipped","summary","residual_risks","approved_to_apply","edit_json_modified"],"properties":{"version":{"const":1},"kind":{"const":"akari-cut-candidates-v1"},"policy":{"$ref":"#/$defs/policy"},"inputs":{"$ref":"#/$defs/inputs"},"tool":{"$ref":"#/$defs/tool"},"candidates":{"type":"array","maxItems":1000000,"items":{"oneOf":[{"$ref":"#/$defs/semanticCandidate"},{"$ref":"#/$defs/pauseCandidate"}]}},"skipped":{"type":"array","maxItems":1000000,"items":{"$ref":"#/$defs/skipped"}},"summary":{"$ref":"#/$defs/summary"},"residual_risks":{"type":"array","minItems":3,"maxItems":3,"uniqueItems":true,"items":{"enum":["ANALYSIS_FRESHNESS_UNVERIFIED","CONCURRENT_RETARGET_NOT_PROVEN","DYNAMIC_LIBRARY_CLOSURE_UNVERIFIED"]}},"approved_to_apply":{"const":false},"edit_json_modified":{"const":false}},"$defs":{"sha256":{"type":"string","pattern":"^[a-f0-9]{64}$"},"bytes":{"type":"integer","minimum":0},"relativePath":{"type":"string","minLength":1,"pattern":"^(?!/)(?![A-Za-z]:[\\\\/])(?![A-Za-z][A-Za-z0-9+.-]*:)(?!.*\\\\)(?!.*(?:^|/)\\.\\.(?:/|$))\\S(?:.*\\S)?$"},"src":{"oneOf":[{"type":"null"},{"type":"string","minLength":1,"pattern":"\\S"}]},"seconds":{"type":"number","minimum":0},"interval":{"type":"object","additionalProperties":false,"required":["start","end"],"properties":{"start":{"$ref":"#/$defs/seconds"},"end":{"$ref":"#/$defs/seconds"}}},"wordRef":{"type":"object","additionalProperties":false,"required":["segment_index","word_index","start","end","text"],"properties":{"segment_index":{"type":"integer","minimum":0},"word_index":{"type":"integer","minimum":0},"start":{"$ref":"#/$defs/seconds"},"end":{"$ref":"#/$defs/seconds"},"text":{"type":"string","minLength":1}}},"nullableWordRef":{"oneOf":[{"type":"null"},{"$ref":"#/$defs/wordRef"}]},"context":{"type":"object","additionalProperties":false,"required":["start","end","previous_word","next_word","chapter_event_indexes","keyframe_input_indexes"],"properties":{"start":{"$ref":"#/$defs/seconds"},"end":{"$ref":"#/$defs/seconds"},"previous_word":{"$ref":"#/$defs/nullableWordRef"},"next_word":{"$ref":"#/$defs/nullableWordRef"},"chapter_event_indexes":{"type":"array","items":{"type":"integer","minimum":0}},"keyframe_input_indexes":{"type":"array","items":{"type":"integer","minimum":0}}}},"policyValues":{"type":"object","additionalProperties":false,"required":["silence_detection_db","minimum_silence_seconds","retained_pause_seconds","surrounding_context_seconds","speech_guard_seconds","frame_rate"],"properties":{"silence_detection_db":{"const":-35},"minimum_silence_seconds":{"const":0.45},"retained_pause_seconds":{"type":"object","additionalProperties":false,"required":["within_sentence","sentence_end","topic_transition"],"properties":{"within_sentence":{"const":0.1},"sentence_end":{"const":0.166667},"topic_transition":{"const":0.3}}},"surrounding_context_seconds":{"const":1},"speech_guard_seconds":{"const":0.033333},"frame_rate":{"const":30}}},"policy":{"type":"object","additionalProperties":false,"required":["id","origin","skill_relative_path","bytes","sha256","values"],"properties":{"id":{"const":"a4-conversation-v1"},"origin":{"const":"EDIT_PLAN_SKILL"},"skill_relative_path":{"const":"references/cut-candidate-policy.a4-conversation-v1.json"},"bytes":{"$ref":"#/$defs/bytes"},"sha256":{"$ref":"#/$defs/sha256"},"values":{"$ref":"#/$defs/policyValues"}}},"fileReceipt":{"type":"object","additionalProperties":false,"required":["path","bytes","sha256"],"properties":{"path":{"$ref":"#/$defs/relativePath"},"bytes":{"$ref":"#/$defs/bytes"},"sha256":{"$ref":"#/$defs/sha256"}}},"semanticKeepPlanReceipt":{"type":"object","additionalProperties":false,"required":["path","bytes","sha256","claim"],"properties":{"path":{"$ref":"#/$defs/relativePath"},"bytes":{"$ref":"#/$defs/bytes"},"sha256":{"$ref":"#/$defs/sha256"},"claim":{"const":"CALLER_SUPPLIED_SEMANTIC_KEEP_DRAFT"}}},"decisionLogReceipt":{"type":"object","additionalProperties":false,"required":["path","bytes","sha256","approval_ref","verification"],"properties":{"path":{"$ref":"#/$defs/relativePath"},"bytes":{"$ref":"#/$defs/bytes"},"sha256":{"$ref":"#/$defs/sha256"},"approval_ref":{"type":"string","pattern":"^checkpoint-1/[a-z0-9](?:[a-z0-9-]{0,62})/[0-9]{4}-[0-9]{2}-[0-9]{2}(?:-r[0-9]{1,3})?$"},"verification":{"const":"CALLER_ASSERTED_NOT_MACHINE_VERIFIED"}}},"probeStream":{"type":"object","additionalProperties":false,"required":["index","codec_type","duration_seconds"],"properties":{"index":{"type":"integer","minimum":0},"codec_type":{"type":"string","minLength":1},"duration_seconds":{"oneOf":[{"type":"null"},{"type":"number","minimum":0}]}}},"probe":{"type":"object","additionalProperties":false,"required":["format_names","format_duration_seconds","stream_count","audio_stream_count","streams","selected_audio_stream_index","selected_audio_codec_type","selected_audio_duration_seconds","audio_format_delta_seconds","normalized_sha256"],"properties":{"format_names":{"type":"array","minItems":1,"items":{"type":"string","minLength":1}},"format_duration_seconds":{"type":"number","exclusiveMinimum":0},"stream_count":{"type":"integer","minimum":1},"audio_stream_count":{"const":1},"streams":{"type":"array","minItems":1,"items":{"$ref":"#/$defs/probeStream"}},"selected_audio_stream_index":{"type":"integer","minimum":0},"selected_audio_codec_type":{"const":"audio"},"selected_audio_duration_seconds":{"oneOf":[{"type":"null"},{"type":"number","minimum":0}]},"audio_format_delta_seconds":{"oneOf":[{"type":"null"},{"type":"number","minimum":0}]},"normalized_sha256":{"$ref":"#/$defs/sha256"}}},"detector":{"type":"object","additionalProperties":false,"required":["status","silence_pair_count","stderr_bytes","argv_template_sha256"],"properties":{"status":{"enum":["COMPLETED","NOT_RUN_WORD_TIMING_UNAVAILABLE"]},"silence_pair_count":{"type":"integer","minimum":0},"stderr_bytes":{"$ref":"#/$defs/bytes"},"argv_template_sha256":{"$ref":"#/$defs/sha256"}}},"processedSource":{"type":"object","additionalProperties":false,"required":["id","path","bytes","sha256","source_order","probe","detector"],"properties":{"id":{"$ref":"#/$defs/src"},"path":{"$ref":"#/$defs/relativePath"},"bytes":{"$ref":"#/$defs/bytes"},"sha256":{"$ref":"#/$defs/sha256"},"source_order":{"type":"integer","minimum":0},"probe":{"$ref":"#/$defs/probe"},"detector":{"$ref":"#/$defs/detector"}}},"analysisReceipt":{"type":"object","additionalProperties":false,"required":["src","path","bytes","sha256","analysis_freshness"],"properties":{"src":{"$ref":"#/$defs/src"},"path":{"$ref":"#/$defs/relativePath"},"bytes":{"$ref":"#/$defs/bytes"},"sha256":{"$ref":"#/$defs/sha256"},"analysis_freshness":{"const":"UNVERIFIED_CONTRACT_LIMIT"}}},"keyframeReceipt":{"type":"object","additionalProperties":false,"required":["input_index","src","t","path","bytes","sha256","note"],"properties":{"input_index":{"type":"integer","minimum":0},"src":{"$ref":"#/$defs/src"},"t":{"$ref":"#/$defs/seconds"},"path":{"$ref":"#/$defs/relativePath"},"bytes":{"$ref":"#/$defs/bytes"},"sha256":{"$ref":"#/$defs/sha256"},"note":{"type":"string","minLength":1},"origin":{"enum":["scene","interval","transcript"]}}},"inputs":{"type":"object","additionalProperties":false,"required":["semantic_keep_plan","decision_log","processed_sources","analyses","keyframes"],"properties":{"semantic_keep_plan":{"$ref":"#/$defs/semanticKeepPlanReceipt"},"decision_log":{"$ref":"#/$defs/decisionLogReceipt"},"processed_sources":{"type":"array","maxItems":256,"items":{"$ref":"#/$defs/processedSource"}},"analyses":{"type":"array","maxItems":256,"items":{"$ref":"#/$defs/analysisReceipt"}},"keyframes":{"type":"array","items":{"$ref":"#/$defs/keyframeReceipt"}}}},"moduleReceipt":{"type":"object","additionalProperties":false,"required":["role","skill_relative_path","bytes","sha256"],"properties":{"role":{"enum":["entrypoint","helper","schema_validator","semantic_validator","vendor_runtime"]},"skill_relative_path":{"$ref":"#/$defs/relativePath"},"bytes":{"$ref":"#/$defs/bytes"},"sha256":{"$ref":"#/$defs/sha256"}}},"schemaReceipt":{"type":"object","additionalProperties":false,"required":["id","canonical_source_path","sha256"],"properties":{"id":{"enum":["analysis-v0","semantic-keep-plan-v1","cut-candidates-v1"]},"canonical_source_path":{"enum":["packages/schemas/analysis.schema.json","packages/schemas/semantic-keep-plan.schema.json","packages/schemas/cut-candidates.schema.json"]},"sha256":{"$ref":"#/$defs/sha256"}}},"binaryToolReceipt":{"type":"object","additionalProperties":false,"required":["version","binary_bytes","binary_sha256"],"properties":{"version":{"type":"string","minLength":1,"maxLength":512},"binary_bytes":{"$ref":"#/$defs/bytes"},"binary_sha256":{"$ref":"#/$defs/sha256"}}},"nodeReceipt":{"type":"object","additionalProperties":false,"required":["platform","arch","node_version","v8_version","node_binary_bytes","node_binary_sha256"],"properties":{"platform":{"type":"string","minLength":1},"arch":{"type":"string","minLength":1},"node_version":{"type":"string","minLength":1},"v8_version":{"type":"string","minLength":1},"node_binary_bytes":{"$ref":"#/$defs/bytes"},"node_binary_sha256":{"$ref":"#/$defs/sha256"}}},"tool":{"type":"object","additionalProperties":false,"required":["module_source_set","module_source_set_sha256","contract_schemas","ffmpeg","ffprobe","node","detector_argv_template_sha256"],"properties":{"module_source_set":{"type":"array","minItems":4,"items":{"$ref":"#/$defs/moduleReceipt"}},"module_source_set_sha256":{"$ref":"#/$defs/sha256"},"contract_schemas":{"type":"array","minItems":3,"maxItems":3,"items":{"$ref":"#/$defs/schemaReceipt"}},"ffmpeg":{"$ref":"#/$defs/binaryToolReceipt"},"ffprobe":{"$ref":"#/$defs/binaryToolReceipt"},"node":{"$ref":"#/$defs/nodeReceipt"},"detector_argv_template_sha256":{"$ref":"#/$defs/sha256"}}},"classificationBasis":{"oneOf":[{"type":"object","additionalProperties":false,"required":["kind","event_index"],"properties":{"kind":{"const":"chapter_event"},"event_index":{"type":"integer","minimum":0}}},{"type":"object","additionalProperties":false,"required":["kind","segment_index","terminal"],"properties":{"kind":{"const":"sentence_terminal"},"segment_index":{"type":"integer","minimum":0},"terminal":{"type":"string","pattern":"^[。！？!?]$"}}},{"type":"object","additionalProperties":false,"required":["kind"],"properties":{"kind":{"const":"default_within_sentence"}}}]},"candidateRisk":{"enum":["UI_WAIT_UNRESOLVED","SCREEN_CONTEXT_MISSING","INFORMATION_RETENTION_REVIEW","PARTIAL_EVENT_OCCURRENCE"]},"semanticEvent":{"type":"object","additionalProperties":false,"required":["index","type","event_original_interval","projected_interval","partial_event_occurrence"],"properties":{"index":{"type":"integer","minimum":0},"type":{"enum":["filler","trouble"]},"note":{"type":"string","minLength":1},"event_original_interval":{"$ref":"#/$defs/interval"},"projected_interval":{"$ref":"#/$defs/interval"},"partial_event_occurrence":{"type":"boolean"}}},"semanticCandidate":{"type":"object","additionalProperties":false,"required":["id","family","src","occurrence_index","occurrence_origin","occurrence_interval","event","context","screen_review_required","suggested_action","risk_flags","decision"],"properties":{"id":{"type":"string","pattern":"^semantic-[0-9]{4,}$"},"family":{"const":"semantic_event_review"},"src":{"$ref":"#/$defs/src"},"occurrence_index":{"type":"integer","minimum":0},"occurrence_origin":{"enum":["explicit_range","full_source"]},"occurrence_interval":{"$ref":"#/$defs/interval"},"event":{"$ref":"#/$defs/semanticEvent"},"context":{"$ref":"#/$defs/context"},"screen_review_required":{"const":true},"suggested_action":{"const":"review_drop_or_keep"},"risk_flags":{"type":"array","minItems":2,"uniqueItems":true,"items":{"$ref":"#/$defs/candidateRisk"}},"decision":{"const":"REVIEW_REQUIRED"}}},"pauseProposal":{"type":"object","additionalProperties":false,"required":["fps","target_retained_seconds","raw_remove_start","raw_remove_end","remove_start_frame","remove_end_frame","remove_start","remove_end","actual_retained_seconds"],"properties":{"fps":{"const":30},"target_retained_seconds":{"enum":[0.1,0.166667,0.3]},"raw_remove_start":{"$ref":"#/$defs/seconds"},"raw_remove_end":{"$ref":"#/$defs/seconds"},"remove_start_frame":{"type":"integer","minimum":0},"remove_end_frame":{"type":"integer","minimum":0},"remove_start":{"$ref":"#/$defs/seconds"},"remove_end":{"$ref":"#/$defs/seconds"},"actual_retained_seconds":{"$ref":"#/$defs/seconds"}}},"pauseCandidate":{"type":"object","additionalProperties":false,"required":["id","family","src","occurrence_index","occurrence_origin","occurrence_interval","source_interval","classification","classification_basis","context","proposal","screen_review_required","risk_flags","decision"],"properties":{"id":{"type":"string","pattern":"^pause-[0-9]{4,}$"},"family":{"const":"pause_shortening_review"},"src":{"$ref":"#/$defs/src"},"occurrence_index":{"type":"integer","minimum":0},"occurrence_origin":{"enum":["explicit_range","full_source"]},"occurrence_interval":{"$ref":"#/$defs/interval"},"source_interval":{"$ref":"#/$defs/interval"},"classification":{"enum":["within_sentence","sentence_end","topic_transition"]},"classification_basis":{"$ref":"#/$defs/classificationBasis"},"context":{"$ref":"#/$defs/context"},"proposal":{"$ref":"#/$defs/pauseProposal"},"screen_review_required":{"const":true},"risk_flags":{"type":"array","minItems":1,"uniqueItems":true,"items":{"$ref":"#/$defs/candidateRisk"}},"decision":{"const":"REVIEW_REQUIRED"}}},"skipCode":{"enum":["WORD_TIMING_UNAVAILABLE","MISSING_SPEECH_CONTEXT","PROTECTED_WORD_OVERLAP","OUTSIDE_KEEP_OCCURRENCE","CROSSES_OCCURRENCE_BOUNDARY","NO_FRAME_CELL","NO_EFFECTIVE_CHANGE","TARGET_NOT_REACHED"]},"skipDetail":{"oneOf":[{"type":"object","additionalProperties":false,"required":["missing_segment_indexes"],"properties":{"missing_segment_indexes":{"type":"array","items":{"type":"integer","minimum":0}}}},{"type":"object","additionalProperties":false,"required":["previous_word_available","next_word_available"],"properties":{"previous_word_available":{"type":"boolean"},"next_word_available":{"type":"boolean"}}},{"type":"object","additionalProperties":false,"required":["protected_words"],"properties":{"protected_words":{"type":"array","minItems":1,"items":{"$ref":"#/$defs/wordRef"}}}},{"type":"object","additionalProperties":false,"required":["detector_pair_index"],"properties":{"detector_pair_index":{"type":"integer","minimum":0}}},{"type":"object","additionalProperties":false,"required":["detector_pair_index","occurrence_interval"],"properties":{"detector_pair_index":{"type":"integer","minimum":0},"occurrence_interval":{"$ref":"#/$defs/interval"}}},{"type":"object","additionalProperties":false,"required":["raw_remove_start","raw_remove_end","remove_start_frame","remove_end_frame"],"properties":{"raw_remove_start":{"$ref":"#/$defs/seconds"},"raw_remove_end":{"$ref":"#/$defs/seconds"},"remove_start_frame":{"type":"integer","minimum":0},"remove_end_frame":{"type":"integer","minimum":0}}},{"type":"object","additionalProperties":false,"required":["retained_before_seconds","target_retained_seconds","retained_after_seconds"],"properties":{"retained_before_seconds":{"$ref":"#/$defs/seconds"},"target_retained_seconds":{"$ref":"#/$defs/seconds"},"retained_after_seconds":{"$ref":"#/$defs/seconds"}}}]},"skipped":{"type":"object","additionalProperties":false,"required":["id","src","occurrence_index","occurrence_origin","source_interval","code","detail"],"properties":{"id":{"type":"string","pattern":"^skip-[0-9]{4,}$"},"src":{"$ref":"#/$defs/src"},"occurrence_index":{"oneOf":[{"type":"null"},{"type":"integer","minimum":0}]},"occurrence_origin":{"oneOf":[{"type":"null"},{"enum":["explicit_range","full_source"]}]},"source_interval":{"$ref":"#/$defs/interval"},"code":{"$ref":"#/$defs/skipCode"},"detail":{"$ref":"#/$defs/skipDetail"}}},"sourceSummary":{"type":"object","additionalProperties":false,"required":["src","candidate_count","skipped_count"],"properties":{"src":{"$ref":"#/$defs/src"},"candidate_count":{"type":"integer","minimum":0},"skipped_count":{"type":"integer","minimum":0}}},"skippedByCode":{"type":"object","additionalProperties":false,"properties":{"WORD_TIMING_UNAVAILABLE":{"type":"integer","minimum":1},"MISSING_SPEECH_CONTEXT":{"type":"integer","minimum":1},"PROTECTED_WORD_OVERLAP":{"type":"integer","minimum":1},"OUTSIDE_KEEP_OCCURRENCE":{"type":"integer","minimum":1},"CROSSES_OCCURRENCE_BOUNDARY":{"type":"integer","minimum":1},"NO_FRAME_CELL":{"type":"integer","minimum":1},"NO_EFFECTIVE_CHANGE":{"type":"integer","minimum":1},"TARGET_NOT_REACHED":{"type":"integer","minimum":1}}},"summary":{"type":"object","additionalProperties":false,"required":["candidate_count","semantic_event_review_count","pause_shortening_review_count","skipped_count","skipped_by_code","by_source"],"properties":{"candidate_count":{"type":"integer","minimum":0},"semantic_event_review_count":{"type":"integer","minimum":0},"pause_shortening_review_count":{"type":"integer","minimum":0},"skipped_count":{"type":"integer","minimum":0},"skipped_by_code":{"$ref":"#/$defs/skippedByCode"},"by_source":{"type":"array","items":{"$ref":"#/$defs/sourceSummary"}}}}}};
const func20 = Object.prototype.hasOwnProperty;
const func0 = require("./runtime/equal.cjs").default;
const schema77 = {"type":"object","additionalProperties":false,"required":["id","origin","skill_relative_path","bytes","sha256","values"],"properties":{"id":{"const":"a4-conversation-v1"},"origin":{"const":"EDIT_PLAN_SKILL"},"skill_relative_path":{"const":"references/cut-candidate-policy.a4-conversation-v1.json"},"bytes":{"$ref":"#/$defs/bytes"},"sha256":{"$ref":"#/$defs/sha256"},"values":{"$ref":"#/$defs/policyValues"}}};
const schema78 = {"type":"integer","minimum":0};
const schema79 = {"type":"string","pattern":"^[a-f0-9]{64}$"};
const schema80 = {"type":"object","additionalProperties":false,"required":["silence_detection_db","minimum_silence_seconds","retained_pause_seconds","surrounding_context_seconds","speech_guard_seconds","frame_rate"],"properties":{"silence_detection_db":{"const":-35},"minimum_silence_seconds":{"const":0.45},"retained_pause_seconds":{"type":"object","additionalProperties":false,"required":["within_sentence","sentence_end","topic_transition"],"properties":{"within_sentence":{"const":0.1},"sentence_end":{"const":0.166667},"topic_transition":{"const":0.3}}},"surrounding_context_seconds":{"const":1},"speech_guard_seconds":{"const":0.033333},"frame_rate":{"const":30}}};
const pattern6 = new RegExp("^[a-f0-9]{64}$", "u");

function validate53(data, {instancePath="", parentData, parentDataProperty, rootData=data, dynamicAnchors={}}={}){
let vErrors = null;
let errors = 0;
const evaluated0 = validate53.evaluated;
if(evaluated0.dynamicProps){
evaluated0.props = undefined;
}
if(evaluated0.dynamicItems){
evaluated0.items = undefined;
}
if(data && typeof data == "object" && !Array.isArray(data)){
if(data.id === undefined){
const err0 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "id"},message:"must have required property '"+"id"+"'"};
if(vErrors === null){
vErrors = [err0];
}
else {
vErrors.push(err0);
}
errors++;
}
if(data.origin === undefined){
const err1 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "origin"},message:"must have required property '"+"origin"+"'"};
if(vErrors === null){
vErrors = [err1];
}
else {
vErrors.push(err1);
}
errors++;
}
if(data.skill_relative_path === undefined){
const err2 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "skill_relative_path"},message:"must have required property '"+"skill_relative_path"+"'"};
if(vErrors === null){
vErrors = [err2];
}
else {
vErrors.push(err2);
}
errors++;
}
if(data.bytes === undefined){
const err3 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "bytes"},message:"must have required property '"+"bytes"+"'"};
if(vErrors === null){
vErrors = [err3];
}
else {
vErrors.push(err3);
}
errors++;
}
if(data.sha256 === undefined){
const err4 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "sha256"},message:"must have required property '"+"sha256"+"'"};
if(vErrors === null){
vErrors = [err4];
}
else {
vErrors.push(err4);
}
errors++;
}
if(data.values === undefined){
const err5 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "values"},message:"must have required property '"+"values"+"'"};
if(vErrors === null){
vErrors = [err5];
}
else {
vErrors.push(err5);
}
errors++;
}
for(const key0 in data){
if(!((((((key0 === "id") || (key0 === "origin")) || (key0 === "skill_relative_path")) || (key0 === "bytes")) || (key0 === "sha256")) || (key0 === "values"))){
const err6 = {instancePath,schemaPath:"#/additionalProperties",keyword:"additionalProperties",params:{additionalProperty: key0},message:"must NOT have additional properties"};
if(vErrors === null){
vErrors = [err6];
}
else {
vErrors.push(err6);
}
errors++;
}
}
if(data.id !== undefined){
if("a4-conversation-v1" !== data.id){
const err7 = {instancePath:instancePath+"/id",schemaPath:"#/properties/id/const",keyword:"const",params:{allowedValue: "a4-conversation-v1"},message:"must be equal to constant"};
if(vErrors === null){
vErrors = [err7];
}
else {
vErrors.push(err7);
}
errors++;
}
}
if(data.origin !== undefined){
if("EDIT_PLAN_SKILL" !== data.origin){
const err8 = {instancePath:instancePath+"/origin",schemaPath:"#/properties/origin/const",keyword:"const",params:{allowedValue: "EDIT_PLAN_SKILL"},message:"must be equal to constant"};
if(vErrors === null){
vErrors = [err8];
}
else {
vErrors.push(err8);
}
errors++;
}
}
if(data.skill_relative_path !== undefined){
if("references/cut-candidate-policy.a4-conversation-v1.json" !== data.skill_relative_path){
const err9 = {instancePath:instancePath+"/skill_relative_path",schemaPath:"#/properties/skill_relative_path/const",keyword:"const",params:{allowedValue: "references/cut-candidate-policy.a4-conversation-v1.json"},message:"must be equal to constant"};
if(vErrors === null){
vErrors = [err9];
}
else {
vErrors.push(err9);
}
errors++;
}
}
if(data.bytes !== undefined){
let data3 = data.bytes;
if(!((typeof data3 == "number") && (!(data3 % 1) && !isNaN(data3)))){
const err10 = {instancePath:instancePath+"/bytes",schemaPath:"#/$defs/bytes/type",keyword:"type",params:{type: "integer"},message:"must be integer"};
if(vErrors === null){
vErrors = [err10];
}
else {
vErrors.push(err10);
}
errors++;
}
if(typeof data3 == "number"){
if(data3 < 0 || isNaN(data3)){
const err11 = {instancePath:instancePath+"/bytes",schemaPath:"#/$defs/bytes/minimum",keyword:"minimum",params:{comparison: ">=", limit: 0},message:"must be >= 0"};
if(vErrors === null){
vErrors = [err11];
}
else {
vErrors.push(err11);
}
errors++;
}
}
}
if(data.sha256 !== undefined){
let data4 = data.sha256;
if(typeof data4 === "string"){
if(!pattern6.test(data4)){
const err12 = {instancePath:instancePath+"/sha256",schemaPath:"#/$defs/sha256/pattern",keyword:"pattern",params:{pattern: "^[a-f0-9]{64}$"},message:"must match pattern \""+"^[a-f0-9]{64}$"+"\""};
if(vErrors === null){
vErrors = [err12];
}
else {
vErrors.push(err12);
}
errors++;
}
}
else {
const err13 = {instancePath:instancePath+"/sha256",schemaPath:"#/$defs/sha256/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err13];
}
else {
vErrors.push(err13);
}
errors++;
}
}
if(data.values !== undefined){
let data5 = data.values;
if(data5 && typeof data5 == "object" && !Array.isArray(data5)){
if(data5.silence_detection_db === undefined){
const err14 = {instancePath:instancePath+"/values",schemaPath:"#/$defs/policyValues/required",keyword:"required",params:{missingProperty: "silence_detection_db"},message:"must have required property '"+"silence_detection_db"+"'"};
if(vErrors === null){
vErrors = [err14];
}
else {
vErrors.push(err14);
}
errors++;
}
if(data5.minimum_silence_seconds === undefined){
const err15 = {instancePath:instancePath+"/values",schemaPath:"#/$defs/policyValues/required",keyword:"required",params:{missingProperty: "minimum_silence_seconds"},message:"must have required property '"+"minimum_silence_seconds"+"'"};
if(vErrors === null){
vErrors = [err15];
}
else {
vErrors.push(err15);
}
errors++;
}
if(data5.retained_pause_seconds === undefined){
const err16 = {instancePath:instancePath+"/values",schemaPath:"#/$defs/policyValues/required",keyword:"required",params:{missingProperty: "retained_pause_seconds"},message:"must have required property '"+"retained_pause_seconds"+"'"};
if(vErrors === null){
vErrors = [err16];
}
else {
vErrors.push(err16);
}
errors++;
}
if(data5.surrounding_context_seconds === undefined){
const err17 = {instancePath:instancePath+"/values",schemaPath:"#/$defs/policyValues/required",keyword:"required",params:{missingProperty: "surrounding_context_seconds"},message:"must have required property '"+"surrounding_context_seconds"+"'"};
if(vErrors === null){
vErrors = [err17];
}
else {
vErrors.push(err17);
}
errors++;
}
if(data5.speech_guard_seconds === undefined){
const err18 = {instancePath:instancePath+"/values",schemaPath:"#/$defs/policyValues/required",keyword:"required",params:{missingProperty: "speech_guard_seconds"},message:"must have required property '"+"speech_guard_seconds"+"'"};
if(vErrors === null){
vErrors = [err18];
}
else {
vErrors.push(err18);
}
errors++;
}
if(data5.frame_rate === undefined){
const err19 = {instancePath:instancePath+"/values",schemaPath:"#/$defs/policyValues/required",keyword:"required",params:{missingProperty: "frame_rate"},message:"must have required property '"+"frame_rate"+"'"};
if(vErrors === null){
vErrors = [err19];
}
else {
vErrors.push(err19);
}
errors++;
}
for(const key1 in data5){
if(!((((((key1 === "silence_detection_db") || (key1 === "minimum_silence_seconds")) || (key1 === "retained_pause_seconds")) || (key1 === "surrounding_context_seconds")) || (key1 === "speech_guard_seconds")) || (key1 === "frame_rate"))){
const err20 = {instancePath:instancePath+"/values",schemaPath:"#/$defs/policyValues/additionalProperties",keyword:"additionalProperties",params:{additionalProperty: key1},message:"must NOT have additional properties"};
if(vErrors === null){
vErrors = [err20];
}
else {
vErrors.push(err20);
}
errors++;
}
}
if(data5.silence_detection_db !== undefined){
if(-35 !== data5.silence_detection_db){
const err21 = {instancePath:instancePath+"/values/silence_detection_db",schemaPath:"#/$defs/policyValues/properties/silence_detection_db/const",keyword:"const",params:{allowedValue: -35},message:"must be equal to constant"};
if(vErrors === null){
vErrors = [err21];
}
else {
vErrors.push(err21);
}
errors++;
}
}
if(data5.minimum_silence_seconds !== undefined){
if(0.45 !== data5.minimum_silence_seconds){
const err22 = {instancePath:instancePath+"/values/minimum_silence_seconds",schemaPath:"#/$defs/policyValues/properties/minimum_silence_seconds/const",keyword:"const",params:{allowedValue: 0.45},message:"must be equal to constant"};
if(vErrors === null){
vErrors = [err22];
}
else {
vErrors.push(err22);
}
errors++;
}
}
if(data5.retained_pause_seconds !== undefined){
let data8 = data5.retained_pause_seconds;
if(data8 && typeof data8 == "object" && !Array.isArray(data8)){
if(data8.within_sentence === undefined){
const err23 = {instancePath:instancePath+"/values/retained_pause_seconds",schemaPath:"#/$defs/policyValues/properties/retained_pause_seconds/required",keyword:"required",params:{missingProperty: "within_sentence"},message:"must have required property '"+"within_sentence"+"'"};
if(vErrors === null){
vErrors = [err23];
}
else {
vErrors.push(err23);
}
errors++;
}
if(data8.sentence_end === undefined){
const err24 = {instancePath:instancePath+"/values/retained_pause_seconds",schemaPath:"#/$defs/policyValues/properties/retained_pause_seconds/required",keyword:"required",params:{missingProperty: "sentence_end"},message:"must have required property '"+"sentence_end"+"'"};
if(vErrors === null){
vErrors = [err24];
}
else {
vErrors.push(err24);
}
errors++;
}
if(data8.topic_transition === undefined){
const err25 = {instancePath:instancePath+"/values/retained_pause_seconds",schemaPath:"#/$defs/policyValues/properties/retained_pause_seconds/required",keyword:"required",params:{missingProperty: "topic_transition"},message:"must have required property '"+"topic_transition"+"'"};
if(vErrors === null){
vErrors = [err25];
}
else {
vErrors.push(err25);
}
errors++;
}
for(const key2 in data8){
if(!(((key2 === "within_sentence") || (key2 === "sentence_end")) || (key2 === "topic_transition"))){
const err26 = {instancePath:instancePath+"/values/retained_pause_seconds",schemaPath:"#/$defs/policyValues/properties/retained_pause_seconds/additionalProperties",keyword:"additionalProperties",params:{additionalProperty: key2},message:"must NOT have additional properties"};
if(vErrors === null){
vErrors = [err26];
}
else {
vErrors.push(err26);
}
errors++;
}
}
if(data8.within_sentence !== undefined){
if(0.1 !== data8.within_sentence){
const err27 = {instancePath:instancePath+"/values/retained_pause_seconds/within_sentence",schemaPath:"#/$defs/policyValues/properties/retained_pause_seconds/properties/within_sentence/const",keyword:"const",params:{allowedValue: 0.1},message:"must be equal to constant"};
if(vErrors === null){
vErrors = [err27];
}
else {
vErrors.push(err27);
}
errors++;
}
}
if(data8.sentence_end !== undefined){
if(0.166667 !== data8.sentence_end){
const err28 = {instancePath:instancePath+"/values/retained_pause_seconds/sentence_end",schemaPath:"#/$defs/policyValues/properties/retained_pause_seconds/properties/sentence_end/const",keyword:"const",params:{allowedValue: 0.166667},message:"must be equal to constant"};
if(vErrors === null){
vErrors = [err28];
}
else {
vErrors.push(err28);
}
errors++;
}
}
if(data8.topic_transition !== undefined){
if(0.3 !== data8.topic_transition){
const err29 = {instancePath:instancePath+"/values/retained_pause_seconds/topic_transition",schemaPath:"#/$defs/policyValues/properties/retained_pause_seconds/properties/topic_transition/const",keyword:"const",params:{allowedValue: 0.3},message:"must be equal to constant"};
if(vErrors === null){
vErrors = [err29];
}
else {
vErrors.push(err29);
}
errors++;
}
}
}
else {
const err30 = {instancePath:instancePath+"/values/retained_pause_seconds",schemaPath:"#/$defs/policyValues/properties/retained_pause_seconds/type",keyword:"type",params:{type: "object"},message:"must be object"};
if(vErrors === null){
vErrors = [err30];
}
else {
vErrors.push(err30);
}
errors++;
}
}
if(data5.surrounding_context_seconds !== undefined){
if(1 !== data5.surrounding_context_seconds){
const err31 = {instancePath:instancePath+"/values/surrounding_context_seconds",schemaPath:"#/$defs/policyValues/properties/surrounding_context_seconds/const",keyword:"const",params:{allowedValue: 1},message:"must be equal to constant"};
if(vErrors === null){
vErrors = [err31];
}
else {
vErrors.push(err31);
}
errors++;
}
}
if(data5.speech_guard_seconds !== undefined){
if(0.033333 !== data5.speech_guard_seconds){
const err32 = {instancePath:instancePath+"/values/speech_guard_seconds",schemaPath:"#/$defs/policyValues/properties/speech_guard_seconds/const",keyword:"const",params:{allowedValue: 0.033333},message:"must be equal to constant"};
if(vErrors === null){
vErrors = [err32];
}
else {
vErrors.push(err32);
}
errors++;
}
}
if(data5.frame_rate !== undefined){
if(30 !== data5.frame_rate){
const err33 = {instancePath:instancePath+"/values/frame_rate",schemaPath:"#/$defs/policyValues/properties/frame_rate/const",keyword:"const",params:{allowedValue: 30},message:"must be equal to constant"};
if(vErrors === null){
vErrors = [err33];
}
else {
vErrors.push(err33);
}
errors++;
}
}
}
else {
const err34 = {instancePath:instancePath+"/values",schemaPath:"#/$defs/policyValues/type",keyword:"type",params:{type: "object"},message:"must be object"};
if(vErrors === null){
vErrors = [err34];
}
else {
vErrors.push(err34);
}
errors++;
}
}
}
else {
const err35 = {instancePath,schemaPath:"#/type",keyword:"type",params:{type: "object"},message:"must be object"};
if(vErrors === null){
vErrors = [err35];
}
else {
vErrors.push(err35);
}
errors++;
}
validate53.errors = vErrors;
return errors === 0;
}
validate53.evaluated = {"props":true,"dynamicProps":false,"dynamicItems":false};

const schema81 = {"type":"object","additionalProperties":false,"required":["semantic_keep_plan","decision_log","processed_sources","analyses","keyframes"],"properties":{"semantic_keep_plan":{"$ref":"#/$defs/semanticKeepPlanReceipt"},"decision_log":{"$ref":"#/$defs/decisionLogReceipt"},"processed_sources":{"type":"array","maxItems":256,"items":{"$ref":"#/$defs/processedSource"}},"analyses":{"type":"array","maxItems":256,"items":{"$ref":"#/$defs/analysisReceipt"}},"keyframes":{"type":"array","items":{"$ref":"#/$defs/keyframeReceipt"}}}};
const schema82 = {"type":"object","additionalProperties":false,"required":["path","bytes","sha256","claim"],"properties":{"path":{"$ref":"#/$defs/relativePath"},"bytes":{"$ref":"#/$defs/bytes"},"sha256":{"$ref":"#/$defs/sha256"},"claim":{"const":"CALLER_SUPPLIED_SEMANTIC_KEEP_DRAFT"}}};
const schema83 = {"type":"string","minLength":1,"pattern":"^(?!/)(?![A-Za-z]:[\\\\/])(?![A-Za-z][A-Za-z0-9+.-]*:)(?!.*\\\\)(?!.*(?:^|/)\\.\\.(?:/|$))\\S(?:.*\\S)?$"};

function validate56(data, {instancePath="", parentData, parentDataProperty, rootData=data, dynamicAnchors={}}={}){
let vErrors = null;
let errors = 0;
const evaluated0 = validate56.evaluated;
if(evaluated0.dynamicProps){
evaluated0.props = undefined;
}
if(evaluated0.dynamicItems){
evaluated0.items = undefined;
}
if(data && typeof data == "object" && !Array.isArray(data)){
if(data.path === undefined){
const err0 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "path"},message:"must have required property '"+"path"+"'"};
if(vErrors === null){
vErrors = [err0];
}
else {
vErrors.push(err0);
}
errors++;
}
if(data.bytes === undefined){
const err1 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "bytes"},message:"must have required property '"+"bytes"+"'"};
if(vErrors === null){
vErrors = [err1];
}
else {
vErrors.push(err1);
}
errors++;
}
if(data.sha256 === undefined){
const err2 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "sha256"},message:"must have required property '"+"sha256"+"'"};
if(vErrors === null){
vErrors = [err2];
}
else {
vErrors.push(err2);
}
errors++;
}
if(data.claim === undefined){
const err3 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "claim"},message:"must have required property '"+"claim"+"'"};
if(vErrors === null){
vErrors = [err3];
}
else {
vErrors.push(err3);
}
errors++;
}
for(const key0 in data){
if(!((((key0 === "path") || (key0 === "bytes")) || (key0 === "sha256")) || (key0 === "claim"))){
const err4 = {instancePath,schemaPath:"#/additionalProperties",keyword:"additionalProperties",params:{additionalProperty: key0},message:"must NOT have additional properties"};
if(vErrors === null){
vErrors = [err4];
}
else {
vErrors.push(err4);
}
errors++;
}
}
if(data.path !== undefined){
let data0 = data.path;
if(typeof data0 === "string"){
if(func1(data0) < 1){
const err5 = {instancePath:instancePath+"/path",schemaPath:"#/$defs/relativePath/minLength",keyword:"minLength",params:{limit: 1},message:"must NOT have fewer than 1 characters"};
if(vErrors === null){
vErrors = [err5];
}
else {
vErrors.push(err5);
}
errors++;
}
if(!pattern5.test(data0)){
const err6 = {instancePath:instancePath+"/path",schemaPath:"#/$defs/relativePath/pattern",keyword:"pattern",params:{pattern: "^(?!/)(?![A-Za-z]:[\\\\/])(?![A-Za-z][A-Za-z0-9+.-]*:)(?!.*\\\\)(?!.*(?:^|/)\\.\\.(?:/|$))\\S(?:.*\\S)?$"},message:"must match pattern \""+"^(?!/)(?![A-Za-z]:[\\\\/])(?![A-Za-z][A-Za-z0-9+.-]*:)(?!.*\\\\)(?!.*(?:^|/)\\.\\.(?:/|$))\\S(?:.*\\S)?$"+"\""};
if(vErrors === null){
vErrors = [err6];
}
else {
vErrors.push(err6);
}
errors++;
}
}
else {
const err7 = {instancePath:instancePath+"/path",schemaPath:"#/$defs/relativePath/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err7];
}
else {
vErrors.push(err7);
}
errors++;
}
}
if(data.bytes !== undefined){
let data1 = data.bytes;
if(!((typeof data1 == "number") && (!(data1 % 1) && !isNaN(data1)))){
const err8 = {instancePath:instancePath+"/bytes",schemaPath:"#/$defs/bytes/type",keyword:"type",params:{type: "integer"},message:"must be integer"};
if(vErrors === null){
vErrors = [err8];
}
else {
vErrors.push(err8);
}
errors++;
}
if(typeof data1 == "number"){
if(data1 < 0 || isNaN(data1)){
const err9 = {instancePath:instancePath+"/bytes",schemaPath:"#/$defs/bytes/minimum",keyword:"minimum",params:{comparison: ">=", limit: 0},message:"must be >= 0"};
if(vErrors === null){
vErrors = [err9];
}
else {
vErrors.push(err9);
}
errors++;
}
}
}
if(data.sha256 !== undefined){
let data2 = data.sha256;
if(typeof data2 === "string"){
if(!pattern6.test(data2)){
const err10 = {instancePath:instancePath+"/sha256",schemaPath:"#/$defs/sha256/pattern",keyword:"pattern",params:{pattern: "^[a-f0-9]{64}$"},message:"must match pattern \""+"^[a-f0-9]{64}$"+"\""};
if(vErrors === null){
vErrors = [err10];
}
else {
vErrors.push(err10);
}
errors++;
}
}
else {
const err11 = {instancePath:instancePath+"/sha256",schemaPath:"#/$defs/sha256/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err11];
}
else {
vErrors.push(err11);
}
errors++;
}
}
if(data.claim !== undefined){
if("CALLER_SUPPLIED_SEMANTIC_KEEP_DRAFT" !== data.claim){
const err12 = {instancePath:instancePath+"/claim",schemaPath:"#/properties/claim/const",keyword:"const",params:{allowedValue: "CALLER_SUPPLIED_SEMANTIC_KEEP_DRAFT"},message:"must be equal to constant"};
if(vErrors === null){
vErrors = [err12];
}
else {
vErrors.push(err12);
}
errors++;
}
}
}
else {
const err13 = {instancePath,schemaPath:"#/type",keyword:"type",params:{type: "object"},message:"must be object"};
if(vErrors === null){
vErrors = [err13];
}
else {
vErrors.push(err13);
}
errors++;
}
validate56.errors = vErrors;
return errors === 0;
}
validate56.evaluated = {"props":true,"dynamicProps":false,"dynamicItems":false};

const schema86 = {"type":"object","additionalProperties":false,"required":["path","bytes","sha256","approval_ref","verification"],"properties":{"path":{"$ref":"#/$defs/relativePath"},"bytes":{"$ref":"#/$defs/bytes"},"sha256":{"$ref":"#/$defs/sha256"},"approval_ref":{"type":"string","pattern":"^checkpoint-1/[a-z0-9](?:[a-z0-9-]{0,62})/[0-9]{4}-[0-9]{2}-[0-9]{2}(?:-r[0-9]{1,3})?$"},"verification":{"const":"CALLER_ASSERTED_NOT_MACHINE_VERIFIED"}}};
const pattern11 = new RegExp("^checkpoint-1/[a-z0-9](?:[a-z0-9-]{0,62})/[0-9]{4}-[0-9]{2}-[0-9]{2}(?:-r[0-9]{1,3})?$", "u");

function validate58(data, {instancePath="", parentData, parentDataProperty, rootData=data, dynamicAnchors={}}={}){
let vErrors = null;
let errors = 0;
const evaluated0 = validate58.evaluated;
if(evaluated0.dynamicProps){
evaluated0.props = undefined;
}
if(evaluated0.dynamicItems){
evaluated0.items = undefined;
}
if(data && typeof data == "object" && !Array.isArray(data)){
if(data.path === undefined){
const err0 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "path"},message:"must have required property '"+"path"+"'"};
if(vErrors === null){
vErrors = [err0];
}
else {
vErrors.push(err0);
}
errors++;
}
if(data.bytes === undefined){
const err1 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "bytes"},message:"must have required property '"+"bytes"+"'"};
if(vErrors === null){
vErrors = [err1];
}
else {
vErrors.push(err1);
}
errors++;
}
if(data.sha256 === undefined){
const err2 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "sha256"},message:"must have required property '"+"sha256"+"'"};
if(vErrors === null){
vErrors = [err2];
}
else {
vErrors.push(err2);
}
errors++;
}
if(data.approval_ref === undefined){
const err3 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "approval_ref"},message:"must have required property '"+"approval_ref"+"'"};
if(vErrors === null){
vErrors = [err3];
}
else {
vErrors.push(err3);
}
errors++;
}
if(data.verification === undefined){
const err4 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "verification"},message:"must have required property '"+"verification"+"'"};
if(vErrors === null){
vErrors = [err4];
}
else {
vErrors.push(err4);
}
errors++;
}
for(const key0 in data){
if(!(((((key0 === "path") || (key0 === "bytes")) || (key0 === "sha256")) || (key0 === "approval_ref")) || (key0 === "verification"))){
const err5 = {instancePath,schemaPath:"#/additionalProperties",keyword:"additionalProperties",params:{additionalProperty: key0},message:"must NOT have additional properties"};
if(vErrors === null){
vErrors = [err5];
}
else {
vErrors.push(err5);
}
errors++;
}
}
if(data.path !== undefined){
let data0 = data.path;
if(typeof data0 === "string"){
if(func1(data0) < 1){
const err6 = {instancePath:instancePath+"/path",schemaPath:"#/$defs/relativePath/minLength",keyword:"minLength",params:{limit: 1},message:"must NOT have fewer than 1 characters"};
if(vErrors === null){
vErrors = [err6];
}
else {
vErrors.push(err6);
}
errors++;
}
if(!pattern5.test(data0)){
const err7 = {instancePath:instancePath+"/path",schemaPath:"#/$defs/relativePath/pattern",keyword:"pattern",params:{pattern: "^(?!/)(?![A-Za-z]:[\\\\/])(?![A-Za-z][A-Za-z0-9+.-]*:)(?!.*\\\\)(?!.*(?:^|/)\\.\\.(?:/|$))\\S(?:.*\\S)?$"},message:"must match pattern \""+"^(?!/)(?![A-Za-z]:[\\\\/])(?![A-Za-z][A-Za-z0-9+.-]*:)(?!.*\\\\)(?!.*(?:^|/)\\.\\.(?:/|$))\\S(?:.*\\S)?$"+"\""};
if(vErrors === null){
vErrors = [err7];
}
else {
vErrors.push(err7);
}
errors++;
}
}
else {
const err8 = {instancePath:instancePath+"/path",schemaPath:"#/$defs/relativePath/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err8];
}
else {
vErrors.push(err8);
}
errors++;
}
}
if(data.bytes !== undefined){
let data1 = data.bytes;
if(!((typeof data1 == "number") && (!(data1 % 1) && !isNaN(data1)))){
const err9 = {instancePath:instancePath+"/bytes",schemaPath:"#/$defs/bytes/type",keyword:"type",params:{type: "integer"},message:"must be integer"};
if(vErrors === null){
vErrors = [err9];
}
else {
vErrors.push(err9);
}
errors++;
}
if(typeof data1 == "number"){
if(data1 < 0 || isNaN(data1)){
const err10 = {instancePath:instancePath+"/bytes",schemaPath:"#/$defs/bytes/minimum",keyword:"minimum",params:{comparison: ">=", limit: 0},message:"must be >= 0"};
if(vErrors === null){
vErrors = [err10];
}
else {
vErrors.push(err10);
}
errors++;
}
}
}
if(data.sha256 !== undefined){
let data2 = data.sha256;
if(typeof data2 === "string"){
if(!pattern6.test(data2)){
const err11 = {instancePath:instancePath+"/sha256",schemaPath:"#/$defs/sha256/pattern",keyword:"pattern",params:{pattern: "^[a-f0-9]{64}$"},message:"must match pattern \""+"^[a-f0-9]{64}$"+"\""};
if(vErrors === null){
vErrors = [err11];
}
else {
vErrors.push(err11);
}
errors++;
}
}
else {
const err12 = {instancePath:instancePath+"/sha256",schemaPath:"#/$defs/sha256/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err12];
}
else {
vErrors.push(err12);
}
errors++;
}
}
if(data.approval_ref !== undefined){
let data3 = data.approval_ref;
if(typeof data3 === "string"){
if(!pattern11.test(data3)){
const err13 = {instancePath:instancePath+"/approval_ref",schemaPath:"#/properties/approval_ref/pattern",keyword:"pattern",params:{pattern: "^checkpoint-1/[a-z0-9](?:[a-z0-9-]{0,62})/[0-9]{4}-[0-9]{2}-[0-9]{2}(?:-r[0-9]{1,3})?$"},message:"must match pattern \""+"^checkpoint-1/[a-z0-9](?:[a-z0-9-]{0,62})/[0-9]{4}-[0-9]{2}-[0-9]{2}(?:-r[0-9]{1,3})?$"+"\""};
if(vErrors === null){
vErrors = [err13];
}
else {
vErrors.push(err13);
}
errors++;
}
}
else {
const err14 = {instancePath:instancePath+"/approval_ref",schemaPath:"#/properties/approval_ref/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err14];
}
else {
vErrors.push(err14);
}
errors++;
}
}
if(data.verification !== undefined){
if("CALLER_ASSERTED_NOT_MACHINE_VERIFIED" !== data.verification){
const err15 = {instancePath:instancePath+"/verification",schemaPath:"#/properties/verification/const",keyword:"const",params:{allowedValue: "CALLER_ASSERTED_NOT_MACHINE_VERIFIED"},message:"must be equal to constant"};
if(vErrors === null){
vErrors = [err15];
}
else {
vErrors.push(err15);
}
errors++;
}
}
}
else {
const err16 = {instancePath,schemaPath:"#/type",keyword:"type",params:{type: "object"},message:"must be object"};
if(vErrors === null){
vErrors = [err16];
}
else {
vErrors.push(err16);
}
errors++;
}
validate58.errors = vErrors;
return errors === 0;
}
validate58.evaluated = {"props":true,"dynamicProps":false,"dynamicItems":false};

const schema90 = {"type":"object","additionalProperties":false,"required":["id","path","bytes","sha256","source_order","probe","detector"],"properties":{"id":{"$ref":"#/$defs/src"},"path":{"$ref":"#/$defs/relativePath"},"bytes":{"$ref":"#/$defs/bytes"},"sha256":{"$ref":"#/$defs/sha256"},"source_order":{"type":"integer","minimum":0},"probe":{"$ref":"#/$defs/probe"},"detector":{"$ref":"#/$defs/detector"}}};
const schema91 = {"oneOf":[{"type":"null"},{"type":"string","minLength":1,"pattern":"\\S"}]};
const schema95 = {"type":"object","additionalProperties":false,"required":["format_names","format_duration_seconds","stream_count","audio_stream_count","streams","selected_audio_stream_index","selected_audio_codec_type","selected_audio_duration_seconds","audio_format_delta_seconds","normalized_sha256"],"properties":{"format_names":{"type":"array","minItems":1,"items":{"type":"string","minLength":1}},"format_duration_seconds":{"type":"number","exclusiveMinimum":0},"stream_count":{"type":"integer","minimum":1},"audio_stream_count":{"const":1},"streams":{"type":"array","minItems":1,"items":{"$ref":"#/$defs/probeStream"}},"selected_audio_stream_index":{"type":"integer","minimum":0},"selected_audio_codec_type":{"const":"audio"},"selected_audio_duration_seconds":{"oneOf":[{"type":"null"},{"type":"number","minimum":0}]},"audio_format_delta_seconds":{"oneOf":[{"type":"null"},{"type":"number","minimum":0}]},"normalized_sha256":{"$ref":"#/$defs/sha256"}}};
const schema96 = {"type":"object","additionalProperties":false,"required":["index","codec_type","duration_seconds"],"properties":{"index":{"type":"integer","minimum":0},"codec_type":{"type":"string","minLength":1},"duration_seconds":{"oneOf":[{"type":"null"},{"type":"number","minimum":0}]}}};

function validate61(data, {instancePath="", parentData, parentDataProperty, rootData=data, dynamicAnchors={}}={}){
let vErrors = null;
let errors = 0;
const evaluated0 = validate61.evaluated;
if(evaluated0.dynamicProps){
evaluated0.props = undefined;
}
if(evaluated0.dynamicItems){
evaluated0.items = undefined;
}
if(data && typeof data == "object" && !Array.isArray(data)){
if(data.format_names === undefined){
const err0 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "format_names"},message:"must have required property '"+"format_names"+"'"};
if(vErrors === null){
vErrors = [err0];
}
else {
vErrors.push(err0);
}
errors++;
}
if(data.format_duration_seconds === undefined){
const err1 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "format_duration_seconds"},message:"must have required property '"+"format_duration_seconds"+"'"};
if(vErrors === null){
vErrors = [err1];
}
else {
vErrors.push(err1);
}
errors++;
}
if(data.stream_count === undefined){
const err2 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "stream_count"},message:"must have required property '"+"stream_count"+"'"};
if(vErrors === null){
vErrors = [err2];
}
else {
vErrors.push(err2);
}
errors++;
}
if(data.audio_stream_count === undefined){
const err3 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "audio_stream_count"},message:"must have required property '"+"audio_stream_count"+"'"};
if(vErrors === null){
vErrors = [err3];
}
else {
vErrors.push(err3);
}
errors++;
}
if(data.streams === undefined){
const err4 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "streams"},message:"must have required property '"+"streams"+"'"};
if(vErrors === null){
vErrors = [err4];
}
else {
vErrors.push(err4);
}
errors++;
}
if(data.selected_audio_stream_index === undefined){
const err5 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "selected_audio_stream_index"},message:"must have required property '"+"selected_audio_stream_index"+"'"};
if(vErrors === null){
vErrors = [err5];
}
else {
vErrors.push(err5);
}
errors++;
}
if(data.selected_audio_codec_type === undefined){
const err6 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "selected_audio_codec_type"},message:"must have required property '"+"selected_audio_codec_type"+"'"};
if(vErrors === null){
vErrors = [err6];
}
else {
vErrors.push(err6);
}
errors++;
}
if(data.selected_audio_duration_seconds === undefined){
const err7 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "selected_audio_duration_seconds"},message:"must have required property '"+"selected_audio_duration_seconds"+"'"};
if(vErrors === null){
vErrors = [err7];
}
else {
vErrors.push(err7);
}
errors++;
}
if(data.audio_format_delta_seconds === undefined){
const err8 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "audio_format_delta_seconds"},message:"must have required property '"+"audio_format_delta_seconds"+"'"};
if(vErrors === null){
vErrors = [err8];
}
else {
vErrors.push(err8);
}
errors++;
}
if(data.normalized_sha256 === undefined){
const err9 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "normalized_sha256"},message:"must have required property '"+"normalized_sha256"+"'"};
if(vErrors === null){
vErrors = [err9];
}
else {
vErrors.push(err9);
}
errors++;
}
for(const key0 in data){
if(!(func20.call(schema95.properties, key0))){
const err10 = {instancePath,schemaPath:"#/additionalProperties",keyword:"additionalProperties",params:{additionalProperty: key0},message:"must NOT have additional properties"};
if(vErrors === null){
vErrors = [err10];
}
else {
vErrors.push(err10);
}
errors++;
}
}
if(data.format_names !== undefined){
let data0 = data.format_names;
if(Array.isArray(data0)){
if(data0.length < 1){
const err11 = {instancePath:instancePath+"/format_names",schemaPath:"#/properties/format_names/minItems",keyword:"minItems",params:{limit: 1},message:"must NOT have fewer than 1 items"};
if(vErrors === null){
vErrors = [err11];
}
else {
vErrors.push(err11);
}
errors++;
}
const len0 = data0.length;
for(let i0=0; i0<len0; i0++){
let data1 = data0[i0];
if(typeof data1 === "string"){
if(func1(data1) < 1){
const err12 = {instancePath:instancePath+"/format_names/" + i0,schemaPath:"#/properties/format_names/items/minLength",keyword:"minLength",params:{limit: 1},message:"must NOT have fewer than 1 characters"};
if(vErrors === null){
vErrors = [err12];
}
else {
vErrors.push(err12);
}
errors++;
}
}
else {
const err13 = {instancePath:instancePath+"/format_names/" + i0,schemaPath:"#/properties/format_names/items/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err13];
}
else {
vErrors.push(err13);
}
errors++;
}
}
}
else {
const err14 = {instancePath:instancePath+"/format_names",schemaPath:"#/properties/format_names/type",keyword:"type",params:{type: "array"},message:"must be array"};
if(vErrors === null){
vErrors = [err14];
}
else {
vErrors.push(err14);
}
errors++;
}
}
if(data.format_duration_seconds !== undefined){
let data2 = data.format_duration_seconds;
if(typeof data2 == "number"){
if(data2 <= 0 || isNaN(data2)){
const err15 = {instancePath:instancePath+"/format_duration_seconds",schemaPath:"#/properties/format_duration_seconds/exclusiveMinimum",keyword:"exclusiveMinimum",params:{comparison: ">", limit: 0},message:"must be > 0"};
if(vErrors === null){
vErrors = [err15];
}
else {
vErrors.push(err15);
}
errors++;
}
}
else {
const err16 = {instancePath:instancePath+"/format_duration_seconds",schemaPath:"#/properties/format_duration_seconds/type",keyword:"type",params:{type: "number"},message:"must be number"};
if(vErrors === null){
vErrors = [err16];
}
else {
vErrors.push(err16);
}
errors++;
}
}
if(data.stream_count !== undefined){
let data3 = data.stream_count;
if(!((typeof data3 == "number") && (!(data3 % 1) && !isNaN(data3)))){
const err17 = {instancePath:instancePath+"/stream_count",schemaPath:"#/properties/stream_count/type",keyword:"type",params:{type: "integer"},message:"must be integer"};
if(vErrors === null){
vErrors = [err17];
}
else {
vErrors.push(err17);
}
errors++;
}
if(typeof data3 == "number"){
if(data3 < 1 || isNaN(data3)){
const err18 = {instancePath:instancePath+"/stream_count",schemaPath:"#/properties/stream_count/minimum",keyword:"minimum",params:{comparison: ">=", limit: 1},message:"must be >= 1"};
if(vErrors === null){
vErrors = [err18];
}
else {
vErrors.push(err18);
}
errors++;
}
}
}
if(data.audio_stream_count !== undefined){
if(1 !== data.audio_stream_count){
const err19 = {instancePath:instancePath+"/audio_stream_count",schemaPath:"#/properties/audio_stream_count/const",keyword:"const",params:{allowedValue: 1},message:"must be equal to constant"};
if(vErrors === null){
vErrors = [err19];
}
else {
vErrors.push(err19);
}
errors++;
}
}
if(data.streams !== undefined){
let data5 = data.streams;
if(Array.isArray(data5)){
if(data5.length < 1){
const err20 = {instancePath:instancePath+"/streams",schemaPath:"#/properties/streams/minItems",keyword:"minItems",params:{limit: 1},message:"must NOT have fewer than 1 items"};
if(vErrors === null){
vErrors = [err20];
}
else {
vErrors.push(err20);
}
errors++;
}
const len1 = data5.length;
for(let i1=0; i1<len1; i1++){
let data6 = data5[i1];
if(data6 && typeof data6 == "object" && !Array.isArray(data6)){
if(data6.index === undefined){
const err21 = {instancePath:instancePath+"/streams/" + i1,schemaPath:"#/$defs/probeStream/required",keyword:"required",params:{missingProperty: "index"},message:"must have required property '"+"index"+"'"};
if(vErrors === null){
vErrors = [err21];
}
else {
vErrors.push(err21);
}
errors++;
}
if(data6.codec_type === undefined){
const err22 = {instancePath:instancePath+"/streams/" + i1,schemaPath:"#/$defs/probeStream/required",keyword:"required",params:{missingProperty: "codec_type"},message:"must have required property '"+"codec_type"+"'"};
if(vErrors === null){
vErrors = [err22];
}
else {
vErrors.push(err22);
}
errors++;
}
if(data6.duration_seconds === undefined){
const err23 = {instancePath:instancePath+"/streams/" + i1,schemaPath:"#/$defs/probeStream/required",keyword:"required",params:{missingProperty: "duration_seconds"},message:"must have required property '"+"duration_seconds"+"'"};
if(vErrors === null){
vErrors = [err23];
}
else {
vErrors.push(err23);
}
errors++;
}
for(const key1 in data6){
if(!(((key1 === "index") || (key1 === "codec_type")) || (key1 === "duration_seconds"))){
const err24 = {instancePath:instancePath+"/streams/" + i1,schemaPath:"#/$defs/probeStream/additionalProperties",keyword:"additionalProperties",params:{additionalProperty: key1},message:"must NOT have additional properties"};
if(vErrors === null){
vErrors = [err24];
}
else {
vErrors.push(err24);
}
errors++;
}
}
if(data6.index !== undefined){
let data7 = data6.index;
if(!((typeof data7 == "number") && (!(data7 % 1) && !isNaN(data7)))){
const err25 = {instancePath:instancePath+"/streams/" + i1+"/index",schemaPath:"#/$defs/probeStream/properties/index/type",keyword:"type",params:{type: "integer"},message:"must be integer"};
if(vErrors === null){
vErrors = [err25];
}
else {
vErrors.push(err25);
}
errors++;
}
if(typeof data7 == "number"){
if(data7 < 0 || isNaN(data7)){
const err26 = {instancePath:instancePath+"/streams/" + i1+"/index",schemaPath:"#/$defs/probeStream/properties/index/minimum",keyword:"minimum",params:{comparison: ">=", limit: 0},message:"must be >= 0"};
if(vErrors === null){
vErrors = [err26];
}
else {
vErrors.push(err26);
}
errors++;
}
}
}
if(data6.codec_type !== undefined){
let data8 = data6.codec_type;
if(typeof data8 === "string"){
if(func1(data8) < 1){
const err27 = {instancePath:instancePath+"/streams/" + i1+"/codec_type",schemaPath:"#/$defs/probeStream/properties/codec_type/minLength",keyword:"minLength",params:{limit: 1},message:"must NOT have fewer than 1 characters"};
if(vErrors === null){
vErrors = [err27];
}
else {
vErrors.push(err27);
}
errors++;
}
}
else {
const err28 = {instancePath:instancePath+"/streams/" + i1+"/codec_type",schemaPath:"#/$defs/probeStream/properties/codec_type/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err28];
}
else {
vErrors.push(err28);
}
errors++;
}
}
if(data6.duration_seconds !== undefined){
let data9 = data6.duration_seconds;
const _errs22 = errors;
let valid7 = false;
let passing0 = null;
const _errs23 = errors;
if(data9 !== null){
const err29 = {instancePath:instancePath+"/streams/" + i1+"/duration_seconds",schemaPath:"#/$defs/probeStream/properties/duration_seconds/oneOf/0/type",keyword:"type",params:{type: "null"},message:"must be null"};
if(vErrors === null){
vErrors = [err29];
}
else {
vErrors.push(err29);
}
errors++;
}
var _valid0 = _errs23 === errors;
if(_valid0){
valid7 = true;
passing0 = 0;
}
const _errs25 = errors;
if(typeof data9 == "number"){
if(data9 < 0 || isNaN(data9)){
const err30 = {instancePath:instancePath+"/streams/" + i1+"/duration_seconds",schemaPath:"#/$defs/probeStream/properties/duration_seconds/oneOf/1/minimum",keyword:"minimum",params:{comparison: ">=", limit: 0},message:"must be >= 0"};
if(vErrors === null){
vErrors = [err30];
}
else {
vErrors.push(err30);
}
errors++;
}
}
else {
const err31 = {instancePath:instancePath+"/streams/" + i1+"/duration_seconds",schemaPath:"#/$defs/probeStream/properties/duration_seconds/oneOf/1/type",keyword:"type",params:{type: "number"},message:"must be number"};
if(vErrors === null){
vErrors = [err31];
}
else {
vErrors.push(err31);
}
errors++;
}
var _valid0 = _errs25 === errors;
if(_valid0 && valid7){
valid7 = false;
passing0 = [passing0, 1];
}
else {
if(_valid0){
valid7 = true;
passing0 = 1;
}
}
if(!valid7){
const err32 = {instancePath:instancePath+"/streams/" + i1+"/duration_seconds",schemaPath:"#/$defs/probeStream/properties/duration_seconds/oneOf",keyword:"oneOf",params:{passingSchemas: passing0},message:"must match exactly one schema in oneOf"};
if(vErrors === null){
vErrors = [err32];
}
else {
vErrors.push(err32);
}
errors++;
}
else {
errors = _errs22;
if(vErrors !== null){
if(_errs22){
vErrors.length = _errs22;
}
else {
vErrors = null;
}
}
}
}
}
else {
const err33 = {instancePath:instancePath+"/streams/" + i1,schemaPath:"#/$defs/probeStream/type",keyword:"type",params:{type: "object"},message:"must be object"};
if(vErrors === null){
vErrors = [err33];
}
else {
vErrors.push(err33);
}
errors++;
}
}
}
else {
const err34 = {instancePath:instancePath+"/streams",schemaPath:"#/properties/streams/type",keyword:"type",params:{type: "array"},message:"must be array"};
if(vErrors === null){
vErrors = [err34];
}
else {
vErrors.push(err34);
}
errors++;
}
}
if(data.selected_audio_stream_index !== undefined){
let data10 = data.selected_audio_stream_index;
if(!((typeof data10 == "number") && (!(data10 % 1) && !isNaN(data10)))){
const err35 = {instancePath:instancePath+"/selected_audio_stream_index",schemaPath:"#/properties/selected_audio_stream_index/type",keyword:"type",params:{type: "integer"},message:"must be integer"};
if(vErrors === null){
vErrors = [err35];
}
else {
vErrors.push(err35);
}
errors++;
}
if(typeof data10 == "number"){
if(data10 < 0 || isNaN(data10)){
const err36 = {instancePath:instancePath+"/selected_audio_stream_index",schemaPath:"#/properties/selected_audio_stream_index/minimum",keyword:"minimum",params:{comparison: ">=", limit: 0},message:"must be >= 0"};
if(vErrors === null){
vErrors = [err36];
}
else {
vErrors.push(err36);
}
errors++;
}
}
}
if(data.selected_audio_codec_type !== undefined){
if("audio" !== data.selected_audio_codec_type){
const err37 = {instancePath:instancePath+"/selected_audio_codec_type",schemaPath:"#/properties/selected_audio_codec_type/const",keyword:"const",params:{allowedValue: "audio"},message:"must be equal to constant"};
if(vErrors === null){
vErrors = [err37];
}
else {
vErrors.push(err37);
}
errors++;
}
}
if(data.selected_audio_duration_seconds !== undefined){
let data12 = data.selected_audio_duration_seconds;
const _errs31 = errors;
let valid8 = false;
let passing1 = null;
const _errs32 = errors;
if(data12 !== null){
const err38 = {instancePath:instancePath+"/selected_audio_duration_seconds",schemaPath:"#/properties/selected_audio_duration_seconds/oneOf/0/type",keyword:"type",params:{type: "null"},message:"must be null"};
if(vErrors === null){
vErrors = [err38];
}
else {
vErrors.push(err38);
}
errors++;
}
var _valid1 = _errs32 === errors;
if(_valid1){
valid8 = true;
passing1 = 0;
}
const _errs34 = errors;
if(typeof data12 == "number"){
if(data12 < 0 || isNaN(data12)){
const err39 = {instancePath:instancePath+"/selected_audio_duration_seconds",schemaPath:"#/properties/selected_audio_duration_seconds/oneOf/1/minimum",keyword:"minimum",params:{comparison: ">=", limit: 0},message:"must be >= 0"};
if(vErrors === null){
vErrors = [err39];
}
else {
vErrors.push(err39);
}
errors++;
}
}
else {
const err40 = {instancePath:instancePath+"/selected_audio_duration_seconds",schemaPath:"#/properties/selected_audio_duration_seconds/oneOf/1/type",keyword:"type",params:{type: "number"},message:"must be number"};
if(vErrors === null){
vErrors = [err40];
}
else {
vErrors.push(err40);
}
errors++;
}
var _valid1 = _errs34 === errors;
if(_valid1 && valid8){
valid8 = false;
passing1 = [passing1, 1];
}
else {
if(_valid1){
valid8 = true;
passing1 = 1;
}
}
if(!valid8){
const err41 = {instancePath:instancePath+"/selected_audio_duration_seconds",schemaPath:"#/properties/selected_audio_duration_seconds/oneOf",keyword:"oneOf",params:{passingSchemas: passing1},message:"must match exactly one schema in oneOf"};
if(vErrors === null){
vErrors = [err41];
}
else {
vErrors.push(err41);
}
errors++;
}
else {
errors = _errs31;
if(vErrors !== null){
if(_errs31){
vErrors.length = _errs31;
}
else {
vErrors = null;
}
}
}
}
if(data.audio_format_delta_seconds !== undefined){
let data13 = data.audio_format_delta_seconds;
const _errs37 = errors;
let valid9 = false;
let passing2 = null;
const _errs38 = errors;
if(data13 !== null){
const err42 = {instancePath:instancePath+"/audio_format_delta_seconds",schemaPath:"#/properties/audio_format_delta_seconds/oneOf/0/type",keyword:"type",params:{type: "null"},message:"must be null"};
if(vErrors === null){
vErrors = [err42];
}
else {
vErrors.push(err42);
}
errors++;
}
var _valid2 = _errs38 === errors;
if(_valid2){
valid9 = true;
passing2 = 0;
}
const _errs40 = errors;
if(typeof data13 == "number"){
if(data13 < 0 || isNaN(data13)){
const err43 = {instancePath:instancePath+"/audio_format_delta_seconds",schemaPath:"#/properties/audio_format_delta_seconds/oneOf/1/minimum",keyword:"minimum",params:{comparison: ">=", limit: 0},message:"must be >= 0"};
if(vErrors === null){
vErrors = [err43];
}
else {
vErrors.push(err43);
}
errors++;
}
}
else {
const err44 = {instancePath:instancePath+"/audio_format_delta_seconds",schemaPath:"#/properties/audio_format_delta_seconds/oneOf/1/type",keyword:"type",params:{type: "number"},message:"must be number"};
if(vErrors === null){
vErrors = [err44];
}
else {
vErrors.push(err44);
}
errors++;
}
var _valid2 = _errs40 === errors;
if(_valid2 && valid9){
valid9 = false;
passing2 = [passing2, 1];
}
else {
if(_valid2){
valid9 = true;
passing2 = 1;
}
}
if(!valid9){
const err45 = {instancePath:instancePath+"/audio_format_delta_seconds",schemaPath:"#/properties/audio_format_delta_seconds/oneOf",keyword:"oneOf",params:{passingSchemas: passing2},message:"must match exactly one schema in oneOf"};
if(vErrors === null){
vErrors = [err45];
}
else {
vErrors.push(err45);
}
errors++;
}
else {
errors = _errs37;
if(vErrors !== null){
if(_errs37){
vErrors.length = _errs37;
}
else {
vErrors = null;
}
}
}
}
if(data.normalized_sha256 !== undefined){
let data14 = data.normalized_sha256;
if(typeof data14 === "string"){
if(!pattern6.test(data14)){
const err46 = {instancePath:instancePath+"/normalized_sha256",schemaPath:"#/$defs/sha256/pattern",keyword:"pattern",params:{pattern: "^[a-f0-9]{64}$"},message:"must match pattern \""+"^[a-f0-9]{64}$"+"\""};
if(vErrors === null){
vErrors = [err46];
}
else {
vErrors.push(err46);
}
errors++;
}
}
else {
const err47 = {instancePath:instancePath+"/normalized_sha256",schemaPath:"#/$defs/sha256/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err47];
}
else {
vErrors.push(err47);
}
errors++;
}
}
}
else {
const err48 = {instancePath,schemaPath:"#/type",keyword:"type",params:{type: "object"},message:"must be object"};
if(vErrors === null){
vErrors = [err48];
}
else {
vErrors.push(err48);
}
errors++;
}
validate61.errors = vErrors;
return errors === 0;
}
validate61.evaluated = {"props":true,"dynamicProps":false,"dynamicItems":false};

const schema98 = {"type":"object","additionalProperties":false,"required":["status","silence_pair_count","stderr_bytes","argv_template_sha256"],"properties":{"status":{"enum":["COMPLETED","NOT_RUN_WORD_TIMING_UNAVAILABLE"]},"silence_pair_count":{"type":"integer","minimum":0},"stderr_bytes":{"$ref":"#/$defs/bytes"},"argv_template_sha256":{"$ref":"#/$defs/sha256"}}};

function validate63(data, {instancePath="", parentData, parentDataProperty, rootData=data, dynamicAnchors={}}={}){
let vErrors = null;
let errors = 0;
const evaluated0 = validate63.evaluated;
if(evaluated0.dynamicProps){
evaluated0.props = undefined;
}
if(evaluated0.dynamicItems){
evaluated0.items = undefined;
}
if(data && typeof data == "object" && !Array.isArray(data)){
if(data.status === undefined){
const err0 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "status"},message:"must have required property '"+"status"+"'"};
if(vErrors === null){
vErrors = [err0];
}
else {
vErrors.push(err0);
}
errors++;
}
if(data.silence_pair_count === undefined){
const err1 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "silence_pair_count"},message:"must have required property '"+"silence_pair_count"+"'"};
if(vErrors === null){
vErrors = [err1];
}
else {
vErrors.push(err1);
}
errors++;
}
if(data.stderr_bytes === undefined){
const err2 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "stderr_bytes"},message:"must have required property '"+"stderr_bytes"+"'"};
if(vErrors === null){
vErrors = [err2];
}
else {
vErrors.push(err2);
}
errors++;
}
if(data.argv_template_sha256 === undefined){
const err3 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "argv_template_sha256"},message:"must have required property '"+"argv_template_sha256"+"'"};
if(vErrors === null){
vErrors = [err3];
}
else {
vErrors.push(err3);
}
errors++;
}
for(const key0 in data){
if(!((((key0 === "status") || (key0 === "silence_pair_count")) || (key0 === "stderr_bytes")) || (key0 === "argv_template_sha256"))){
const err4 = {instancePath,schemaPath:"#/additionalProperties",keyword:"additionalProperties",params:{additionalProperty: key0},message:"must NOT have additional properties"};
if(vErrors === null){
vErrors = [err4];
}
else {
vErrors.push(err4);
}
errors++;
}
}
if(data.status !== undefined){
let data0 = data.status;
if(!((data0 === "COMPLETED") || (data0 === "NOT_RUN_WORD_TIMING_UNAVAILABLE"))){
const err5 = {instancePath:instancePath+"/status",schemaPath:"#/properties/status/enum",keyword:"enum",params:{allowedValues: schema98.properties.status.enum},message:"must be equal to one of the allowed values"};
if(vErrors === null){
vErrors = [err5];
}
else {
vErrors.push(err5);
}
errors++;
}
}
if(data.silence_pair_count !== undefined){
let data1 = data.silence_pair_count;
if(!((typeof data1 == "number") && (!(data1 % 1) && !isNaN(data1)))){
const err6 = {instancePath:instancePath+"/silence_pair_count",schemaPath:"#/properties/silence_pair_count/type",keyword:"type",params:{type: "integer"},message:"must be integer"};
if(vErrors === null){
vErrors = [err6];
}
else {
vErrors.push(err6);
}
errors++;
}
if(typeof data1 == "number"){
if(data1 < 0 || isNaN(data1)){
const err7 = {instancePath:instancePath+"/silence_pair_count",schemaPath:"#/properties/silence_pair_count/minimum",keyword:"minimum",params:{comparison: ">=", limit: 0},message:"must be >= 0"};
if(vErrors === null){
vErrors = [err7];
}
else {
vErrors.push(err7);
}
errors++;
}
}
}
if(data.stderr_bytes !== undefined){
let data2 = data.stderr_bytes;
if(!((typeof data2 == "number") && (!(data2 % 1) && !isNaN(data2)))){
const err8 = {instancePath:instancePath+"/stderr_bytes",schemaPath:"#/$defs/bytes/type",keyword:"type",params:{type: "integer"},message:"must be integer"};
if(vErrors === null){
vErrors = [err8];
}
else {
vErrors.push(err8);
}
errors++;
}
if(typeof data2 == "number"){
if(data2 < 0 || isNaN(data2)){
const err9 = {instancePath:instancePath+"/stderr_bytes",schemaPath:"#/$defs/bytes/minimum",keyword:"minimum",params:{comparison: ">=", limit: 0},message:"must be >= 0"};
if(vErrors === null){
vErrors = [err9];
}
else {
vErrors.push(err9);
}
errors++;
}
}
}
if(data.argv_template_sha256 !== undefined){
let data3 = data.argv_template_sha256;
if(typeof data3 === "string"){
if(!pattern6.test(data3)){
const err10 = {instancePath:instancePath+"/argv_template_sha256",schemaPath:"#/$defs/sha256/pattern",keyword:"pattern",params:{pattern: "^[a-f0-9]{64}$"},message:"must match pattern \""+"^[a-f0-9]{64}$"+"\""};
if(vErrors === null){
vErrors = [err10];
}
else {
vErrors.push(err10);
}
errors++;
}
}
else {
const err11 = {instancePath:instancePath+"/argv_template_sha256",schemaPath:"#/$defs/sha256/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err11];
}
else {
vErrors.push(err11);
}
errors++;
}
}
}
else {
const err12 = {instancePath,schemaPath:"#/type",keyword:"type",params:{type: "object"},message:"must be object"};
if(vErrors === null){
vErrors = [err12];
}
else {
vErrors.push(err12);
}
errors++;
}
validate63.errors = vErrors;
return errors === 0;
}
validate63.evaluated = {"props":true,"dynamicProps":false,"dynamicItems":false};


function validate60(data, {instancePath="", parentData, parentDataProperty, rootData=data, dynamicAnchors={}}={}){
let vErrors = null;
let errors = 0;
const evaluated0 = validate60.evaluated;
if(evaluated0.dynamicProps){
evaluated0.props = undefined;
}
if(evaluated0.dynamicItems){
evaluated0.items = undefined;
}
if(data && typeof data == "object" && !Array.isArray(data)){
if(data.id === undefined){
const err0 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "id"},message:"must have required property '"+"id"+"'"};
if(vErrors === null){
vErrors = [err0];
}
else {
vErrors.push(err0);
}
errors++;
}
if(data.path === undefined){
const err1 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "path"},message:"must have required property '"+"path"+"'"};
if(vErrors === null){
vErrors = [err1];
}
else {
vErrors.push(err1);
}
errors++;
}
if(data.bytes === undefined){
const err2 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "bytes"},message:"must have required property '"+"bytes"+"'"};
if(vErrors === null){
vErrors = [err2];
}
else {
vErrors.push(err2);
}
errors++;
}
if(data.sha256 === undefined){
const err3 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "sha256"},message:"must have required property '"+"sha256"+"'"};
if(vErrors === null){
vErrors = [err3];
}
else {
vErrors.push(err3);
}
errors++;
}
if(data.source_order === undefined){
const err4 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "source_order"},message:"must have required property '"+"source_order"+"'"};
if(vErrors === null){
vErrors = [err4];
}
else {
vErrors.push(err4);
}
errors++;
}
if(data.probe === undefined){
const err5 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "probe"},message:"must have required property '"+"probe"+"'"};
if(vErrors === null){
vErrors = [err5];
}
else {
vErrors.push(err5);
}
errors++;
}
if(data.detector === undefined){
const err6 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "detector"},message:"must have required property '"+"detector"+"'"};
if(vErrors === null){
vErrors = [err6];
}
else {
vErrors.push(err6);
}
errors++;
}
for(const key0 in data){
if(!(((((((key0 === "id") || (key0 === "path")) || (key0 === "bytes")) || (key0 === "sha256")) || (key0 === "source_order")) || (key0 === "probe")) || (key0 === "detector"))){
const err7 = {instancePath,schemaPath:"#/additionalProperties",keyword:"additionalProperties",params:{additionalProperty: key0},message:"must NOT have additional properties"};
if(vErrors === null){
vErrors = [err7];
}
else {
vErrors.push(err7);
}
errors++;
}
}
if(data.id !== undefined){
let data0 = data.id;
const _errs4 = errors;
let valid2 = false;
let passing0 = null;
const _errs5 = errors;
if(data0 !== null){
const err8 = {instancePath:instancePath+"/id",schemaPath:"#/$defs/src/oneOf/0/type",keyword:"type",params:{type: "null"},message:"must be null"};
if(vErrors === null){
vErrors = [err8];
}
else {
vErrors.push(err8);
}
errors++;
}
var _valid0 = _errs5 === errors;
if(_valid0){
valid2 = true;
passing0 = 0;
}
const _errs7 = errors;
if(typeof data0 === "string"){
if(func1(data0) < 1){
const err9 = {instancePath:instancePath+"/id",schemaPath:"#/$defs/src/oneOf/1/minLength",keyword:"minLength",params:{limit: 1},message:"must NOT have fewer than 1 characters"};
if(vErrors === null){
vErrors = [err9];
}
else {
vErrors.push(err9);
}
errors++;
}
if(!pattern4.test(data0)){
const err10 = {instancePath:instancePath+"/id",schemaPath:"#/$defs/src/oneOf/1/pattern",keyword:"pattern",params:{pattern: "\\S"},message:"must match pattern \""+"\\S"+"\""};
if(vErrors === null){
vErrors = [err10];
}
else {
vErrors.push(err10);
}
errors++;
}
}
else {
const err11 = {instancePath:instancePath+"/id",schemaPath:"#/$defs/src/oneOf/1/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err11];
}
else {
vErrors.push(err11);
}
errors++;
}
var _valid0 = _errs7 === errors;
if(_valid0 && valid2){
valid2 = false;
passing0 = [passing0, 1];
}
else {
if(_valid0){
valid2 = true;
passing0 = 1;
}
}
if(!valid2){
const err12 = {instancePath:instancePath+"/id",schemaPath:"#/$defs/src/oneOf",keyword:"oneOf",params:{passingSchemas: passing0},message:"must match exactly one schema in oneOf"};
if(vErrors === null){
vErrors = [err12];
}
else {
vErrors.push(err12);
}
errors++;
}
else {
errors = _errs4;
if(vErrors !== null){
if(_errs4){
vErrors.length = _errs4;
}
else {
vErrors = null;
}
}
}
}
if(data.path !== undefined){
let data1 = data.path;
if(typeof data1 === "string"){
if(func1(data1) < 1){
const err13 = {instancePath:instancePath+"/path",schemaPath:"#/$defs/relativePath/minLength",keyword:"minLength",params:{limit: 1},message:"must NOT have fewer than 1 characters"};
if(vErrors === null){
vErrors = [err13];
}
else {
vErrors.push(err13);
}
errors++;
}
if(!pattern5.test(data1)){
const err14 = {instancePath:instancePath+"/path",schemaPath:"#/$defs/relativePath/pattern",keyword:"pattern",params:{pattern: "^(?!/)(?![A-Za-z]:[\\\\/])(?![A-Za-z][A-Za-z0-9+.-]*:)(?!.*\\\\)(?!.*(?:^|/)\\.\\.(?:/|$))\\S(?:.*\\S)?$"},message:"must match pattern \""+"^(?!/)(?![A-Za-z]:[\\\\/])(?![A-Za-z][A-Za-z0-9+.-]*:)(?!.*\\\\)(?!.*(?:^|/)\\.\\.(?:/|$))\\S(?:.*\\S)?$"+"\""};
if(vErrors === null){
vErrors = [err14];
}
else {
vErrors.push(err14);
}
errors++;
}
}
else {
const err15 = {instancePath:instancePath+"/path",schemaPath:"#/$defs/relativePath/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err15];
}
else {
vErrors.push(err15);
}
errors++;
}
}
if(data.bytes !== undefined){
let data2 = data.bytes;
if(!((typeof data2 == "number") && (!(data2 % 1) && !isNaN(data2)))){
const err16 = {instancePath:instancePath+"/bytes",schemaPath:"#/$defs/bytes/type",keyword:"type",params:{type: "integer"},message:"must be integer"};
if(vErrors === null){
vErrors = [err16];
}
else {
vErrors.push(err16);
}
errors++;
}
if(typeof data2 == "number"){
if(data2 < 0 || isNaN(data2)){
const err17 = {instancePath:instancePath+"/bytes",schemaPath:"#/$defs/bytes/minimum",keyword:"minimum",params:{comparison: ">=", limit: 0},message:"must be >= 0"};
if(vErrors === null){
vErrors = [err17];
}
else {
vErrors.push(err17);
}
errors++;
}
}
}
if(data.sha256 !== undefined){
let data3 = data.sha256;
if(typeof data3 === "string"){
if(!pattern6.test(data3)){
const err18 = {instancePath:instancePath+"/sha256",schemaPath:"#/$defs/sha256/pattern",keyword:"pattern",params:{pattern: "^[a-f0-9]{64}$"},message:"must match pattern \""+"^[a-f0-9]{64}$"+"\""};
if(vErrors === null){
vErrors = [err18];
}
else {
vErrors.push(err18);
}
errors++;
}
}
else {
const err19 = {instancePath:instancePath+"/sha256",schemaPath:"#/$defs/sha256/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err19];
}
else {
vErrors.push(err19);
}
errors++;
}
}
if(data.source_order !== undefined){
let data4 = data.source_order;
if(!((typeof data4 == "number") && (!(data4 % 1) && !isNaN(data4)))){
const err20 = {instancePath:instancePath+"/source_order",schemaPath:"#/properties/source_order/type",keyword:"type",params:{type: "integer"},message:"must be integer"};
if(vErrors === null){
vErrors = [err20];
}
else {
vErrors.push(err20);
}
errors++;
}
if(typeof data4 == "number"){
if(data4 < 0 || isNaN(data4)){
const err21 = {instancePath:instancePath+"/source_order",schemaPath:"#/properties/source_order/minimum",keyword:"minimum",params:{comparison: ">=", limit: 0},message:"must be >= 0"};
if(vErrors === null){
vErrors = [err21];
}
else {
vErrors.push(err21);
}
errors++;
}
}
}
if(data.probe !== undefined){
if(!(validate61(data.probe, {instancePath:instancePath+"/probe",parentData:data,parentDataProperty:"probe",rootData,dynamicAnchors}))){
vErrors = vErrors === null ? validate61.errors : vErrors.concat(validate61.errors);
errors = vErrors.length;
}
}
if(data.detector !== undefined){
if(!(validate63(data.detector, {instancePath:instancePath+"/detector",parentData:data,parentDataProperty:"detector",rootData,dynamicAnchors}))){
vErrors = vErrors === null ? validate63.errors : vErrors.concat(validate63.errors);
errors = vErrors.length;
}
}
}
else {
const err22 = {instancePath,schemaPath:"#/type",keyword:"type",params:{type: "object"},message:"must be object"};
if(vErrors === null){
vErrors = [err22];
}
else {
vErrors.push(err22);
}
errors++;
}
validate60.errors = vErrors;
return errors === 0;
}
validate60.evaluated = {"props":true,"dynamicProps":false,"dynamicItems":false};

const schema101 = {"type":"object","additionalProperties":false,"required":["src","path","bytes","sha256","analysis_freshness"],"properties":{"src":{"$ref":"#/$defs/src"},"path":{"$ref":"#/$defs/relativePath"},"bytes":{"$ref":"#/$defs/bytes"},"sha256":{"$ref":"#/$defs/sha256"},"analysis_freshness":{"const":"UNVERIFIED_CONTRACT_LIMIT"}}};

function validate66(data, {instancePath="", parentData, parentDataProperty, rootData=data, dynamicAnchors={}}={}){
let vErrors = null;
let errors = 0;
const evaluated0 = validate66.evaluated;
if(evaluated0.dynamicProps){
evaluated0.props = undefined;
}
if(evaluated0.dynamicItems){
evaluated0.items = undefined;
}
if(data && typeof data == "object" && !Array.isArray(data)){
if(data.src === undefined){
const err0 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "src"},message:"must have required property '"+"src"+"'"};
if(vErrors === null){
vErrors = [err0];
}
else {
vErrors.push(err0);
}
errors++;
}
if(data.path === undefined){
const err1 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "path"},message:"must have required property '"+"path"+"'"};
if(vErrors === null){
vErrors = [err1];
}
else {
vErrors.push(err1);
}
errors++;
}
if(data.bytes === undefined){
const err2 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "bytes"},message:"must have required property '"+"bytes"+"'"};
if(vErrors === null){
vErrors = [err2];
}
else {
vErrors.push(err2);
}
errors++;
}
if(data.sha256 === undefined){
const err3 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "sha256"},message:"must have required property '"+"sha256"+"'"};
if(vErrors === null){
vErrors = [err3];
}
else {
vErrors.push(err3);
}
errors++;
}
if(data.analysis_freshness === undefined){
const err4 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "analysis_freshness"},message:"must have required property '"+"analysis_freshness"+"'"};
if(vErrors === null){
vErrors = [err4];
}
else {
vErrors.push(err4);
}
errors++;
}
for(const key0 in data){
if(!(((((key0 === "src") || (key0 === "path")) || (key0 === "bytes")) || (key0 === "sha256")) || (key0 === "analysis_freshness"))){
const err5 = {instancePath,schemaPath:"#/additionalProperties",keyword:"additionalProperties",params:{additionalProperty: key0},message:"must NOT have additional properties"};
if(vErrors === null){
vErrors = [err5];
}
else {
vErrors.push(err5);
}
errors++;
}
}
if(data.src !== undefined){
let data0 = data.src;
const _errs4 = errors;
let valid2 = false;
let passing0 = null;
const _errs5 = errors;
if(data0 !== null){
const err6 = {instancePath:instancePath+"/src",schemaPath:"#/$defs/src/oneOf/0/type",keyword:"type",params:{type: "null"},message:"must be null"};
if(vErrors === null){
vErrors = [err6];
}
else {
vErrors.push(err6);
}
errors++;
}
var _valid0 = _errs5 === errors;
if(_valid0){
valid2 = true;
passing0 = 0;
}
const _errs7 = errors;
if(typeof data0 === "string"){
if(func1(data0) < 1){
const err7 = {instancePath:instancePath+"/src",schemaPath:"#/$defs/src/oneOf/1/minLength",keyword:"minLength",params:{limit: 1},message:"must NOT have fewer than 1 characters"};
if(vErrors === null){
vErrors = [err7];
}
else {
vErrors.push(err7);
}
errors++;
}
if(!pattern4.test(data0)){
const err8 = {instancePath:instancePath+"/src",schemaPath:"#/$defs/src/oneOf/1/pattern",keyword:"pattern",params:{pattern: "\\S"},message:"must match pattern \""+"\\S"+"\""};
if(vErrors === null){
vErrors = [err8];
}
else {
vErrors.push(err8);
}
errors++;
}
}
else {
const err9 = {instancePath:instancePath+"/src",schemaPath:"#/$defs/src/oneOf/1/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err9];
}
else {
vErrors.push(err9);
}
errors++;
}
var _valid0 = _errs7 === errors;
if(_valid0 && valid2){
valid2 = false;
passing0 = [passing0, 1];
}
else {
if(_valid0){
valid2 = true;
passing0 = 1;
}
}
if(!valid2){
const err10 = {instancePath:instancePath+"/src",schemaPath:"#/$defs/src/oneOf",keyword:"oneOf",params:{passingSchemas: passing0},message:"must match exactly one schema in oneOf"};
if(vErrors === null){
vErrors = [err10];
}
else {
vErrors.push(err10);
}
errors++;
}
else {
errors = _errs4;
if(vErrors !== null){
if(_errs4){
vErrors.length = _errs4;
}
else {
vErrors = null;
}
}
}
}
if(data.path !== undefined){
let data1 = data.path;
if(typeof data1 === "string"){
if(func1(data1) < 1){
const err11 = {instancePath:instancePath+"/path",schemaPath:"#/$defs/relativePath/minLength",keyword:"minLength",params:{limit: 1},message:"must NOT have fewer than 1 characters"};
if(vErrors === null){
vErrors = [err11];
}
else {
vErrors.push(err11);
}
errors++;
}
if(!pattern5.test(data1)){
const err12 = {instancePath:instancePath+"/path",schemaPath:"#/$defs/relativePath/pattern",keyword:"pattern",params:{pattern: "^(?!/)(?![A-Za-z]:[\\\\/])(?![A-Za-z][A-Za-z0-9+.-]*:)(?!.*\\\\)(?!.*(?:^|/)\\.\\.(?:/|$))\\S(?:.*\\S)?$"},message:"must match pattern \""+"^(?!/)(?![A-Za-z]:[\\\\/])(?![A-Za-z][A-Za-z0-9+.-]*:)(?!.*\\\\)(?!.*(?:^|/)\\.\\.(?:/|$))\\S(?:.*\\S)?$"+"\""};
if(vErrors === null){
vErrors = [err12];
}
else {
vErrors.push(err12);
}
errors++;
}
}
else {
const err13 = {instancePath:instancePath+"/path",schemaPath:"#/$defs/relativePath/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err13];
}
else {
vErrors.push(err13);
}
errors++;
}
}
if(data.bytes !== undefined){
let data2 = data.bytes;
if(!((typeof data2 == "number") && (!(data2 % 1) && !isNaN(data2)))){
const err14 = {instancePath:instancePath+"/bytes",schemaPath:"#/$defs/bytes/type",keyword:"type",params:{type: "integer"},message:"must be integer"};
if(vErrors === null){
vErrors = [err14];
}
else {
vErrors.push(err14);
}
errors++;
}
if(typeof data2 == "number"){
if(data2 < 0 || isNaN(data2)){
const err15 = {instancePath:instancePath+"/bytes",schemaPath:"#/$defs/bytes/minimum",keyword:"minimum",params:{comparison: ">=", limit: 0},message:"must be >= 0"};
if(vErrors === null){
vErrors = [err15];
}
else {
vErrors.push(err15);
}
errors++;
}
}
}
if(data.sha256 !== undefined){
let data3 = data.sha256;
if(typeof data3 === "string"){
if(!pattern6.test(data3)){
const err16 = {instancePath:instancePath+"/sha256",schemaPath:"#/$defs/sha256/pattern",keyword:"pattern",params:{pattern: "^[a-f0-9]{64}$"},message:"must match pattern \""+"^[a-f0-9]{64}$"+"\""};
if(vErrors === null){
vErrors = [err16];
}
else {
vErrors.push(err16);
}
errors++;
}
}
else {
const err17 = {instancePath:instancePath+"/sha256",schemaPath:"#/$defs/sha256/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err17];
}
else {
vErrors.push(err17);
}
errors++;
}
}
if(data.analysis_freshness !== undefined){
if("UNVERIFIED_CONTRACT_LIMIT" !== data.analysis_freshness){
const err18 = {instancePath:instancePath+"/analysis_freshness",schemaPath:"#/properties/analysis_freshness/const",keyword:"const",params:{allowedValue: "UNVERIFIED_CONTRACT_LIMIT"},message:"must be equal to constant"};
if(vErrors === null){
vErrors = [err18];
}
else {
vErrors.push(err18);
}
errors++;
}
}
}
else {
const err19 = {instancePath,schemaPath:"#/type",keyword:"type",params:{type: "object"},message:"must be object"};
if(vErrors === null){
vErrors = [err19];
}
else {
vErrors.push(err19);
}
errors++;
}
validate66.errors = vErrors;
return errors === 0;
}
validate66.evaluated = {"props":true,"dynamicProps":false,"dynamicItems":false};

const schema106 = {"type":"object","additionalProperties":false,"required":["input_index","src","t","path","bytes","sha256","note"],"properties":{"input_index":{"type":"integer","minimum":0},"src":{"$ref":"#/$defs/src"},"t":{"$ref":"#/$defs/seconds"},"path":{"$ref":"#/$defs/relativePath"},"bytes":{"$ref":"#/$defs/bytes"},"sha256":{"$ref":"#/$defs/sha256"},"note":{"type":"string","minLength":1},"origin":{"enum":["scene","interval","transcript"]}}};
const schema108 = {"type":"number","minimum":0};

function validate68(data, {instancePath="", parentData, parentDataProperty, rootData=data, dynamicAnchors={}}={}){
let vErrors = null;
let errors = 0;
const evaluated0 = validate68.evaluated;
if(evaluated0.dynamicProps){
evaluated0.props = undefined;
}
if(evaluated0.dynamicItems){
evaluated0.items = undefined;
}
if(data && typeof data == "object" && !Array.isArray(data)){
if(data.input_index === undefined){
const err0 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "input_index"},message:"must have required property '"+"input_index"+"'"};
if(vErrors === null){
vErrors = [err0];
}
else {
vErrors.push(err0);
}
errors++;
}
if(data.src === undefined){
const err1 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "src"},message:"must have required property '"+"src"+"'"};
if(vErrors === null){
vErrors = [err1];
}
else {
vErrors.push(err1);
}
errors++;
}
if(data.t === undefined){
const err2 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "t"},message:"must have required property '"+"t"+"'"};
if(vErrors === null){
vErrors = [err2];
}
else {
vErrors.push(err2);
}
errors++;
}
if(data.path === undefined){
const err3 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "path"},message:"must have required property '"+"path"+"'"};
if(vErrors === null){
vErrors = [err3];
}
else {
vErrors.push(err3);
}
errors++;
}
if(data.bytes === undefined){
const err4 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "bytes"},message:"must have required property '"+"bytes"+"'"};
if(vErrors === null){
vErrors = [err4];
}
else {
vErrors.push(err4);
}
errors++;
}
if(data.sha256 === undefined){
const err5 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "sha256"},message:"must have required property '"+"sha256"+"'"};
if(vErrors === null){
vErrors = [err5];
}
else {
vErrors.push(err5);
}
errors++;
}
if(data.note === undefined){
const err6 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "note"},message:"must have required property '"+"note"+"'"};
if(vErrors === null){
vErrors = [err6];
}
else {
vErrors.push(err6);
}
errors++;
}
for(const key0 in data){
if(!((((((((key0 === "input_index") || (key0 === "src")) || (key0 === "t")) || (key0 === "path")) || (key0 === "bytes")) || (key0 === "sha256")) || (key0 === "note")) || (key0 === "origin"))){
const err7 = {instancePath,schemaPath:"#/additionalProperties",keyword:"additionalProperties",params:{additionalProperty: key0},message:"must NOT have additional properties"};
if(vErrors === null){
vErrors = [err7];
}
else {
vErrors.push(err7);
}
errors++;
}
}
if(data.input_index !== undefined){
let data0 = data.input_index;
if(!((typeof data0 == "number") && (!(data0 % 1) && !isNaN(data0)))){
const err8 = {instancePath:instancePath+"/input_index",schemaPath:"#/properties/input_index/type",keyword:"type",params:{type: "integer"},message:"must be integer"};
if(vErrors === null){
vErrors = [err8];
}
else {
vErrors.push(err8);
}
errors++;
}
if(typeof data0 == "number"){
if(data0 < 0 || isNaN(data0)){
const err9 = {instancePath:instancePath+"/input_index",schemaPath:"#/properties/input_index/minimum",keyword:"minimum",params:{comparison: ">=", limit: 0},message:"must be >= 0"};
if(vErrors === null){
vErrors = [err9];
}
else {
vErrors.push(err9);
}
errors++;
}
}
}
if(data.src !== undefined){
let data1 = data.src;
const _errs6 = errors;
let valid2 = false;
let passing0 = null;
const _errs7 = errors;
if(data1 !== null){
const err10 = {instancePath:instancePath+"/src",schemaPath:"#/$defs/src/oneOf/0/type",keyword:"type",params:{type: "null"},message:"must be null"};
if(vErrors === null){
vErrors = [err10];
}
else {
vErrors.push(err10);
}
errors++;
}
var _valid0 = _errs7 === errors;
if(_valid0){
valid2 = true;
passing0 = 0;
}
const _errs9 = errors;
if(typeof data1 === "string"){
if(func1(data1) < 1){
const err11 = {instancePath:instancePath+"/src",schemaPath:"#/$defs/src/oneOf/1/minLength",keyword:"minLength",params:{limit: 1},message:"must NOT have fewer than 1 characters"};
if(vErrors === null){
vErrors = [err11];
}
else {
vErrors.push(err11);
}
errors++;
}
if(!pattern4.test(data1)){
const err12 = {instancePath:instancePath+"/src",schemaPath:"#/$defs/src/oneOf/1/pattern",keyword:"pattern",params:{pattern: "\\S"},message:"must match pattern \""+"\\S"+"\""};
if(vErrors === null){
vErrors = [err12];
}
else {
vErrors.push(err12);
}
errors++;
}
}
else {
const err13 = {instancePath:instancePath+"/src",schemaPath:"#/$defs/src/oneOf/1/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err13];
}
else {
vErrors.push(err13);
}
errors++;
}
var _valid0 = _errs9 === errors;
if(_valid0 && valid2){
valid2 = false;
passing0 = [passing0, 1];
}
else {
if(_valid0){
valid2 = true;
passing0 = 1;
}
}
if(!valid2){
const err14 = {instancePath:instancePath+"/src",schemaPath:"#/$defs/src/oneOf",keyword:"oneOf",params:{passingSchemas: passing0},message:"must match exactly one schema in oneOf"};
if(vErrors === null){
vErrors = [err14];
}
else {
vErrors.push(err14);
}
errors++;
}
else {
errors = _errs6;
if(vErrors !== null){
if(_errs6){
vErrors.length = _errs6;
}
else {
vErrors = null;
}
}
}
}
if(data.t !== undefined){
let data2 = data.t;
if(typeof data2 == "number"){
if(data2 < 0 || isNaN(data2)){
const err15 = {instancePath:instancePath+"/t",schemaPath:"#/$defs/seconds/minimum",keyword:"minimum",params:{comparison: ">=", limit: 0},message:"must be >= 0"};
if(vErrors === null){
vErrors = [err15];
}
else {
vErrors.push(err15);
}
errors++;
}
}
else {
const err16 = {instancePath:instancePath+"/t",schemaPath:"#/$defs/seconds/type",keyword:"type",params:{type: "number"},message:"must be number"};
if(vErrors === null){
vErrors = [err16];
}
else {
vErrors.push(err16);
}
errors++;
}
}
if(data.path !== undefined){
let data3 = data.path;
if(typeof data3 === "string"){
if(func1(data3) < 1){
const err17 = {instancePath:instancePath+"/path",schemaPath:"#/$defs/relativePath/minLength",keyword:"minLength",params:{limit: 1},message:"must NOT have fewer than 1 characters"};
if(vErrors === null){
vErrors = [err17];
}
else {
vErrors.push(err17);
}
errors++;
}
if(!pattern5.test(data3)){
const err18 = {instancePath:instancePath+"/path",schemaPath:"#/$defs/relativePath/pattern",keyword:"pattern",params:{pattern: "^(?!/)(?![A-Za-z]:[\\\\/])(?![A-Za-z][A-Za-z0-9+.-]*:)(?!.*\\\\)(?!.*(?:^|/)\\.\\.(?:/|$))\\S(?:.*\\S)?$"},message:"must match pattern \""+"^(?!/)(?![A-Za-z]:[\\\\/])(?![A-Za-z][A-Za-z0-9+.-]*:)(?!.*\\\\)(?!.*(?:^|/)\\.\\.(?:/|$))\\S(?:.*\\S)?$"+"\""};
if(vErrors === null){
vErrors = [err18];
}
else {
vErrors.push(err18);
}
errors++;
}
}
else {
const err19 = {instancePath:instancePath+"/path",schemaPath:"#/$defs/relativePath/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err19];
}
else {
vErrors.push(err19);
}
errors++;
}
}
if(data.bytes !== undefined){
let data4 = data.bytes;
if(!((typeof data4 == "number") && (!(data4 % 1) && !isNaN(data4)))){
const err20 = {instancePath:instancePath+"/bytes",schemaPath:"#/$defs/bytes/type",keyword:"type",params:{type: "integer"},message:"must be integer"};
if(vErrors === null){
vErrors = [err20];
}
else {
vErrors.push(err20);
}
errors++;
}
if(typeof data4 == "number"){
if(data4 < 0 || isNaN(data4)){
const err21 = {instancePath:instancePath+"/bytes",schemaPath:"#/$defs/bytes/minimum",keyword:"minimum",params:{comparison: ">=", limit: 0},message:"must be >= 0"};
if(vErrors === null){
vErrors = [err21];
}
else {
vErrors.push(err21);
}
errors++;
}
}
}
if(data.sha256 !== undefined){
let data5 = data.sha256;
if(typeof data5 === "string"){
if(!pattern6.test(data5)){
const err22 = {instancePath:instancePath+"/sha256",schemaPath:"#/$defs/sha256/pattern",keyword:"pattern",params:{pattern: "^[a-f0-9]{64}$"},message:"must match pattern \""+"^[a-f0-9]{64}$"+"\""};
if(vErrors === null){
vErrors = [err22];
}
else {
vErrors.push(err22);
}
errors++;
}
}
else {
const err23 = {instancePath:instancePath+"/sha256",schemaPath:"#/$defs/sha256/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err23];
}
else {
vErrors.push(err23);
}
errors++;
}
}
if(data.note !== undefined){
let data6 = data.note;
if(typeof data6 === "string"){
if(func1(data6) < 1){
const err24 = {instancePath:instancePath+"/note",schemaPath:"#/properties/note/minLength",keyword:"minLength",params:{limit: 1},message:"must NOT have fewer than 1 characters"};
if(vErrors === null){
vErrors = [err24];
}
else {
vErrors.push(err24);
}
errors++;
}
}
else {
const err25 = {instancePath:instancePath+"/note",schemaPath:"#/properties/note/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err25];
}
else {
vErrors.push(err25);
}
errors++;
}
}
if(data.origin !== undefined){
let data7 = data.origin;
if(!(((data7 === "scene") || (data7 === "interval")) || (data7 === "transcript"))){
const err26 = {instancePath:instancePath+"/origin",schemaPath:"#/properties/origin/enum",keyword:"enum",params:{allowedValues: schema106.properties.origin.enum},message:"must be equal to one of the allowed values"};
if(vErrors === null){
vErrors = [err26];
}
else {
vErrors.push(err26);
}
errors++;
}
}
}
else {
const err27 = {instancePath,schemaPath:"#/type",keyword:"type",params:{type: "object"},message:"must be object"};
if(vErrors === null){
vErrors = [err27];
}
else {
vErrors.push(err27);
}
errors++;
}
validate68.errors = vErrors;
return errors === 0;
}
validate68.evaluated = {"props":true,"dynamicProps":false,"dynamicItems":false};


function validate55(data, {instancePath="", parentData, parentDataProperty, rootData=data, dynamicAnchors={}}={}){
let vErrors = null;
let errors = 0;
const evaluated0 = validate55.evaluated;
if(evaluated0.dynamicProps){
evaluated0.props = undefined;
}
if(evaluated0.dynamicItems){
evaluated0.items = undefined;
}
if(data && typeof data == "object" && !Array.isArray(data)){
if(data.semantic_keep_plan === undefined){
const err0 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "semantic_keep_plan"},message:"must have required property '"+"semantic_keep_plan"+"'"};
if(vErrors === null){
vErrors = [err0];
}
else {
vErrors.push(err0);
}
errors++;
}
if(data.decision_log === undefined){
const err1 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "decision_log"},message:"must have required property '"+"decision_log"+"'"};
if(vErrors === null){
vErrors = [err1];
}
else {
vErrors.push(err1);
}
errors++;
}
if(data.processed_sources === undefined){
const err2 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "processed_sources"},message:"must have required property '"+"processed_sources"+"'"};
if(vErrors === null){
vErrors = [err2];
}
else {
vErrors.push(err2);
}
errors++;
}
if(data.analyses === undefined){
const err3 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "analyses"},message:"must have required property '"+"analyses"+"'"};
if(vErrors === null){
vErrors = [err3];
}
else {
vErrors.push(err3);
}
errors++;
}
if(data.keyframes === undefined){
const err4 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "keyframes"},message:"must have required property '"+"keyframes"+"'"};
if(vErrors === null){
vErrors = [err4];
}
else {
vErrors.push(err4);
}
errors++;
}
for(const key0 in data){
if(!(((((key0 === "semantic_keep_plan") || (key0 === "decision_log")) || (key0 === "processed_sources")) || (key0 === "analyses")) || (key0 === "keyframes"))){
const err5 = {instancePath,schemaPath:"#/additionalProperties",keyword:"additionalProperties",params:{additionalProperty: key0},message:"must NOT have additional properties"};
if(vErrors === null){
vErrors = [err5];
}
else {
vErrors.push(err5);
}
errors++;
}
}
if(data.semantic_keep_plan !== undefined){
if(!(validate56(data.semantic_keep_plan, {instancePath:instancePath+"/semantic_keep_plan",parentData:data,parentDataProperty:"semantic_keep_plan",rootData,dynamicAnchors}))){
vErrors = vErrors === null ? validate56.errors : vErrors.concat(validate56.errors);
errors = vErrors.length;
}
}
if(data.decision_log !== undefined){
if(!(validate58(data.decision_log, {instancePath:instancePath+"/decision_log",parentData:data,parentDataProperty:"decision_log",rootData,dynamicAnchors}))){
vErrors = vErrors === null ? validate58.errors : vErrors.concat(validate58.errors);
errors = vErrors.length;
}
}
if(data.processed_sources !== undefined){
let data2 = data.processed_sources;
if(Array.isArray(data2)){
if(data2.length > 256){
const err6 = {instancePath:instancePath+"/processed_sources",schemaPath:"#/properties/processed_sources/maxItems",keyword:"maxItems",params:{limit: 256},message:"must NOT have more than 256 items"};
if(vErrors === null){
vErrors = [err6];
}
else {
vErrors.push(err6);
}
errors++;
}
const len0 = data2.length;
for(let i0=0; i0<len0; i0++){
if(!(validate60(data2[i0], {instancePath:instancePath+"/processed_sources/" + i0,parentData:data2,parentDataProperty:i0,rootData,dynamicAnchors}))){
vErrors = vErrors === null ? validate60.errors : vErrors.concat(validate60.errors);
errors = vErrors.length;
}
}
}
else {
const err7 = {instancePath:instancePath+"/processed_sources",schemaPath:"#/properties/processed_sources/type",keyword:"type",params:{type: "array"},message:"must be array"};
if(vErrors === null){
vErrors = [err7];
}
else {
vErrors.push(err7);
}
errors++;
}
}
if(data.analyses !== undefined){
let data4 = data.analyses;
if(Array.isArray(data4)){
if(data4.length > 256){
const err8 = {instancePath:instancePath+"/analyses",schemaPath:"#/properties/analyses/maxItems",keyword:"maxItems",params:{limit: 256},message:"must NOT have more than 256 items"};
if(vErrors === null){
vErrors = [err8];
}
else {
vErrors.push(err8);
}
errors++;
}
const len1 = data4.length;
for(let i1=0; i1<len1; i1++){
if(!(validate66(data4[i1], {instancePath:instancePath+"/analyses/" + i1,parentData:data4,parentDataProperty:i1,rootData,dynamicAnchors}))){
vErrors = vErrors === null ? validate66.errors : vErrors.concat(validate66.errors);
errors = vErrors.length;
}
}
}
else {
const err9 = {instancePath:instancePath+"/analyses",schemaPath:"#/properties/analyses/type",keyword:"type",params:{type: "array"},message:"must be array"};
if(vErrors === null){
vErrors = [err9];
}
else {
vErrors.push(err9);
}
errors++;
}
}
if(data.keyframes !== undefined){
let data6 = data.keyframes;
if(Array.isArray(data6)){
const len2 = data6.length;
for(let i2=0; i2<len2; i2++){
if(!(validate68(data6[i2], {instancePath:instancePath+"/keyframes/" + i2,parentData:data6,parentDataProperty:i2,rootData,dynamicAnchors}))){
vErrors = vErrors === null ? validate68.errors : vErrors.concat(validate68.errors);
errors = vErrors.length;
}
}
}
else {
const err10 = {instancePath:instancePath+"/keyframes",schemaPath:"#/properties/keyframes/type",keyword:"type",params:{type: "array"},message:"must be array"};
if(vErrors === null){
vErrors = [err10];
}
else {
vErrors.push(err10);
}
errors++;
}
}
}
else {
const err11 = {instancePath,schemaPath:"#/type",keyword:"type",params:{type: "object"},message:"must be object"};
if(vErrors === null){
vErrors = [err11];
}
else {
vErrors.push(err11);
}
errors++;
}
validate55.errors = vErrors;
return errors === 0;
}
validate55.evaluated = {"props":true,"dynamicProps":false,"dynamicItems":false};

const schema112 = {"type":"object","additionalProperties":false,"required":["module_source_set","module_source_set_sha256","contract_schemas","ffmpeg","ffprobe","node","detector_argv_template_sha256"],"properties":{"module_source_set":{"type":"array","minItems":4,"items":{"$ref":"#/$defs/moduleReceipt"}},"module_source_set_sha256":{"$ref":"#/$defs/sha256"},"contract_schemas":{"type":"array","minItems":3,"maxItems":3,"items":{"$ref":"#/$defs/schemaReceipt"}},"ffmpeg":{"$ref":"#/$defs/binaryToolReceipt"},"ffprobe":{"$ref":"#/$defs/binaryToolReceipt"},"node":{"$ref":"#/$defs/nodeReceipt"},"detector_argv_template_sha256":{"$ref":"#/$defs/sha256"}}};
const schema113 = {"type":"object","additionalProperties":false,"required":["role","skill_relative_path","bytes","sha256"],"properties":{"role":{"enum":["entrypoint","helper","schema_validator","semantic_validator","vendor_runtime"]},"skill_relative_path":{"$ref":"#/$defs/relativePath"},"bytes":{"$ref":"#/$defs/bytes"},"sha256":{"$ref":"#/$defs/sha256"}}};

function validate72(data, {instancePath="", parentData, parentDataProperty, rootData=data, dynamicAnchors={}}={}){
let vErrors = null;
let errors = 0;
const evaluated0 = validate72.evaluated;
if(evaluated0.dynamicProps){
evaluated0.props = undefined;
}
if(evaluated0.dynamicItems){
evaluated0.items = undefined;
}
if(data && typeof data == "object" && !Array.isArray(data)){
if(data.role === undefined){
const err0 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "role"},message:"must have required property '"+"role"+"'"};
if(vErrors === null){
vErrors = [err0];
}
else {
vErrors.push(err0);
}
errors++;
}
if(data.skill_relative_path === undefined){
const err1 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "skill_relative_path"},message:"must have required property '"+"skill_relative_path"+"'"};
if(vErrors === null){
vErrors = [err1];
}
else {
vErrors.push(err1);
}
errors++;
}
if(data.bytes === undefined){
const err2 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "bytes"},message:"must have required property '"+"bytes"+"'"};
if(vErrors === null){
vErrors = [err2];
}
else {
vErrors.push(err2);
}
errors++;
}
if(data.sha256 === undefined){
const err3 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "sha256"},message:"must have required property '"+"sha256"+"'"};
if(vErrors === null){
vErrors = [err3];
}
else {
vErrors.push(err3);
}
errors++;
}
for(const key0 in data){
if(!((((key0 === "role") || (key0 === "skill_relative_path")) || (key0 === "bytes")) || (key0 === "sha256"))){
const err4 = {instancePath,schemaPath:"#/additionalProperties",keyword:"additionalProperties",params:{additionalProperty: key0},message:"must NOT have additional properties"};
if(vErrors === null){
vErrors = [err4];
}
else {
vErrors.push(err4);
}
errors++;
}
}
if(data.role !== undefined){
let data0 = data.role;
if(!(((((data0 === "entrypoint") || (data0 === "helper")) || (data0 === "schema_validator")) || (data0 === "semantic_validator")) || (data0 === "vendor_runtime"))){
const err5 = {instancePath:instancePath+"/role",schemaPath:"#/properties/role/enum",keyword:"enum",params:{allowedValues: schema113.properties.role.enum},message:"must be equal to one of the allowed values"};
if(vErrors === null){
vErrors = [err5];
}
else {
vErrors.push(err5);
}
errors++;
}
}
if(data.skill_relative_path !== undefined){
let data1 = data.skill_relative_path;
if(typeof data1 === "string"){
if(func1(data1) < 1){
const err6 = {instancePath:instancePath+"/skill_relative_path",schemaPath:"#/$defs/relativePath/minLength",keyword:"minLength",params:{limit: 1},message:"must NOT have fewer than 1 characters"};
if(vErrors === null){
vErrors = [err6];
}
else {
vErrors.push(err6);
}
errors++;
}
if(!pattern5.test(data1)){
const err7 = {instancePath:instancePath+"/skill_relative_path",schemaPath:"#/$defs/relativePath/pattern",keyword:"pattern",params:{pattern: "^(?!/)(?![A-Za-z]:[\\\\/])(?![A-Za-z][A-Za-z0-9+.-]*:)(?!.*\\\\)(?!.*(?:^|/)\\.\\.(?:/|$))\\S(?:.*\\S)?$"},message:"must match pattern \""+"^(?!/)(?![A-Za-z]:[\\\\/])(?![A-Za-z][A-Za-z0-9+.-]*:)(?!.*\\\\)(?!.*(?:^|/)\\.\\.(?:/|$))\\S(?:.*\\S)?$"+"\""};
if(vErrors === null){
vErrors = [err7];
}
else {
vErrors.push(err7);
}
errors++;
}
}
else {
const err8 = {instancePath:instancePath+"/skill_relative_path",schemaPath:"#/$defs/relativePath/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err8];
}
else {
vErrors.push(err8);
}
errors++;
}
}
if(data.bytes !== undefined){
let data2 = data.bytes;
if(!((typeof data2 == "number") && (!(data2 % 1) && !isNaN(data2)))){
const err9 = {instancePath:instancePath+"/bytes",schemaPath:"#/$defs/bytes/type",keyword:"type",params:{type: "integer"},message:"must be integer"};
if(vErrors === null){
vErrors = [err9];
}
else {
vErrors.push(err9);
}
errors++;
}
if(typeof data2 == "number"){
if(data2 < 0 || isNaN(data2)){
const err10 = {instancePath:instancePath+"/bytes",schemaPath:"#/$defs/bytes/minimum",keyword:"minimum",params:{comparison: ">=", limit: 0},message:"must be >= 0"};
if(vErrors === null){
vErrors = [err10];
}
else {
vErrors.push(err10);
}
errors++;
}
}
}
if(data.sha256 !== undefined){
let data3 = data.sha256;
if(typeof data3 === "string"){
if(!pattern6.test(data3)){
const err11 = {instancePath:instancePath+"/sha256",schemaPath:"#/$defs/sha256/pattern",keyword:"pattern",params:{pattern: "^[a-f0-9]{64}$"},message:"must match pattern \""+"^[a-f0-9]{64}$"+"\""};
if(vErrors === null){
vErrors = [err11];
}
else {
vErrors.push(err11);
}
errors++;
}
}
else {
const err12 = {instancePath:instancePath+"/sha256",schemaPath:"#/$defs/sha256/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err12];
}
else {
vErrors.push(err12);
}
errors++;
}
}
}
else {
const err13 = {instancePath,schemaPath:"#/type",keyword:"type",params:{type: "object"},message:"must be object"};
if(vErrors === null){
vErrors = [err13];
}
else {
vErrors.push(err13);
}
errors++;
}
validate72.errors = vErrors;
return errors === 0;
}
validate72.evaluated = {"props":true,"dynamicProps":false,"dynamicItems":false};

const schema118 = {"type":"object","additionalProperties":false,"required":["id","canonical_source_path","sha256"],"properties":{"id":{"enum":["analysis-v0","semantic-keep-plan-v1","cut-candidates-v1"]},"canonical_source_path":{"enum":["packages/schemas/analysis.schema.json","packages/schemas/semantic-keep-plan.schema.json","packages/schemas/cut-candidates.schema.json"]},"sha256":{"$ref":"#/$defs/sha256"}}};

function validate74(data, {instancePath="", parentData, parentDataProperty, rootData=data, dynamicAnchors={}}={}){
let vErrors = null;
let errors = 0;
const evaluated0 = validate74.evaluated;
if(evaluated0.dynamicProps){
evaluated0.props = undefined;
}
if(evaluated0.dynamicItems){
evaluated0.items = undefined;
}
if(data && typeof data == "object" && !Array.isArray(data)){
if(data.id === undefined){
const err0 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "id"},message:"must have required property '"+"id"+"'"};
if(vErrors === null){
vErrors = [err0];
}
else {
vErrors.push(err0);
}
errors++;
}
if(data.canonical_source_path === undefined){
const err1 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "canonical_source_path"},message:"must have required property '"+"canonical_source_path"+"'"};
if(vErrors === null){
vErrors = [err1];
}
else {
vErrors.push(err1);
}
errors++;
}
if(data.sha256 === undefined){
const err2 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "sha256"},message:"must have required property '"+"sha256"+"'"};
if(vErrors === null){
vErrors = [err2];
}
else {
vErrors.push(err2);
}
errors++;
}
for(const key0 in data){
if(!(((key0 === "id") || (key0 === "canonical_source_path")) || (key0 === "sha256"))){
const err3 = {instancePath,schemaPath:"#/additionalProperties",keyword:"additionalProperties",params:{additionalProperty: key0},message:"must NOT have additional properties"};
if(vErrors === null){
vErrors = [err3];
}
else {
vErrors.push(err3);
}
errors++;
}
}
if(data.id !== undefined){
let data0 = data.id;
if(!(((data0 === "analysis-v0") || (data0 === "semantic-keep-plan-v1")) || (data0 === "cut-candidates-v1"))){
const err4 = {instancePath:instancePath+"/id",schemaPath:"#/properties/id/enum",keyword:"enum",params:{allowedValues: schema118.properties.id.enum},message:"must be equal to one of the allowed values"};
if(vErrors === null){
vErrors = [err4];
}
else {
vErrors.push(err4);
}
errors++;
}
}
if(data.canonical_source_path !== undefined){
let data1 = data.canonical_source_path;
if(!(((data1 === "packages/schemas/analysis.schema.json") || (data1 === "packages/schemas/semantic-keep-plan.schema.json")) || (data1 === "packages/schemas/cut-candidates.schema.json"))){
const err5 = {instancePath:instancePath+"/canonical_source_path",schemaPath:"#/properties/canonical_source_path/enum",keyword:"enum",params:{allowedValues: schema118.properties.canonical_source_path.enum},message:"must be equal to one of the allowed values"};
if(vErrors === null){
vErrors = [err5];
}
else {
vErrors.push(err5);
}
errors++;
}
}
if(data.sha256 !== undefined){
let data2 = data.sha256;
if(typeof data2 === "string"){
if(!pattern6.test(data2)){
const err6 = {instancePath:instancePath+"/sha256",schemaPath:"#/$defs/sha256/pattern",keyword:"pattern",params:{pattern: "^[a-f0-9]{64}$"},message:"must match pattern \""+"^[a-f0-9]{64}$"+"\""};
if(vErrors === null){
vErrors = [err6];
}
else {
vErrors.push(err6);
}
errors++;
}
}
else {
const err7 = {instancePath:instancePath+"/sha256",schemaPath:"#/$defs/sha256/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err7];
}
else {
vErrors.push(err7);
}
errors++;
}
}
}
else {
const err8 = {instancePath,schemaPath:"#/type",keyword:"type",params:{type: "object"},message:"must be object"};
if(vErrors === null){
vErrors = [err8];
}
else {
vErrors.push(err8);
}
errors++;
}
validate74.errors = vErrors;
return errors === 0;
}
validate74.evaluated = {"props":true,"dynamicProps":false,"dynamicItems":false};

const schema120 = {"type":"object","additionalProperties":false,"required":["version","binary_bytes","binary_sha256"],"properties":{"version":{"type":"string","minLength":1,"maxLength":512},"binary_bytes":{"$ref":"#/$defs/bytes"},"binary_sha256":{"$ref":"#/$defs/sha256"}}};

function validate76(data, {instancePath="", parentData, parentDataProperty, rootData=data, dynamicAnchors={}}={}){
let vErrors = null;
let errors = 0;
const evaluated0 = validate76.evaluated;
if(evaluated0.dynamicProps){
evaluated0.props = undefined;
}
if(evaluated0.dynamicItems){
evaluated0.items = undefined;
}
if(data && typeof data == "object" && !Array.isArray(data)){
if(data.version === undefined){
const err0 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "version"},message:"must have required property '"+"version"+"'"};
if(vErrors === null){
vErrors = [err0];
}
else {
vErrors.push(err0);
}
errors++;
}
if(data.binary_bytes === undefined){
const err1 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "binary_bytes"},message:"must have required property '"+"binary_bytes"+"'"};
if(vErrors === null){
vErrors = [err1];
}
else {
vErrors.push(err1);
}
errors++;
}
if(data.binary_sha256 === undefined){
const err2 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "binary_sha256"},message:"must have required property '"+"binary_sha256"+"'"};
if(vErrors === null){
vErrors = [err2];
}
else {
vErrors.push(err2);
}
errors++;
}
for(const key0 in data){
if(!(((key0 === "version") || (key0 === "binary_bytes")) || (key0 === "binary_sha256"))){
const err3 = {instancePath,schemaPath:"#/additionalProperties",keyword:"additionalProperties",params:{additionalProperty: key0},message:"must NOT have additional properties"};
if(vErrors === null){
vErrors = [err3];
}
else {
vErrors.push(err3);
}
errors++;
}
}
if(data.version !== undefined){
let data0 = data.version;
if(typeof data0 === "string"){
if(func1(data0) > 512){
const err4 = {instancePath:instancePath+"/version",schemaPath:"#/properties/version/maxLength",keyword:"maxLength",params:{limit: 512},message:"must NOT have more than 512 characters"};
if(vErrors === null){
vErrors = [err4];
}
else {
vErrors.push(err4);
}
errors++;
}
if(func1(data0) < 1){
const err5 = {instancePath:instancePath+"/version",schemaPath:"#/properties/version/minLength",keyword:"minLength",params:{limit: 1},message:"must NOT have fewer than 1 characters"};
if(vErrors === null){
vErrors = [err5];
}
else {
vErrors.push(err5);
}
errors++;
}
}
else {
const err6 = {instancePath:instancePath+"/version",schemaPath:"#/properties/version/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err6];
}
else {
vErrors.push(err6);
}
errors++;
}
}
if(data.binary_bytes !== undefined){
let data1 = data.binary_bytes;
if(!((typeof data1 == "number") && (!(data1 % 1) && !isNaN(data1)))){
const err7 = {instancePath:instancePath+"/binary_bytes",schemaPath:"#/$defs/bytes/type",keyword:"type",params:{type: "integer"},message:"must be integer"};
if(vErrors === null){
vErrors = [err7];
}
else {
vErrors.push(err7);
}
errors++;
}
if(typeof data1 == "number"){
if(data1 < 0 || isNaN(data1)){
const err8 = {instancePath:instancePath+"/binary_bytes",schemaPath:"#/$defs/bytes/minimum",keyword:"minimum",params:{comparison: ">=", limit: 0},message:"must be >= 0"};
if(vErrors === null){
vErrors = [err8];
}
else {
vErrors.push(err8);
}
errors++;
}
}
}
if(data.binary_sha256 !== undefined){
let data2 = data.binary_sha256;
if(typeof data2 === "string"){
if(!pattern6.test(data2)){
const err9 = {instancePath:instancePath+"/binary_sha256",schemaPath:"#/$defs/sha256/pattern",keyword:"pattern",params:{pattern: "^[a-f0-9]{64}$"},message:"must match pattern \""+"^[a-f0-9]{64}$"+"\""};
if(vErrors === null){
vErrors = [err9];
}
else {
vErrors.push(err9);
}
errors++;
}
}
else {
const err10 = {instancePath:instancePath+"/binary_sha256",schemaPath:"#/$defs/sha256/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err10];
}
else {
vErrors.push(err10);
}
errors++;
}
}
}
else {
const err11 = {instancePath,schemaPath:"#/type",keyword:"type",params:{type: "object"},message:"must be object"};
if(vErrors === null){
vErrors = [err11];
}
else {
vErrors.push(err11);
}
errors++;
}
validate76.errors = vErrors;
return errors === 0;
}
validate76.evaluated = {"props":true,"dynamicProps":false,"dynamicItems":false};

const schema123 = {"type":"object","additionalProperties":false,"required":["platform","arch","node_version","v8_version","node_binary_bytes","node_binary_sha256"],"properties":{"platform":{"type":"string","minLength":1},"arch":{"type":"string","minLength":1},"node_version":{"type":"string","minLength":1},"v8_version":{"type":"string","minLength":1},"node_binary_bytes":{"$ref":"#/$defs/bytes"},"node_binary_sha256":{"$ref":"#/$defs/sha256"}}};

function validate79(data, {instancePath="", parentData, parentDataProperty, rootData=data, dynamicAnchors={}}={}){
let vErrors = null;
let errors = 0;
const evaluated0 = validate79.evaluated;
if(evaluated0.dynamicProps){
evaluated0.props = undefined;
}
if(evaluated0.dynamicItems){
evaluated0.items = undefined;
}
if(data && typeof data == "object" && !Array.isArray(data)){
if(data.platform === undefined){
const err0 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "platform"},message:"must have required property '"+"platform"+"'"};
if(vErrors === null){
vErrors = [err0];
}
else {
vErrors.push(err0);
}
errors++;
}
if(data.arch === undefined){
const err1 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "arch"},message:"must have required property '"+"arch"+"'"};
if(vErrors === null){
vErrors = [err1];
}
else {
vErrors.push(err1);
}
errors++;
}
if(data.node_version === undefined){
const err2 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "node_version"},message:"must have required property '"+"node_version"+"'"};
if(vErrors === null){
vErrors = [err2];
}
else {
vErrors.push(err2);
}
errors++;
}
if(data.v8_version === undefined){
const err3 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "v8_version"},message:"must have required property '"+"v8_version"+"'"};
if(vErrors === null){
vErrors = [err3];
}
else {
vErrors.push(err3);
}
errors++;
}
if(data.node_binary_bytes === undefined){
const err4 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "node_binary_bytes"},message:"must have required property '"+"node_binary_bytes"+"'"};
if(vErrors === null){
vErrors = [err4];
}
else {
vErrors.push(err4);
}
errors++;
}
if(data.node_binary_sha256 === undefined){
const err5 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "node_binary_sha256"},message:"must have required property '"+"node_binary_sha256"+"'"};
if(vErrors === null){
vErrors = [err5];
}
else {
vErrors.push(err5);
}
errors++;
}
for(const key0 in data){
if(!((((((key0 === "platform") || (key0 === "arch")) || (key0 === "node_version")) || (key0 === "v8_version")) || (key0 === "node_binary_bytes")) || (key0 === "node_binary_sha256"))){
const err6 = {instancePath,schemaPath:"#/additionalProperties",keyword:"additionalProperties",params:{additionalProperty: key0},message:"must NOT have additional properties"};
if(vErrors === null){
vErrors = [err6];
}
else {
vErrors.push(err6);
}
errors++;
}
}
if(data.platform !== undefined){
let data0 = data.platform;
if(typeof data0 === "string"){
if(func1(data0) < 1){
const err7 = {instancePath:instancePath+"/platform",schemaPath:"#/properties/platform/minLength",keyword:"minLength",params:{limit: 1},message:"must NOT have fewer than 1 characters"};
if(vErrors === null){
vErrors = [err7];
}
else {
vErrors.push(err7);
}
errors++;
}
}
else {
const err8 = {instancePath:instancePath+"/platform",schemaPath:"#/properties/platform/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err8];
}
else {
vErrors.push(err8);
}
errors++;
}
}
if(data.arch !== undefined){
let data1 = data.arch;
if(typeof data1 === "string"){
if(func1(data1) < 1){
const err9 = {instancePath:instancePath+"/arch",schemaPath:"#/properties/arch/minLength",keyword:"minLength",params:{limit: 1},message:"must NOT have fewer than 1 characters"};
if(vErrors === null){
vErrors = [err9];
}
else {
vErrors.push(err9);
}
errors++;
}
}
else {
const err10 = {instancePath:instancePath+"/arch",schemaPath:"#/properties/arch/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err10];
}
else {
vErrors.push(err10);
}
errors++;
}
}
if(data.node_version !== undefined){
let data2 = data.node_version;
if(typeof data2 === "string"){
if(func1(data2) < 1){
const err11 = {instancePath:instancePath+"/node_version",schemaPath:"#/properties/node_version/minLength",keyword:"minLength",params:{limit: 1},message:"must NOT have fewer than 1 characters"};
if(vErrors === null){
vErrors = [err11];
}
else {
vErrors.push(err11);
}
errors++;
}
}
else {
const err12 = {instancePath:instancePath+"/node_version",schemaPath:"#/properties/node_version/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err12];
}
else {
vErrors.push(err12);
}
errors++;
}
}
if(data.v8_version !== undefined){
let data3 = data.v8_version;
if(typeof data3 === "string"){
if(func1(data3) < 1){
const err13 = {instancePath:instancePath+"/v8_version",schemaPath:"#/properties/v8_version/minLength",keyword:"minLength",params:{limit: 1},message:"must NOT have fewer than 1 characters"};
if(vErrors === null){
vErrors = [err13];
}
else {
vErrors.push(err13);
}
errors++;
}
}
else {
const err14 = {instancePath:instancePath+"/v8_version",schemaPath:"#/properties/v8_version/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err14];
}
else {
vErrors.push(err14);
}
errors++;
}
}
if(data.node_binary_bytes !== undefined){
let data4 = data.node_binary_bytes;
if(!((typeof data4 == "number") && (!(data4 % 1) && !isNaN(data4)))){
const err15 = {instancePath:instancePath+"/node_binary_bytes",schemaPath:"#/$defs/bytes/type",keyword:"type",params:{type: "integer"},message:"must be integer"};
if(vErrors === null){
vErrors = [err15];
}
else {
vErrors.push(err15);
}
errors++;
}
if(typeof data4 == "number"){
if(data4 < 0 || isNaN(data4)){
const err16 = {instancePath:instancePath+"/node_binary_bytes",schemaPath:"#/$defs/bytes/minimum",keyword:"minimum",params:{comparison: ">=", limit: 0},message:"must be >= 0"};
if(vErrors === null){
vErrors = [err16];
}
else {
vErrors.push(err16);
}
errors++;
}
}
}
if(data.node_binary_sha256 !== undefined){
let data5 = data.node_binary_sha256;
if(typeof data5 === "string"){
if(!pattern6.test(data5)){
const err17 = {instancePath:instancePath+"/node_binary_sha256",schemaPath:"#/$defs/sha256/pattern",keyword:"pattern",params:{pattern: "^[a-f0-9]{64}$"},message:"must match pattern \""+"^[a-f0-9]{64}$"+"\""};
if(vErrors === null){
vErrors = [err17];
}
else {
vErrors.push(err17);
}
errors++;
}
}
else {
const err18 = {instancePath:instancePath+"/node_binary_sha256",schemaPath:"#/$defs/sha256/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err18];
}
else {
vErrors.push(err18);
}
errors++;
}
}
}
else {
const err19 = {instancePath,schemaPath:"#/type",keyword:"type",params:{type: "object"},message:"must be object"};
if(vErrors === null){
vErrors = [err19];
}
else {
vErrors.push(err19);
}
errors++;
}
validate79.errors = vErrors;
return errors === 0;
}
validate79.evaluated = {"props":true,"dynamicProps":false,"dynamicItems":false};


function validate71(data, {instancePath="", parentData, parentDataProperty, rootData=data, dynamicAnchors={}}={}){
let vErrors = null;
let errors = 0;
const evaluated0 = validate71.evaluated;
if(evaluated0.dynamicProps){
evaluated0.props = undefined;
}
if(evaluated0.dynamicItems){
evaluated0.items = undefined;
}
if(data && typeof data == "object" && !Array.isArray(data)){
if(data.module_source_set === undefined){
const err0 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "module_source_set"},message:"must have required property '"+"module_source_set"+"'"};
if(vErrors === null){
vErrors = [err0];
}
else {
vErrors.push(err0);
}
errors++;
}
if(data.module_source_set_sha256 === undefined){
const err1 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "module_source_set_sha256"},message:"must have required property '"+"module_source_set_sha256"+"'"};
if(vErrors === null){
vErrors = [err1];
}
else {
vErrors.push(err1);
}
errors++;
}
if(data.contract_schemas === undefined){
const err2 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "contract_schemas"},message:"must have required property '"+"contract_schemas"+"'"};
if(vErrors === null){
vErrors = [err2];
}
else {
vErrors.push(err2);
}
errors++;
}
if(data.ffmpeg === undefined){
const err3 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "ffmpeg"},message:"must have required property '"+"ffmpeg"+"'"};
if(vErrors === null){
vErrors = [err3];
}
else {
vErrors.push(err3);
}
errors++;
}
if(data.ffprobe === undefined){
const err4 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "ffprobe"},message:"must have required property '"+"ffprobe"+"'"};
if(vErrors === null){
vErrors = [err4];
}
else {
vErrors.push(err4);
}
errors++;
}
if(data.node === undefined){
const err5 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "node"},message:"must have required property '"+"node"+"'"};
if(vErrors === null){
vErrors = [err5];
}
else {
vErrors.push(err5);
}
errors++;
}
if(data.detector_argv_template_sha256 === undefined){
const err6 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "detector_argv_template_sha256"},message:"must have required property '"+"detector_argv_template_sha256"+"'"};
if(vErrors === null){
vErrors = [err6];
}
else {
vErrors.push(err6);
}
errors++;
}
for(const key0 in data){
if(!(((((((key0 === "module_source_set") || (key0 === "module_source_set_sha256")) || (key0 === "contract_schemas")) || (key0 === "ffmpeg")) || (key0 === "ffprobe")) || (key0 === "node")) || (key0 === "detector_argv_template_sha256"))){
const err7 = {instancePath,schemaPath:"#/additionalProperties",keyword:"additionalProperties",params:{additionalProperty: key0},message:"must NOT have additional properties"};
if(vErrors === null){
vErrors = [err7];
}
else {
vErrors.push(err7);
}
errors++;
}
}
if(data.module_source_set !== undefined){
let data0 = data.module_source_set;
if(Array.isArray(data0)){
if(data0.length < 4){
const err8 = {instancePath:instancePath+"/module_source_set",schemaPath:"#/properties/module_source_set/minItems",keyword:"minItems",params:{limit: 4},message:"must NOT have fewer than 4 items"};
if(vErrors === null){
vErrors = [err8];
}
else {
vErrors.push(err8);
}
errors++;
}
const len0 = data0.length;
for(let i0=0; i0<len0; i0++){
if(!(validate72(data0[i0], {instancePath:instancePath+"/module_source_set/" + i0,parentData:data0,parentDataProperty:i0,rootData,dynamicAnchors}))){
vErrors = vErrors === null ? validate72.errors : vErrors.concat(validate72.errors);
errors = vErrors.length;
}
}
}
else {
const err9 = {instancePath:instancePath+"/module_source_set",schemaPath:"#/properties/module_source_set/type",keyword:"type",params:{type: "array"},message:"must be array"};
if(vErrors === null){
vErrors = [err9];
}
else {
vErrors.push(err9);
}
errors++;
}
}
if(data.module_source_set_sha256 !== undefined){
let data2 = data.module_source_set_sha256;
if(typeof data2 === "string"){
if(!pattern6.test(data2)){
const err10 = {instancePath:instancePath+"/module_source_set_sha256",schemaPath:"#/$defs/sha256/pattern",keyword:"pattern",params:{pattern: "^[a-f0-9]{64}$"},message:"must match pattern \""+"^[a-f0-9]{64}$"+"\""};
if(vErrors === null){
vErrors = [err10];
}
else {
vErrors.push(err10);
}
errors++;
}
}
else {
const err11 = {instancePath:instancePath+"/module_source_set_sha256",schemaPath:"#/$defs/sha256/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err11];
}
else {
vErrors.push(err11);
}
errors++;
}
}
if(data.contract_schemas !== undefined){
let data3 = data.contract_schemas;
if(Array.isArray(data3)){
if(data3.length > 3){
const err12 = {instancePath:instancePath+"/contract_schemas",schemaPath:"#/properties/contract_schemas/maxItems",keyword:"maxItems",params:{limit: 3},message:"must NOT have more than 3 items"};
if(vErrors === null){
vErrors = [err12];
}
else {
vErrors.push(err12);
}
errors++;
}
if(data3.length < 3){
const err13 = {instancePath:instancePath+"/contract_schemas",schemaPath:"#/properties/contract_schemas/minItems",keyword:"minItems",params:{limit: 3},message:"must NOT have fewer than 3 items"};
if(vErrors === null){
vErrors = [err13];
}
else {
vErrors.push(err13);
}
errors++;
}
const len1 = data3.length;
for(let i1=0; i1<len1; i1++){
if(!(validate74(data3[i1], {instancePath:instancePath+"/contract_schemas/" + i1,parentData:data3,parentDataProperty:i1,rootData,dynamicAnchors}))){
vErrors = vErrors === null ? validate74.errors : vErrors.concat(validate74.errors);
errors = vErrors.length;
}
}
}
else {
const err14 = {instancePath:instancePath+"/contract_schemas",schemaPath:"#/properties/contract_schemas/type",keyword:"type",params:{type: "array"},message:"must be array"};
if(vErrors === null){
vErrors = [err14];
}
else {
vErrors.push(err14);
}
errors++;
}
}
if(data.ffmpeg !== undefined){
if(!(validate76(data.ffmpeg, {instancePath:instancePath+"/ffmpeg",parentData:data,parentDataProperty:"ffmpeg",rootData,dynamicAnchors}))){
vErrors = vErrors === null ? validate76.errors : vErrors.concat(validate76.errors);
errors = vErrors.length;
}
}
if(data.ffprobe !== undefined){
if(!(validate76(data.ffprobe, {instancePath:instancePath+"/ffprobe",parentData:data,parentDataProperty:"ffprobe",rootData,dynamicAnchors}))){
vErrors = vErrors === null ? validate76.errors : vErrors.concat(validate76.errors);
errors = vErrors.length;
}
}
if(data.node !== undefined){
if(!(validate79(data.node, {instancePath:instancePath+"/node",parentData:data,parentDataProperty:"node",rootData,dynamicAnchors}))){
vErrors = vErrors === null ? validate79.errors : vErrors.concat(validate79.errors);
errors = vErrors.length;
}
}
if(data.detector_argv_template_sha256 !== undefined){
let data8 = data.detector_argv_template_sha256;
if(typeof data8 === "string"){
if(!pattern6.test(data8)){
const err15 = {instancePath:instancePath+"/detector_argv_template_sha256",schemaPath:"#/$defs/sha256/pattern",keyword:"pattern",params:{pattern: "^[a-f0-9]{64}$"},message:"must match pattern \""+"^[a-f0-9]{64}$"+"\""};
if(vErrors === null){
vErrors = [err15];
}
else {
vErrors.push(err15);
}
errors++;
}
}
else {
const err16 = {instancePath:instancePath+"/detector_argv_template_sha256",schemaPath:"#/$defs/sha256/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err16];
}
else {
vErrors.push(err16);
}
errors++;
}
}
}
else {
const err17 = {instancePath,schemaPath:"#/type",keyword:"type",params:{type: "object"},message:"must be object"};
if(vErrors === null){
vErrors = [err17];
}
else {
vErrors.push(err17);
}
errors++;
}
validate71.errors = vErrors;
return errors === 0;
}
validate71.evaluated = {"props":true,"dynamicProps":false,"dynamicItems":false};

const schema127 = {"type":"object","additionalProperties":false,"required":["id","family","src","occurrence_index","occurrence_origin","occurrence_interval","event","context","screen_review_required","suggested_action","risk_flags","decision"],"properties":{"id":{"type":"string","pattern":"^semantic-[0-9]{4,}$"},"family":{"const":"semantic_event_review"},"src":{"$ref":"#/$defs/src"},"occurrence_index":{"type":"integer","minimum":0},"occurrence_origin":{"enum":["explicit_range","full_source"]},"occurrence_interval":{"$ref":"#/$defs/interval"},"event":{"$ref":"#/$defs/semanticEvent"},"context":{"$ref":"#/$defs/context"},"screen_review_required":{"const":true},"suggested_action":{"const":"review_drop_or_keep"},"risk_flags":{"type":"array","minItems":2,"uniqueItems":true,"items":{"$ref":"#/$defs/candidateRisk"}},"decision":{"const":"REVIEW_REQUIRED"}}};
const schema140 = {"enum":["UI_WAIT_UNRESOLVED","SCREEN_CONTEXT_MISSING","INFORMATION_RETENTION_REVIEW","PARTIAL_EVENT_OCCURRENCE"]};
const pattern30 = new RegExp("^semantic-[0-9]{4,}$", "u");
const schema129 = {"type":"object","additionalProperties":false,"required":["start","end"],"properties":{"start":{"$ref":"#/$defs/seconds"},"end":{"$ref":"#/$defs/seconds"}}};

function validate83(data, {instancePath="", parentData, parentDataProperty, rootData=data, dynamicAnchors={}}={}){
let vErrors = null;
let errors = 0;
const evaluated0 = validate83.evaluated;
if(evaluated0.dynamicProps){
evaluated0.props = undefined;
}
if(evaluated0.dynamicItems){
evaluated0.items = undefined;
}
if(data && typeof data == "object" && !Array.isArray(data)){
if(data.start === undefined){
const err0 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "start"},message:"must have required property '"+"start"+"'"};
if(vErrors === null){
vErrors = [err0];
}
else {
vErrors.push(err0);
}
errors++;
}
if(data.end === undefined){
const err1 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "end"},message:"must have required property '"+"end"+"'"};
if(vErrors === null){
vErrors = [err1];
}
else {
vErrors.push(err1);
}
errors++;
}
for(const key0 in data){
if(!((key0 === "start") || (key0 === "end"))){
const err2 = {instancePath,schemaPath:"#/additionalProperties",keyword:"additionalProperties",params:{additionalProperty: key0},message:"must NOT have additional properties"};
if(vErrors === null){
vErrors = [err2];
}
else {
vErrors.push(err2);
}
errors++;
}
}
if(data.start !== undefined){
let data0 = data.start;
if(typeof data0 == "number"){
if(data0 < 0 || isNaN(data0)){
const err3 = {instancePath:instancePath+"/start",schemaPath:"#/$defs/seconds/minimum",keyword:"minimum",params:{comparison: ">=", limit: 0},message:"must be >= 0"};
if(vErrors === null){
vErrors = [err3];
}
else {
vErrors.push(err3);
}
errors++;
}
}
else {
const err4 = {instancePath:instancePath+"/start",schemaPath:"#/$defs/seconds/type",keyword:"type",params:{type: "number"},message:"must be number"};
if(vErrors === null){
vErrors = [err4];
}
else {
vErrors.push(err4);
}
errors++;
}
}
if(data.end !== undefined){
let data1 = data.end;
if(typeof data1 == "number"){
if(data1 < 0 || isNaN(data1)){
const err5 = {instancePath:instancePath+"/end",schemaPath:"#/$defs/seconds/minimum",keyword:"minimum",params:{comparison: ">=", limit: 0},message:"must be >= 0"};
if(vErrors === null){
vErrors = [err5];
}
else {
vErrors.push(err5);
}
errors++;
}
}
else {
const err6 = {instancePath:instancePath+"/end",schemaPath:"#/$defs/seconds/type",keyword:"type",params:{type: "number"},message:"must be number"};
if(vErrors === null){
vErrors = [err6];
}
else {
vErrors.push(err6);
}
errors++;
}
}
}
else {
const err7 = {instancePath,schemaPath:"#/type",keyword:"type",params:{type: "object"},message:"must be object"};
if(vErrors === null){
vErrors = [err7];
}
else {
vErrors.push(err7);
}
errors++;
}
validate83.errors = vErrors;
return errors === 0;
}
validate83.evaluated = {"props":true,"dynamicProps":false,"dynamicItems":false};

const schema132 = {"type":"object","additionalProperties":false,"required":["index","type","event_original_interval","projected_interval","partial_event_occurrence"],"properties":{"index":{"type":"integer","minimum":0},"type":{"enum":["filler","trouble"]},"note":{"type":"string","minLength":1},"event_original_interval":{"$ref":"#/$defs/interval"},"projected_interval":{"$ref":"#/$defs/interval"},"partial_event_occurrence":{"type":"boolean"}}};

function validate85(data, {instancePath="", parentData, parentDataProperty, rootData=data, dynamicAnchors={}}={}){
let vErrors = null;
let errors = 0;
const evaluated0 = validate85.evaluated;
if(evaluated0.dynamicProps){
evaluated0.props = undefined;
}
if(evaluated0.dynamicItems){
evaluated0.items = undefined;
}
if(data && typeof data == "object" && !Array.isArray(data)){
if(data.index === undefined){
const err0 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "index"},message:"must have required property '"+"index"+"'"};
if(vErrors === null){
vErrors = [err0];
}
else {
vErrors.push(err0);
}
errors++;
}
if(data.type === undefined){
const err1 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "type"},message:"must have required property '"+"type"+"'"};
if(vErrors === null){
vErrors = [err1];
}
else {
vErrors.push(err1);
}
errors++;
}
if(data.event_original_interval === undefined){
const err2 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "event_original_interval"},message:"must have required property '"+"event_original_interval"+"'"};
if(vErrors === null){
vErrors = [err2];
}
else {
vErrors.push(err2);
}
errors++;
}
if(data.projected_interval === undefined){
const err3 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "projected_interval"},message:"must have required property '"+"projected_interval"+"'"};
if(vErrors === null){
vErrors = [err3];
}
else {
vErrors.push(err3);
}
errors++;
}
if(data.partial_event_occurrence === undefined){
const err4 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "partial_event_occurrence"},message:"must have required property '"+"partial_event_occurrence"+"'"};
if(vErrors === null){
vErrors = [err4];
}
else {
vErrors.push(err4);
}
errors++;
}
for(const key0 in data){
if(!((((((key0 === "index") || (key0 === "type")) || (key0 === "note")) || (key0 === "event_original_interval")) || (key0 === "projected_interval")) || (key0 === "partial_event_occurrence"))){
const err5 = {instancePath,schemaPath:"#/additionalProperties",keyword:"additionalProperties",params:{additionalProperty: key0},message:"must NOT have additional properties"};
if(vErrors === null){
vErrors = [err5];
}
else {
vErrors.push(err5);
}
errors++;
}
}
if(data.index !== undefined){
let data0 = data.index;
if(!((typeof data0 == "number") && (!(data0 % 1) && !isNaN(data0)))){
const err6 = {instancePath:instancePath+"/index",schemaPath:"#/properties/index/type",keyword:"type",params:{type: "integer"},message:"must be integer"};
if(vErrors === null){
vErrors = [err6];
}
else {
vErrors.push(err6);
}
errors++;
}
if(typeof data0 == "number"){
if(data0 < 0 || isNaN(data0)){
const err7 = {instancePath:instancePath+"/index",schemaPath:"#/properties/index/minimum",keyword:"minimum",params:{comparison: ">=", limit: 0},message:"must be >= 0"};
if(vErrors === null){
vErrors = [err7];
}
else {
vErrors.push(err7);
}
errors++;
}
}
}
if(data.type !== undefined){
let data1 = data.type;
if(!((data1 === "filler") || (data1 === "trouble"))){
const err8 = {instancePath:instancePath+"/type",schemaPath:"#/properties/type/enum",keyword:"enum",params:{allowedValues: schema132.properties.type.enum},message:"must be equal to one of the allowed values"};
if(vErrors === null){
vErrors = [err8];
}
else {
vErrors.push(err8);
}
errors++;
}
}
if(data.note !== undefined){
let data2 = data.note;
if(typeof data2 === "string"){
if(func1(data2) < 1){
const err9 = {instancePath:instancePath+"/note",schemaPath:"#/properties/note/minLength",keyword:"minLength",params:{limit: 1},message:"must NOT have fewer than 1 characters"};
if(vErrors === null){
vErrors = [err9];
}
else {
vErrors.push(err9);
}
errors++;
}
}
else {
const err10 = {instancePath:instancePath+"/note",schemaPath:"#/properties/note/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err10];
}
else {
vErrors.push(err10);
}
errors++;
}
}
if(data.event_original_interval !== undefined){
if(!(validate83(data.event_original_interval, {instancePath:instancePath+"/event_original_interval",parentData:data,parentDataProperty:"event_original_interval",rootData,dynamicAnchors}))){
vErrors = vErrors === null ? validate83.errors : vErrors.concat(validate83.errors);
errors = vErrors.length;
}
}
if(data.projected_interval !== undefined){
if(!(validate83(data.projected_interval, {instancePath:instancePath+"/projected_interval",parentData:data,parentDataProperty:"projected_interval",rootData,dynamicAnchors}))){
vErrors = vErrors === null ? validate83.errors : vErrors.concat(validate83.errors);
errors = vErrors.length;
}
}
if(data.partial_event_occurrence !== undefined){
if(typeof data.partial_event_occurrence !== "boolean"){
const err11 = {instancePath:instancePath+"/partial_event_occurrence",schemaPath:"#/properties/partial_event_occurrence/type",keyword:"type",params:{type: "boolean"},message:"must be boolean"};
if(vErrors === null){
vErrors = [err11];
}
else {
vErrors.push(err11);
}
errors++;
}
}
}
else {
const err12 = {instancePath,schemaPath:"#/type",keyword:"type",params:{type: "object"},message:"must be object"};
if(vErrors === null){
vErrors = [err12];
}
else {
vErrors.push(err12);
}
errors++;
}
validate85.errors = vErrors;
return errors === 0;
}
validate85.evaluated = {"props":true,"dynamicProps":false,"dynamicItems":false};

const schema133 = {"type":"object","additionalProperties":false,"required":["start","end","previous_word","next_word","chapter_event_indexes","keyframe_input_indexes"],"properties":{"start":{"$ref":"#/$defs/seconds"},"end":{"$ref":"#/$defs/seconds"},"previous_word":{"$ref":"#/$defs/nullableWordRef"},"next_word":{"$ref":"#/$defs/nullableWordRef"},"chapter_event_indexes":{"type":"array","items":{"type":"integer","minimum":0}},"keyframe_input_indexes":{"type":"array","items":{"type":"integer","minimum":0}}}};
const schema136 = {"oneOf":[{"type":"null"},{"$ref":"#/$defs/wordRef"}]};
const schema137 = {"type":"object","additionalProperties":false,"required":["segment_index","word_index","start","end","text"],"properties":{"segment_index":{"type":"integer","minimum":0},"word_index":{"type":"integer","minimum":0},"start":{"$ref":"#/$defs/seconds"},"end":{"$ref":"#/$defs/seconds"},"text":{"type":"string","minLength":1}}};

function validate91(data, {instancePath="", parentData, parentDataProperty, rootData=data, dynamicAnchors={}}={}){
let vErrors = null;
let errors = 0;
const evaluated0 = validate91.evaluated;
if(evaluated0.dynamicProps){
evaluated0.props = undefined;
}
if(evaluated0.dynamicItems){
evaluated0.items = undefined;
}
if(data && typeof data == "object" && !Array.isArray(data)){
if(data.segment_index === undefined){
const err0 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "segment_index"},message:"must have required property '"+"segment_index"+"'"};
if(vErrors === null){
vErrors = [err0];
}
else {
vErrors.push(err0);
}
errors++;
}
if(data.word_index === undefined){
const err1 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "word_index"},message:"must have required property '"+"word_index"+"'"};
if(vErrors === null){
vErrors = [err1];
}
else {
vErrors.push(err1);
}
errors++;
}
if(data.start === undefined){
const err2 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "start"},message:"must have required property '"+"start"+"'"};
if(vErrors === null){
vErrors = [err2];
}
else {
vErrors.push(err2);
}
errors++;
}
if(data.end === undefined){
const err3 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "end"},message:"must have required property '"+"end"+"'"};
if(vErrors === null){
vErrors = [err3];
}
else {
vErrors.push(err3);
}
errors++;
}
if(data.text === undefined){
const err4 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "text"},message:"must have required property '"+"text"+"'"};
if(vErrors === null){
vErrors = [err4];
}
else {
vErrors.push(err4);
}
errors++;
}
for(const key0 in data){
if(!(((((key0 === "segment_index") || (key0 === "word_index")) || (key0 === "start")) || (key0 === "end")) || (key0 === "text"))){
const err5 = {instancePath,schemaPath:"#/additionalProperties",keyword:"additionalProperties",params:{additionalProperty: key0},message:"must NOT have additional properties"};
if(vErrors === null){
vErrors = [err5];
}
else {
vErrors.push(err5);
}
errors++;
}
}
if(data.segment_index !== undefined){
let data0 = data.segment_index;
if(!((typeof data0 == "number") && (!(data0 % 1) && !isNaN(data0)))){
const err6 = {instancePath:instancePath+"/segment_index",schemaPath:"#/properties/segment_index/type",keyword:"type",params:{type: "integer"},message:"must be integer"};
if(vErrors === null){
vErrors = [err6];
}
else {
vErrors.push(err6);
}
errors++;
}
if(typeof data0 == "number"){
if(data0 < 0 || isNaN(data0)){
const err7 = {instancePath:instancePath+"/segment_index",schemaPath:"#/properties/segment_index/minimum",keyword:"minimum",params:{comparison: ">=", limit: 0},message:"must be >= 0"};
if(vErrors === null){
vErrors = [err7];
}
else {
vErrors.push(err7);
}
errors++;
}
}
}
if(data.word_index !== undefined){
let data1 = data.word_index;
if(!((typeof data1 == "number") && (!(data1 % 1) && !isNaN(data1)))){
const err8 = {instancePath:instancePath+"/word_index",schemaPath:"#/properties/word_index/type",keyword:"type",params:{type: "integer"},message:"must be integer"};
if(vErrors === null){
vErrors = [err8];
}
else {
vErrors.push(err8);
}
errors++;
}
if(typeof data1 == "number"){
if(data1 < 0 || isNaN(data1)){
const err9 = {instancePath:instancePath+"/word_index",schemaPath:"#/properties/word_index/minimum",keyword:"minimum",params:{comparison: ">=", limit: 0},message:"must be >= 0"};
if(vErrors === null){
vErrors = [err9];
}
else {
vErrors.push(err9);
}
errors++;
}
}
}
if(data.start !== undefined){
let data2 = data.start;
if(typeof data2 == "number"){
if(data2 < 0 || isNaN(data2)){
const err10 = {instancePath:instancePath+"/start",schemaPath:"#/$defs/seconds/minimum",keyword:"minimum",params:{comparison: ">=", limit: 0},message:"must be >= 0"};
if(vErrors === null){
vErrors = [err10];
}
else {
vErrors.push(err10);
}
errors++;
}
}
else {
const err11 = {instancePath:instancePath+"/start",schemaPath:"#/$defs/seconds/type",keyword:"type",params:{type: "number"},message:"must be number"};
if(vErrors === null){
vErrors = [err11];
}
else {
vErrors.push(err11);
}
errors++;
}
}
if(data.end !== undefined){
let data3 = data.end;
if(typeof data3 == "number"){
if(data3 < 0 || isNaN(data3)){
const err12 = {instancePath:instancePath+"/end",schemaPath:"#/$defs/seconds/minimum",keyword:"minimum",params:{comparison: ">=", limit: 0},message:"must be >= 0"};
if(vErrors === null){
vErrors = [err12];
}
else {
vErrors.push(err12);
}
errors++;
}
}
else {
const err13 = {instancePath:instancePath+"/end",schemaPath:"#/$defs/seconds/type",keyword:"type",params:{type: "number"},message:"must be number"};
if(vErrors === null){
vErrors = [err13];
}
else {
vErrors.push(err13);
}
errors++;
}
}
if(data.text !== undefined){
let data4 = data.text;
if(typeof data4 === "string"){
if(func1(data4) < 1){
const err14 = {instancePath:instancePath+"/text",schemaPath:"#/properties/text/minLength",keyword:"minLength",params:{limit: 1},message:"must NOT have fewer than 1 characters"};
if(vErrors === null){
vErrors = [err14];
}
else {
vErrors.push(err14);
}
errors++;
}
}
else {
const err15 = {instancePath:instancePath+"/text",schemaPath:"#/properties/text/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err15];
}
else {
vErrors.push(err15);
}
errors++;
}
}
}
else {
const err16 = {instancePath,schemaPath:"#/type",keyword:"type",params:{type: "object"},message:"must be object"};
if(vErrors === null){
vErrors = [err16];
}
else {
vErrors.push(err16);
}
errors++;
}
validate91.errors = vErrors;
return errors === 0;
}
validate91.evaluated = {"props":true,"dynamicProps":false,"dynamicItems":false};


function validate90(data, {instancePath="", parentData, parentDataProperty, rootData=data, dynamicAnchors={}}={}){
let vErrors = null;
let errors = 0;
const evaluated0 = validate90.evaluated;
if(evaluated0.dynamicProps){
evaluated0.props = undefined;
}
if(evaluated0.dynamicItems){
evaluated0.items = undefined;
}
const _errs0 = errors;
let valid0 = false;
let passing0 = null;
const _errs1 = errors;
if(data !== null){
const err0 = {instancePath,schemaPath:"#/oneOf/0/type",keyword:"type",params:{type: "null"},message:"must be null"};
if(vErrors === null){
vErrors = [err0];
}
else {
vErrors.push(err0);
}
errors++;
}
var _valid0 = _errs1 === errors;
if(_valid0){
valid0 = true;
passing0 = 0;
}
const _errs3 = errors;
if(!(validate91(data, {instancePath,parentData,parentDataProperty,rootData,dynamicAnchors}))){
vErrors = vErrors === null ? validate91.errors : vErrors.concat(validate91.errors);
errors = vErrors.length;
}
var _valid0 = _errs3 === errors;
if(_valid0 && valid0){
valid0 = false;
passing0 = [passing0, 1];
}
else {
if(_valid0){
valid0 = true;
passing0 = 1;
var props0 = true;
}
}
if(!valid0){
const err1 = {instancePath,schemaPath:"#/oneOf",keyword:"oneOf",params:{passingSchemas: passing0},message:"must match exactly one schema in oneOf"};
if(vErrors === null){
vErrors = [err1];
}
else {
vErrors.push(err1);
}
errors++;
}
else {
errors = _errs0;
if(vErrors !== null){
if(_errs0){
vErrors.length = _errs0;
}
else {
vErrors = null;
}
}
}
validate90.errors = vErrors;
evaluated0.props = props0;
return errors === 0;
}
validate90.evaluated = {"dynamicProps":true,"dynamicItems":false};


function validate89(data, {instancePath="", parentData, parentDataProperty, rootData=data, dynamicAnchors={}}={}){
let vErrors = null;
let errors = 0;
const evaluated0 = validate89.evaluated;
if(evaluated0.dynamicProps){
evaluated0.props = undefined;
}
if(evaluated0.dynamicItems){
evaluated0.items = undefined;
}
if(data && typeof data == "object" && !Array.isArray(data)){
if(data.start === undefined){
const err0 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "start"},message:"must have required property '"+"start"+"'"};
if(vErrors === null){
vErrors = [err0];
}
else {
vErrors.push(err0);
}
errors++;
}
if(data.end === undefined){
const err1 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "end"},message:"must have required property '"+"end"+"'"};
if(vErrors === null){
vErrors = [err1];
}
else {
vErrors.push(err1);
}
errors++;
}
if(data.previous_word === undefined){
const err2 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "previous_word"},message:"must have required property '"+"previous_word"+"'"};
if(vErrors === null){
vErrors = [err2];
}
else {
vErrors.push(err2);
}
errors++;
}
if(data.next_word === undefined){
const err3 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "next_word"},message:"must have required property '"+"next_word"+"'"};
if(vErrors === null){
vErrors = [err3];
}
else {
vErrors.push(err3);
}
errors++;
}
if(data.chapter_event_indexes === undefined){
const err4 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "chapter_event_indexes"},message:"must have required property '"+"chapter_event_indexes"+"'"};
if(vErrors === null){
vErrors = [err4];
}
else {
vErrors.push(err4);
}
errors++;
}
if(data.keyframe_input_indexes === undefined){
const err5 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "keyframe_input_indexes"},message:"must have required property '"+"keyframe_input_indexes"+"'"};
if(vErrors === null){
vErrors = [err5];
}
else {
vErrors.push(err5);
}
errors++;
}
for(const key0 in data){
if(!((((((key0 === "start") || (key0 === "end")) || (key0 === "previous_word")) || (key0 === "next_word")) || (key0 === "chapter_event_indexes")) || (key0 === "keyframe_input_indexes"))){
const err6 = {instancePath,schemaPath:"#/additionalProperties",keyword:"additionalProperties",params:{additionalProperty: key0},message:"must NOT have additional properties"};
if(vErrors === null){
vErrors = [err6];
}
else {
vErrors.push(err6);
}
errors++;
}
}
if(data.start !== undefined){
let data0 = data.start;
if(typeof data0 == "number"){
if(data0 < 0 || isNaN(data0)){
const err7 = {instancePath:instancePath+"/start",schemaPath:"#/$defs/seconds/minimum",keyword:"minimum",params:{comparison: ">=", limit: 0},message:"must be >= 0"};
if(vErrors === null){
vErrors = [err7];
}
else {
vErrors.push(err7);
}
errors++;
}
}
else {
const err8 = {instancePath:instancePath+"/start",schemaPath:"#/$defs/seconds/type",keyword:"type",params:{type: "number"},message:"must be number"};
if(vErrors === null){
vErrors = [err8];
}
else {
vErrors.push(err8);
}
errors++;
}
}
if(data.end !== undefined){
let data1 = data.end;
if(typeof data1 == "number"){
if(data1 < 0 || isNaN(data1)){
const err9 = {instancePath:instancePath+"/end",schemaPath:"#/$defs/seconds/minimum",keyword:"minimum",params:{comparison: ">=", limit: 0},message:"must be >= 0"};
if(vErrors === null){
vErrors = [err9];
}
else {
vErrors.push(err9);
}
errors++;
}
}
else {
const err10 = {instancePath:instancePath+"/end",schemaPath:"#/$defs/seconds/type",keyword:"type",params:{type: "number"},message:"must be number"};
if(vErrors === null){
vErrors = [err10];
}
else {
vErrors.push(err10);
}
errors++;
}
}
if(data.previous_word !== undefined){
if(!(validate90(data.previous_word, {instancePath:instancePath+"/previous_word",parentData:data,parentDataProperty:"previous_word",rootData,dynamicAnchors}))){
vErrors = vErrors === null ? validate90.errors : vErrors.concat(validate90.errors);
errors = vErrors.length;
}
}
if(data.next_word !== undefined){
if(!(validate90(data.next_word, {instancePath:instancePath+"/next_word",parentData:data,parentDataProperty:"next_word",rootData,dynamicAnchors}))){
vErrors = vErrors === null ? validate90.errors : vErrors.concat(validate90.errors);
errors = vErrors.length;
}
}
if(data.chapter_event_indexes !== undefined){
let data4 = data.chapter_event_indexes;
if(Array.isArray(data4)){
const len0 = data4.length;
for(let i0=0; i0<len0; i0++){
let data5 = data4[i0];
if(!((typeof data5 == "number") && (!(data5 % 1) && !isNaN(data5)))){
const err11 = {instancePath:instancePath+"/chapter_event_indexes/" + i0,schemaPath:"#/properties/chapter_event_indexes/items/type",keyword:"type",params:{type: "integer"},message:"must be integer"};
if(vErrors === null){
vErrors = [err11];
}
else {
vErrors.push(err11);
}
errors++;
}
if(typeof data5 == "number"){
if(data5 < 0 || isNaN(data5)){
const err12 = {instancePath:instancePath+"/chapter_event_indexes/" + i0,schemaPath:"#/properties/chapter_event_indexes/items/minimum",keyword:"minimum",params:{comparison: ">=", limit: 0},message:"must be >= 0"};
if(vErrors === null){
vErrors = [err12];
}
else {
vErrors.push(err12);
}
errors++;
}
}
}
}
else {
const err13 = {instancePath:instancePath+"/chapter_event_indexes",schemaPath:"#/properties/chapter_event_indexes/type",keyword:"type",params:{type: "array"},message:"must be array"};
if(vErrors === null){
vErrors = [err13];
}
else {
vErrors.push(err13);
}
errors++;
}
}
if(data.keyframe_input_indexes !== undefined){
let data6 = data.keyframe_input_indexes;
if(Array.isArray(data6)){
const len1 = data6.length;
for(let i1=0; i1<len1; i1++){
let data7 = data6[i1];
if(!((typeof data7 == "number") && (!(data7 % 1) && !isNaN(data7)))){
const err14 = {instancePath:instancePath+"/keyframe_input_indexes/" + i1,schemaPath:"#/properties/keyframe_input_indexes/items/type",keyword:"type",params:{type: "integer"},message:"must be integer"};
if(vErrors === null){
vErrors = [err14];
}
else {
vErrors.push(err14);
}
errors++;
}
if(typeof data7 == "number"){
if(data7 < 0 || isNaN(data7)){
const err15 = {instancePath:instancePath+"/keyframe_input_indexes/" + i1,schemaPath:"#/properties/keyframe_input_indexes/items/minimum",keyword:"minimum",params:{comparison: ">=", limit: 0},message:"must be >= 0"};
if(vErrors === null){
vErrors = [err15];
}
else {
vErrors.push(err15);
}
errors++;
}
}
}
}
else {
const err16 = {instancePath:instancePath+"/keyframe_input_indexes",schemaPath:"#/properties/keyframe_input_indexes/type",keyword:"type",params:{type: "array"},message:"must be array"};
if(vErrors === null){
vErrors = [err16];
}
else {
vErrors.push(err16);
}
errors++;
}
}
}
else {
const err17 = {instancePath,schemaPath:"#/type",keyword:"type",params:{type: "object"},message:"must be object"};
if(vErrors === null){
vErrors = [err17];
}
else {
vErrors.push(err17);
}
errors++;
}
validate89.errors = vErrors;
return errors === 0;
}
validate89.evaluated = {"props":true,"dynamicProps":false,"dynamicItems":false};


function validate82(data, {instancePath="", parentData, parentDataProperty, rootData=data, dynamicAnchors={}}={}){
let vErrors = null;
let errors = 0;
const evaluated0 = validate82.evaluated;
if(evaluated0.dynamicProps){
evaluated0.props = undefined;
}
if(evaluated0.dynamicItems){
evaluated0.items = undefined;
}
if(data && typeof data == "object" && !Array.isArray(data)){
if(data.id === undefined){
const err0 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "id"},message:"must have required property '"+"id"+"'"};
if(vErrors === null){
vErrors = [err0];
}
else {
vErrors.push(err0);
}
errors++;
}
if(data.family === undefined){
const err1 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "family"},message:"must have required property '"+"family"+"'"};
if(vErrors === null){
vErrors = [err1];
}
else {
vErrors.push(err1);
}
errors++;
}
if(data.src === undefined){
const err2 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "src"},message:"must have required property '"+"src"+"'"};
if(vErrors === null){
vErrors = [err2];
}
else {
vErrors.push(err2);
}
errors++;
}
if(data.occurrence_index === undefined){
const err3 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "occurrence_index"},message:"must have required property '"+"occurrence_index"+"'"};
if(vErrors === null){
vErrors = [err3];
}
else {
vErrors.push(err3);
}
errors++;
}
if(data.occurrence_origin === undefined){
const err4 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "occurrence_origin"},message:"must have required property '"+"occurrence_origin"+"'"};
if(vErrors === null){
vErrors = [err4];
}
else {
vErrors.push(err4);
}
errors++;
}
if(data.occurrence_interval === undefined){
const err5 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "occurrence_interval"},message:"must have required property '"+"occurrence_interval"+"'"};
if(vErrors === null){
vErrors = [err5];
}
else {
vErrors.push(err5);
}
errors++;
}
if(data.event === undefined){
const err6 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "event"},message:"must have required property '"+"event"+"'"};
if(vErrors === null){
vErrors = [err6];
}
else {
vErrors.push(err6);
}
errors++;
}
if(data.context === undefined){
const err7 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "context"},message:"must have required property '"+"context"+"'"};
if(vErrors === null){
vErrors = [err7];
}
else {
vErrors.push(err7);
}
errors++;
}
if(data.screen_review_required === undefined){
const err8 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "screen_review_required"},message:"must have required property '"+"screen_review_required"+"'"};
if(vErrors === null){
vErrors = [err8];
}
else {
vErrors.push(err8);
}
errors++;
}
if(data.suggested_action === undefined){
const err9 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "suggested_action"},message:"must have required property '"+"suggested_action"+"'"};
if(vErrors === null){
vErrors = [err9];
}
else {
vErrors.push(err9);
}
errors++;
}
if(data.risk_flags === undefined){
const err10 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "risk_flags"},message:"must have required property '"+"risk_flags"+"'"};
if(vErrors === null){
vErrors = [err10];
}
else {
vErrors.push(err10);
}
errors++;
}
if(data.decision === undefined){
const err11 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "decision"},message:"must have required property '"+"decision"+"'"};
if(vErrors === null){
vErrors = [err11];
}
else {
vErrors.push(err11);
}
errors++;
}
for(const key0 in data){
if(!(func20.call(schema127.properties, key0))){
const err12 = {instancePath,schemaPath:"#/additionalProperties",keyword:"additionalProperties",params:{additionalProperty: key0},message:"must NOT have additional properties"};
if(vErrors === null){
vErrors = [err12];
}
else {
vErrors.push(err12);
}
errors++;
}
}
if(data.id !== undefined){
let data0 = data.id;
if(typeof data0 === "string"){
if(!pattern30.test(data0)){
const err13 = {instancePath:instancePath+"/id",schemaPath:"#/properties/id/pattern",keyword:"pattern",params:{pattern: "^semantic-[0-9]{4,}$"},message:"must match pattern \""+"^semantic-[0-9]{4,}$"+"\""};
if(vErrors === null){
vErrors = [err13];
}
else {
vErrors.push(err13);
}
errors++;
}
}
else {
const err14 = {instancePath:instancePath+"/id",schemaPath:"#/properties/id/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err14];
}
else {
vErrors.push(err14);
}
errors++;
}
}
if(data.family !== undefined){
if("semantic_event_review" !== data.family){
const err15 = {instancePath:instancePath+"/family",schemaPath:"#/properties/family/const",keyword:"const",params:{allowedValue: "semantic_event_review"},message:"must be equal to constant"};
if(vErrors === null){
vErrors = [err15];
}
else {
vErrors.push(err15);
}
errors++;
}
}
if(data.src !== undefined){
let data2 = data.src;
const _errs7 = errors;
let valid2 = false;
let passing0 = null;
const _errs8 = errors;
if(data2 !== null){
const err16 = {instancePath:instancePath+"/src",schemaPath:"#/$defs/src/oneOf/0/type",keyword:"type",params:{type: "null"},message:"must be null"};
if(vErrors === null){
vErrors = [err16];
}
else {
vErrors.push(err16);
}
errors++;
}
var _valid0 = _errs8 === errors;
if(_valid0){
valid2 = true;
passing0 = 0;
}
const _errs10 = errors;
if(typeof data2 === "string"){
if(func1(data2) < 1){
const err17 = {instancePath:instancePath+"/src",schemaPath:"#/$defs/src/oneOf/1/minLength",keyword:"minLength",params:{limit: 1},message:"must NOT have fewer than 1 characters"};
if(vErrors === null){
vErrors = [err17];
}
else {
vErrors.push(err17);
}
errors++;
}
if(!pattern4.test(data2)){
const err18 = {instancePath:instancePath+"/src",schemaPath:"#/$defs/src/oneOf/1/pattern",keyword:"pattern",params:{pattern: "\\S"},message:"must match pattern \""+"\\S"+"\""};
if(vErrors === null){
vErrors = [err18];
}
else {
vErrors.push(err18);
}
errors++;
}
}
else {
const err19 = {instancePath:instancePath+"/src",schemaPath:"#/$defs/src/oneOf/1/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err19];
}
else {
vErrors.push(err19);
}
errors++;
}
var _valid0 = _errs10 === errors;
if(_valid0 && valid2){
valid2 = false;
passing0 = [passing0, 1];
}
else {
if(_valid0){
valid2 = true;
passing0 = 1;
}
}
if(!valid2){
const err20 = {instancePath:instancePath+"/src",schemaPath:"#/$defs/src/oneOf",keyword:"oneOf",params:{passingSchemas: passing0},message:"must match exactly one schema in oneOf"};
if(vErrors === null){
vErrors = [err20];
}
else {
vErrors.push(err20);
}
errors++;
}
else {
errors = _errs7;
if(vErrors !== null){
if(_errs7){
vErrors.length = _errs7;
}
else {
vErrors = null;
}
}
}
}
if(data.occurrence_index !== undefined){
let data3 = data.occurrence_index;
if(!((typeof data3 == "number") && (!(data3 % 1) && !isNaN(data3)))){
const err21 = {instancePath:instancePath+"/occurrence_index",schemaPath:"#/properties/occurrence_index/type",keyword:"type",params:{type: "integer"},message:"must be integer"};
if(vErrors === null){
vErrors = [err21];
}
else {
vErrors.push(err21);
}
errors++;
}
if(typeof data3 == "number"){
if(data3 < 0 || isNaN(data3)){
const err22 = {instancePath:instancePath+"/occurrence_index",schemaPath:"#/properties/occurrence_index/minimum",keyword:"minimum",params:{comparison: ">=", limit: 0},message:"must be >= 0"};
if(vErrors === null){
vErrors = [err22];
}
else {
vErrors.push(err22);
}
errors++;
}
}
}
if(data.occurrence_origin !== undefined){
let data4 = data.occurrence_origin;
if(!((data4 === "explicit_range") || (data4 === "full_source"))){
const err23 = {instancePath:instancePath+"/occurrence_origin",schemaPath:"#/properties/occurrence_origin/enum",keyword:"enum",params:{allowedValues: schema127.properties.occurrence_origin.enum},message:"must be equal to one of the allowed values"};
if(vErrors === null){
vErrors = [err23];
}
else {
vErrors.push(err23);
}
errors++;
}
}
if(data.occurrence_interval !== undefined){
if(!(validate83(data.occurrence_interval, {instancePath:instancePath+"/occurrence_interval",parentData:data,parentDataProperty:"occurrence_interval",rootData,dynamicAnchors}))){
vErrors = vErrors === null ? validate83.errors : vErrors.concat(validate83.errors);
errors = vErrors.length;
}
}
if(data.event !== undefined){
if(!(validate85(data.event, {instancePath:instancePath+"/event",parentData:data,parentDataProperty:"event",rootData,dynamicAnchors}))){
vErrors = vErrors === null ? validate85.errors : vErrors.concat(validate85.errors);
errors = vErrors.length;
}
}
if(data.context !== undefined){
if(!(validate89(data.context, {instancePath:instancePath+"/context",parentData:data,parentDataProperty:"context",rootData,dynamicAnchors}))){
vErrors = vErrors === null ? validate89.errors : vErrors.concat(validate89.errors);
errors = vErrors.length;
}
}
if(data.screen_review_required !== undefined){
if(true !== data.screen_review_required){
const err24 = {instancePath:instancePath+"/screen_review_required",schemaPath:"#/properties/screen_review_required/const",keyword:"const",params:{allowedValue: true},message:"must be equal to constant"};
if(vErrors === null){
vErrors = [err24];
}
else {
vErrors.push(err24);
}
errors++;
}
}
if(data.suggested_action !== undefined){
if("review_drop_or_keep" !== data.suggested_action){
const err25 = {instancePath:instancePath+"/suggested_action",schemaPath:"#/properties/suggested_action/const",keyword:"const",params:{allowedValue: "review_drop_or_keep"},message:"must be equal to constant"};
if(vErrors === null){
vErrors = [err25];
}
else {
vErrors.push(err25);
}
errors++;
}
}
if(data.risk_flags !== undefined){
let data10 = data.risk_flags;
if(Array.isArray(data10)){
if(data10.length < 2){
const err26 = {instancePath:instancePath+"/risk_flags",schemaPath:"#/properties/risk_flags/minItems",keyword:"minItems",params:{limit: 2},message:"must NOT have fewer than 2 items"};
if(vErrors === null){
vErrors = [err26];
}
else {
vErrors.push(err26);
}
errors++;
}
const len0 = data10.length;
for(let i0=0; i0<len0; i0++){
let data11 = data10[i0];
if(!((((data11 === "UI_WAIT_UNRESOLVED") || (data11 === "SCREEN_CONTEXT_MISSING")) || (data11 === "INFORMATION_RETENTION_REVIEW")) || (data11 === "PARTIAL_EVENT_OCCURRENCE"))){
const err27 = {instancePath:instancePath+"/risk_flags/" + i0,schemaPath:"#/$defs/candidateRisk/enum",keyword:"enum",params:{allowedValues: schema140.enum},message:"must be equal to one of the allowed values"};
if(vErrors === null){
vErrors = [err27];
}
else {
vErrors.push(err27);
}
errors++;
}
}
let i1 = data10.length;
let j0;
if(i1 > 1){
outer0:
for(;i1--;){
for(j0 = i1; j0--;){
if(func0(data10[i1], data10[j0])){
const err28 = {instancePath:instancePath+"/risk_flags",schemaPath:"#/properties/risk_flags/uniqueItems",keyword:"uniqueItems",params:{i: i1, j: j0},message:"must NOT have duplicate items (items ## "+j0+" and "+i1+" are identical)"};
if(vErrors === null){
vErrors = [err28];
}
else {
vErrors.push(err28);
}
errors++;
break outer0;
}
}
}
}
}
else {
const err29 = {instancePath:instancePath+"/risk_flags",schemaPath:"#/properties/risk_flags/type",keyword:"type",params:{type: "array"},message:"must be array"};
if(vErrors === null){
vErrors = [err29];
}
else {
vErrors.push(err29);
}
errors++;
}
}
if(data.decision !== undefined){
if("REVIEW_REQUIRED" !== data.decision){
const err30 = {instancePath:instancePath+"/decision",schemaPath:"#/properties/decision/const",keyword:"const",params:{allowedValue: "REVIEW_REQUIRED"},message:"must be equal to constant"};
if(vErrors === null){
vErrors = [err30];
}
else {
vErrors.push(err30);
}
errors++;
}
}
}
else {
const err31 = {instancePath,schemaPath:"#/type",keyword:"type",params:{type: "object"},message:"must be object"};
if(vErrors === null){
vErrors = [err31];
}
else {
vErrors.push(err31);
}
errors++;
}
validate82.errors = vErrors;
return errors === 0;
}
validate82.evaluated = {"props":true,"dynamicProps":false,"dynamicItems":false};

const schema141 = {"type":"object","additionalProperties":false,"required":["id","family","src","occurrence_index","occurrence_origin","occurrence_interval","source_interval","classification","classification_basis","context","proposal","screen_review_required","risk_flags","decision"],"properties":{"id":{"type":"string","pattern":"^pause-[0-9]{4,}$"},"family":{"const":"pause_shortening_review"},"src":{"$ref":"#/$defs/src"},"occurrence_index":{"type":"integer","minimum":0},"occurrence_origin":{"enum":["explicit_range","full_source"]},"occurrence_interval":{"$ref":"#/$defs/interval"},"source_interval":{"$ref":"#/$defs/interval"},"classification":{"enum":["within_sentence","sentence_end","topic_transition"]},"classification_basis":{"$ref":"#/$defs/classificationBasis"},"context":{"$ref":"#/$defs/context"},"proposal":{"$ref":"#/$defs/pauseProposal"},"screen_review_required":{"const":true},"risk_flags":{"type":"array","minItems":1,"uniqueItems":true,"items":{"$ref":"#/$defs/candidateRisk"}},"decision":{"const":"REVIEW_REQUIRED"}}};
const schema143 = {"oneOf":[{"type":"object","additionalProperties":false,"required":["kind","event_index"],"properties":{"kind":{"const":"chapter_event"},"event_index":{"type":"integer","minimum":0}}},{"type":"object","additionalProperties":false,"required":["kind","segment_index","terminal"],"properties":{"kind":{"const":"sentence_terminal"},"segment_index":{"type":"integer","minimum":0},"terminal":{"type":"string","pattern":"^[。！？!?]$"}}},{"type":"object","additionalProperties":false,"required":["kind"],"properties":{"kind":{"const":"default_within_sentence"}}}]};
const pattern32 = new RegExp("^pause-[0-9]{4,}$", "u");
const pattern34 = new RegExp("^[。！？!?]$", "u");
const schema144 = {"type":"object","additionalProperties":false,"required":["fps","target_retained_seconds","raw_remove_start","raw_remove_end","remove_start_frame","remove_end_frame","remove_start","remove_end","actual_retained_seconds"],"properties":{"fps":{"const":30},"target_retained_seconds":{"enum":[0.1,0.166667,0.3]},"raw_remove_start":{"$ref":"#/$defs/seconds"},"raw_remove_end":{"$ref":"#/$defs/seconds"},"remove_start_frame":{"type":"integer","minimum":0},"remove_end_frame":{"type":"integer","minimum":0},"remove_start":{"$ref":"#/$defs/seconds"},"remove_end":{"$ref":"#/$defs/seconds"},"actual_retained_seconds":{"$ref":"#/$defs/seconds"}}};

function validate101(data, {instancePath="", parentData, parentDataProperty, rootData=data, dynamicAnchors={}}={}){
let vErrors = null;
let errors = 0;
const evaluated0 = validate101.evaluated;
if(evaluated0.dynamicProps){
evaluated0.props = undefined;
}
if(evaluated0.dynamicItems){
evaluated0.items = undefined;
}
if(data && typeof data == "object" && !Array.isArray(data)){
if(data.fps === undefined){
const err0 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "fps"},message:"must have required property '"+"fps"+"'"};
if(vErrors === null){
vErrors = [err0];
}
else {
vErrors.push(err0);
}
errors++;
}
if(data.target_retained_seconds === undefined){
const err1 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "target_retained_seconds"},message:"must have required property '"+"target_retained_seconds"+"'"};
if(vErrors === null){
vErrors = [err1];
}
else {
vErrors.push(err1);
}
errors++;
}
if(data.raw_remove_start === undefined){
const err2 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "raw_remove_start"},message:"must have required property '"+"raw_remove_start"+"'"};
if(vErrors === null){
vErrors = [err2];
}
else {
vErrors.push(err2);
}
errors++;
}
if(data.raw_remove_end === undefined){
const err3 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "raw_remove_end"},message:"must have required property '"+"raw_remove_end"+"'"};
if(vErrors === null){
vErrors = [err3];
}
else {
vErrors.push(err3);
}
errors++;
}
if(data.remove_start_frame === undefined){
const err4 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "remove_start_frame"},message:"must have required property '"+"remove_start_frame"+"'"};
if(vErrors === null){
vErrors = [err4];
}
else {
vErrors.push(err4);
}
errors++;
}
if(data.remove_end_frame === undefined){
const err5 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "remove_end_frame"},message:"must have required property '"+"remove_end_frame"+"'"};
if(vErrors === null){
vErrors = [err5];
}
else {
vErrors.push(err5);
}
errors++;
}
if(data.remove_start === undefined){
const err6 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "remove_start"},message:"must have required property '"+"remove_start"+"'"};
if(vErrors === null){
vErrors = [err6];
}
else {
vErrors.push(err6);
}
errors++;
}
if(data.remove_end === undefined){
const err7 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "remove_end"},message:"must have required property '"+"remove_end"+"'"};
if(vErrors === null){
vErrors = [err7];
}
else {
vErrors.push(err7);
}
errors++;
}
if(data.actual_retained_seconds === undefined){
const err8 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "actual_retained_seconds"},message:"must have required property '"+"actual_retained_seconds"+"'"};
if(vErrors === null){
vErrors = [err8];
}
else {
vErrors.push(err8);
}
errors++;
}
for(const key0 in data){
if(!(func20.call(schema144.properties, key0))){
const err9 = {instancePath,schemaPath:"#/additionalProperties",keyword:"additionalProperties",params:{additionalProperty: key0},message:"must NOT have additional properties"};
if(vErrors === null){
vErrors = [err9];
}
else {
vErrors.push(err9);
}
errors++;
}
}
if(data.fps !== undefined){
if(30 !== data.fps){
const err10 = {instancePath:instancePath+"/fps",schemaPath:"#/properties/fps/const",keyword:"const",params:{allowedValue: 30},message:"must be equal to constant"};
if(vErrors === null){
vErrors = [err10];
}
else {
vErrors.push(err10);
}
errors++;
}
}
if(data.target_retained_seconds !== undefined){
let data1 = data.target_retained_seconds;
if(!(((data1 === 0.1) || (data1 === 0.166667)) || (data1 === 0.3))){
const err11 = {instancePath:instancePath+"/target_retained_seconds",schemaPath:"#/properties/target_retained_seconds/enum",keyword:"enum",params:{allowedValues: schema144.properties.target_retained_seconds.enum},message:"must be equal to one of the allowed values"};
if(vErrors === null){
vErrors = [err11];
}
else {
vErrors.push(err11);
}
errors++;
}
}
if(data.raw_remove_start !== undefined){
let data2 = data.raw_remove_start;
if(typeof data2 == "number"){
if(data2 < 0 || isNaN(data2)){
const err12 = {instancePath:instancePath+"/raw_remove_start",schemaPath:"#/$defs/seconds/minimum",keyword:"minimum",params:{comparison: ">=", limit: 0},message:"must be >= 0"};
if(vErrors === null){
vErrors = [err12];
}
else {
vErrors.push(err12);
}
errors++;
}
}
else {
const err13 = {instancePath:instancePath+"/raw_remove_start",schemaPath:"#/$defs/seconds/type",keyword:"type",params:{type: "number"},message:"must be number"};
if(vErrors === null){
vErrors = [err13];
}
else {
vErrors.push(err13);
}
errors++;
}
}
if(data.raw_remove_end !== undefined){
let data3 = data.raw_remove_end;
if(typeof data3 == "number"){
if(data3 < 0 || isNaN(data3)){
const err14 = {instancePath:instancePath+"/raw_remove_end",schemaPath:"#/$defs/seconds/minimum",keyword:"minimum",params:{comparison: ">=", limit: 0},message:"must be >= 0"};
if(vErrors === null){
vErrors = [err14];
}
else {
vErrors.push(err14);
}
errors++;
}
}
else {
const err15 = {instancePath:instancePath+"/raw_remove_end",schemaPath:"#/$defs/seconds/type",keyword:"type",params:{type: "number"},message:"must be number"};
if(vErrors === null){
vErrors = [err15];
}
else {
vErrors.push(err15);
}
errors++;
}
}
if(data.remove_start_frame !== undefined){
let data4 = data.remove_start_frame;
if(!((typeof data4 == "number") && (!(data4 % 1) && !isNaN(data4)))){
const err16 = {instancePath:instancePath+"/remove_start_frame",schemaPath:"#/properties/remove_start_frame/type",keyword:"type",params:{type: "integer"},message:"must be integer"};
if(vErrors === null){
vErrors = [err16];
}
else {
vErrors.push(err16);
}
errors++;
}
if(typeof data4 == "number"){
if(data4 < 0 || isNaN(data4)){
const err17 = {instancePath:instancePath+"/remove_start_frame",schemaPath:"#/properties/remove_start_frame/minimum",keyword:"minimum",params:{comparison: ">=", limit: 0},message:"must be >= 0"};
if(vErrors === null){
vErrors = [err17];
}
else {
vErrors.push(err17);
}
errors++;
}
}
}
if(data.remove_end_frame !== undefined){
let data5 = data.remove_end_frame;
if(!((typeof data5 == "number") && (!(data5 % 1) && !isNaN(data5)))){
const err18 = {instancePath:instancePath+"/remove_end_frame",schemaPath:"#/properties/remove_end_frame/type",keyword:"type",params:{type: "integer"},message:"must be integer"};
if(vErrors === null){
vErrors = [err18];
}
else {
vErrors.push(err18);
}
errors++;
}
if(typeof data5 == "number"){
if(data5 < 0 || isNaN(data5)){
const err19 = {instancePath:instancePath+"/remove_end_frame",schemaPath:"#/properties/remove_end_frame/minimum",keyword:"minimum",params:{comparison: ">=", limit: 0},message:"must be >= 0"};
if(vErrors === null){
vErrors = [err19];
}
else {
vErrors.push(err19);
}
errors++;
}
}
}
if(data.remove_start !== undefined){
let data6 = data.remove_start;
if(typeof data6 == "number"){
if(data6 < 0 || isNaN(data6)){
const err20 = {instancePath:instancePath+"/remove_start",schemaPath:"#/$defs/seconds/minimum",keyword:"minimum",params:{comparison: ">=", limit: 0},message:"must be >= 0"};
if(vErrors === null){
vErrors = [err20];
}
else {
vErrors.push(err20);
}
errors++;
}
}
else {
const err21 = {instancePath:instancePath+"/remove_start",schemaPath:"#/$defs/seconds/type",keyword:"type",params:{type: "number"},message:"must be number"};
if(vErrors === null){
vErrors = [err21];
}
else {
vErrors.push(err21);
}
errors++;
}
}
if(data.remove_end !== undefined){
let data7 = data.remove_end;
if(typeof data7 == "number"){
if(data7 < 0 || isNaN(data7)){
const err22 = {instancePath:instancePath+"/remove_end",schemaPath:"#/$defs/seconds/minimum",keyword:"minimum",params:{comparison: ">=", limit: 0},message:"must be >= 0"};
if(vErrors === null){
vErrors = [err22];
}
else {
vErrors.push(err22);
}
errors++;
}
}
else {
const err23 = {instancePath:instancePath+"/remove_end",schemaPath:"#/$defs/seconds/type",keyword:"type",params:{type: "number"},message:"must be number"};
if(vErrors === null){
vErrors = [err23];
}
else {
vErrors.push(err23);
}
errors++;
}
}
if(data.actual_retained_seconds !== undefined){
let data8 = data.actual_retained_seconds;
if(typeof data8 == "number"){
if(data8 < 0 || isNaN(data8)){
const err24 = {instancePath:instancePath+"/actual_retained_seconds",schemaPath:"#/$defs/seconds/minimum",keyword:"minimum",params:{comparison: ">=", limit: 0},message:"must be >= 0"};
if(vErrors === null){
vErrors = [err24];
}
else {
vErrors.push(err24);
}
errors++;
}
}
else {
const err25 = {instancePath:instancePath+"/actual_retained_seconds",schemaPath:"#/$defs/seconds/type",keyword:"type",params:{type: "number"},message:"must be number"};
if(vErrors === null){
vErrors = [err25];
}
else {
vErrors.push(err25);
}
errors++;
}
}
}
else {
const err26 = {instancePath,schemaPath:"#/type",keyword:"type",params:{type: "object"},message:"must be object"};
if(vErrors === null){
vErrors = [err26];
}
else {
vErrors.push(err26);
}
errors++;
}
validate101.errors = vErrors;
return errors === 0;
}
validate101.evaluated = {"props":true,"dynamicProps":false,"dynamicItems":false};


function validate97(data, {instancePath="", parentData, parentDataProperty, rootData=data, dynamicAnchors={}}={}){
let vErrors = null;
let errors = 0;
const evaluated0 = validate97.evaluated;
if(evaluated0.dynamicProps){
evaluated0.props = undefined;
}
if(evaluated0.dynamicItems){
evaluated0.items = undefined;
}
if(data && typeof data == "object" && !Array.isArray(data)){
if(data.id === undefined){
const err0 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "id"},message:"must have required property '"+"id"+"'"};
if(vErrors === null){
vErrors = [err0];
}
else {
vErrors.push(err0);
}
errors++;
}
if(data.family === undefined){
const err1 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "family"},message:"must have required property '"+"family"+"'"};
if(vErrors === null){
vErrors = [err1];
}
else {
vErrors.push(err1);
}
errors++;
}
if(data.src === undefined){
const err2 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "src"},message:"must have required property '"+"src"+"'"};
if(vErrors === null){
vErrors = [err2];
}
else {
vErrors.push(err2);
}
errors++;
}
if(data.occurrence_index === undefined){
const err3 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "occurrence_index"},message:"must have required property '"+"occurrence_index"+"'"};
if(vErrors === null){
vErrors = [err3];
}
else {
vErrors.push(err3);
}
errors++;
}
if(data.occurrence_origin === undefined){
const err4 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "occurrence_origin"},message:"must have required property '"+"occurrence_origin"+"'"};
if(vErrors === null){
vErrors = [err4];
}
else {
vErrors.push(err4);
}
errors++;
}
if(data.occurrence_interval === undefined){
const err5 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "occurrence_interval"},message:"must have required property '"+"occurrence_interval"+"'"};
if(vErrors === null){
vErrors = [err5];
}
else {
vErrors.push(err5);
}
errors++;
}
if(data.source_interval === undefined){
const err6 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "source_interval"},message:"must have required property '"+"source_interval"+"'"};
if(vErrors === null){
vErrors = [err6];
}
else {
vErrors.push(err6);
}
errors++;
}
if(data.classification === undefined){
const err7 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "classification"},message:"must have required property '"+"classification"+"'"};
if(vErrors === null){
vErrors = [err7];
}
else {
vErrors.push(err7);
}
errors++;
}
if(data.classification_basis === undefined){
const err8 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "classification_basis"},message:"must have required property '"+"classification_basis"+"'"};
if(vErrors === null){
vErrors = [err8];
}
else {
vErrors.push(err8);
}
errors++;
}
if(data.context === undefined){
const err9 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "context"},message:"must have required property '"+"context"+"'"};
if(vErrors === null){
vErrors = [err9];
}
else {
vErrors.push(err9);
}
errors++;
}
if(data.proposal === undefined){
const err10 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "proposal"},message:"must have required property '"+"proposal"+"'"};
if(vErrors === null){
vErrors = [err10];
}
else {
vErrors.push(err10);
}
errors++;
}
if(data.screen_review_required === undefined){
const err11 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "screen_review_required"},message:"must have required property '"+"screen_review_required"+"'"};
if(vErrors === null){
vErrors = [err11];
}
else {
vErrors.push(err11);
}
errors++;
}
if(data.risk_flags === undefined){
const err12 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "risk_flags"},message:"must have required property '"+"risk_flags"+"'"};
if(vErrors === null){
vErrors = [err12];
}
else {
vErrors.push(err12);
}
errors++;
}
if(data.decision === undefined){
const err13 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "decision"},message:"must have required property '"+"decision"+"'"};
if(vErrors === null){
vErrors = [err13];
}
else {
vErrors.push(err13);
}
errors++;
}
for(const key0 in data){
if(!(func20.call(schema141.properties, key0))){
const err14 = {instancePath,schemaPath:"#/additionalProperties",keyword:"additionalProperties",params:{additionalProperty: key0},message:"must NOT have additional properties"};
if(vErrors === null){
vErrors = [err14];
}
else {
vErrors.push(err14);
}
errors++;
}
}
if(data.id !== undefined){
let data0 = data.id;
if(typeof data0 === "string"){
if(!pattern32.test(data0)){
const err15 = {instancePath:instancePath+"/id",schemaPath:"#/properties/id/pattern",keyword:"pattern",params:{pattern: "^pause-[0-9]{4,}$"},message:"must match pattern \""+"^pause-[0-9]{4,}$"+"\""};
if(vErrors === null){
vErrors = [err15];
}
else {
vErrors.push(err15);
}
errors++;
}
}
else {
const err16 = {instancePath:instancePath+"/id",schemaPath:"#/properties/id/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err16];
}
else {
vErrors.push(err16);
}
errors++;
}
}
if(data.family !== undefined){
if("pause_shortening_review" !== data.family){
const err17 = {instancePath:instancePath+"/family",schemaPath:"#/properties/family/const",keyword:"const",params:{allowedValue: "pause_shortening_review"},message:"must be equal to constant"};
if(vErrors === null){
vErrors = [err17];
}
else {
vErrors.push(err17);
}
errors++;
}
}
if(data.src !== undefined){
let data2 = data.src;
const _errs7 = errors;
let valid2 = false;
let passing0 = null;
const _errs8 = errors;
if(data2 !== null){
const err18 = {instancePath:instancePath+"/src",schemaPath:"#/$defs/src/oneOf/0/type",keyword:"type",params:{type: "null"},message:"must be null"};
if(vErrors === null){
vErrors = [err18];
}
else {
vErrors.push(err18);
}
errors++;
}
var _valid0 = _errs8 === errors;
if(_valid0){
valid2 = true;
passing0 = 0;
}
const _errs10 = errors;
if(typeof data2 === "string"){
if(func1(data2) < 1){
const err19 = {instancePath:instancePath+"/src",schemaPath:"#/$defs/src/oneOf/1/minLength",keyword:"minLength",params:{limit: 1},message:"must NOT have fewer than 1 characters"};
if(vErrors === null){
vErrors = [err19];
}
else {
vErrors.push(err19);
}
errors++;
}
if(!pattern4.test(data2)){
const err20 = {instancePath:instancePath+"/src",schemaPath:"#/$defs/src/oneOf/1/pattern",keyword:"pattern",params:{pattern: "\\S"},message:"must match pattern \""+"\\S"+"\""};
if(vErrors === null){
vErrors = [err20];
}
else {
vErrors.push(err20);
}
errors++;
}
}
else {
const err21 = {instancePath:instancePath+"/src",schemaPath:"#/$defs/src/oneOf/1/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err21];
}
else {
vErrors.push(err21);
}
errors++;
}
var _valid0 = _errs10 === errors;
if(_valid0 && valid2){
valid2 = false;
passing0 = [passing0, 1];
}
else {
if(_valid0){
valid2 = true;
passing0 = 1;
}
}
if(!valid2){
const err22 = {instancePath:instancePath+"/src",schemaPath:"#/$defs/src/oneOf",keyword:"oneOf",params:{passingSchemas: passing0},message:"must match exactly one schema in oneOf"};
if(vErrors === null){
vErrors = [err22];
}
else {
vErrors.push(err22);
}
errors++;
}
else {
errors = _errs7;
if(vErrors !== null){
if(_errs7){
vErrors.length = _errs7;
}
else {
vErrors = null;
}
}
}
}
if(data.occurrence_index !== undefined){
let data3 = data.occurrence_index;
if(!((typeof data3 == "number") && (!(data3 % 1) && !isNaN(data3)))){
const err23 = {instancePath:instancePath+"/occurrence_index",schemaPath:"#/properties/occurrence_index/type",keyword:"type",params:{type: "integer"},message:"must be integer"};
if(vErrors === null){
vErrors = [err23];
}
else {
vErrors.push(err23);
}
errors++;
}
if(typeof data3 == "number"){
if(data3 < 0 || isNaN(data3)){
const err24 = {instancePath:instancePath+"/occurrence_index",schemaPath:"#/properties/occurrence_index/minimum",keyword:"minimum",params:{comparison: ">=", limit: 0},message:"must be >= 0"};
if(vErrors === null){
vErrors = [err24];
}
else {
vErrors.push(err24);
}
errors++;
}
}
}
if(data.occurrence_origin !== undefined){
let data4 = data.occurrence_origin;
if(!((data4 === "explicit_range") || (data4 === "full_source"))){
const err25 = {instancePath:instancePath+"/occurrence_origin",schemaPath:"#/properties/occurrence_origin/enum",keyword:"enum",params:{allowedValues: schema141.properties.occurrence_origin.enum},message:"must be equal to one of the allowed values"};
if(vErrors === null){
vErrors = [err25];
}
else {
vErrors.push(err25);
}
errors++;
}
}
if(data.occurrence_interval !== undefined){
if(!(validate83(data.occurrence_interval, {instancePath:instancePath+"/occurrence_interval",parentData:data,parentDataProperty:"occurrence_interval",rootData,dynamicAnchors}))){
vErrors = vErrors === null ? validate83.errors : vErrors.concat(validate83.errors);
errors = vErrors.length;
}
}
if(data.source_interval !== undefined){
if(!(validate83(data.source_interval, {instancePath:instancePath+"/source_interval",parentData:data,parentDataProperty:"source_interval",rootData,dynamicAnchors}))){
vErrors = vErrors === null ? validate83.errors : vErrors.concat(validate83.errors);
errors = vErrors.length;
}
}
if(data.classification !== undefined){
let data7 = data.classification;
if(!(((data7 === "within_sentence") || (data7 === "sentence_end")) || (data7 === "topic_transition"))){
const err26 = {instancePath:instancePath+"/classification",schemaPath:"#/properties/classification/enum",keyword:"enum",params:{allowedValues: schema141.properties.classification.enum},message:"must be equal to one of the allowed values"};
if(vErrors === null){
vErrors = [err26];
}
else {
vErrors.push(err26);
}
errors++;
}
}
if(data.classification_basis !== undefined){
let data8 = data.classification_basis;
const _errs20 = errors;
let valid4 = false;
let passing1 = null;
const _errs21 = errors;
if(data8 && typeof data8 == "object" && !Array.isArray(data8)){
if(data8.kind === undefined){
const err27 = {instancePath:instancePath+"/classification_basis",schemaPath:"#/$defs/classificationBasis/oneOf/0/required",keyword:"required",params:{missingProperty: "kind"},message:"must have required property '"+"kind"+"'"};
if(vErrors === null){
vErrors = [err27];
}
else {
vErrors.push(err27);
}
errors++;
}
if(data8.event_index === undefined){
const err28 = {instancePath:instancePath+"/classification_basis",schemaPath:"#/$defs/classificationBasis/oneOf/0/required",keyword:"required",params:{missingProperty: "event_index"},message:"must have required property '"+"event_index"+"'"};
if(vErrors === null){
vErrors = [err28];
}
else {
vErrors.push(err28);
}
errors++;
}
for(const key1 in data8){
if(!((key1 === "kind") || (key1 === "event_index"))){
const err29 = {instancePath:instancePath+"/classification_basis",schemaPath:"#/$defs/classificationBasis/oneOf/0/additionalProperties",keyword:"additionalProperties",params:{additionalProperty: key1},message:"must NOT have additional properties"};
if(vErrors === null){
vErrors = [err29];
}
else {
vErrors.push(err29);
}
errors++;
}
}
if(data8.kind !== undefined){
if("chapter_event" !== data8.kind){
const err30 = {instancePath:instancePath+"/classification_basis/kind",schemaPath:"#/$defs/classificationBasis/oneOf/0/properties/kind/const",keyword:"const",params:{allowedValue: "chapter_event"},message:"must be equal to constant"};
if(vErrors === null){
vErrors = [err30];
}
else {
vErrors.push(err30);
}
errors++;
}
}
if(data8.event_index !== undefined){
let data10 = data8.event_index;
if(!((typeof data10 == "number") && (!(data10 % 1) && !isNaN(data10)))){
const err31 = {instancePath:instancePath+"/classification_basis/event_index",schemaPath:"#/$defs/classificationBasis/oneOf/0/properties/event_index/type",keyword:"type",params:{type: "integer"},message:"must be integer"};
if(vErrors === null){
vErrors = [err31];
}
else {
vErrors.push(err31);
}
errors++;
}
if(typeof data10 == "number"){
if(data10 < 0 || isNaN(data10)){
const err32 = {instancePath:instancePath+"/classification_basis/event_index",schemaPath:"#/$defs/classificationBasis/oneOf/0/properties/event_index/minimum",keyword:"minimum",params:{comparison: ">=", limit: 0},message:"must be >= 0"};
if(vErrors === null){
vErrors = [err32];
}
else {
vErrors.push(err32);
}
errors++;
}
}
}
}
else {
const err33 = {instancePath:instancePath+"/classification_basis",schemaPath:"#/$defs/classificationBasis/oneOf/0/type",keyword:"type",params:{type: "object"},message:"must be object"};
if(vErrors === null){
vErrors = [err33];
}
else {
vErrors.push(err33);
}
errors++;
}
var _valid1 = _errs21 === errors;
if(_valid1){
valid4 = true;
passing1 = 0;
var props0 = true;
}
const _errs27 = errors;
if(data8 && typeof data8 == "object" && !Array.isArray(data8)){
if(data8.kind === undefined){
const err34 = {instancePath:instancePath+"/classification_basis",schemaPath:"#/$defs/classificationBasis/oneOf/1/required",keyword:"required",params:{missingProperty: "kind"},message:"must have required property '"+"kind"+"'"};
if(vErrors === null){
vErrors = [err34];
}
else {
vErrors.push(err34);
}
errors++;
}
if(data8.segment_index === undefined){
const err35 = {instancePath:instancePath+"/classification_basis",schemaPath:"#/$defs/classificationBasis/oneOf/1/required",keyword:"required",params:{missingProperty: "segment_index"},message:"must have required property '"+"segment_index"+"'"};
if(vErrors === null){
vErrors = [err35];
}
else {
vErrors.push(err35);
}
errors++;
}
if(data8.terminal === undefined){
const err36 = {instancePath:instancePath+"/classification_basis",schemaPath:"#/$defs/classificationBasis/oneOf/1/required",keyword:"required",params:{missingProperty: "terminal"},message:"must have required property '"+"terminal"+"'"};
if(vErrors === null){
vErrors = [err36];
}
else {
vErrors.push(err36);
}
errors++;
}
for(const key2 in data8){
if(!(((key2 === "kind") || (key2 === "segment_index")) || (key2 === "terminal"))){
const err37 = {instancePath:instancePath+"/classification_basis",schemaPath:"#/$defs/classificationBasis/oneOf/1/additionalProperties",keyword:"additionalProperties",params:{additionalProperty: key2},message:"must NOT have additional properties"};
if(vErrors === null){
vErrors = [err37];
}
else {
vErrors.push(err37);
}
errors++;
}
}
if(data8.kind !== undefined){
if("sentence_terminal" !== data8.kind){
const err38 = {instancePath:instancePath+"/classification_basis/kind",schemaPath:"#/$defs/classificationBasis/oneOf/1/properties/kind/const",keyword:"const",params:{allowedValue: "sentence_terminal"},message:"must be equal to constant"};
if(vErrors === null){
vErrors = [err38];
}
else {
vErrors.push(err38);
}
errors++;
}
}
if(data8.segment_index !== undefined){
let data12 = data8.segment_index;
if(!((typeof data12 == "number") && (!(data12 % 1) && !isNaN(data12)))){
const err39 = {instancePath:instancePath+"/classification_basis/segment_index",schemaPath:"#/$defs/classificationBasis/oneOf/1/properties/segment_index/type",keyword:"type",params:{type: "integer"},message:"must be integer"};
if(vErrors === null){
vErrors = [err39];
}
else {
vErrors.push(err39);
}
errors++;
}
if(typeof data12 == "number"){
if(data12 < 0 || isNaN(data12)){
const err40 = {instancePath:instancePath+"/classification_basis/segment_index",schemaPath:"#/$defs/classificationBasis/oneOf/1/properties/segment_index/minimum",keyword:"minimum",params:{comparison: ">=", limit: 0},message:"must be >= 0"};
if(vErrors === null){
vErrors = [err40];
}
else {
vErrors.push(err40);
}
errors++;
}
}
}
if(data8.terminal !== undefined){
let data13 = data8.terminal;
if(typeof data13 === "string"){
if(!pattern34.test(data13)){
const err41 = {instancePath:instancePath+"/classification_basis/terminal",schemaPath:"#/$defs/classificationBasis/oneOf/1/properties/terminal/pattern",keyword:"pattern",params:{pattern: "^[。！？!?]$"},message:"must match pattern \""+"^[。！？!?]$"+"\""};
if(vErrors === null){
vErrors = [err41];
}
else {
vErrors.push(err41);
}
errors++;
}
}
else {
const err42 = {instancePath:instancePath+"/classification_basis/terminal",schemaPath:"#/$defs/classificationBasis/oneOf/1/properties/terminal/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err42];
}
else {
vErrors.push(err42);
}
errors++;
}
}
}
else {
const err43 = {instancePath:instancePath+"/classification_basis",schemaPath:"#/$defs/classificationBasis/oneOf/1/type",keyword:"type",params:{type: "object"},message:"must be object"};
if(vErrors === null){
vErrors = [err43];
}
else {
vErrors.push(err43);
}
errors++;
}
var _valid1 = _errs27 === errors;
if(_valid1 && valid4){
valid4 = false;
passing1 = [passing1, 1];
}
else {
if(_valid1){
valid4 = true;
passing1 = 1;
if(props0 !== true){
props0 = true;
}
}
const _errs35 = errors;
if(data8 && typeof data8 == "object" && !Array.isArray(data8)){
if(data8.kind === undefined){
const err44 = {instancePath:instancePath+"/classification_basis",schemaPath:"#/$defs/classificationBasis/oneOf/2/required",keyword:"required",params:{missingProperty: "kind"},message:"must have required property '"+"kind"+"'"};
if(vErrors === null){
vErrors = [err44];
}
else {
vErrors.push(err44);
}
errors++;
}
for(const key3 in data8){
if(!(key3 === "kind")){
const err45 = {instancePath:instancePath+"/classification_basis",schemaPath:"#/$defs/classificationBasis/oneOf/2/additionalProperties",keyword:"additionalProperties",params:{additionalProperty: key3},message:"must NOT have additional properties"};
if(vErrors === null){
vErrors = [err45];
}
else {
vErrors.push(err45);
}
errors++;
}
}
if(data8.kind !== undefined){
if("default_within_sentence" !== data8.kind){
const err46 = {instancePath:instancePath+"/classification_basis/kind",schemaPath:"#/$defs/classificationBasis/oneOf/2/properties/kind/const",keyword:"const",params:{allowedValue: "default_within_sentence"},message:"must be equal to constant"};
if(vErrors === null){
vErrors = [err46];
}
else {
vErrors.push(err46);
}
errors++;
}
}
}
else {
const err47 = {instancePath:instancePath+"/classification_basis",schemaPath:"#/$defs/classificationBasis/oneOf/2/type",keyword:"type",params:{type: "object"},message:"must be object"};
if(vErrors === null){
vErrors = [err47];
}
else {
vErrors.push(err47);
}
errors++;
}
var _valid1 = _errs35 === errors;
if(_valid1 && valid4){
valid4 = false;
passing1 = [passing1, 2];
}
else {
if(_valid1){
valid4 = true;
passing1 = 2;
if(props0 !== true){
props0 = true;
}
}
}
}
if(!valid4){
const err48 = {instancePath:instancePath+"/classification_basis",schemaPath:"#/$defs/classificationBasis/oneOf",keyword:"oneOf",params:{passingSchemas: passing1},message:"must match exactly one schema in oneOf"};
if(vErrors === null){
vErrors = [err48];
}
else {
vErrors.push(err48);
}
errors++;
}
else {
errors = _errs20;
if(vErrors !== null){
if(_errs20){
vErrors.length = _errs20;
}
else {
vErrors = null;
}
}
}
}
if(data.context !== undefined){
if(!(validate89(data.context, {instancePath:instancePath+"/context",parentData:data,parentDataProperty:"context",rootData,dynamicAnchors}))){
vErrors = vErrors === null ? validate89.errors : vErrors.concat(validate89.errors);
errors = vErrors.length;
}
}
if(data.proposal !== undefined){
if(!(validate101(data.proposal, {instancePath:instancePath+"/proposal",parentData:data,parentDataProperty:"proposal",rootData,dynamicAnchors}))){
vErrors = vErrors === null ? validate101.errors : vErrors.concat(validate101.errors);
errors = vErrors.length;
}
}
if(data.screen_review_required !== undefined){
if(true !== data.screen_review_required){
const err49 = {instancePath:instancePath+"/screen_review_required",schemaPath:"#/properties/screen_review_required/const",keyword:"const",params:{allowedValue: true},message:"must be equal to constant"};
if(vErrors === null){
vErrors = [err49];
}
else {
vErrors.push(err49);
}
errors++;
}
}
if(data.risk_flags !== undefined){
let data18 = data.risk_flags;
if(Array.isArray(data18)){
if(data18.length < 1){
const err50 = {instancePath:instancePath+"/risk_flags",schemaPath:"#/properties/risk_flags/minItems",keyword:"minItems",params:{limit: 1},message:"must NOT have fewer than 1 items"};
if(vErrors === null){
vErrors = [err50];
}
else {
vErrors.push(err50);
}
errors++;
}
const len0 = data18.length;
for(let i0=0; i0<len0; i0++){
let data19 = data18[i0];
if(!((((data19 === "UI_WAIT_UNRESOLVED") || (data19 === "SCREEN_CONTEXT_MISSING")) || (data19 === "INFORMATION_RETENTION_REVIEW")) || (data19 === "PARTIAL_EVENT_OCCURRENCE"))){
const err51 = {instancePath:instancePath+"/risk_flags/" + i0,schemaPath:"#/$defs/candidateRisk/enum",keyword:"enum",params:{allowedValues: schema140.enum},message:"must be equal to one of the allowed values"};
if(vErrors === null){
vErrors = [err51];
}
else {
vErrors.push(err51);
}
errors++;
}
}
let i1 = data18.length;
let j0;
if(i1 > 1){
outer0:
for(;i1--;){
for(j0 = i1; j0--;){
if(func0(data18[i1], data18[j0])){
const err52 = {instancePath:instancePath+"/risk_flags",schemaPath:"#/properties/risk_flags/uniqueItems",keyword:"uniqueItems",params:{i: i1, j: j0},message:"must NOT have duplicate items (items ## "+j0+" and "+i1+" are identical)"};
if(vErrors === null){
vErrors = [err52];
}
else {
vErrors.push(err52);
}
errors++;
break outer0;
}
}
}
}
}
else {
const err53 = {instancePath:instancePath+"/risk_flags",schemaPath:"#/properties/risk_flags/type",keyword:"type",params:{type: "array"},message:"must be array"};
if(vErrors === null){
vErrors = [err53];
}
else {
vErrors.push(err53);
}
errors++;
}
}
if(data.decision !== undefined){
if("REVIEW_REQUIRED" !== data.decision){
const err54 = {instancePath:instancePath+"/decision",schemaPath:"#/properties/decision/const",keyword:"const",params:{allowedValue: "REVIEW_REQUIRED"},message:"must be equal to constant"};
if(vErrors === null){
vErrors = [err54];
}
else {
vErrors.push(err54);
}
errors++;
}
}
}
else {
const err55 = {instancePath,schemaPath:"#/type",keyword:"type",params:{type: "object"},message:"must be object"};
if(vErrors === null){
vErrors = [err55];
}
else {
vErrors.push(err55);
}
errors++;
}
validate97.errors = vErrors;
return errors === 0;
}
validate97.evaluated = {"props":true,"dynamicProps":false,"dynamicItems":false};

const schema151 = {"type":"object","additionalProperties":false,"required":["id","src","occurrence_index","occurrence_origin","source_interval","code","detail"],"properties":{"id":{"type":"string","pattern":"^skip-[0-9]{4,}$"},"src":{"$ref":"#/$defs/src"},"occurrence_index":{"oneOf":[{"type":"null"},{"type":"integer","minimum":0}]},"occurrence_origin":{"oneOf":[{"type":"null"},{"enum":["explicit_range","full_source"]}]},"source_interval":{"$ref":"#/$defs/interval"},"code":{"$ref":"#/$defs/skipCode"},"detail":{"$ref":"#/$defs/skipDetail"}}};
const schema153 = {"enum":["WORD_TIMING_UNAVAILABLE","MISSING_SPEECH_CONTEXT","PROTECTED_WORD_OVERLAP","OUTSIDE_KEEP_OCCURRENCE","CROSSES_OCCURRENCE_BOUNDARY","NO_FRAME_CELL","NO_EFFECTIVE_CHANGE","TARGET_NOT_REACHED"]};
const pattern35 = new RegExp("^skip-[0-9]{4,}$", "u");
const schema154 = {"oneOf":[{"type":"object","additionalProperties":false,"required":["missing_segment_indexes"],"properties":{"missing_segment_indexes":{"type":"array","items":{"type":"integer","minimum":0}}}},{"type":"object","additionalProperties":false,"required":["previous_word_available","next_word_available"],"properties":{"previous_word_available":{"type":"boolean"},"next_word_available":{"type":"boolean"}}},{"type":"object","additionalProperties":false,"required":["protected_words"],"properties":{"protected_words":{"type":"array","minItems":1,"items":{"$ref":"#/$defs/wordRef"}}}},{"type":"object","additionalProperties":false,"required":["detector_pair_index"],"properties":{"detector_pair_index":{"type":"integer","minimum":0}}},{"type":"object","additionalProperties":false,"required":["detector_pair_index","occurrence_interval"],"properties":{"detector_pair_index":{"type":"integer","minimum":0},"occurrence_interval":{"$ref":"#/$defs/interval"}}},{"type":"object","additionalProperties":false,"required":["raw_remove_start","raw_remove_end","remove_start_frame","remove_end_frame"],"properties":{"raw_remove_start":{"$ref":"#/$defs/seconds"},"raw_remove_end":{"$ref":"#/$defs/seconds"},"remove_start_frame":{"type":"integer","minimum":0},"remove_end_frame":{"type":"integer","minimum":0}}},{"type":"object","additionalProperties":false,"required":["retained_before_seconds","target_retained_seconds","retained_after_seconds"],"properties":{"retained_before_seconds":{"$ref":"#/$defs/seconds"},"target_retained_seconds":{"$ref":"#/$defs/seconds"},"retained_after_seconds":{"$ref":"#/$defs/seconds"}}}]};

function validate106(data, {instancePath="", parentData, parentDataProperty, rootData=data, dynamicAnchors={}}={}){
let vErrors = null;
let errors = 0;
const evaluated0 = validate106.evaluated;
if(evaluated0.dynamicProps){
evaluated0.props = undefined;
}
if(evaluated0.dynamicItems){
evaluated0.items = undefined;
}
const _errs0 = errors;
let valid0 = false;
let passing0 = null;
const _errs1 = errors;
if(data && typeof data == "object" && !Array.isArray(data)){
if(data.missing_segment_indexes === undefined){
const err0 = {instancePath,schemaPath:"#/oneOf/0/required",keyword:"required",params:{missingProperty: "missing_segment_indexes"},message:"must have required property '"+"missing_segment_indexes"+"'"};
if(vErrors === null){
vErrors = [err0];
}
else {
vErrors.push(err0);
}
errors++;
}
for(const key0 in data){
if(!(key0 === "missing_segment_indexes")){
const err1 = {instancePath,schemaPath:"#/oneOf/0/additionalProperties",keyword:"additionalProperties",params:{additionalProperty: key0},message:"must NOT have additional properties"};
if(vErrors === null){
vErrors = [err1];
}
else {
vErrors.push(err1);
}
errors++;
}
}
if(data.missing_segment_indexes !== undefined){
let data0 = data.missing_segment_indexes;
if(Array.isArray(data0)){
const len0 = data0.length;
for(let i0=0; i0<len0; i0++){
let data1 = data0[i0];
if(!((typeof data1 == "number") && (!(data1 % 1) && !isNaN(data1)))){
const err2 = {instancePath:instancePath+"/missing_segment_indexes/" + i0,schemaPath:"#/oneOf/0/properties/missing_segment_indexes/items/type",keyword:"type",params:{type: "integer"},message:"must be integer"};
if(vErrors === null){
vErrors = [err2];
}
else {
vErrors.push(err2);
}
errors++;
}
if(typeof data1 == "number"){
if(data1 < 0 || isNaN(data1)){
const err3 = {instancePath:instancePath+"/missing_segment_indexes/" + i0,schemaPath:"#/oneOf/0/properties/missing_segment_indexes/items/minimum",keyword:"minimum",params:{comparison: ">=", limit: 0},message:"must be >= 0"};
if(vErrors === null){
vErrors = [err3];
}
else {
vErrors.push(err3);
}
errors++;
}
}
}
}
else {
const err4 = {instancePath:instancePath+"/missing_segment_indexes",schemaPath:"#/oneOf/0/properties/missing_segment_indexes/type",keyword:"type",params:{type: "array"},message:"must be array"};
if(vErrors === null){
vErrors = [err4];
}
else {
vErrors.push(err4);
}
errors++;
}
}
}
else {
const err5 = {instancePath,schemaPath:"#/oneOf/0/type",keyword:"type",params:{type: "object"},message:"must be object"};
if(vErrors === null){
vErrors = [err5];
}
else {
vErrors.push(err5);
}
errors++;
}
var _valid0 = _errs1 === errors;
if(_valid0){
valid0 = true;
passing0 = 0;
var props0 = true;
}
const _errs8 = errors;
if(data && typeof data == "object" && !Array.isArray(data)){
if(data.previous_word_available === undefined){
const err6 = {instancePath,schemaPath:"#/oneOf/1/required",keyword:"required",params:{missingProperty: "previous_word_available"},message:"must have required property '"+"previous_word_available"+"'"};
if(vErrors === null){
vErrors = [err6];
}
else {
vErrors.push(err6);
}
errors++;
}
if(data.next_word_available === undefined){
const err7 = {instancePath,schemaPath:"#/oneOf/1/required",keyword:"required",params:{missingProperty: "next_word_available"},message:"must have required property '"+"next_word_available"+"'"};
if(vErrors === null){
vErrors = [err7];
}
else {
vErrors.push(err7);
}
errors++;
}
for(const key1 in data){
if(!((key1 === "previous_word_available") || (key1 === "next_word_available"))){
const err8 = {instancePath,schemaPath:"#/oneOf/1/additionalProperties",keyword:"additionalProperties",params:{additionalProperty: key1},message:"must NOT have additional properties"};
if(vErrors === null){
vErrors = [err8];
}
else {
vErrors.push(err8);
}
errors++;
}
}
if(data.previous_word_available !== undefined){
if(typeof data.previous_word_available !== "boolean"){
const err9 = {instancePath:instancePath+"/previous_word_available",schemaPath:"#/oneOf/1/properties/previous_word_available/type",keyword:"type",params:{type: "boolean"},message:"must be boolean"};
if(vErrors === null){
vErrors = [err9];
}
else {
vErrors.push(err9);
}
errors++;
}
}
if(data.next_word_available !== undefined){
if(typeof data.next_word_available !== "boolean"){
const err10 = {instancePath:instancePath+"/next_word_available",schemaPath:"#/oneOf/1/properties/next_word_available/type",keyword:"type",params:{type: "boolean"},message:"must be boolean"};
if(vErrors === null){
vErrors = [err10];
}
else {
vErrors.push(err10);
}
errors++;
}
}
}
else {
const err11 = {instancePath,schemaPath:"#/oneOf/1/type",keyword:"type",params:{type: "object"},message:"must be object"};
if(vErrors === null){
vErrors = [err11];
}
else {
vErrors.push(err11);
}
errors++;
}
var _valid0 = _errs8 === errors;
if(_valid0 && valid0){
valid0 = false;
passing0 = [passing0, 1];
}
else {
if(_valid0){
valid0 = true;
passing0 = 1;
if(props0 !== true){
props0 = true;
}
}
const _errs15 = errors;
if(data && typeof data == "object" && !Array.isArray(data)){
if(data.protected_words === undefined){
const err12 = {instancePath,schemaPath:"#/oneOf/2/required",keyword:"required",params:{missingProperty: "protected_words"},message:"must have required property '"+"protected_words"+"'"};
if(vErrors === null){
vErrors = [err12];
}
else {
vErrors.push(err12);
}
errors++;
}
for(const key2 in data){
if(!(key2 === "protected_words")){
const err13 = {instancePath,schemaPath:"#/oneOf/2/additionalProperties",keyword:"additionalProperties",params:{additionalProperty: key2},message:"must NOT have additional properties"};
if(vErrors === null){
vErrors = [err13];
}
else {
vErrors.push(err13);
}
errors++;
}
}
if(data.protected_words !== undefined){
let data4 = data.protected_words;
if(Array.isArray(data4)){
if(data4.length < 1){
const err14 = {instancePath:instancePath+"/protected_words",schemaPath:"#/oneOf/2/properties/protected_words/minItems",keyword:"minItems",params:{limit: 1},message:"must NOT have fewer than 1 items"};
if(vErrors === null){
vErrors = [err14];
}
else {
vErrors.push(err14);
}
errors++;
}
const len1 = data4.length;
for(let i1=0; i1<len1; i1++){
if(!(validate91(data4[i1], {instancePath:instancePath+"/protected_words/" + i1,parentData:data4,parentDataProperty:i1,rootData,dynamicAnchors}))){
vErrors = vErrors === null ? validate91.errors : vErrors.concat(validate91.errors);
errors = vErrors.length;
}
}
}
else {
const err15 = {instancePath:instancePath+"/protected_words",schemaPath:"#/oneOf/2/properties/protected_words/type",keyword:"type",params:{type: "array"},message:"must be array"};
if(vErrors === null){
vErrors = [err15];
}
else {
vErrors.push(err15);
}
errors++;
}
}
}
else {
const err16 = {instancePath,schemaPath:"#/oneOf/2/type",keyword:"type",params:{type: "object"},message:"must be object"};
if(vErrors === null){
vErrors = [err16];
}
else {
vErrors.push(err16);
}
errors++;
}
var _valid0 = _errs15 === errors;
if(_valid0 && valid0){
valid0 = false;
passing0 = [passing0, 2];
}
else {
if(_valid0){
valid0 = true;
passing0 = 2;
if(props0 !== true){
props0 = true;
}
}
const _errs21 = errors;
if(data && typeof data == "object" && !Array.isArray(data)){
if(data.detector_pair_index === undefined){
const err17 = {instancePath,schemaPath:"#/oneOf/3/required",keyword:"required",params:{missingProperty: "detector_pair_index"},message:"must have required property '"+"detector_pair_index"+"'"};
if(vErrors === null){
vErrors = [err17];
}
else {
vErrors.push(err17);
}
errors++;
}
for(const key3 in data){
if(!(key3 === "detector_pair_index")){
const err18 = {instancePath,schemaPath:"#/oneOf/3/additionalProperties",keyword:"additionalProperties",params:{additionalProperty: key3},message:"must NOT have additional properties"};
if(vErrors === null){
vErrors = [err18];
}
else {
vErrors.push(err18);
}
errors++;
}
}
if(data.detector_pair_index !== undefined){
let data6 = data.detector_pair_index;
if(!((typeof data6 == "number") && (!(data6 % 1) && !isNaN(data6)))){
const err19 = {instancePath:instancePath+"/detector_pair_index",schemaPath:"#/oneOf/3/properties/detector_pair_index/type",keyword:"type",params:{type: "integer"},message:"must be integer"};
if(vErrors === null){
vErrors = [err19];
}
else {
vErrors.push(err19);
}
errors++;
}
if(typeof data6 == "number"){
if(data6 < 0 || isNaN(data6)){
const err20 = {instancePath:instancePath+"/detector_pair_index",schemaPath:"#/oneOf/3/properties/detector_pair_index/minimum",keyword:"minimum",params:{comparison: ">=", limit: 0},message:"must be >= 0"};
if(vErrors === null){
vErrors = [err20];
}
else {
vErrors.push(err20);
}
errors++;
}
}
}
}
else {
const err21 = {instancePath,schemaPath:"#/oneOf/3/type",keyword:"type",params:{type: "object"},message:"must be object"};
if(vErrors === null){
vErrors = [err21];
}
else {
vErrors.push(err21);
}
errors++;
}
var _valid0 = _errs21 === errors;
if(_valid0 && valid0){
valid0 = false;
passing0 = [passing0, 3];
}
else {
if(_valid0){
valid0 = true;
passing0 = 3;
if(props0 !== true){
props0 = true;
}
}
const _errs26 = errors;
if(data && typeof data == "object" && !Array.isArray(data)){
if(data.detector_pair_index === undefined){
const err22 = {instancePath,schemaPath:"#/oneOf/4/required",keyword:"required",params:{missingProperty: "detector_pair_index"},message:"must have required property '"+"detector_pair_index"+"'"};
if(vErrors === null){
vErrors = [err22];
}
else {
vErrors.push(err22);
}
errors++;
}
if(data.occurrence_interval === undefined){
const err23 = {instancePath,schemaPath:"#/oneOf/4/required",keyword:"required",params:{missingProperty: "occurrence_interval"},message:"must have required property '"+"occurrence_interval"+"'"};
if(vErrors === null){
vErrors = [err23];
}
else {
vErrors.push(err23);
}
errors++;
}
for(const key4 in data){
if(!((key4 === "detector_pair_index") || (key4 === "occurrence_interval"))){
const err24 = {instancePath,schemaPath:"#/oneOf/4/additionalProperties",keyword:"additionalProperties",params:{additionalProperty: key4},message:"must NOT have additional properties"};
if(vErrors === null){
vErrors = [err24];
}
else {
vErrors.push(err24);
}
errors++;
}
}
if(data.detector_pair_index !== undefined){
let data7 = data.detector_pair_index;
if(!((typeof data7 == "number") && (!(data7 % 1) && !isNaN(data7)))){
const err25 = {instancePath:instancePath+"/detector_pair_index",schemaPath:"#/oneOf/4/properties/detector_pair_index/type",keyword:"type",params:{type: "integer"},message:"must be integer"};
if(vErrors === null){
vErrors = [err25];
}
else {
vErrors.push(err25);
}
errors++;
}
if(typeof data7 == "number"){
if(data7 < 0 || isNaN(data7)){
const err26 = {instancePath:instancePath+"/detector_pair_index",schemaPath:"#/oneOf/4/properties/detector_pair_index/minimum",keyword:"minimum",params:{comparison: ">=", limit: 0},message:"must be >= 0"};
if(vErrors === null){
vErrors = [err26];
}
else {
vErrors.push(err26);
}
errors++;
}
}
}
if(data.occurrence_interval !== undefined){
if(!(validate83(data.occurrence_interval, {instancePath:instancePath+"/occurrence_interval",parentData:data,parentDataProperty:"occurrence_interval",rootData,dynamicAnchors}))){
vErrors = vErrors === null ? validate83.errors : vErrors.concat(validate83.errors);
errors = vErrors.length;
}
}
}
else {
const err27 = {instancePath,schemaPath:"#/oneOf/4/type",keyword:"type",params:{type: "object"},message:"must be object"};
if(vErrors === null){
vErrors = [err27];
}
else {
vErrors.push(err27);
}
errors++;
}
var _valid0 = _errs26 === errors;
if(_valid0 && valid0){
valid0 = false;
passing0 = [passing0, 4];
}
else {
if(_valid0){
valid0 = true;
passing0 = 4;
if(props0 !== true){
props0 = true;
}
}
const _errs32 = errors;
if(data && typeof data == "object" && !Array.isArray(data)){
if(data.raw_remove_start === undefined){
const err28 = {instancePath,schemaPath:"#/oneOf/5/required",keyword:"required",params:{missingProperty: "raw_remove_start"},message:"must have required property '"+"raw_remove_start"+"'"};
if(vErrors === null){
vErrors = [err28];
}
else {
vErrors.push(err28);
}
errors++;
}
if(data.raw_remove_end === undefined){
const err29 = {instancePath,schemaPath:"#/oneOf/5/required",keyword:"required",params:{missingProperty: "raw_remove_end"},message:"must have required property '"+"raw_remove_end"+"'"};
if(vErrors === null){
vErrors = [err29];
}
else {
vErrors.push(err29);
}
errors++;
}
if(data.remove_start_frame === undefined){
const err30 = {instancePath,schemaPath:"#/oneOf/5/required",keyword:"required",params:{missingProperty: "remove_start_frame"},message:"must have required property '"+"remove_start_frame"+"'"};
if(vErrors === null){
vErrors = [err30];
}
else {
vErrors.push(err30);
}
errors++;
}
if(data.remove_end_frame === undefined){
const err31 = {instancePath,schemaPath:"#/oneOf/5/required",keyword:"required",params:{missingProperty: "remove_end_frame"},message:"must have required property '"+"remove_end_frame"+"'"};
if(vErrors === null){
vErrors = [err31];
}
else {
vErrors.push(err31);
}
errors++;
}
for(const key5 in data){
if(!((((key5 === "raw_remove_start") || (key5 === "raw_remove_end")) || (key5 === "remove_start_frame")) || (key5 === "remove_end_frame"))){
const err32 = {instancePath,schemaPath:"#/oneOf/5/additionalProperties",keyword:"additionalProperties",params:{additionalProperty: key5},message:"must NOT have additional properties"};
if(vErrors === null){
vErrors = [err32];
}
else {
vErrors.push(err32);
}
errors++;
}
}
if(data.raw_remove_start !== undefined){
let data9 = data.raw_remove_start;
if(typeof data9 == "number"){
if(data9 < 0 || isNaN(data9)){
const err33 = {instancePath:instancePath+"/raw_remove_start",schemaPath:"#/$defs/seconds/minimum",keyword:"minimum",params:{comparison: ">=", limit: 0},message:"must be >= 0"};
if(vErrors === null){
vErrors = [err33];
}
else {
vErrors.push(err33);
}
errors++;
}
}
else {
const err34 = {instancePath:instancePath+"/raw_remove_start",schemaPath:"#/$defs/seconds/type",keyword:"type",params:{type: "number"},message:"must be number"};
if(vErrors === null){
vErrors = [err34];
}
else {
vErrors.push(err34);
}
errors++;
}
}
if(data.raw_remove_end !== undefined){
let data10 = data.raw_remove_end;
if(typeof data10 == "number"){
if(data10 < 0 || isNaN(data10)){
const err35 = {instancePath:instancePath+"/raw_remove_end",schemaPath:"#/$defs/seconds/minimum",keyword:"minimum",params:{comparison: ">=", limit: 0},message:"must be >= 0"};
if(vErrors === null){
vErrors = [err35];
}
else {
vErrors.push(err35);
}
errors++;
}
}
else {
const err36 = {instancePath:instancePath+"/raw_remove_end",schemaPath:"#/$defs/seconds/type",keyword:"type",params:{type: "number"},message:"must be number"};
if(vErrors === null){
vErrors = [err36];
}
else {
vErrors.push(err36);
}
errors++;
}
}
if(data.remove_start_frame !== undefined){
let data11 = data.remove_start_frame;
if(!((typeof data11 == "number") && (!(data11 % 1) && !isNaN(data11)))){
const err37 = {instancePath:instancePath+"/remove_start_frame",schemaPath:"#/oneOf/5/properties/remove_start_frame/type",keyword:"type",params:{type: "integer"},message:"must be integer"};
if(vErrors === null){
vErrors = [err37];
}
else {
vErrors.push(err37);
}
errors++;
}
if(typeof data11 == "number"){
if(data11 < 0 || isNaN(data11)){
const err38 = {instancePath:instancePath+"/remove_start_frame",schemaPath:"#/oneOf/5/properties/remove_start_frame/minimum",keyword:"minimum",params:{comparison: ">=", limit: 0},message:"must be >= 0"};
if(vErrors === null){
vErrors = [err38];
}
else {
vErrors.push(err38);
}
errors++;
}
}
}
if(data.remove_end_frame !== undefined){
let data12 = data.remove_end_frame;
if(!((typeof data12 == "number") && (!(data12 % 1) && !isNaN(data12)))){
const err39 = {instancePath:instancePath+"/remove_end_frame",schemaPath:"#/oneOf/5/properties/remove_end_frame/type",keyword:"type",params:{type: "integer"},message:"must be integer"};
if(vErrors === null){
vErrors = [err39];
}
else {
vErrors.push(err39);
}
errors++;
}
if(typeof data12 == "number"){
if(data12 < 0 || isNaN(data12)){
const err40 = {instancePath:instancePath+"/remove_end_frame",schemaPath:"#/oneOf/5/properties/remove_end_frame/minimum",keyword:"minimum",params:{comparison: ">=", limit: 0},message:"must be >= 0"};
if(vErrors === null){
vErrors = [err40];
}
else {
vErrors.push(err40);
}
errors++;
}
}
}
}
else {
const err41 = {instancePath,schemaPath:"#/oneOf/5/type",keyword:"type",params:{type: "object"},message:"must be object"};
if(vErrors === null){
vErrors = [err41];
}
else {
vErrors.push(err41);
}
errors++;
}
var _valid0 = _errs32 === errors;
if(_valid0 && valid0){
valid0 = false;
passing0 = [passing0, 5];
}
else {
if(_valid0){
valid0 = true;
passing0 = 5;
if(props0 !== true){
props0 = true;
}
}
const _errs45 = errors;
if(data && typeof data == "object" && !Array.isArray(data)){
if(data.retained_before_seconds === undefined){
const err42 = {instancePath,schemaPath:"#/oneOf/6/required",keyword:"required",params:{missingProperty: "retained_before_seconds"},message:"must have required property '"+"retained_before_seconds"+"'"};
if(vErrors === null){
vErrors = [err42];
}
else {
vErrors.push(err42);
}
errors++;
}
if(data.target_retained_seconds === undefined){
const err43 = {instancePath,schemaPath:"#/oneOf/6/required",keyword:"required",params:{missingProperty: "target_retained_seconds"},message:"must have required property '"+"target_retained_seconds"+"'"};
if(vErrors === null){
vErrors = [err43];
}
else {
vErrors.push(err43);
}
errors++;
}
if(data.retained_after_seconds === undefined){
const err44 = {instancePath,schemaPath:"#/oneOf/6/required",keyword:"required",params:{missingProperty: "retained_after_seconds"},message:"must have required property '"+"retained_after_seconds"+"'"};
if(vErrors === null){
vErrors = [err44];
}
else {
vErrors.push(err44);
}
errors++;
}
for(const key6 in data){
if(!(((key6 === "retained_before_seconds") || (key6 === "target_retained_seconds")) || (key6 === "retained_after_seconds"))){
const err45 = {instancePath,schemaPath:"#/oneOf/6/additionalProperties",keyword:"additionalProperties",params:{additionalProperty: key6},message:"must NOT have additional properties"};
if(vErrors === null){
vErrors = [err45];
}
else {
vErrors.push(err45);
}
errors++;
}
}
if(data.retained_before_seconds !== undefined){
let data13 = data.retained_before_seconds;
if(typeof data13 == "number"){
if(data13 < 0 || isNaN(data13)){
const err46 = {instancePath:instancePath+"/retained_before_seconds",schemaPath:"#/$defs/seconds/minimum",keyword:"minimum",params:{comparison: ">=", limit: 0},message:"must be >= 0"};
if(vErrors === null){
vErrors = [err46];
}
else {
vErrors.push(err46);
}
errors++;
}
}
else {
const err47 = {instancePath:instancePath+"/retained_before_seconds",schemaPath:"#/$defs/seconds/type",keyword:"type",params:{type: "number"},message:"must be number"};
if(vErrors === null){
vErrors = [err47];
}
else {
vErrors.push(err47);
}
errors++;
}
}
if(data.target_retained_seconds !== undefined){
let data14 = data.target_retained_seconds;
if(typeof data14 == "number"){
if(data14 < 0 || isNaN(data14)){
const err48 = {instancePath:instancePath+"/target_retained_seconds",schemaPath:"#/$defs/seconds/minimum",keyword:"minimum",params:{comparison: ">=", limit: 0},message:"must be >= 0"};
if(vErrors === null){
vErrors = [err48];
}
else {
vErrors.push(err48);
}
errors++;
}
}
else {
const err49 = {instancePath:instancePath+"/target_retained_seconds",schemaPath:"#/$defs/seconds/type",keyword:"type",params:{type: "number"},message:"must be number"};
if(vErrors === null){
vErrors = [err49];
}
else {
vErrors.push(err49);
}
errors++;
}
}
if(data.retained_after_seconds !== undefined){
let data15 = data.retained_after_seconds;
if(typeof data15 == "number"){
if(data15 < 0 || isNaN(data15)){
const err50 = {instancePath:instancePath+"/retained_after_seconds",schemaPath:"#/$defs/seconds/minimum",keyword:"minimum",params:{comparison: ">=", limit: 0},message:"must be >= 0"};
if(vErrors === null){
vErrors = [err50];
}
else {
vErrors.push(err50);
}
errors++;
}
}
else {
const err51 = {instancePath:instancePath+"/retained_after_seconds",schemaPath:"#/$defs/seconds/type",keyword:"type",params:{type: "number"},message:"must be number"};
if(vErrors === null){
vErrors = [err51];
}
else {
vErrors.push(err51);
}
errors++;
}
}
}
else {
const err52 = {instancePath,schemaPath:"#/oneOf/6/type",keyword:"type",params:{type: "object"},message:"must be object"};
if(vErrors === null){
vErrors = [err52];
}
else {
vErrors.push(err52);
}
errors++;
}
var _valid0 = _errs45 === errors;
if(_valid0 && valid0){
valid0 = false;
passing0 = [passing0, 6];
}
else {
if(_valid0){
valid0 = true;
passing0 = 6;
if(props0 !== true){
props0 = true;
}
}
}
}
}
}
}
}
if(!valid0){
const err53 = {instancePath,schemaPath:"#/oneOf",keyword:"oneOf",params:{passingSchemas: passing0},message:"must match exactly one schema in oneOf"};
if(vErrors === null){
vErrors = [err53];
}
else {
vErrors.push(err53);
}
errors++;
}
else {
errors = _errs0;
if(vErrors !== null){
if(_errs0){
vErrors.length = _errs0;
}
else {
vErrors = null;
}
}
}
validate106.errors = vErrors;
evaluated0.props = props0;
return errors === 0;
}
validate106.evaluated = {"dynamicProps":true,"dynamicItems":false};


function validate104(data, {instancePath="", parentData, parentDataProperty, rootData=data, dynamicAnchors={}}={}){
let vErrors = null;
let errors = 0;
const evaluated0 = validate104.evaluated;
if(evaluated0.dynamicProps){
evaluated0.props = undefined;
}
if(evaluated0.dynamicItems){
evaluated0.items = undefined;
}
if(data && typeof data == "object" && !Array.isArray(data)){
if(data.id === undefined){
const err0 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "id"},message:"must have required property '"+"id"+"'"};
if(vErrors === null){
vErrors = [err0];
}
else {
vErrors.push(err0);
}
errors++;
}
if(data.src === undefined){
const err1 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "src"},message:"must have required property '"+"src"+"'"};
if(vErrors === null){
vErrors = [err1];
}
else {
vErrors.push(err1);
}
errors++;
}
if(data.occurrence_index === undefined){
const err2 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "occurrence_index"},message:"must have required property '"+"occurrence_index"+"'"};
if(vErrors === null){
vErrors = [err2];
}
else {
vErrors.push(err2);
}
errors++;
}
if(data.occurrence_origin === undefined){
const err3 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "occurrence_origin"},message:"must have required property '"+"occurrence_origin"+"'"};
if(vErrors === null){
vErrors = [err3];
}
else {
vErrors.push(err3);
}
errors++;
}
if(data.source_interval === undefined){
const err4 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "source_interval"},message:"must have required property '"+"source_interval"+"'"};
if(vErrors === null){
vErrors = [err4];
}
else {
vErrors.push(err4);
}
errors++;
}
if(data.code === undefined){
const err5 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "code"},message:"must have required property '"+"code"+"'"};
if(vErrors === null){
vErrors = [err5];
}
else {
vErrors.push(err5);
}
errors++;
}
if(data.detail === undefined){
const err6 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "detail"},message:"must have required property '"+"detail"+"'"};
if(vErrors === null){
vErrors = [err6];
}
else {
vErrors.push(err6);
}
errors++;
}
for(const key0 in data){
if(!(((((((key0 === "id") || (key0 === "src")) || (key0 === "occurrence_index")) || (key0 === "occurrence_origin")) || (key0 === "source_interval")) || (key0 === "code")) || (key0 === "detail"))){
const err7 = {instancePath,schemaPath:"#/additionalProperties",keyword:"additionalProperties",params:{additionalProperty: key0},message:"must NOT have additional properties"};
if(vErrors === null){
vErrors = [err7];
}
else {
vErrors.push(err7);
}
errors++;
}
}
if(data.id !== undefined){
let data0 = data.id;
if(typeof data0 === "string"){
if(!pattern35.test(data0)){
const err8 = {instancePath:instancePath+"/id",schemaPath:"#/properties/id/pattern",keyword:"pattern",params:{pattern: "^skip-[0-9]{4,}$"},message:"must match pattern \""+"^skip-[0-9]{4,}$"+"\""};
if(vErrors === null){
vErrors = [err8];
}
else {
vErrors.push(err8);
}
errors++;
}
}
else {
const err9 = {instancePath:instancePath+"/id",schemaPath:"#/properties/id/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err9];
}
else {
vErrors.push(err9);
}
errors++;
}
}
if(data.src !== undefined){
let data1 = data.src;
const _errs6 = errors;
let valid2 = false;
let passing0 = null;
const _errs7 = errors;
if(data1 !== null){
const err10 = {instancePath:instancePath+"/src",schemaPath:"#/$defs/src/oneOf/0/type",keyword:"type",params:{type: "null"},message:"must be null"};
if(vErrors === null){
vErrors = [err10];
}
else {
vErrors.push(err10);
}
errors++;
}
var _valid0 = _errs7 === errors;
if(_valid0){
valid2 = true;
passing0 = 0;
}
const _errs9 = errors;
if(typeof data1 === "string"){
if(func1(data1) < 1){
const err11 = {instancePath:instancePath+"/src",schemaPath:"#/$defs/src/oneOf/1/minLength",keyword:"minLength",params:{limit: 1},message:"must NOT have fewer than 1 characters"};
if(vErrors === null){
vErrors = [err11];
}
else {
vErrors.push(err11);
}
errors++;
}
if(!pattern4.test(data1)){
const err12 = {instancePath:instancePath+"/src",schemaPath:"#/$defs/src/oneOf/1/pattern",keyword:"pattern",params:{pattern: "\\S"},message:"must match pattern \""+"\\S"+"\""};
if(vErrors === null){
vErrors = [err12];
}
else {
vErrors.push(err12);
}
errors++;
}
}
else {
const err13 = {instancePath:instancePath+"/src",schemaPath:"#/$defs/src/oneOf/1/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err13];
}
else {
vErrors.push(err13);
}
errors++;
}
var _valid0 = _errs9 === errors;
if(_valid0 && valid2){
valid2 = false;
passing0 = [passing0, 1];
}
else {
if(_valid0){
valid2 = true;
passing0 = 1;
}
}
if(!valid2){
const err14 = {instancePath:instancePath+"/src",schemaPath:"#/$defs/src/oneOf",keyword:"oneOf",params:{passingSchemas: passing0},message:"must match exactly one schema in oneOf"};
if(vErrors === null){
vErrors = [err14];
}
else {
vErrors.push(err14);
}
errors++;
}
else {
errors = _errs6;
if(vErrors !== null){
if(_errs6){
vErrors.length = _errs6;
}
else {
vErrors = null;
}
}
}
}
if(data.occurrence_index !== undefined){
let data2 = data.occurrence_index;
const _errs12 = errors;
let valid3 = false;
let passing1 = null;
const _errs13 = errors;
if(data2 !== null){
const err15 = {instancePath:instancePath+"/occurrence_index",schemaPath:"#/properties/occurrence_index/oneOf/0/type",keyword:"type",params:{type: "null"},message:"must be null"};
if(vErrors === null){
vErrors = [err15];
}
else {
vErrors.push(err15);
}
errors++;
}
var _valid1 = _errs13 === errors;
if(_valid1){
valid3 = true;
passing1 = 0;
}
const _errs15 = errors;
if(!((typeof data2 == "number") && (!(data2 % 1) && !isNaN(data2)))){
const err16 = {instancePath:instancePath+"/occurrence_index",schemaPath:"#/properties/occurrence_index/oneOf/1/type",keyword:"type",params:{type: "integer"},message:"must be integer"};
if(vErrors === null){
vErrors = [err16];
}
else {
vErrors.push(err16);
}
errors++;
}
if(typeof data2 == "number"){
if(data2 < 0 || isNaN(data2)){
const err17 = {instancePath:instancePath+"/occurrence_index",schemaPath:"#/properties/occurrence_index/oneOf/1/minimum",keyword:"minimum",params:{comparison: ">=", limit: 0},message:"must be >= 0"};
if(vErrors === null){
vErrors = [err17];
}
else {
vErrors.push(err17);
}
errors++;
}
}
var _valid1 = _errs15 === errors;
if(_valid1 && valid3){
valid3 = false;
passing1 = [passing1, 1];
}
else {
if(_valid1){
valid3 = true;
passing1 = 1;
}
}
if(!valid3){
const err18 = {instancePath:instancePath+"/occurrence_index",schemaPath:"#/properties/occurrence_index/oneOf",keyword:"oneOf",params:{passingSchemas: passing1},message:"must match exactly one schema in oneOf"};
if(vErrors === null){
vErrors = [err18];
}
else {
vErrors.push(err18);
}
errors++;
}
else {
errors = _errs12;
if(vErrors !== null){
if(_errs12){
vErrors.length = _errs12;
}
else {
vErrors = null;
}
}
}
}
if(data.occurrence_origin !== undefined){
let data3 = data.occurrence_origin;
const _errs18 = errors;
let valid4 = false;
let passing2 = null;
const _errs19 = errors;
if(data3 !== null){
const err19 = {instancePath:instancePath+"/occurrence_origin",schemaPath:"#/properties/occurrence_origin/oneOf/0/type",keyword:"type",params:{type: "null"},message:"must be null"};
if(vErrors === null){
vErrors = [err19];
}
else {
vErrors.push(err19);
}
errors++;
}
var _valid2 = _errs19 === errors;
if(_valid2){
valid4 = true;
passing2 = 0;
}
const _errs21 = errors;
if(!((data3 === "explicit_range") || (data3 === "full_source"))){
const err20 = {instancePath:instancePath+"/occurrence_origin",schemaPath:"#/properties/occurrence_origin/oneOf/1/enum",keyword:"enum",params:{allowedValues: schema151.properties.occurrence_origin.oneOf[1].enum},message:"must be equal to one of the allowed values"};
if(vErrors === null){
vErrors = [err20];
}
else {
vErrors.push(err20);
}
errors++;
}
var _valid2 = _errs21 === errors;
if(_valid2 && valid4){
valid4 = false;
passing2 = [passing2, 1];
}
else {
if(_valid2){
valid4 = true;
passing2 = 1;
}
}
if(!valid4){
const err21 = {instancePath:instancePath+"/occurrence_origin",schemaPath:"#/properties/occurrence_origin/oneOf",keyword:"oneOf",params:{passingSchemas: passing2},message:"must match exactly one schema in oneOf"};
if(vErrors === null){
vErrors = [err21];
}
else {
vErrors.push(err21);
}
errors++;
}
else {
errors = _errs18;
if(vErrors !== null){
if(_errs18){
vErrors.length = _errs18;
}
else {
vErrors = null;
}
}
}
}
if(data.source_interval !== undefined){
if(!(validate83(data.source_interval, {instancePath:instancePath+"/source_interval",parentData:data,parentDataProperty:"source_interval",rootData,dynamicAnchors}))){
vErrors = vErrors === null ? validate83.errors : vErrors.concat(validate83.errors);
errors = vErrors.length;
}
}
if(data.code !== undefined){
let data5 = data.code;
if(!((((((((data5 === "WORD_TIMING_UNAVAILABLE") || (data5 === "MISSING_SPEECH_CONTEXT")) || (data5 === "PROTECTED_WORD_OVERLAP")) || (data5 === "OUTSIDE_KEEP_OCCURRENCE")) || (data5 === "CROSSES_OCCURRENCE_BOUNDARY")) || (data5 === "NO_FRAME_CELL")) || (data5 === "NO_EFFECTIVE_CHANGE")) || (data5 === "TARGET_NOT_REACHED"))){
const err22 = {instancePath:instancePath+"/code",schemaPath:"#/$defs/skipCode/enum",keyword:"enum",params:{allowedValues: schema153.enum},message:"must be equal to one of the allowed values"};
if(vErrors === null){
vErrors = [err22];
}
else {
vErrors.push(err22);
}
errors++;
}
}
if(data.detail !== undefined){
if(!(validate106(data.detail, {instancePath:instancePath+"/detail",parentData:data,parentDataProperty:"detail",rootData,dynamicAnchors}))){
vErrors = vErrors === null ? validate106.errors : vErrors.concat(validate106.errors);
errors = vErrors.length;
}
}
}
else {
const err23 = {instancePath,schemaPath:"#/type",keyword:"type",params:{type: "object"},message:"must be object"};
if(vErrors === null){
vErrors = [err23];
}
else {
vErrors.push(err23);
}
errors++;
}
validate104.errors = vErrors;
return errors === 0;
}
validate104.evaluated = {"props":true,"dynamicProps":false,"dynamicItems":false};

const schema160 = {"type":"object","additionalProperties":false,"required":["candidate_count","semantic_event_review_count","pause_shortening_review_count","skipped_count","skipped_by_code","by_source"],"properties":{"candidate_count":{"type":"integer","minimum":0},"semantic_event_review_count":{"type":"integer","minimum":0},"pause_shortening_review_count":{"type":"integer","minimum":0},"skipped_count":{"type":"integer","minimum":0},"skipped_by_code":{"$ref":"#/$defs/skippedByCode"},"by_source":{"type":"array","items":{"$ref":"#/$defs/sourceSummary"}}}};
const schema161 = {"type":"object","additionalProperties":false,"properties":{"WORD_TIMING_UNAVAILABLE":{"type":"integer","minimum":1},"MISSING_SPEECH_CONTEXT":{"type":"integer","minimum":1},"PROTECTED_WORD_OVERLAP":{"type":"integer","minimum":1},"OUTSIDE_KEEP_OCCURRENCE":{"type":"integer","minimum":1},"CROSSES_OCCURRENCE_BOUNDARY":{"type":"integer","minimum":1},"NO_FRAME_CELL":{"type":"integer","minimum":1},"NO_EFFECTIVE_CHANGE":{"type":"integer","minimum":1},"TARGET_NOT_REACHED":{"type":"integer","minimum":1}}};
const schema162 = {"type":"object","additionalProperties":false,"required":["src","candidate_count","skipped_count"],"properties":{"src":{"$ref":"#/$defs/src"},"candidate_count":{"type":"integer","minimum":0},"skipped_count":{"type":"integer","minimum":0}}};

function validate112(data, {instancePath="", parentData, parentDataProperty, rootData=data, dynamicAnchors={}}={}){
let vErrors = null;
let errors = 0;
const evaluated0 = validate112.evaluated;
if(evaluated0.dynamicProps){
evaluated0.props = undefined;
}
if(evaluated0.dynamicItems){
evaluated0.items = undefined;
}
if(data && typeof data == "object" && !Array.isArray(data)){
if(data.src === undefined){
const err0 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "src"},message:"must have required property '"+"src"+"'"};
if(vErrors === null){
vErrors = [err0];
}
else {
vErrors.push(err0);
}
errors++;
}
if(data.candidate_count === undefined){
const err1 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "candidate_count"},message:"must have required property '"+"candidate_count"+"'"};
if(vErrors === null){
vErrors = [err1];
}
else {
vErrors.push(err1);
}
errors++;
}
if(data.skipped_count === undefined){
const err2 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "skipped_count"},message:"must have required property '"+"skipped_count"+"'"};
if(vErrors === null){
vErrors = [err2];
}
else {
vErrors.push(err2);
}
errors++;
}
for(const key0 in data){
if(!(((key0 === "src") || (key0 === "candidate_count")) || (key0 === "skipped_count"))){
const err3 = {instancePath,schemaPath:"#/additionalProperties",keyword:"additionalProperties",params:{additionalProperty: key0},message:"must NOT have additional properties"};
if(vErrors === null){
vErrors = [err3];
}
else {
vErrors.push(err3);
}
errors++;
}
}
if(data.src !== undefined){
let data0 = data.src;
const _errs4 = errors;
let valid2 = false;
let passing0 = null;
const _errs5 = errors;
if(data0 !== null){
const err4 = {instancePath:instancePath+"/src",schemaPath:"#/$defs/src/oneOf/0/type",keyword:"type",params:{type: "null"},message:"must be null"};
if(vErrors === null){
vErrors = [err4];
}
else {
vErrors.push(err4);
}
errors++;
}
var _valid0 = _errs5 === errors;
if(_valid0){
valid2 = true;
passing0 = 0;
}
const _errs7 = errors;
if(typeof data0 === "string"){
if(func1(data0) < 1){
const err5 = {instancePath:instancePath+"/src",schemaPath:"#/$defs/src/oneOf/1/minLength",keyword:"minLength",params:{limit: 1},message:"must NOT have fewer than 1 characters"};
if(vErrors === null){
vErrors = [err5];
}
else {
vErrors.push(err5);
}
errors++;
}
if(!pattern4.test(data0)){
const err6 = {instancePath:instancePath+"/src",schemaPath:"#/$defs/src/oneOf/1/pattern",keyword:"pattern",params:{pattern: "\\S"},message:"must match pattern \""+"\\S"+"\""};
if(vErrors === null){
vErrors = [err6];
}
else {
vErrors.push(err6);
}
errors++;
}
}
else {
const err7 = {instancePath:instancePath+"/src",schemaPath:"#/$defs/src/oneOf/1/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err7];
}
else {
vErrors.push(err7);
}
errors++;
}
var _valid0 = _errs7 === errors;
if(_valid0 && valid2){
valid2 = false;
passing0 = [passing0, 1];
}
else {
if(_valid0){
valid2 = true;
passing0 = 1;
}
}
if(!valid2){
const err8 = {instancePath:instancePath+"/src",schemaPath:"#/$defs/src/oneOf",keyword:"oneOf",params:{passingSchemas: passing0},message:"must match exactly one schema in oneOf"};
if(vErrors === null){
vErrors = [err8];
}
else {
vErrors.push(err8);
}
errors++;
}
else {
errors = _errs4;
if(vErrors !== null){
if(_errs4){
vErrors.length = _errs4;
}
else {
vErrors = null;
}
}
}
}
if(data.candidate_count !== undefined){
let data1 = data.candidate_count;
if(!((typeof data1 == "number") && (!(data1 % 1) && !isNaN(data1)))){
const err9 = {instancePath:instancePath+"/candidate_count",schemaPath:"#/properties/candidate_count/type",keyword:"type",params:{type: "integer"},message:"must be integer"};
if(vErrors === null){
vErrors = [err9];
}
else {
vErrors.push(err9);
}
errors++;
}
if(typeof data1 == "number"){
if(data1 < 0 || isNaN(data1)){
const err10 = {instancePath:instancePath+"/candidate_count",schemaPath:"#/properties/candidate_count/minimum",keyword:"minimum",params:{comparison: ">=", limit: 0},message:"must be >= 0"};
if(vErrors === null){
vErrors = [err10];
}
else {
vErrors.push(err10);
}
errors++;
}
}
}
if(data.skipped_count !== undefined){
let data2 = data.skipped_count;
if(!((typeof data2 == "number") && (!(data2 % 1) && !isNaN(data2)))){
const err11 = {instancePath:instancePath+"/skipped_count",schemaPath:"#/properties/skipped_count/type",keyword:"type",params:{type: "integer"},message:"must be integer"};
if(vErrors === null){
vErrors = [err11];
}
else {
vErrors.push(err11);
}
errors++;
}
if(typeof data2 == "number"){
if(data2 < 0 || isNaN(data2)){
const err12 = {instancePath:instancePath+"/skipped_count",schemaPath:"#/properties/skipped_count/minimum",keyword:"minimum",params:{comparison: ">=", limit: 0},message:"must be >= 0"};
if(vErrors === null){
vErrors = [err12];
}
else {
vErrors.push(err12);
}
errors++;
}
}
}
}
else {
const err13 = {instancePath,schemaPath:"#/type",keyword:"type",params:{type: "object"},message:"must be object"};
if(vErrors === null){
vErrors = [err13];
}
else {
vErrors.push(err13);
}
errors++;
}
validate112.errors = vErrors;
return errors === 0;
}
validate112.evaluated = {"props":true,"dynamicProps":false,"dynamicItems":false};


function validate111(data, {instancePath="", parentData, parentDataProperty, rootData=data, dynamicAnchors={}}={}){
let vErrors = null;
let errors = 0;
const evaluated0 = validate111.evaluated;
if(evaluated0.dynamicProps){
evaluated0.props = undefined;
}
if(evaluated0.dynamicItems){
evaluated0.items = undefined;
}
if(data && typeof data == "object" && !Array.isArray(data)){
if(data.candidate_count === undefined){
const err0 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "candidate_count"},message:"must have required property '"+"candidate_count"+"'"};
if(vErrors === null){
vErrors = [err0];
}
else {
vErrors.push(err0);
}
errors++;
}
if(data.semantic_event_review_count === undefined){
const err1 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "semantic_event_review_count"},message:"must have required property '"+"semantic_event_review_count"+"'"};
if(vErrors === null){
vErrors = [err1];
}
else {
vErrors.push(err1);
}
errors++;
}
if(data.pause_shortening_review_count === undefined){
const err2 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "pause_shortening_review_count"},message:"must have required property '"+"pause_shortening_review_count"+"'"};
if(vErrors === null){
vErrors = [err2];
}
else {
vErrors.push(err2);
}
errors++;
}
if(data.skipped_count === undefined){
const err3 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "skipped_count"},message:"must have required property '"+"skipped_count"+"'"};
if(vErrors === null){
vErrors = [err3];
}
else {
vErrors.push(err3);
}
errors++;
}
if(data.skipped_by_code === undefined){
const err4 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "skipped_by_code"},message:"must have required property '"+"skipped_by_code"+"'"};
if(vErrors === null){
vErrors = [err4];
}
else {
vErrors.push(err4);
}
errors++;
}
if(data.by_source === undefined){
const err5 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "by_source"},message:"must have required property '"+"by_source"+"'"};
if(vErrors === null){
vErrors = [err5];
}
else {
vErrors.push(err5);
}
errors++;
}
for(const key0 in data){
if(!((((((key0 === "candidate_count") || (key0 === "semantic_event_review_count")) || (key0 === "pause_shortening_review_count")) || (key0 === "skipped_count")) || (key0 === "skipped_by_code")) || (key0 === "by_source"))){
const err6 = {instancePath,schemaPath:"#/additionalProperties",keyword:"additionalProperties",params:{additionalProperty: key0},message:"must NOT have additional properties"};
if(vErrors === null){
vErrors = [err6];
}
else {
vErrors.push(err6);
}
errors++;
}
}
if(data.candidate_count !== undefined){
let data0 = data.candidate_count;
if(!((typeof data0 == "number") && (!(data0 % 1) && !isNaN(data0)))){
const err7 = {instancePath:instancePath+"/candidate_count",schemaPath:"#/properties/candidate_count/type",keyword:"type",params:{type: "integer"},message:"must be integer"};
if(vErrors === null){
vErrors = [err7];
}
else {
vErrors.push(err7);
}
errors++;
}
if(typeof data0 == "number"){
if(data0 < 0 || isNaN(data0)){
const err8 = {instancePath:instancePath+"/candidate_count",schemaPath:"#/properties/candidate_count/minimum",keyword:"minimum",params:{comparison: ">=", limit: 0},message:"must be >= 0"};
if(vErrors === null){
vErrors = [err8];
}
else {
vErrors.push(err8);
}
errors++;
}
}
}
if(data.semantic_event_review_count !== undefined){
let data1 = data.semantic_event_review_count;
if(!((typeof data1 == "number") && (!(data1 % 1) && !isNaN(data1)))){
const err9 = {instancePath:instancePath+"/semantic_event_review_count",schemaPath:"#/properties/semantic_event_review_count/type",keyword:"type",params:{type: "integer"},message:"must be integer"};
if(vErrors === null){
vErrors = [err9];
}
else {
vErrors.push(err9);
}
errors++;
}
if(typeof data1 == "number"){
if(data1 < 0 || isNaN(data1)){
const err10 = {instancePath:instancePath+"/semantic_event_review_count",schemaPath:"#/properties/semantic_event_review_count/minimum",keyword:"minimum",params:{comparison: ">=", limit: 0},message:"must be >= 0"};
if(vErrors === null){
vErrors = [err10];
}
else {
vErrors.push(err10);
}
errors++;
}
}
}
if(data.pause_shortening_review_count !== undefined){
let data2 = data.pause_shortening_review_count;
if(!((typeof data2 == "number") && (!(data2 % 1) && !isNaN(data2)))){
const err11 = {instancePath:instancePath+"/pause_shortening_review_count",schemaPath:"#/properties/pause_shortening_review_count/type",keyword:"type",params:{type: "integer"},message:"must be integer"};
if(vErrors === null){
vErrors = [err11];
}
else {
vErrors.push(err11);
}
errors++;
}
if(typeof data2 == "number"){
if(data2 < 0 || isNaN(data2)){
const err12 = {instancePath:instancePath+"/pause_shortening_review_count",schemaPath:"#/properties/pause_shortening_review_count/minimum",keyword:"minimum",params:{comparison: ">=", limit: 0},message:"must be >= 0"};
if(vErrors === null){
vErrors = [err12];
}
else {
vErrors.push(err12);
}
errors++;
}
}
}
if(data.skipped_count !== undefined){
let data3 = data.skipped_count;
if(!((typeof data3 == "number") && (!(data3 % 1) && !isNaN(data3)))){
const err13 = {instancePath:instancePath+"/skipped_count",schemaPath:"#/properties/skipped_count/type",keyword:"type",params:{type: "integer"},message:"must be integer"};
if(vErrors === null){
vErrors = [err13];
}
else {
vErrors.push(err13);
}
errors++;
}
if(typeof data3 == "number"){
if(data3 < 0 || isNaN(data3)){
const err14 = {instancePath:instancePath+"/skipped_count",schemaPath:"#/properties/skipped_count/minimum",keyword:"minimum",params:{comparison: ">=", limit: 0},message:"must be >= 0"};
if(vErrors === null){
vErrors = [err14];
}
else {
vErrors.push(err14);
}
errors++;
}
}
}
if(data.skipped_by_code !== undefined){
let data4 = data.skipped_by_code;
if(data4 && typeof data4 == "object" && !Array.isArray(data4)){
for(const key1 in data4){
if(!((((((((key1 === "WORD_TIMING_UNAVAILABLE") || (key1 === "MISSING_SPEECH_CONTEXT")) || (key1 === "PROTECTED_WORD_OVERLAP")) || (key1 === "OUTSIDE_KEEP_OCCURRENCE")) || (key1 === "CROSSES_OCCURRENCE_BOUNDARY")) || (key1 === "NO_FRAME_CELL")) || (key1 === "NO_EFFECTIVE_CHANGE")) || (key1 === "TARGET_NOT_REACHED"))){
const err15 = {instancePath:instancePath+"/skipped_by_code",schemaPath:"#/$defs/skippedByCode/additionalProperties",keyword:"additionalProperties",params:{additionalProperty: key1},message:"must NOT have additional properties"};
if(vErrors === null){
vErrors = [err15];
}
else {
vErrors.push(err15);
}
errors++;
}
}
if(data4.WORD_TIMING_UNAVAILABLE !== undefined){
let data5 = data4.WORD_TIMING_UNAVAILABLE;
if(!((typeof data5 == "number") && (!(data5 % 1) && !isNaN(data5)))){
const err16 = {instancePath:instancePath+"/skipped_by_code/WORD_TIMING_UNAVAILABLE",schemaPath:"#/$defs/skippedByCode/properties/WORD_TIMING_UNAVAILABLE/type",keyword:"type",params:{type: "integer"},message:"must be integer"};
if(vErrors === null){
vErrors = [err16];
}
else {
vErrors.push(err16);
}
errors++;
}
if(typeof data5 == "number"){
if(data5 < 1 || isNaN(data5)){
const err17 = {instancePath:instancePath+"/skipped_by_code/WORD_TIMING_UNAVAILABLE",schemaPath:"#/$defs/skippedByCode/properties/WORD_TIMING_UNAVAILABLE/minimum",keyword:"minimum",params:{comparison: ">=", limit: 1},message:"must be >= 1"};
if(vErrors === null){
vErrors = [err17];
}
else {
vErrors.push(err17);
}
errors++;
}
}
}
if(data4.MISSING_SPEECH_CONTEXT !== undefined){
let data6 = data4.MISSING_SPEECH_CONTEXT;
if(!((typeof data6 == "number") && (!(data6 % 1) && !isNaN(data6)))){
const err18 = {instancePath:instancePath+"/skipped_by_code/MISSING_SPEECH_CONTEXT",schemaPath:"#/$defs/skippedByCode/properties/MISSING_SPEECH_CONTEXT/type",keyword:"type",params:{type: "integer"},message:"must be integer"};
if(vErrors === null){
vErrors = [err18];
}
else {
vErrors.push(err18);
}
errors++;
}
if(typeof data6 == "number"){
if(data6 < 1 || isNaN(data6)){
const err19 = {instancePath:instancePath+"/skipped_by_code/MISSING_SPEECH_CONTEXT",schemaPath:"#/$defs/skippedByCode/properties/MISSING_SPEECH_CONTEXT/minimum",keyword:"minimum",params:{comparison: ">=", limit: 1},message:"must be >= 1"};
if(vErrors === null){
vErrors = [err19];
}
else {
vErrors.push(err19);
}
errors++;
}
}
}
if(data4.PROTECTED_WORD_OVERLAP !== undefined){
let data7 = data4.PROTECTED_WORD_OVERLAP;
if(!((typeof data7 == "number") && (!(data7 % 1) && !isNaN(data7)))){
const err20 = {instancePath:instancePath+"/skipped_by_code/PROTECTED_WORD_OVERLAP",schemaPath:"#/$defs/skippedByCode/properties/PROTECTED_WORD_OVERLAP/type",keyword:"type",params:{type: "integer"},message:"must be integer"};
if(vErrors === null){
vErrors = [err20];
}
else {
vErrors.push(err20);
}
errors++;
}
if(typeof data7 == "number"){
if(data7 < 1 || isNaN(data7)){
const err21 = {instancePath:instancePath+"/skipped_by_code/PROTECTED_WORD_OVERLAP",schemaPath:"#/$defs/skippedByCode/properties/PROTECTED_WORD_OVERLAP/minimum",keyword:"minimum",params:{comparison: ">=", limit: 1},message:"must be >= 1"};
if(vErrors === null){
vErrors = [err21];
}
else {
vErrors.push(err21);
}
errors++;
}
}
}
if(data4.OUTSIDE_KEEP_OCCURRENCE !== undefined){
let data8 = data4.OUTSIDE_KEEP_OCCURRENCE;
if(!((typeof data8 == "number") && (!(data8 % 1) && !isNaN(data8)))){
const err22 = {instancePath:instancePath+"/skipped_by_code/OUTSIDE_KEEP_OCCURRENCE",schemaPath:"#/$defs/skippedByCode/properties/OUTSIDE_KEEP_OCCURRENCE/type",keyword:"type",params:{type: "integer"},message:"must be integer"};
if(vErrors === null){
vErrors = [err22];
}
else {
vErrors.push(err22);
}
errors++;
}
if(typeof data8 == "number"){
if(data8 < 1 || isNaN(data8)){
const err23 = {instancePath:instancePath+"/skipped_by_code/OUTSIDE_KEEP_OCCURRENCE",schemaPath:"#/$defs/skippedByCode/properties/OUTSIDE_KEEP_OCCURRENCE/minimum",keyword:"minimum",params:{comparison: ">=", limit: 1},message:"must be >= 1"};
if(vErrors === null){
vErrors = [err23];
}
else {
vErrors.push(err23);
}
errors++;
}
}
}
if(data4.CROSSES_OCCURRENCE_BOUNDARY !== undefined){
let data9 = data4.CROSSES_OCCURRENCE_BOUNDARY;
if(!((typeof data9 == "number") && (!(data9 % 1) && !isNaN(data9)))){
const err24 = {instancePath:instancePath+"/skipped_by_code/CROSSES_OCCURRENCE_BOUNDARY",schemaPath:"#/$defs/skippedByCode/properties/CROSSES_OCCURRENCE_BOUNDARY/type",keyword:"type",params:{type: "integer"},message:"must be integer"};
if(vErrors === null){
vErrors = [err24];
}
else {
vErrors.push(err24);
}
errors++;
}
if(typeof data9 == "number"){
if(data9 < 1 || isNaN(data9)){
const err25 = {instancePath:instancePath+"/skipped_by_code/CROSSES_OCCURRENCE_BOUNDARY",schemaPath:"#/$defs/skippedByCode/properties/CROSSES_OCCURRENCE_BOUNDARY/minimum",keyword:"minimum",params:{comparison: ">=", limit: 1},message:"must be >= 1"};
if(vErrors === null){
vErrors = [err25];
}
else {
vErrors.push(err25);
}
errors++;
}
}
}
if(data4.NO_FRAME_CELL !== undefined){
let data10 = data4.NO_FRAME_CELL;
if(!((typeof data10 == "number") && (!(data10 % 1) && !isNaN(data10)))){
const err26 = {instancePath:instancePath+"/skipped_by_code/NO_FRAME_CELL",schemaPath:"#/$defs/skippedByCode/properties/NO_FRAME_CELL/type",keyword:"type",params:{type: "integer"},message:"must be integer"};
if(vErrors === null){
vErrors = [err26];
}
else {
vErrors.push(err26);
}
errors++;
}
if(typeof data10 == "number"){
if(data10 < 1 || isNaN(data10)){
const err27 = {instancePath:instancePath+"/skipped_by_code/NO_FRAME_CELL",schemaPath:"#/$defs/skippedByCode/properties/NO_FRAME_CELL/minimum",keyword:"minimum",params:{comparison: ">=", limit: 1},message:"must be >= 1"};
if(vErrors === null){
vErrors = [err27];
}
else {
vErrors.push(err27);
}
errors++;
}
}
}
if(data4.NO_EFFECTIVE_CHANGE !== undefined){
let data11 = data4.NO_EFFECTIVE_CHANGE;
if(!((typeof data11 == "number") && (!(data11 % 1) && !isNaN(data11)))){
const err28 = {instancePath:instancePath+"/skipped_by_code/NO_EFFECTIVE_CHANGE",schemaPath:"#/$defs/skippedByCode/properties/NO_EFFECTIVE_CHANGE/type",keyword:"type",params:{type: "integer"},message:"must be integer"};
if(vErrors === null){
vErrors = [err28];
}
else {
vErrors.push(err28);
}
errors++;
}
if(typeof data11 == "number"){
if(data11 < 1 || isNaN(data11)){
const err29 = {instancePath:instancePath+"/skipped_by_code/NO_EFFECTIVE_CHANGE",schemaPath:"#/$defs/skippedByCode/properties/NO_EFFECTIVE_CHANGE/minimum",keyword:"minimum",params:{comparison: ">=", limit: 1},message:"must be >= 1"};
if(vErrors === null){
vErrors = [err29];
}
else {
vErrors.push(err29);
}
errors++;
}
}
}
if(data4.TARGET_NOT_REACHED !== undefined){
let data12 = data4.TARGET_NOT_REACHED;
if(!((typeof data12 == "number") && (!(data12 % 1) && !isNaN(data12)))){
const err30 = {instancePath:instancePath+"/skipped_by_code/TARGET_NOT_REACHED",schemaPath:"#/$defs/skippedByCode/properties/TARGET_NOT_REACHED/type",keyword:"type",params:{type: "integer"},message:"must be integer"};
if(vErrors === null){
vErrors = [err30];
}
else {
vErrors.push(err30);
}
errors++;
}
if(typeof data12 == "number"){
if(data12 < 1 || isNaN(data12)){
const err31 = {instancePath:instancePath+"/skipped_by_code/TARGET_NOT_REACHED",schemaPath:"#/$defs/skippedByCode/properties/TARGET_NOT_REACHED/minimum",keyword:"minimum",params:{comparison: ">=", limit: 1},message:"must be >= 1"};
if(vErrors === null){
vErrors = [err31];
}
else {
vErrors.push(err31);
}
errors++;
}
}
}
}
else {
const err32 = {instancePath:instancePath+"/skipped_by_code",schemaPath:"#/$defs/skippedByCode/type",keyword:"type",params:{type: "object"},message:"must be object"};
if(vErrors === null){
vErrors = [err32];
}
else {
vErrors.push(err32);
}
errors++;
}
}
if(data.by_source !== undefined){
let data13 = data.by_source;
if(Array.isArray(data13)){
const len0 = data13.length;
for(let i0=0; i0<len0; i0++){
if(!(validate112(data13[i0], {instancePath:instancePath+"/by_source/" + i0,parentData:data13,parentDataProperty:i0,rootData,dynamicAnchors}))){
vErrors = vErrors === null ? validate112.errors : vErrors.concat(validate112.errors);
errors = vErrors.length;
}
}
}
else {
const err33 = {instancePath:instancePath+"/by_source",schemaPath:"#/properties/by_source/type",keyword:"type",params:{type: "array"},message:"must be array"};
if(vErrors === null){
vErrors = [err33];
}
else {
vErrors.push(err33);
}
errors++;
}
}
}
else {
const err34 = {instancePath,schemaPath:"#/type",keyword:"type",params:{type: "object"},message:"must be object"};
if(vErrors === null){
vErrors = [err34];
}
else {
vErrors.push(err34);
}
errors++;
}
validate111.errors = vErrors;
return errors === 0;
}
validate111.evaluated = {"props":true,"dynamicProps":false,"dynamicItems":false};


function validate52(data, {instancePath="", parentData, parentDataProperty, rootData=data, dynamicAnchors={}}={}){
/*# sourceURL="urn:akari-video:schema:cut-candidates:v1" */;
let vErrors = null;
let errors = 0;
const evaluated0 = validate52.evaluated;
if(evaluated0.dynamicProps){
evaluated0.props = undefined;
}
if(evaluated0.dynamicItems){
evaluated0.items = undefined;
}
if(data && typeof data == "object" && !Array.isArray(data)){
if(data.version === undefined){
const err0 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "version"},message:"must have required property '"+"version"+"'"};
if(vErrors === null){
vErrors = [err0];
}
else {
vErrors.push(err0);
}
errors++;
}
if(data.kind === undefined){
const err1 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "kind"},message:"must have required property '"+"kind"+"'"};
if(vErrors === null){
vErrors = [err1];
}
else {
vErrors.push(err1);
}
errors++;
}
if(data.policy === undefined){
const err2 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "policy"},message:"must have required property '"+"policy"+"'"};
if(vErrors === null){
vErrors = [err2];
}
else {
vErrors.push(err2);
}
errors++;
}
if(data.inputs === undefined){
const err3 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "inputs"},message:"must have required property '"+"inputs"+"'"};
if(vErrors === null){
vErrors = [err3];
}
else {
vErrors.push(err3);
}
errors++;
}
if(data.tool === undefined){
const err4 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "tool"},message:"must have required property '"+"tool"+"'"};
if(vErrors === null){
vErrors = [err4];
}
else {
vErrors.push(err4);
}
errors++;
}
if(data.candidates === undefined){
const err5 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "candidates"},message:"must have required property '"+"candidates"+"'"};
if(vErrors === null){
vErrors = [err5];
}
else {
vErrors.push(err5);
}
errors++;
}
if(data.skipped === undefined){
const err6 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "skipped"},message:"must have required property '"+"skipped"+"'"};
if(vErrors === null){
vErrors = [err6];
}
else {
vErrors.push(err6);
}
errors++;
}
if(data.summary === undefined){
const err7 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "summary"},message:"must have required property '"+"summary"+"'"};
if(vErrors === null){
vErrors = [err7];
}
else {
vErrors.push(err7);
}
errors++;
}
if(data.residual_risks === undefined){
const err8 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "residual_risks"},message:"must have required property '"+"residual_risks"+"'"};
if(vErrors === null){
vErrors = [err8];
}
else {
vErrors.push(err8);
}
errors++;
}
if(data.approved_to_apply === undefined){
const err9 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "approved_to_apply"},message:"must have required property '"+"approved_to_apply"+"'"};
if(vErrors === null){
vErrors = [err9];
}
else {
vErrors.push(err9);
}
errors++;
}
if(data.edit_json_modified === undefined){
const err10 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "edit_json_modified"},message:"must have required property '"+"edit_json_modified"+"'"};
if(vErrors === null){
vErrors = [err10];
}
else {
vErrors.push(err10);
}
errors++;
}
for(const key0 in data){
if(!(func20.call(schema76.properties, key0))){
const err11 = {instancePath,schemaPath:"#/additionalProperties",keyword:"additionalProperties",params:{additionalProperty: key0},message:"must NOT have additional properties"};
if(vErrors === null){
vErrors = [err11];
}
else {
vErrors.push(err11);
}
errors++;
}
}
if(data.version !== undefined){
if(1 !== data.version){
const err12 = {instancePath:instancePath+"/version",schemaPath:"#/properties/version/const",keyword:"const",params:{allowedValue: 1},message:"must be equal to constant"};
if(vErrors === null){
vErrors = [err12];
}
else {
vErrors.push(err12);
}
errors++;
}
}
if(data.kind !== undefined){
if("akari-cut-candidates-v1" !== data.kind){
const err13 = {instancePath:instancePath+"/kind",schemaPath:"#/properties/kind/const",keyword:"const",params:{allowedValue: "akari-cut-candidates-v1"},message:"must be equal to constant"};
if(vErrors === null){
vErrors = [err13];
}
else {
vErrors.push(err13);
}
errors++;
}
}
if(data.policy !== undefined){
if(!(validate53(data.policy, {instancePath:instancePath+"/policy",parentData:data,parentDataProperty:"policy",rootData,dynamicAnchors}))){
vErrors = vErrors === null ? validate53.errors : vErrors.concat(validate53.errors);
errors = vErrors.length;
}
}
if(data.inputs !== undefined){
if(!(validate55(data.inputs, {instancePath:instancePath+"/inputs",parentData:data,parentDataProperty:"inputs",rootData,dynamicAnchors}))){
vErrors = vErrors === null ? validate55.errors : vErrors.concat(validate55.errors);
errors = vErrors.length;
}
}
if(data.tool !== undefined){
if(!(validate71(data.tool, {instancePath:instancePath+"/tool",parentData:data,parentDataProperty:"tool",rootData,dynamicAnchors}))){
vErrors = vErrors === null ? validate71.errors : vErrors.concat(validate71.errors);
errors = vErrors.length;
}
}
if(data.candidates !== undefined){
let data5 = data.candidates;
if(Array.isArray(data5)){
if(data5.length > 1000000){
const err14 = {instancePath:instancePath+"/candidates",schemaPath:"#/properties/candidates/maxItems",keyword:"maxItems",params:{limit: 1000000},message:"must NOT have more than 1000000 items"};
if(vErrors === null){
vErrors = [err14];
}
else {
vErrors.push(err14);
}
errors++;
}
const len0 = data5.length;
for(let i0=0; i0<len0; i0++){
let data6 = data5[i0];
const _errs10 = errors;
let valid3 = false;
let passing0 = null;
const _errs11 = errors;
if(!(validate82(data6, {instancePath:instancePath+"/candidates/" + i0,parentData:data5,parentDataProperty:i0,rootData,dynamicAnchors}))){
vErrors = vErrors === null ? validate82.errors : vErrors.concat(validate82.errors);
errors = vErrors.length;
}
var _valid0 = _errs11 === errors;
if(_valid0){
valid3 = true;
passing0 = 0;
var props0 = true;
}
const _errs12 = errors;
if(!(validate97(data6, {instancePath:instancePath+"/candidates/" + i0,parentData:data5,parentDataProperty:i0,rootData,dynamicAnchors}))){
vErrors = vErrors === null ? validate97.errors : vErrors.concat(validate97.errors);
errors = vErrors.length;
}
var _valid0 = _errs12 === errors;
if(_valid0 && valid3){
valid3 = false;
passing0 = [passing0, 1];
}
else {
if(_valid0){
valid3 = true;
passing0 = 1;
if(props0 !== true){
props0 = true;
}
}
}
if(!valid3){
const err15 = {instancePath:instancePath+"/candidates/" + i0,schemaPath:"#/properties/candidates/items/oneOf",keyword:"oneOf",params:{passingSchemas: passing0},message:"must match exactly one schema in oneOf"};
if(vErrors === null){
vErrors = [err15];
}
else {
vErrors.push(err15);
}
errors++;
}
else {
errors = _errs10;
if(vErrors !== null){
if(_errs10){
vErrors.length = _errs10;
}
else {
vErrors = null;
}
}
}
}
}
else {
const err16 = {instancePath:instancePath+"/candidates",schemaPath:"#/properties/candidates/type",keyword:"type",params:{type: "array"},message:"must be array"};
if(vErrors === null){
vErrors = [err16];
}
else {
vErrors.push(err16);
}
errors++;
}
}
if(data.skipped !== undefined){
let data7 = data.skipped;
if(Array.isArray(data7)){
if(data7.length > 1000000){
const err17 = {instancePath:instancePath+"/skipped",schemaPath:"#/properties/skipped/maxItems",keyword:"maxItems",params:{limit: 1000000},message:"must NOT have more than 1000000 items"};
if(vErrors === null){
vErrors = [err17];
}
else {
vErrors.push(err17);
}
errors++;
}
const len1 = data7.length;
for(let i1=0; i1<len1; i1++){
if(!(validate104(data7[i1], {instancePath:instancePath+"/skipped/" + i1,parentData:data7,parentDataProperty:i1,rootData,dynamicAnchors}))){
vErrors = vErrors === null ? validate104.errors : vErrors.concat(validate104.errors);
errors = vErrors.length;
}
}
}
else {
const err18 = {instancePath:instancePath+"/skipped",schemaPath:"#/properties/skipped/type",keyword:"type",params:{type: "array"},message:"must be array"};
if(vErrors === null){
vErrors = [err18];
}
else {
vErrors.push(err18);
}
errors++;
}
}
if(data.summary !== undefined){
if(!(validate111(data.summary, {instancePath:instancePath+"/summary",parentData:data,parentDataProperty:"summary",rootData,dynamicAnchors}))){
vErrors = vErrors === null ? validate111.errors : vErrors.concat(validate111.errors);
errors = vErrors.length;
}
}
if(data.residual_risks !== undefined){
let data10 = data.residual_risks;
if(Array.isArray(data10)){
if(data10.length > 3){
const err19 = {instancePath:instancePath+"/residual_risks",schemaPath:"#/properties/residual_risks/maxItems",keyword:"maxItems",params:{limit: 3},message:"must NOT have more than 3 items"};
if(vErrors === null){
vErrors = [err19];
}
else {
vErrors.push(err19);
}
errors++;
}
if(data10.length < 3){
const err20 = {instancePath:instancePath+"/residual_risks",schemaPath:"#/properties/residual_risks/minItems",keyword:"minItems",params:{limit: 3},message:"must NOT have fewer than 3 items"};
if(vErrors === null){
vErrors = [err20];
}
else {
vErrors.push(err20);
}
errors++;
}
const len2 = data10.length;
for(let i2=0; i2<len2; i2++){
let data11 = data10[i2];
if(!(((data11 === "ANALYSIS_FRESHNESS_UNVERIFIED") || (data11 === "CONCURRENT_RETARGET_NOT_PROVEN")) || (data11 === "DYNAMIC_LIBRARY_CLOSURE_UNVERIFIED"))){
const err21 = {instancePath:instancePath+"/residual_risks/" + i2,schemaPath:"#/properties/residual_risks/items/enum",keyword:"enum",params:{allowedValues: schema76.properties.residual_risks.items.enum},message:"must be equal to one of the allowed values"};
if(vErrors === null){
vErrors = [err21];
}
else {
vErrors.push(err21);
}
errors++;
}
}
let i3 = data10.length;
let j0;
if(i3 > 1){
outer0:
for(;i3--;){
for(j0 = i3; j0--;){
if(func0(data10[i3], data10[j0])){
const err22 = {instancePath:instancePath+"/residual_risks",schemaPath:"#/properties/residual_risks/uniqueItems",keyword:"uniqueItems",params:{i: i3, j: j0},message:"must NOT have duplicate items (items ## "+j0+" and "+i3+" are identical)"};
if(vErrors === null){
vErrors = [err22];
}
else {
vErrors.push(err22);
}
errors++;
break outer0;
}
}
}
}
}
else {
const err23 = {instancePath:instancePath+"/residual_risks",schemaPath:"#/properties/residual_risks/type",keyword:"type",params:{type: "array"},message:"must be array"};
if(vErrors === null){
vErrors = [err23];
}
else {
vErrors.push(err23);
}
errors++;
}
}
if(data.approved_to_apply !== undefined){
if(false !== data.approved_to_apply){
const err24 = {instancePath:instancePath+"/approved_to_apply",schemaPath:"#/properties/approved_to_apply/const",keyword:"const",params:{allowedValue: false},message:"must be equal to constant"};
if(vErrors === null){
vErrors = [err24];
}
else {
vErrors.push(err24);
}
errors++;
}
}
if(data.edit_json_modified !== undefined){
if(false !== data.edit_json_modified){
const err25 = {instancePath:instancePath+"/edit_json_modified",schemaPath:"#/properties/edit_json_modified/const",keyword:"const",params:{allowedValue: false},message:"must be equal to constant"};
if(vErrors === null){
vErrors = [err25];
}
else {
vErrors.push(err25);
}
errors++;
}
}
}
else {
const err26 = {instancePath,schemaPath:"#/type",keyword:"type",params:{type: "object"},message:"must be object"};
if(vErrors === null){
vErrors = [err26];
}
else {
vErrors.push(err26);
}
errors++;
}
validate52.errors = vErrors;
return errors === 0;
}
validate52.evaluated = {"props":true,"dynamicProps":false,"dynamicItems":false};

const contractSchemas = Object.freeze([{"id":"analysis-v0","canonical_source_path":"packages/schemas/analysis.schema.json","sha256":"b6117dd99cca81438019273003c69ae51b479e85b4df3ed3ebee4e2581c38033"},{"id":"semantic-keep-plan-v1","canonical_source_path":"packages/schemas/semantic-keep-plan.schema.json","sha256":"d698331da3a6f4c2033639000fc034e8913d127a20fb3d6b91b75fc2f0a91805"},{"id":"cut-candidates-v1","canonical_source_path":"packages/schemas/cut-candidates.schema.json","sha256":"b29ad4aacc6b672b233e01c3569f34dd12e70d175c7a3e32954e3d6494d95f97"}]);
exports.contractSchemas = contractSchemas;
