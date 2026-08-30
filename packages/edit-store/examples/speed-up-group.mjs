import { openProject } from '../lib/project.js';

const [projectPath, groupId] = process.argv.slice(2);
if (!projectPath || !groupId) {
  console.error('usage: node examples/speed-up-group.mjs <project> <group-id>');
  process.exit(1);
}

const project = await openProject(projectPath);
const group = project.edit.find(groupId);
if (!group || !Array.isArray(group.items)) {
  throw new Error(`子を持つグループが見つかりません: ${groupId}`);
}
for (const child of group.items) {
  child.at = Math.round(child.at / 2);
  child.duration = Math.round(child.duration / 2);
}
group.duration = Math.round(group.duration / 2);
const result = await project.save();
console.log(JSON.stringify(result.written));
