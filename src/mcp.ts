import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { TelegramClient } from './telegram.js';
import { resolveConfig, validateConfig } from './config.js';
import { ensureServerRunning } from './server.js';
import { loadMemory, appendMemory, getEffectiveSystemPrompt, getMemoryFilePath } from './memory.js';
import type { NotificationLevel } from './types.js';

export async function runMcpServer(): Promise<void> {
  const config = resolveConfig();
  const validation = validateConfig(config);

  // Auto-start web server in background so links are active
  ensureServerRunning(config.serverPort).catch(() => {});

  const server = new McpServer({
    name: 'agent-notify',
    version: '1.0.0',
  });

  function getClient(): TelegramClient {
    if (!validation.valid) {
      throw new Error(validation.error || 'Invalid Telegram configuration');
    }
    return new TelegramClient(config);
  }

  // Tool 1: send_notification
  server.tool(
    'send_notification',
    'Sends a push notification message to the user on Telegram with optional LAN/Tailscale web view links.',
    {
      message: z.string().describe('The notification message content to send to the user.'),
      agent_name: z.string().optional().describe('Name of the AI agent sending this message (e.g. "Antigravity", "Claude", "DeployBot").'),
      level: z
        .enum(['info', 'success', 'warn', 'error'])
        .optional()
        .describe('Severity level for the notification badge (info, success, warn, error).'),
      silent: z
        .boolean()
        .optional()
        .describe('If true, sends the notification without sound.'),
      include_links: z
        .boolean()
        .optional()
        .describe('Whether to attach Tailscale & LAN web view links (default true).'),
    },
    async ({ message, agent_name, level, silent, include_links }) => {
      try {
        const client = getClient();
        const res = await client.sendMessage({
          text: message,
          agent: agent_name,
          level: level as NotificationLevel | undefined,
          silent,
          includeLinks: include_links,
          parseMode: 'HTML',
        });
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                status: 'delivered',
                message_id: res.messageRecord.id,
                telegram_message_id: res.message_id,
                links: res.messageRecord.links,
              }, null, 2),
            },
          ],
        };
      } catch (err: any) {
        return {
          isError: true,
          content: [
            {
              type: 'text',
              text: `Failed to send Telegram notification: ${err.message}`,
            },
          ],
        };
      }
    }
  );

  // Tool 2: send_file
  server.tool(
    'send_file',
    'Sends a file, document, code log, or image to the user on Telegram.',
    {
      file_path: z.string().describe('The filesystem path to the file to upload and send.'),
      caption: z.string().optional().describe('An optional caption or summary to accompany the file.'),
      agent_name: z.string().optional().describe('Name of the AI agent sending this file.'),
      level: z
        .enum(['info', 'success', 'warn', 'error'])
        .optional()
        .describe('Optional severity level badge.'),
      silent: z.boolean().optional().describe('If true, sends quietly without sound.'),
      include_links: z.boolean().optional().describe('Whether to attach Tailscale & LAN web view links.'),
    },
    async ({ file_path, caption, agent_name, level, silent, include_links }) => {
      try {
        const client = getClient();
        const res = await client.sendFile({
          filePath: file_path,
          caption,
          agent: agent_name,
          level: level as NotificationLevel | undefined,
          silent,
          includeLinks: include_links,
        });
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                status: 'delivered',
                message_id: res.messageRecord.id,
                telegram_message_id: res.message_id,
                links: res.messageRecord.links,
              }, null, 2),
            },
          ],
        };
      } catch (err: any) {
        return {
          isError: true,
          content: [
            {
              type: 'text',
              text: `Failed to send file to Telegram: ${err.message}`,
            },
          ],
        };
      }
    }
  );

  // Tool 3: ask_user
  server.tool(
    'ask_user',
    'Asks the user a question via Telegram or Web UI with interactive buttons or text response, and waits for human input (Human-in-the-loop).',
    {
      question: z.string().describe('The question or prompt to ask the human user on Telegram/Web.'),
      agent_name: z.string().optional().describe('Name of the AI agent asking the question.'),
      options: z
        .array(z.string())
        .optional()
        .describe('Optional list of quick clickable response button labels (e.g. ["Approve", "Reject", "Retry"]).'),
      timeout_seconds: z
        .number()
        .optional()
        .describe('Maximum number of seconds to wait for user reply (default: 300).'),
      level: z
        .enum(['info', 'success', 'warn', 'error'])
        .optional()
        .describe('Optional severity level badge.'),
      include_links: z.boolean().optional().describe('Whether to attach Tailscale & LAN web view links.'),
    },
    async ({ question, agent_name, options, timeout_seconds, level, include_links }) => {
      try {
        const client = getClient();
        const result = await client.askUser({
          question,
          agent: agent_name,
          options,
          timeoutSeconds: timeout_seconds || 300,
          level: level as NotificationLevel | undefined,
          includeLinks: include_links,
        });

        if (result.answered) {
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify({
                  status: 'answered',
                  answer: result.response,
                  answered_by: result.answeredBy,
                  message_id: result.messageId,
                  timestamp: result.timestamp,
                }, null, 2),
              },
            ],
          };
        }

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                status: 'timed_out',
                message: `User did not respond within ${timeout_seconds || 300} seconds.`,
                message_id: result.messageId,
                timestamp: result.timestamp,
              }, null, 2),
            },
          ],
        };
      } catch (err: any) {
        return {
          isError: true,
          content: [
            {
              type: 'text',
              text: `Error waiting for user input via Telegram/Web: ${err.message}`,
            },
          ],
        };
      }
    }
  );

  // Tool 4: get_memory
  server.tool(
    'get_memory',
    'Reads persistent memory notes and host context from memory.md.',
    {},
    async () => {
      try {
        const memory = loadMemory();
        return {
          content: [
            {
              type: 'text',
              text: memory,
            },
          ],
        };
      } catch (err: any) {
        return {
          isError: true,
          content: [
            {
              type: 'text',
              text: `Failed to load memory: ${err.message}`,
            },
          ],
        };
      }
    }
  );

  // Tool 5: append_memory
  server.tool(
    'append_memory',
    'Appends a new persistent note, preference, or fact to memory.md.',
    {
      note: z.string().describe('The note or fact to append to persistent memory.'),
    },
    async ({ note }) => {
      try {
        const entry = appendMemory(note);
        return {
          content: [
            {
              type: 'text',
              text: `Successfully added to memory: ${entry}`,
            },
          ],
        };
      } catch (err: any) {
        return {
          isError: true,
          content: [
            {
              type: 'text',
              text: `Failed to append to memory: ${err.message}`,
            },
          ],
        };
      }
    }
  );

  // Tool 6: get_system_prompt
  server.tool(
    'get_system_prompt',
    'Returns the effective system prompt with persistent memory plugged in.',
    {},
    async () => {
      try {
        const prompt = getEffectiveSystemPrompt();
        return {
          content: [
            {
              type: 'text',
              text: prompt,
            },
          ],
        };
      } catch (err: any) {
        return {
          isError: true,
          content: [
            {
              type: 'text',
              text: `Failed to get system prompt: ${err.message}`,
            },
          ],
        };
      }
    }
  );

  const transport = new StdioServerTransport();
  await server.connect(transport);
}
