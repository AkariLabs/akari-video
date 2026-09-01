// Real-render regression suites use the software-drawing v2 path for CI stability.
const LEGACY_ENGINE_ARGS = ["--engine", "osr"];
process.env.AKARI_OSR_SOFT ??= "1";

export function legacyRenderArgs(args = []) {
  const plansOnly = args.includes("--plan-only");
  const hasExplicitEngine = args.some((argument) => (
    argument === "--engine" || argument.startsWith("--engine=")
  ));
  if (plansOnly || hasExplicitEngine) return args;
  return [...args, ...LEGACY_ENGINE_ARGS];
}
