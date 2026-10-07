export function maskToken(line: string): string {
    return line.replace(/token=[^\s&)"']+/g, 'token=***');
}

export function maskDshOutput(message: string, secrets: readonly (string | undefined)[]): string {
    let safe = maskToken(message);
    for (const secret of secrets) {
        if (secret) safe = safe.replaceAll(secret, '***');
    }
    return safe;
}
