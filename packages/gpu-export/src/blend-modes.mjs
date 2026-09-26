// W3C Compositing and Blending Level 1 §10.1 の B(Cb, Cs) を、不透明な背景への
// source-over として評価する。add は OSR の CSS plus-lighter と同じ加算・飽和。
// この式木から GPU 用 GLSL と node --test 用の数値評価を両方生成する。
const sub = (left, right) => ["sub", left, right];
const mul = (...values) => ["mul", ...values];
const add = (...values) => ["add", ...values];
const screen = (b, s) => sub(1, mul(sub(1, b), sub(1, s)));
const hardLight = (b, s, threshold) => ["ifLe", threshold, 0.5,
  mul(2, b, s), sub(1, mul(2, sub(1, b), sub(1, s)))];
const softD = ["ifLe", "b", 0.25,
  mul(add(mul(sub(mul(16, "b"), 12), "b"), 4), "b"),
  ["sqrt", "b"]];
const sourceOver = blend => add(mul(sub(1, "a"), "b"), mul("a", blend));

const OUTPUT_EXPRESSIONS = {
  normal: sourceOver("s"),
  screen: sourceOver(screen("b", "s")),
  multiply: sourceOver(mul("b", "s")),
  add: ["min", 1, add("b", mul("a", "s"))],
  difference: sourceOver(["abs", sub("b", "s")]),
  darken: sourceOver(["min", "b", "s"]),
  lighten: sourceOver(["max", "b", "s"]),
  overlay: sourceOver(hardLight("b", "s", "b")),
  hardlight: sourceOver(hardLight("b", "s", "s")),
  softlight: sourceOver(["ifLe", "s", 0.5,
    sub("b", mul(sub(1, mul(2, "s")), "b", sub(1, "b"))),
    add("b", mul(sub(mul(2, "s"), 1), sub(softD, "b")))]),
};

export const GPU_BLEND_MODES = Object.freeze(Object.keys(OUTPUT_EXPRESSIONS));

function glsl(expression) {
  if (typeof expression === "number") return Number.isInteger(expression) ? `${expression}.0` : String(expression);
  if (typeof expression === "string") return expression;
  const [operation, ...args] = expression;
  const values = args.map(glsl);
  if (operation === "add") return `(${values.join(" + ")})`;
  if (operation === "mul") return `(${values.join(" * ")})`;
  if (operation === "sub") return `(${values[0]} - ${values[1]})`;
  if (operation === "min" || operation === "max") return `${operation}(${values.join(", ")})`;
  if (operation === "abs" || operation === "sqrt") return `${operation}(${values[0]})`;
  if (operation === "ifLe") return `((${values[0]} <= ${values[1]}) ? ${values[2]} : ${values[3]})`;
  throw new Error(`unknown blend expression: ${operation}`);
}

function evaluate(expression, values) {
  if (typeof expression === "number") return expression;
  if (typeof expression === "string") return values[expression];
  const [operation, ...args] = expression;
  if (operation === "ifLe") return evaluate(args[0], values) <= evaluate(args[1], values)
    ? evaluate(args[2], values) : evaluate(args[3], values);
  const operands = args.map(value => evaluate(value, values));
  if (operation === "add") return operands.reduce((sum, value) => sum + value, 0);
  if (operation === "mul") return operands.reduce((product, value) => product * value, 1);
  if (operation === "sub") return operands[0] - operands[1];
  if (operation === "min") return Math.min(...operands);
  if (operation === "max") return Math.max(...operands);
  if (operation === "abs") return Math.abs(operands[0]);
  if (operation === "sqrt") return Math.sqrt(operands[0]);
  throw new Error(`unknown blend expression: ${operation}`);
}

export function evaluateGpuBlendChannel(mode, backdrop, source, sourceAlpha) {
  if (!Object.hasOwn(OUTPUT_EXPRESSIONS, mode)) throw new Error(`unknown GPU blend mode: ${mode}`);
  return evaluate(OUTPUT_EXPRESSIONS[mode], { b: backdrop, s: source, a: sourceAlpha });
}

export function gpuBlendGlsl() {
  return `float blendChannel(float b, float s, float a, int mode) {\n${GPU_BLEND_MODES
    .map((name, index) => `  if (mode == ${index}) return ${glsl(OUTPUT_EXPRESSIONS[name])};`)
    .join("\n")}\n  return s;\n}`;
}
