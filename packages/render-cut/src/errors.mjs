export class RefusalError extends Error {
  constructor(message, exitCode = 1) {
    super(message);
    this.exitCode = exitCode;
  }
}
export class ExecutionError extends Error {}

export function parseJson(text, label) {
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new ExecutionError(`${label} is not valid JSON: ${messageOf(error)}`);
  }
}


export function messageOf(error) {
  return error instanceof Error ? error.message : String(error);
}
