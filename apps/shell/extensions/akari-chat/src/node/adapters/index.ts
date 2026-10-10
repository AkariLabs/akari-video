import type { ChatAdapter } from './adapter';
import { ClaudeStreamJsonAdapter } from './claude-stream-json';

export const chatAdapters: ChatAdapter[] = [
    new ClaudeStreamJsonAdapter()
];
