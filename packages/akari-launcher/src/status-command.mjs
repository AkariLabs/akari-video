import {
  resolveProjectStatus,
  resolveFullProjectStatus,
  serializeStatus,
  formatStatusSummary,
  detectStatusScope,
  resolveWorkspaceStatus,
  serializeWorkspaceStatus,
  formatWorkspaceStatusSummary,
} from "./status-core/status.mjs";

export async function runStatusCommand(argv, options = {}) {
  const log = options.log ?? ((line) => process.stdout.write(line));
  const error = options.error ?? ((line) => process.stderr.write(`${line}\n`));
  let parsed;
  try {
    parsed = parseStatusArguments(argv, options.cwd ?? process.cwd());
  } catch (cause) {
    error(cause instanceof Error ? cause.message : String(cause));
    return { exitCode: 2 };
  }
  if (detectStatusScope(parsed.projectRoot) === "workspace") {
    const workspace = resolveWorkspaceStatus(parsed.projectRoot);
    // fail-safe: a broken root.json falls through to the unchanged project-scope path below.
    if (workspace) {
      log(parsed.json ? serializeWorkspaceStatus(workspace) : `${formatWorkspaceStatusSummary(workspace)}\n`);
      return { exitCode: 0, workspace };
    }
  }
  const status = parsed.full
    ? await resolveFullProjectStatus(parsed.projectRoot)
    : resolveProjectStatus(parsed.projectRoot, { mode: "fast" });
  log(parsed.json ? serializeStatus(status) : `${formatStatusOutput(status)}\n`);
  return { exitCode: status.state_health === "inconclusive" ? 1 : 0, status };
}

export function formatStatusOutput(status) {
  const summary = formatStatusSummary(status);
  if (status.state_health !== "inconclusive" || status.problems.length === 0) return summary;
  const problems = status.problems.map((problem) => `  - ${problem}`).join("\n");
  return `${summary}\nCould not determine:\n${problems}\nNext: run \`akari status --json\` for the full machine-readable report, or resolve the items above and re-run \`akari status\`.`;
}

export function parseStatusArguments(argv, cwd = process.cwd()) {
  let projectRoot = cwd;
  let pathSeen = false;
  let full = false;
  let json = false;
  for (const argument of argv) {
    if (argument === "--full") full = true;
    else if (argument === "--json") json = true;
    else if (argument.startsWith("-")) throw new Error(`Unknown status option: ${argument}`);
    else if (pathSeen) throw new Error("status accepts only one project path");
    else {
      projectRoot = argument;
      pathSeen = true;
    }
  }
  return { projectRoot, full, json };
}
