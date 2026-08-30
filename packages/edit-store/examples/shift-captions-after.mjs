import { openProject } from '../lib/project.js';

const [projectPath, thresholdText, deltaText] = process.argv.slice(2);
const threshold = Number(thresholdText);
const delta = Number(deltaText);

if (!projectPath || !Number.isFinite(threshold) || !Number.isFinite(delta)) {
  console.error('usage: node examples/shift-captions-after.mjs <project> <seconds> <delta>');
  process.exit(1);
}

const project = await openProject(projectPath);
for (const row of project.captions.rows) {
  if (row.start < threshold) continue;
  row.start += delta;
  row.end += delta;
}
const result = await project.save();
console.log(JSON.stringify(result.written));
