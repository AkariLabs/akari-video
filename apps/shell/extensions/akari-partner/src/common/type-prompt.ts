export function typedPromptText(text: string): string {
    return /\s$/.test(text) ? text : `${text} `;
}
