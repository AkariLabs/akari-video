// Real-render regression suites measure the legacy composition path. Default engine resolution
// remains observable in plan-only and dedicated engine tests.
// Real renders receive the literal CLI option --engine legacy.
const LEGACY_ENGINE_ARGS = ["--engine", "legacy"];

export function legacyRenderArgs(args = []) {
  const plansOnly = args.includes("--plan-only");
  const hasExplicitEngine = args.some((argument) => (
    argument === "--engine" || argument.startsWith("--engine=")
  ));
  if (plansOnly || hasExplicitEngine) return args;
  return [...args, ...LEGACY_ENGINE_ARGS];
}
