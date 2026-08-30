import { openProject } from '../lib/project.js';

const [projectPath] = process.argv.slice(2);
if (!projectPath) {
  console.error('usage: node examples/tree-summary.mjs <project>');
  process.exit(1);
}

const project = await openProject(projectPath);
project.edit.walk((item, parent, track) => {
  let depth = 0;
  let ancestor = parent;
  while (ancestor) {
    depth += 1;
    ancestor = project.edit.parentOf(ancestor.id);
  }

  const kind = item.source?.kind ?? '-';
  const children = Array.isArray(item.items) ? item.items.length : 0;
  const keyframes = Array.isArray(item.keyframes)
    ? item.keyframes.length
    : (item.keyframes?.count ?? 0);
  const exclude = Array.isArray(item.source?.exclude) ? item.source.exclude.length : 0;
  console.log(`${'  '.repeat(depth)}${item.id}  ${kind}  at=${item.at}  duration=${item.duration}  children=${children}  keyframes=${keyframes}  exclude=${exclude}`);
});
