import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("luma reduction stays on GPU and samples the exact encode canvas", async () => {
  const source = await readFile(new URL("../src/page-runtime.js", import.meta.url), "utf8");
  assert.match(source, /class CanvasLumaReducer/u);
  assert.match(source, /transformFeedbackVaryings/u);
  assert.match(source, /getBufferSubData/u);
  assert.match(source, /lumaReducer\.capture\(frameNumber, encodeCanvas\)/u);
  assert.match(source, /const stages = \{[^\n]+luma: \[\]/u);
  assert.match(source, /lumaFailed \? null : luma/u);
  assert.match(source, /bufferData\([\s\S]+?bindBuffer\(gl\.ARRAY_BUFFER, null\)/u);
  assert.match(source, /bindBufferBase\(gl\.TRANSFORM_FEEDBACK_BUFFER, 0, this\.buffer\)[\s\S]+?endTransformFeedback\(\)[\s\S]+?bindBufferBase\(gl\.TRANSFORM_FEEDBACK_BUFFER, 0, null\)/u);
  assert.match(source, /bindBuffer\(gl\.COPY_READ_BUFFER, this\.buffer\)[\s\S]+?getBufferSubData\(gl\.COPY_READ_BUFFER[\s\S]+?bindBuffer\(gl\.COPY_READ_BUFFER, null\)/u);
  assert.match(source, /addEventListener\("webglcontextlost"[\s\S]+?gl\.getError\(\)/u);
});

test("preview writes and checkpoints are serialized without blocking the frame loop", async () => {
  const source = await readFile(new URL("../src/page-runtime.js", import.meta.url), "utf8");
  const preview = source.slice(source.indexOf("if (previewActive && frameNumber"), source.indexOf("encoder.encode", source.indexOf("if (previewActive && frameNumber")));
  assert.match(preview, /previewWriteChain = previewWriteChain/u);
  assert.doesNotMatch(preview, /await bridge\.writeDumpFrame/u);
  const checkpoint = source.slice(source.indexOf("const checkpoint ="), source.indexOf("const flushStarted"));
  assert.match(checkpoint, /checkpointChain = checkpointChain/u);
  assert.doesNotMatch(checkpoint, /await bridge\.checkpoint/u);
});

test("failed GPU run waits for the bounded device probe before serializing devices", async () => {
  const source = await readFile(new URL("../src/electron-main.mjs", import.meta.url), "utf8");
  const failedRun = source.slice(source.indexOf("} catch (error) {"), source.indexOf("} finally {", source.indexOf("} catch (error) {")));
  assert.ok(failedRun.indexOf("await gpuDevicesPromise.catch") < failedRun.indexOf("const failed ="));
  assert.match(failedRun, /devices: gpuDevices/u);
});
