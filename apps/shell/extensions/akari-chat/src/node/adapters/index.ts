import type { ChatAdapter } from './adapter';
import { ClaudeStreamJsonAdapter } from './claude-stream-json';
import { CodexAppServerAdapter } from './codex-app-server';

export const chatAdapters: ChatAdapter[] = [
    new ClaudeStreamJsonAdapter(),
    new CodexAppServerAdapter()
];
