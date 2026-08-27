import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { getConfigDir } from './config.js';

export const DEFAULT_SYSTEM_PROMPT = `# Telegram Agent System Instructions

You are an autonomous AI coding assistant executing tasks on behalf of the user via Telegram on host \`{{HOSTNAME}}\`.
Active Workspace: \`{{WORKSPACE}}\`

## Response Formatting Guidelines (Telegram Chat)
- **Telegram Friendly**: Write clean, natural conversational text formatted for Telegram.
- **No Monolithic Code Blocks**: Do NOT wrap your whole response in a single code block or \`\`\` / <pre> tag.
- **Rich Formatting**: Use **bold** for key headings, bullet points (\`•\` or \`-\`) for lists, inline code (\`code\`) for file paths, variable names, functions, and commands.
- **Code Snippets**: Use fenced code blocks (\`\`\`lang ... \`\`\`) ONLY when providing actual code snippets, diffs, or commands.
- **Direct & Actionable**: Be concise, direct, and factual.

## Persistent Host Context & Memory
{{MEMORY}}

## Self-Memorization & Persistent Rules
- You have persistent memory stored at: \`{{MEMORY_PATH}}\`
- When the user asks to "remember", "memorize", "save note", or when you discover important preferences, rules, ports, or project paths:
  - Record it into memory by executing: \`agent-notify memory add "<note>"\`
  - Or by directly editing: \`{{MEMORY_PATH}}\`
`;

export const DEFAULT_MEMORY = `# Agent Persistent Memory

- **Host**: Linux (Raspberry Pi)
- **Primary Workspace**: /home/astinaam/orca/workspaces/ai-notifier/barnacle
- **User Tone Preference**: Direct, concise, and focused on working solutions.
`;

export function getMemoryFilePath(customPath?: string): string {
  if (customPath) return path.resolve(customPath);
  return path.join(getConfigDir(), 'memory.md');
}

export function getSystemPromptFilePath(customPath?: string): string {
  if (customPath) return path.resolve(customPath);
  return path.join(getConfigDir(), 'system_prompt.md');
}

export function ensureMemoryFiles(customPromptPath?: string, customMemoryPath?: string): void {
  const promptFile = getSystemPromptFilePath(customPromptPath);
  const memoryFile = getMemoryFilePath(customMemoryPath);

  const promptDir = path.dirname(promptFile);
  if (!fs.existsSync(promptDir)) {
    fs.mkdirSync(promptDir, { recursive: true });
  }

  const memoryDir = path.dirname(memoryFile);
  if (!fs.existsSync(memoryDir)) {
    fs.mkdirSync(memoryDir, { recursive: true });
  }

  if (!fs.existsSync(promptFile)) {
    fs.writeFileSync(promptFile, DEFAULT_SYSTEM_PROMPT, 'utf8');
  }

  if (!fs.existsSync(memoryFile)) {
    fs.writeFileSync(memoryFile, DEFAULT_MEMORY, 'utf8');
  }
}

export function loadMemory(customMemoryPath?: string): string {
  ensureMemoryFiles(undefined, customMemoryPath);
  const memoryFile = getMemoryFilePath(customMemoryPath);
  try {
    return fs.readFileSync(memoryFile, 'utf8').trim();
  } catch {
    return DEFAULT_MEMORY.trim();
  }
}

export function saveMemory(content: string, customMemoryPath?: string): void {
  ensureMemoryFiles(undefined, customMemoryPath);
  const memoryFile = getMemoryFilePath(customMemoryPath);
  fs.writeFileSync(memoryFile, content.trim() + '\n', 'utf8');
}

export function appendMemory(note: string, customMemoryPath?: string): string {
  ensureMemoryFiles(undefined, customMemoryPath);
  const current = loadMemory(customMemoryPath);
  const cleanNote = note.trim().replace(/^[-*•]\s*/, '');
  const timestamp = new Date().toISOString().slice(0, 10);
  const newEntry = `- [${timestamp}] ${cleanNote}`;
  const updated = `${current}\n${newEntry}`;
  saveMemory(updated, customMemoryPath);
  return newEntry;
}

export function loadSystemPrompt(customPromptPath?: string): string {
  ensureMemoryFiles(customPromptPath, undefined);
  const promptFile = getSystemPromptFilePath(customPromptPath);
  try {
    return fs.readFileSync(promptFile, 'utf8').trim();
  } catch {
    return DEFAULT_SYSTEM_PROMPT.trim();
  }
}

export function saveSystemPrompt(content: string, customPromptPath?: string): void {
  ensureMemoryFiles(customPromptPath, undefined);
  const promptFile = getSystemPromptFilePath(customPromptPath);
  fs.writeFileSync(promptFile, content.trim() + '\n', 'utf8');
}

export function getEffectiveSystemPrompt(options?: {
  customPromptPath?: string;
  customMemoryPath?: string;
  workspaceDir?: string;
}): string {
  let promptTemplate = loadSystemPrompt(options?.customPromptPath);
  const memory = loadMemory(options?.customMemoryPath);
  const memoryPath = getMemoryFilePath(options?.customMemoryPath);
  const promptPath = getSystemPromptFilePath(options?.customPromptPath);
  const hostname = os.hostname();
  const dateStr = new Date().toISOString();
  const workspace = options?.workspaceDir || process.cwd();

  if (promptTemplate.includes('{{MEMORY}}')) {
    promptTemplate = promptTemplate.replace(/\{\{MEMORY\}\}/g, memory);
  } else {
    promptTemplate = `${promptTemplate}\n\n## Persistent Memory\n${memory}`;
  }

  promptTemplate = promptTemplate.replace(/\{\{MEMORY_PATH\}\}/g, memoryPath);
  promptTemplate = promptTemplate.replace(/\{\{PROMPT_PATH\}\}/g, promptPath);
  promptTemplate = promptTemplate.replace(/\{\{HOSTNAME\}\}/g, hostname);
  promptTemplate = promptTemplate.replace(/\{\{DATE\}\}/g, dateStr);
  promptTemplate = promptTemplate.replace(/\{\{WORKSPACE\}\}/g, workspace);

  return promptTemplate;
}

export function buildAgentPrompt(
  userPrompt: string,
  options?: {
    customPromptPath?: string;
    customMemoryPath?: string;
    workspaceDir?: string;
  }
): string {
  const effectiveSystemPrompt = getEffectiveSystemPrompt(options);

  return `[SYSTEM INSTRUCTIONS & PERSISTENT MEMORY]
${effectiveSystemPrompt}

[USER TASK / REQUEST]
${userPrompt.trim()}`;
}

export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Converts Markdown from AI agent output into clean, Telegram-friendly HTML formatting.
 * Preserves code blocks & inline code safely while formatting bold, italic, headers, and lists.
 */
export function markdownToTelegramHtml(markdown: string): string {
  if (!markdown) return '';

  const codeBlocks: string[] = [];
  // Extract and protect fenced code blocks
  let text = markdown.replace(/```([a-zA-Z0-9_-]*)\n([\s\S]*?)```/g, (_, _lang, code) => {
    const escaped = escapeHtml(code.trimEnd());
    const placeholder = `%%CB${codeBlocks.length}%%`;
    codeBlocks.push(`<pre>${escaped}</pre>`);
    return placeholder;
  });

  // Extract and protect inline code
  const inlineCodes: string[] = [];
  text = text.replace(/`([^`]+)`/g, (_, code) => {
    const escaped = escapeHtml(code);
    const placeholder = `%%IC${inlineCodes.length}%%`;
    inlineCodes.push(`<code>${escaped}</code>`);
    return placeholder;
  });

  // Escape raw HTML outside of code elements
  text = escapeHtml(text);

  // Markdown headers (# Header -> <b>Header</b>)
  text = text.replace(/^#{1,6}\s+(.+)$/gm, '<b>$1</b>');

  // Bold (**text** or __text__)
  text = text.replace(/\*\*(.+?)\*\*/g, '<b>$1</b>');
  text = text.replace(/__(.+?)__/g, '<b>$1</b>');

  // Italic (*text* or _text_)
  text = text.replace(/(?<!\w)\*([^*]+?)\*(?!\w)/g, '<i>$1</i>');
  text = text.replace(/(?<!\w)_([^_]+?)_(?!\w)/g, '<i>$1</i>');

  // Links ([text](url))
  text = text.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2">$1</a>');

  // Lists (* item or - item -> • item)
  text = text.replace(/^[\*\-]\s+/gm, '• ');

  // Restore inline code & code blocks
  inlineCodes.forEach((code, idx) => {
    text = text.replace(`%%IC${idx}%%`, code);
  });

  codeBlocks.forEach((block, idx) => {
    text = text.replace(`%%CB${idx}%%`, block);
  });

  return text.trim();
}

export function clipPrompt(prompt: string, maxLen = 70): string {
  const firstLine = prompt.trim().split('\n')[0].trim();
  if (firstLine.length <= maxLen) return firstLine;
  return firstLine.slice(0, maxLen - 3).trim() + '...';
}
