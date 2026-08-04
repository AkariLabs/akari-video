import { buildCapabilityCatalog, queryCapability, recordCapabilityMiss } from "./capability.mjs";

export async function runCapabilityCommand(argv, options = {}) {
  const log = options.log ?? ((line) => process.stdout.write(line));
  const error = options.error ?? ((line) => process.stderr.write(`${line}\n`));
  let parsed;
  try {
    parsed = parseCapabilityArguments(argv, options.cwd ?? process.cwd());
    const catalog = buildCapabilityCatalog(options.catalogOptions);
    const result = queryCapability(catalog, parsed.query);
    if (parsed.recordMiss && result.matches.length === 0) {
      const recorded = await recordCapabilityMiss(parsed.projectRoot, catalog, result);
      log(parsed.json ? `${JSON.stringify(recorded.receipt, null, 2)}\n` : `No text match; review required. Receipt: ${recorded.path}\n`);
      return { exitCode: 0, result, receipt: recorded };
    }
    if (parsed.json) log(`${JSON.stringify(result, null, 2)}\n`);
    else if (result.matches.length === 0) log("No text match. Review the source set before proposing a new capability.\n");
    else {
      for (const match of result.matches) log(`${match.path} — ${match.heading} (score ${match.score})\n${match.snippet}\n`);
    }
    return { exitCode: 0, result };
  } catch (cause) {
    error(cause instanceof Error ? cause.message : String(cause));
    return { exitCode: 1 };
  }
}

export function parseCapabilityArguments(argv, cwd = process.cwd()) {
  const queryParts = [];
  let json = false;
  let recordMiss = false;
  let projectRoot = cwd;
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--json") json = true;
    else if (argument === "--record-miss") recordMiss = true;
    else if (argument === "--project") {
      const value = argv[++index];
      if (!value || value.startsWith("-")) throw new Error("--project requires a path");
      projectRoot = value;
    } else if (argument.startsWith("-")) throw new Error(`Unknown capability option: ${argument}`);
    else queryParts.push(argument);
  }
  const query = queryParts.join(" ").trim();
  if (query === "") throw new Error("capability requires a query");
  return { query, json, recordMiss, projectRoot };
}
