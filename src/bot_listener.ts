import fs from 'node:fs';
import path from 'node:path';
import { exec, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { getConfigDir, resolveConfig, saveConfig } from './config.js';
import { messageStore } from './store.js';
import { getSystemMetrics } from './monitor.js';
import { getMessageLinks } from './network.js';
import { TelegramClient } from './telegram.js';
import {
  loadMemory,
  appendMemory,
  loadSystemPrompt,
  getEffectiveSystemPrompt,
  buildAgentPrompt,
  getMemoryFilePath,
  getSystemPromptFilePath,
  markdownToTelegramHtml,
  escapeHtml,
  clipPrompt,
} from './memory.js';
import { taskManager } from './task_tracker.js';
import type { TelegramConfig, StoredMessage } from './types.js';

const execAsync = promisify(exec);

export interface AgentTaskOptions {
  workspaceDir?: string;
  originalPrompt?: string;
  isThreadFollowUp?: boolean;
  sessionId?: string;
}

export class BotListener {
  private config: TelegramConfig;
  private client: TelegramClient;
  private running = false;
  private abortController: AbortController | null = null;
  private offsetFilePath: string;
  private latestOffset = 0;

  constructor(config?: TelegramConfig) {
    this.config = config || resolveConfig();
    this.client = new TelegramClient(this.config);
    this.offsetFilePath = path.join(getConfigDir(), 'bot_offset.json');
    this.loadOffset();
  }

  private loadOffset(): void {
    if (fs.existsSync(this.offsetFilePath)) {
      try {
        const raw = fs.readFileSync(this.offsetFilePath, 'utf8');
        const data = JSON.parse(raw);
        if (typeof data.offset === 'number') {
          this.latestOffset = data.offset;
        }
      } catch {}
    }
  }

  private saveOffset(offset: number): void {
    this.latestOffset = offset;
    try {
      const dir = path.dirname(this.offsetFilePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(this.offsetFilePath, JSON.stringify({ offset, updatedAt: new Date().toISOString() }), 'utf8');
    } catch {}
  }

  async start(): Promise<void> {
    if (this.running) return;
    if (!this.config.botToken || !this.config.chatId) {
      console.log('[BotListener] Bot token or chat ID missing. Bot listener inactive.');
      return;
    }

    if (this.config.botListener?.enabled === false) {
      console.log('[BotListener] Bot listener disabled in configuration.');
      return;
    }

    this.running = true;
    this.abortController = new AbortController();
    console.log('[BotListener] Continuous Telegram Bot listener started.');

    this.pollLoop().catch((err) => {
      console.error('[BotListener] Poll loop terminated unexpectedly:', err);
    });
  }

  stop(): void {
    this.running = false;
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }
    console.log('[BotListener] Bot listener stopped.');
  }

  private async pollLoop(): Promise<void> {
    let errorBackoff = 1000;

    // On initial launch, if no saved offset, fast-forward to latest update
    if (this.latestOffset === 0) {
      try {
        const initial = await this.client.getUpdates(-1, 0);
        if (initial.length > 0) {
          this.saveOffset(initial[initial.length - 1].update_id + 1);
        }
      } catch {}
    }

    while (this.running) {
      try {
        const updates = await this.client.getUpdates(this.latestOffset, 20);
        errorBackoff = 1000; // Reset backoff on success

        for (const update of updates) {
          if (!this.running) break;
          this.saveOffset(update.update_id + 1);

          try {
            await this.processUpdate(update);
          } catch (err: any) {
            console.error('[BotListener] Error processing update:', err.message);
          }
        }
      } catch (err: any) {
        if (!this.running) break;
        console.warn(`[BotListener] Polling error: ${err.message}. Retrying in ${errorBackoff / 1000}s...`);
        await new Promise((r) => setTimeout(r, errorBackoff));
        errorBackoff = Math.min(errorBackoff * 2, 30000);
      }
    }
  }

  private async processUpdate(update: any): Promise<void> {
    if (update.callback_query) {
      await this.handleCallbackQuery(update.callback_query);
      return;
    }

    if (update.message) {
      await this.handleMessage(update.message);
    }
  }

  private async handleCallbackQuery(cq: any): Promise<void> {
    const senderChatId = String(cq.message?.chat?.id);
    const targetChatId = String(this.config.chatId);
    if (senderChatId !== targetChatId) {
      await this.client.answerCallbackQuery(cq.id, 'Unauthorized');
      return;
    }

    const data: string = cq.data || '';
    const messageId = cq.message?.message_id;
    const answeredBy = cq.from?.username ? `@${cq.from.username}` : cq.from?.first_name || 'User';

    // 1. Check if this belongs to an active 'ask' prompt
    const { items } = messageStore.getMessages({ type: 'ask', limit: 20 });
    const matchingAsk = items.find((m) => m.telegramMessageId === messageId && m.status === 'delivered');

    if (matchingAsk) {
      let selectedValue = data;
      if (data.startsWith('btn_') && matchingAsk.options) {
        const idx = Number.parseInt(data.replace('btn_', ''), 10);
        if (!Number.isNaN(idx) && matchingAsk.options[idx]) {
          selectedValue = matchingAsk.options[idx];
        }
      }

      await this.client.answerCallbackQuery(cq.id, `Selected: ${selectedValue}`);
      messageStore.respondToQuestion(matchingAsk.id, selectedValue, answeredBy);

      const links = matchingAsk.links || getMessageLinks(matchingAsk.id, this.config.serverPort, this.config);
      const urlKeyboard = [
        { text: '🌐 Tailscale View', url: links.tailscale },
        { text: '🏠 LAN View', url: links.lan },
      ];

      await this.client.editMessageText(
        messageId,
        `❓ [<b>${matchingAsk.agent}</b>] <b>QUESTION</b>\n\n${matchingAsk.content}\n\n<b>Answered:</b> <code>${selectedValue}</code> ✅ <i>(by ${answeredBy})</i>`,
        'HTML',
        { inline_keyboard: [urlKeyboard] }
      ).catch(() => {});
      return;
    }

    // 2. Cancel Task Callback
    if (data.startsWith('cancel_task_')) {
      const taskId = data.replace('cancel_task_', '');
      const success = taskManager.cancelTask(taskId);
      if (success) {
        await this.client.answerCallbackQuery(cq.id, `Task ${taskId} cancelled`);
        await this.sendReply(`🛑 <b>Agent Task Cancelled</b> (<code>${taskId}</code>)`, cq.message?.message_id);
      } else {
        await this.client.answerCallbackQuery(cq.id, 'Task is no longer running');
      }
      return;
    }

    // 3. Interactive Menu Quick Actions
    if (data === 'cmd_agents') {
      await this.client.answerCallbackQuery(cq.id, 'Fetching running agents...');
      const summary = taskManager.formatActiveTasksSummary();
      await this.sendReply(summary, cq.message?.message_id);
      return;
    }

    if (data === 'cmd_status') {
      await this.client.answerCallbackQuery(cq.id, 'Fetching status...');
      const statusText = this.formatSystemStatus();
      await this.sendReply(statusText, cq.message?.message_id);
      return;
    }

    if (data === 'cmd_top') {
      await this.client.answerCallbackQuery(cq.id, 'Fetching top processes...');
      const topText = await this.getTopProcesses();
      await this.sendReply(topText, cq.message?.message_id);
      return;
    }

    if (data === 'cmd_links') {
      await this.client.answerCallbackQuery(cq.id, 'Fetching links...');
      const linksText = this.formatLinks();
      await this.sendReply(linksText, cq.message?.message_id);
      return;
    }

    if (data === 'cmd_logs') {
      await this.client.answerCallbackQuery(cq.id, 'Fetching recent logs...');
      const logsText = this.formatRecentLogs();
      await this.sendReply(logsText, cq.message?.message_id);
      return;
    }

    if (data === 'cmd_memory') {
      await this.client.answerCallbackQuery(cq.id, 'Fetching memory...');
      const memoryText = this.formatMemory();
      await this.sendReply(memoryText, cq.message?.message_id);
      return;
    }

    if (data === 'cmd_prompt') {
      await this.client.answerCallbackQuery(cq.id, 'Fetching system prompt...');
      const promptText = this.formatSystemPrompt();
      await this.sendReply(promptText, cq.message?.message_id);
      return;
    }

    await this.client.answerCallbackQuery(cq.id, `Action: ${data}`);
  }

  private async handleMessage(msg: any): Promise<void> {
    const senderChatId = String(msg.chat?.id);
    const targetChatId = String(this.config.chatId);
    if (senderChatId !== targetChatId) {
      return; // Ignore messages from unauthorized chats
    }

    const text: string = (msg.text || '').trim();
    if (!text) return;

    const fromUser = msg.from?.username ? `@${msg.from.username}` : msg.from?.first_name || 'User';

    // 1. Check if user is replying to an active 'ask' prompt or continuing an existing agent thread
    if (msg.reply_to_message) {
      const repliedTelegramId = msg.reply_to_message.message_id;
      const { items } = messageStore.getMessages({ limit: 100 });
      const matchingAsk = items.find((m) => m.telegramMessageId === repliedTelegramId && m.status === 'delivered' && m.type === 'ask');

      if (matchingAsk) {
        messageStore.respondToQuestion(matchingAsk.id, text, fromUser);

        const links = matchingAsk.links || getMessageLinks(matchingAsk.id, this.config.serverPort, this.config);
        const urlKeyboard = [
          { text: '🌐 Tailscale View', url: links.tailscale },
          { text: '🏠 LAN View', url: links.lan },
        ];

        await this.client.editMessageText(
          repliedTelegramId,
          `❓ [<b>${matchingAsk.agent}</b>] <b>QUESTION</b>\n\n${matchingAsk.content}\n\n<b>Answered:</b> <code>${text}</code> ✅ <i>(by ${fromUser})</i>`,
          'HTML',
          { inline_keyboard: [urlKeyboard] }
        ).catch(() => {});
        return;
      }

      // If user replied to a previous bot message with plain text (non-command), treat as multi-turn thread follow-up
      if (!text.startsWith('/')) {
        const parentMsg = items.find((m) => m.telegramMessageId === repliedTelegramId);
        const parentText = parentMsg?.content || msg.reply_to_message.text || '';
        const parentPrompt = parentMsg?.prompt || '';
        const parentAgent = parentMsg?.agent || (msg.reply_to_message.text?.includes('Cursor') ? 'CursorAgent' : 'Antigravity');
        const parentWorkspace = parentMsg?.workspaceDir || this.config.botListener?.workspaceDir || process.cwd();
        const parentSessionId = parentMsg?.sessionId;

        if (parentAgent.toLowerCase().includes('cursor')) {
          // Native Cursor CLI session resume
          await this.handleCursorTask(text, fromUser, msg.message_id, {
            workspaceDir: parentWorkspace,
            originalPrompt: text,
            isThreadFollowUp: true,
            sessionId: parentSessionId,
          });
        } else {
          // Antigravity conversation continuation
          const threadPrompt = `[CONVERSATION THREAD FOLLOW-UP]
Prior User Request: "${parentPrompt || 'Previous task'}"
Prior Agent Response:
${parentText.slice(0, 2000)}

[USER FOLLOW-UP IN THIS THREAD]:
${text}`;

          await this.handleAgyTask(threadPrompt, fromUser, msg.message_id, {
            workspaceDir: parentWorkspace,
            originalPrompt: text,
            isThreadFollowUp: true,
          });
        }
        return;
      }
    }

    // 2. Command Processing
    if (text.startsWith('/')) {
      const parts = text.split(' ');
      const rawCommand = parts[0].toLowerCase();
      // Remove bot username if mentioned (e.g. /status@mybot -> /status)
      const command = rawCommand.split('@')[0];
      const args = parts.slice(1).join(' ').trim();

      switch (command) {
        case '/start':
        case '/help':
          await this.sendHelpMessage(msg.message_id);
          break;

        case '/agents':
        case '/running':
        case '/tasks': {
          const summary = taskManager.formatActiveTasksSummary();
          await this.sendReply(summary, msg.message_id);
          break;
        }

        case '/cancel':
        case '/stop':
        case '/kill': {
          if (args) {
            const ok = taskManager.cancelTask(args);
            if (ok) {
              await this.sendReply(`🛑 <b>Task Cancelled:</b> <code>${escapeHtml(args)}</code>`, msg.message_id);
            } else {
              await this.sendReply(`⚠️ No active task found with ID: <code>${escapeHtml(args)}</code>\nType /agents to see active tasks.`, msg.message_id);
            }
          } else {
            const active = taskManager.getActiveTasks();
            if (active.length === 1) {
              const taskToKill = active[0];
              taskManager.cancelTask(taskToKill.id);
              await this.sendReply(`🛑 <b>Task Cancelled:</b> <code>${taskToKill.id}</code> (${taskToKill.agentType})`, msg.message_id);
            } else if (active.length === 0) {
              await this.sendReply('💤 No AI agent tasks currently running.', msg.message_id);
            } else {
              await this.sendReply(`Multiple agents running. Specify task ID to cancel (e.g. <code>/cancel ${active[0].id}</code>):\n\n${taskManager.formatActiveTasksSummary()}`, msg.message_id);
            }
          }
          break;
        }

        case '/status':
        case '/metrics': {
          const statusText = this.formatSystemStatus();
          await this.sendReply(statusText, msg.message_id);
          break;
        }

        case '/top':
        case '/ps': {
          const topText = await this.getTopProcesses();
          await this.sendReply(topText, msg.message_id);
          break;
        }

        case '/links': {
          const linksText = this.formatLinks();
          await this.sendReply(linksText, msg.message_id);
          break;
        }

        case '/logs':
        case '/history': {
          const count = Number.parseInt(args, 10) || 5;
          const logsText = this.formatRecentLogs(count);
          await this.sendReply(logsText, msg.message_id);
          break;
        }

        case '/ping': {
          await this.sendReply('🏓 <b>Pong!</b> <i>agent-notify</i> daemon is active and healthy.', msg.message_id);
          break;
        }

        case '/sh':
        case '/exec': {
          if (this.config.botListener?.allowShellCommands === false) {
            await this.sendReply('🔒 Shell execution is disabled in config.', msg.message_id);
            return;
          }
          if (!args) {
            await this.sendReply('Usage: <code>/sh &lt;command&gt;</code> (e.g. <code>/sh uptime</code>)', msg.message_id);
            return;
          }
          await this.executeAndReplyShell(args, msg.message_id);
          break;
        }

        case '/cursor': {
          if (!args) {
            await this.sendReply('Usage: <code>/cursor &lt;prompt&gt;</code> (e.g. <code>/cursor fix type error in src/index.ts</code>)', msg.message_id);
            return;
          }
          let parentSessionId: string | undefined;
          if (msg.reply_to_message) {
            const repliedTelegramId = msg.reply_to_message.message_id;
            const { items } = messageStore.getMessages({ limit: 100 });
            const parentMsg = items.find((m) => m.telegramMessageId === repliedTelegramId);
            parentSessionId = parentMsg?.sessionId;
          }
          await this.handleCursorTask(args, fromUser, msg.message_id, {
            originalPrompt: args,
            sessionId: parentSessionId,
            isThreadFollowUp: Boolean(parentSessionId),
          });
          break;
        }

        case '/task':
        case '/agent':
        case '/agy': {
          if (!args) {
            await this.sendReply('Usage: <code>/task &lt;prompt&gt;</code> (e.g. <code>/task check system logs</code>)', msg.message_id);
            return;
          }
          let promptToRun = args;
          let isFollowUp = false;
          if (msg.reply_to_message) {
            isFollowUp = true;
            const repliedTelegramId = msg.reply_to_message.message_id;
            const { items } = messageStore.getMessages({ limit: 100 });
            const parentMsg = items.find((m) => m.telegramMessageId === repliedTelegramId);
            const parentText = parentMsg?.content || msg.reply_to_message.text || '';
            promptToRun = `[THREAD CONTEXT]\nPrior Request: "${parentMsg?.prompt || ''}"\nPrior Output:\n${parentText.slice(0, 2000)}\n\n[USER REQUEST]:\n${args}`;
          }
          await this.handleAgyTask(promptToRun, fromUser, msg.message_id, {
            originalPrompt: args,
            isThreadFollowUp: isFollowUp,
          });
          break;
        }

        case '/memory': {
          if (args.toLowerCase().startsWith('add ') || args.toLowerCase().startsWith('set ')) {
            const noteToAdd = args.replace(/^(add|set)\s+/i, '').trim();
            await this.handleMemoryAdd(noteToAdd, msg.message_id);
          } else {
            const memoryText = this.formatMemory();
            await this.sendReply(memoryText, msg.message_id);
          }
          break;
        }

        case '/remember': {
          if (!args) {
            await this.sendReply('Usage: <code>/remember &lt;note&gt;</code> (e.g. <code>/remember Always use TypeScript strict mode</code>)', msg.message_id);
            return;
          }
          await this.handleMemoryAdd(args, msg.message_id);
          break;
        }

        case '/prompt':
        case '/systemprompt': {
          const promptText = this.formatSystemPrompt();
          await this.sendReply(promptText, msg.message_id);
          break;
        }

        case '/dir':
        case '/workspace':
        case '/cwd': {
          await this.handleWorkspaceDir(args, msg.message_id);
          break;
        }

        default:
          await this.sendReply(
            `❓ Unknown command: <code>${command}</code>\nType /help for available commands.`,
            msg.message_id
          );
      }
      return;
    }

    // 3. Free-form text message (Inbox recording & agent trigger)
    const msgId = messageStore.generateId();
    const stored: StoredMessage = {
      id: msgId,
      agent: fromUser,
      type: 'inbound',
      level: 'info',
      content: text,
      status: 'delivered',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    messageStore.saveMessage(stored);

    // If autoAgent is enabled and message looks like a task or command, dispatch it to Antigravity
    if (this.config.botListener?.autoAgent) {
      await this.handleAgyTask(text, fromUser, msg.message_id);
    } else {
      await this.sendReply(
        `📥 <b>Message received</b> (saved to inbox)\n<i>Type /help for commands, /cursor &lt;prompt&gt; for Cursor, or /task &lt;prompt&gt; for Antigravity.\nTip: Reply directly to any bot response to continue in that conversation thread.</i>`,
        msg.message_id
      );
    }
  }

  private async sendReply(text: string, replyToMessageId?: number): Promise<void> {
    await this.client.sendMessage({
      text,
      agent: 'BotDaemon',
      parseMode: 'HTML',
      replyToMessageId,
      includeLinks: false,
    });
  }

  private async sendHelpMessage(replyToMessageId?: number): Promise<void> {
    const cwd = this.config.botListener?.workspaceDir || process.cwd();
    const activeCount = taskManager.getActiveCount();
    const helpText = `🤖 <b>agent-notify Bot Gateway</b>

Here are the commands you can use anytime:

🧠 <b>AI Coding Agents:</b>
• <code>/cursor &lt;prompt&gt;</code> — Run Cursor Agent (with live progress & memory)
• <code>/task &lt;prompt&gt;</code> — Run Antigravity Agent (with live progress & memory)
• <code>/agents</code> — View all running agents (Active: <b>${activeCount}</b>)
• <code>/cancel [id]</code> — Stop / cancel a running agent
• <code>/dir [path]</code> — View or switch workspace directory (Current: <code>${escapeHtml(cwd)}</code>)

💬 <b>Multi-Turn Native Threading:</b>
• <i>Reply directly to ANY bot message in Telegram to natively resume that agent session!</i>

💾 <b>Memory & System Prompt:</b>
• <code>/memory</code> — View persistent memory
• <code>/remember &lt;note&gt;</code> — Add persistent memory note
• <code>/prompt</code> — View system prompt & plugged memory

📊 <b>System & Health:</b>
• <code>/status</code> — CPU, RAM, Disk, Temp & Uptime
• <code>/top</code> — Top CPU/Memory processes
• <code>/ping</code> — Daemon health check
• <code>/sh &lt;cmd&gt;</code> — Run shell command on host

📜 <b>History & Web UI:</b>
• <code>/logs [n]</code> — Show recent notifications
• <code>/links</code> — Dashboard access links (Tailscale & LAN)

<i>Tap a quick button below:</i>`;

    const inlineKeyboard = [
      [
        { text: `👥 Agents (${activeCount})`, callback_data: 'cmd_agents' },
        { text: '📊 Status', callback_data: 'cmd_status' },
      ],
      [
        { text: '💾 Memory', callback_data: 'cmd_memory' },
        { text: '📜 System Prompt', callback_data: 'cmd_prompt' },
      ],
      [
        { text: '⚡ Top Processes', callback_data: 'cmd_top' },
        { text: '📜 Recent Logs', callback_data: 'cmd_logs' },
      ],
      [
        { text: '🌐 Dashboard Links', callback_data: 'cmd_links' },
      ],
    ];

    await this.client.sendMessage({
      text: helpText,
      agent: 'BotDaemon',
      parseMode: 'HTML',
      inlineKeyboard,
      replyToMessageId,
      includeLinks: false,
    });
  }

  private formatSystemStatus(): string {
    const m = getSystemMetrics();
    const mon = this.config.monitor || { enabled: false };

    const hours = Math.floor(m.uptimeSec / 3600);
    const mins = Math.floor((m.uptimeSec % 3600) / 60);

    const cpuBar = this.renderProgressBar(m.cpu.usagePct);
    const ramBar = this.renderProgressBar(m.ram.usedPct);
    const diskBar = this.renderProgressBar(m.disk.usedPct);

    let text = `🖥️ <b>Host:</b> <code>${m.hostname}</code> (Uptime: ${hours}h ${mins}m)\n\n`;
    text += `<b>CPU:</b> ${m.cpu.usagePct}%\n<code>${cpuBar}</code>\nLoad: ${m.cpu.loadAvg.join(', ')} (${m.cpu.cores} cores)\n\n`;
    text += `<b>RAM:</b> ${m.ram.usedPct}% (${(m.ram.usedMb / 1024).toFixed(1)}GB / ${(m.ram.totalMb / 1024).toFixed(1)}GB)\n<code>${ramBar}</code>\n\n`;
    text += `<b>Disk (/):</b> ${m.disk.usedPct}% (${m.disk.usedGb}GB / ${m.disk.totalGb}GB)\n<code>${diskBar}</code>\n\n`;

    if (m.tempC !== undefined) {
      text += `🌡️ <b>Temperature:</b> ${m.tempC}°C\n`;
    }

    text += `\n👥 <b>Active Agents:</b> ${taskManager.getActiveCount()} running\n`;
    text += `🔔 <b>Alert Monitor:</b> ${mon.enabled ? '✅ ENABLED' : '⏸️ DISABLED'}`;
    return text;
  }

  private renderProgressBar(pct: number): string {
    const totalBars = 10;
    const filled = Math.min(totalBars, Math.max(0, Math.round((pct / 100) * totalBars)));
    const empty = totalBars - filled;
    return '█'.repeat(filled) + '░'.repeat(empty);
  }

  private async getTopProcesses(): Promise<string> {
    try {
      const { stdout } = await execAsync('ps -eo pid,%cpu,%mem,comm --sort=-%cpu | head -n 11');
      return `⚡ <b>Top Processes by CPU:</b>\n<pre>${escapeHtml(stdout.trim())}</pre>`;
    } catch (err: any) {
      return `⚠️ Failed to get processes: ${err.message}`;
    }
  }

  private formatLinks(): string {
    const msgId = messageStore.generateId();
    const links = getMessageLinks(msgId, this.config.serverPort, this.config);
    let text = '🌐 <b>agent-notify Web Dashboard Links:</b>\n\n';
    text += `• <b>Tailscale:</b> <a href="${links.tailscale}">${links.tailscale}</a>\n`;
    text += `• <b>Local LAN:</b> <a href="${links.lan}">${links.lan}</a>\n`;
    text += `• <b>Localhost:</b> <code>http://localhost:${this.config.serverPort || 4173}</code>\n`;
    return text;
  }

  private formatRecentLogs(count = 5): string {
    const { items } = messageStore.getMessages({ limit: count });
    if (items.length === 0) {
      return '📜 <b>No notification logs found.</b>';
    }

    let text = `📜 <b>Recent Notifications (${items.length}):</b>\n\n`;
    for (const item of items) {
      const time = new Date(item.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      const badge = item.level === 'error' ? '🚨' : item.level === 'warn' ? '⚠️' : item.level === 'success' ? '✅' : 'ℹ️';
      const snippet = item.content.length > 80 ? item.content.slice(0, 77) + '...' : item.content;
      text += `${badge} <b>[${item.agent}]</b> (<i>${time}</i>)\n${escapeHtml(snippet)}\n\n`;
    }
    return text;
  }

  private formatMemory(): string {
    const memory = loadMemory(this.config.botListener?.memoryFile);
    const memPath = getMemoryFilePath(this.config.botListener?.memoryFile);
    return `💾 <b>Persistent Agent Memory:</b>\n📁 <code>${escapeHtml(memPath)}</code>\n\n<pre>${escapeHtml(memory)}</pre>\n\n<i>To add a memory: <code>/remember &lt;note&gt;</code></i>`;
  }

  private formatSystemPrompt(): string {
    const cwd = this.config.botListener?.workspaceDir || process.cwd();
    const effective = getEffectiveSystemPrompt({
      customPromptPath: this.config.botListener?.systemPromptFile,
      customMemoryPath: this.config.botListener?.memoryFile,
      workspaceDir: cwd,
    });
    const promptPath = getSystemPromptFilePath(this.config.botListener?.systemPromptFile);

    let snippet = effective;
    if (snippet.length > 3000) {
      snippet = snippet.slice(0, 3000) + '\n... [truncated]';
    }

    return `📜 <b>System Prompt (with Memory plugged in):</b>\n📁 <code>${escapeHtml(promptPath)}</code>\n\n<pre>${escapeHtml(snippet)}</pre>`;
  }

  private async handleMemoryAdd(note: string, replyToMessageId?: number): Promise<void> {
    if (!note) {
      await this.sendReply('Usage: <code>/remember &lt;note&gt;</code> or <code>/memory add &lt;note&gt;</code>', replyToMessageId);
      return;
    }
    const entry = appendMemory(note, this.config.botListener?.memoryFile);
    await this.sendReply(`💾 <b>Memory Saved!</b>\n\n<code>${escapeHtml(entry)}</code>\n\n<i>This will automatically be plugged into future /cursor and /task agent executions.</i>`, replyToMessageId);
  }

  private async handleWorkspaceDir(newDir?: string, replyToMessageId?: number): Promise<void> {
    if (newDir) {
      const resolved = path.resolve(newDir);
      if (!fs.existsSync(resolved)) {
        await this.sendReply(`⚠️ Directory does not exist: <code>${escapeHtml(resolved)}</code>`, replyToMessageId);
        return;
      }
      this.config.botListener = {
        ...(this.config.botListener || {}),
        workspaceDir: resolved,
      };
      saveConfig({ botListener: { workspaceDir: resolved } });
      await this.sendReply(`📁 <b>Workspace directory updated:</b>\n<code>${escapeHtml(resolved)}</code>\n\nFuture <code>/cursor</code>, <code>/task</code>, and <code>/sh</code> executions will run here.`, replyToMessageId);
    } else {
      const current = this.config.botListener?.workspaceDir || process.cwd();
      await this.sendReply(`📁 <b>Current workspace directory:</b>\n<code>${escapeHtml(current)}</code>\n\n<i>To change: <code>/dir /path/to/project</code></i>`, replyToMessageId);
    }
  }

  private async executeAndReplyShell(command: string, replyToMessageId?: number): Promise<void> {
    const executionCwd = this.config.botListener?.workspaceDir || process.cwd();
    await this.sendReply(`⚙️ <i>Executing in <code>${escapeHtml(executionCwd)}</code>:</i>\n<code>${escapeHtml(command)}</code>...`, replyToMessageId);

    try {
      const { stdout, stderr } = await execAsync(command, { timeout: 30000, cwd: executionCwd });
      let output = (stdout || stderr || '(No output)').trim();
      if (output.length > 3500) {
        output = output.slice(0, 3500) + '\n... [output truncated]';
      }
      await this.sendReply(`<b>Output:</b>\n<pre>${escapeHtml(output)}</pre>`, replyToMessageId);
    } catch (err: any) {
      const errOut = err.stderr || err.stdout || err.message;
      await this.sendReply(`❌ <b>Execution Error:</b>\n<pre>${escapeHtml(errOut.slice(0, 3000))}</pre>`, replyToMessageId);
    }
  }

  private async handleCursorTask(
    prompt: string,
    user: string,
    replyToMessageId?: number,
    options?: AgentTaskOptions
  ): Promise<void> {
    const executionCwd = options?.workspaceDir || this.config.botListener?.workspaceDir || process.cwd();
    const displayPrompt = options?.originalPrompt || prompt;

    // Allocate / retrieve session ID for native conversation resumption
    let sessionId = options?.sessionId;
    if (!sessionId) {
      try {
        const { stdout: chatOut } = await execAsync('agent create-chat 2>/dev/null || echo ""');
        const trimmed = chatOut.trim();
        if (trimmed && /^[a-zA-Z0-9_-]+$/.test(trimmed)) {
          sessionId = trimmed;
        }
      } catch {}
    }

    // Register active task
    const task = taskManager.registerTask({
      agentType: 'Cursor',
      prompt: displayPrompt,
      user,
      workspaceDir: executionCwd,
    });

    const cancelKeyboard = [
      [
        { text: '🛑 Cancel Task', callback_data: `cancel_task_${task.id}` },
        { text: '👥 Active Agents', callback_data: 'cmd_agents' },
      ],
    ];

    // Send live progress status card
    const initialCard = taskManager.buildLiveStatusCard(task.id);
    const sent = await this.client.sendMessage({
      text: initialCard,
      agent: 'CursorAgent',
      parseMode: 'HTML',
      inlineKeyboard: cancelKeyboard,
      replyToMessageId,
      includeLinks: false,
      sessionId,
    });

    taskManager.setStatusMessageId(task.id, sent.message_id);

    // Start periodic live ticker (edits message every 6s)
    taskManager.startLiveTicker(task.id, 6000, async (_t, cardText) => {
      if (task.statusMessageId) {
        await this.client.editMessageText(
          task.statusMessageId,
          cardText,
          'HTML',
          { inline_keyboard: cancelKeyboard }
        ).catch(() => {});
      }
    });

    // Build prompt with plugged memory & system instructions (only on turn 1 if resuming)
    const augmentedPrompt = options?.isThreadFollowUp
      ? prompt
      : buildAgentPrompt(prompt, {
          workspaceDir: executionCwd,
          customPromptPath: this.config.botListener?.systemPromptFile,
          customMemoryPath: this.config.botListener?.memoryFile,
        });

    // Record task in store
    const taskRecord: StoredMessage = {
      id: messageStore.generateId(),
      agent: 'CursorAgent',
      type: 'notification',
      level: 'info',
      content: `Dispatched Cursor task from ${user}: ${displayPrompt}`,
      prompt: displayPrompt,
      workspaceDir: executionCwd,
      sessionId,
      telegramMessageId: sent.message_id,
      status: 'delivered',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    messageStore.saveMessage(taskRecord);

    try {
      const { stdout: whichOut } = await execAsync('which agent || which cursor || echo ""');
      const agentBin = whichOut.trim();

      if (!agentBin) {
        taskManager.completeTask(task.id);
        await this.sendReply('❌ Cursor Agent CLI (`agent` or `cursor`) was not found in system PATH.', replyToMessageId);
        return;
      }

      const args = sessionId
        ? ['-p', '--resume', sessionId, '--trust', '-f', augmentedPrompt]
        : ['-p', '--trust', '-f', augmentedPrompt];

      const child = spawn(agentBin, args, {
        stdio: 'pipe',
        cwd: executionCwd,
      });

      task.childProcess = child;
      task.pid = child.pid;

      let resultOut = '';
      child.stdout?.on('data', (d) => {
        const chunk = d.toString();
        resultOut += chunk;
        taskManager.updateTaskActivity(task.id, chunk);
      });
      child.stderr?.on('data', (d) => {
        const chunk = d.toString();
        resultOut += chunk;
        taskManager.updateTaskActivity(task.id, chunk);
      });

      child.on('close', async (code) => {
        const wasCancelled = task.isCancelled;
        const elapsedSec = Math.max(1, Math.floor((Date.now() - task.startedAt) / 1000));
        const timeStr = elapsedSec >= 60 ? `${Math.floor(elapsedSec / 60)}m ${elapsedSec % 60}s` : `${elapsedSec}s`;

        taskManager.completeTask(task.id);

        if (wasCancelled) return;

        const clipped = clipPrompt(displayPrompt, 65);
        let summary = resultOut.trim() || 'Goal achieved successfully.';
        if (summary.length > 3400) summary = summary.slice(-3400);
        const formatted = markdownToTelegramHtml(summary);

        const header = code === 0
          ? `✅ <b>Cursor Task Completed!</b> (⏱️ ${timeStr})\n📝 <i>"${escapeHtml(clipped)}"</i>\n\n`
          : `⚠️ <b>Cursor Task Ended (Exit code ${code})</b> (⏱️ ${timeStr})\n📝 <i>"${escapeHtml(clipped)}"</i>\n\n`;

        const finalText = header + formatted;

        // Update the live status message in-place
        let editSucceeded = false;
        if (task.statusMessageId) {
          try {
            await this.client.editMessageText(
              task.statusMessageId,
              finalText,
              'HTML',
              { inline_keyboard: [] }
            );
            editSucceeded = true;
          } catch (err: any) {
            console.warn('[BotListener] In-place edit failed, falling back to sendMessage:', err.message);
          }
        }

        if (!editSucceeded) {
          const completionSent = await this.client.sendMessage({
            text: finalText,
            agent: 'CursorAgent',
            parseMode: 'HTML',
            replyToMessageId,
            includeLinks: false,
            prompt: displayPrompt,
            workspaceDir: executionCwd,
            sessionId,
          });
          messageStore.updateMessage(taskRecord.id, {
            content: summary,
            status: code === 0 ? 'delivered' : 'failed',
            telegramMessageId: completionSent.message_id,
          });
        } else {
          messageStore.updateMessage(taskRecord.id, {
            content: summary,
            status: code === 0 ? 'delivered' : 'failed',
            telegramMessageId: task.statusMessageId,
          });
        }
      });
    } catch (err: any) {
      taskManager.completeTask(task.id);
      await this.sendReply(`❌ <b>Failed to dispatch Cursor agent:</b> ${err.message}`, replyToMessageId);
    }
  }

  private async handleAgyTask(
    prompt: string,
    user: string,
    replyToMessageId?: number,
    options?: AgentTaskOptions
  ): Promise<void> {
    const executionCwd = options?.workspaceDir || this.config.botListener?.workspaceDir || process.cwd();
    const displayPrompt = options?.originalPrompt || prompt;

    // Register active task
    const task = taskManager.registerTask({
      agentType: 'Antigravity',
      prompt: displayPrompt,
      user,
      workspaceDir: executionCwd,
    });

    const cancelKeyboard = [
      [
        { text: '🛑 Cancel Task', callback_data: `cancel_task_${task.id}` },
        { text: '👥 Active Agents', callback_data: 'cmd_agents' },
      ],
    ];

    // Send live progress status card
    const initialCard = taskManager.buildLiveStatusCard(task.id);
    const sent = await this.client.sendMessage({
      text: initialCard,
      agent: 'Antigravity',
      parseMode: 'HTML',
      inlineKeyboard: cancelKeyboard,
      replyToMessageId,
      includeLinks: false,
    });

    taskManager.setStatusMessageId(task.id, sent.message_id);

    // Start periodic live ticker (edits message every 6s)
    taskManager.startLiveTicker(task.id, 6000, async (_t, cardText) => {
      if (task.statusMessageId) {
        await this.client.editMessageText(
          task.statusMessageId,
          cardText,
          'HTML',
          { inline_keyboard: cancelKeyboard }
        ).catch(() => {});
      }
    });

    // Build prompt with plugged memory & system instructions
    const augmentedPrompt = buildAgentPrompt(prompt, {
      workspaceDir: executionCwd,
      customPromptPath: this.config.botListener?.systemPromptFile,
      customMemoryPath: this.config.botListener?.memoryFile,
    });

    // Record task start in messageStore
    const taskRecord: StoredMessage = {
      id: messageStore.generateId(),
      agent: 'TelegramTask',
      type: 'notification',
      level: 'info',
      content: `Dispatched task from ${user}: ${displayPrompt}`,
      prompt: displayPrompt,
      workspaceDir: executionCwd,
      telegramMessageId: sent.message_id,
      status: 'delivered',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    messageStore.saveMessage(taskRecord);

    // Check if `agy` CLI is available in PATH
    try {
      const { stdout: whichOut } = await execAsync('which agy || which antigravity || echo ""');
      const agyPath = whichOut.trim();

      if (agyPath) {
        const agyArgs = options?.isThreadFollowUp
          ? ['--continue', '--dangerously-skip-permissions', '-p', augmentedPrompt]
          : ['--dangerously-skip-permissions', '-p', augmentedPrompt];

        const child = spawn(agyPath, agyArgs, {
          stdio: 'pipe',
          cwd: executionCwd,
        });

        task.childProcess = child;
        task.pid = child.pid;

        let resultOut = '';
        child.stdout?.on('data', (d) => {
          const chunk = d.toString();
          resultOut += chunk;
          taskManager.updateTaskActivity(task.id, chunk);
        });
        child.stderr?.on('data', (d) => {
          const chunk = d.toString();
          resultOut += chunk;
          taskManager.updateTaskActivity(task.id, chunk);
        });

        child.on('close', async (code) => {
          const wasCancelled = task.isCancelled;
          const elapsedSec = Math.max(1, Math.floor((Date.now() - task.startedAt) / 1000));
          const timeStr = elapsedSec >= 60 ? `${Math.floor(elapsedSec / 60)}m ${elapsedSec % 60}s` : `${elapsedSec}s`;

          taskManager.completeTask(task.id);

          if (wasCancelled) return;

          const clipped = clipPrompt(displayPrompt, 65);
          let summary = resultOut.trim() || 'Goal achieved successfully.';
          if (summary.length > 3400) summary = summary.slice(-3400);
          const formatted = markdownToTelegramHtml(summary);

          const header = code === 0
            ? `✅ <b>Antigravity Task Completed!</b> (⏱️ ${timeStr})\n📝 <i>"${escapeHtml(clipped)}"</i>\n\n`
            : `⚠️ <b>Antigravity Task Ended (Exit code ${code})</b> (⏱️ ${timeStr})\n📝 <i>"${escapeHtml(clipped)}"</i>\n\n`;

          const finalText = header + formatted;

          // Update the live status message in-place
          let editSucceeded = false;
          if (task.statusMessageId) {
            try {
              await this.client.editMessageText(
                task.statusMessageId,
                finalText,
                'HTML',
                { inline_keyboard: [] }
              );
              editSucceeded = true;
            } catch (err: any) {
              console.warn('[BotListener] In-place edit failed, falling back to sendMessage:', err.message);
            }
          }

          if (!editSucceeded) {
            const completionSent = await this.client.sendMessage({
              text: finalText,
              agent: 'Antigravity',
              parseMode: 'HTML',
              replyToMessageId,
              includeLinks: false,
              prompt: displayPrompt,
              workspaceDir: executionCwd,
            });
            messageStore.updateMessage(taskRecord.id, {
              content: summary,
              status: code === 0 ? 'delivered' : 'failed',
              telegramMessageId: completionSent.message_id,
            });
          } else {
            messageStore.updateMessage(taskRecord.id, {
              content: summary,
              status: code === 0 ? 'delivered' : 'failed',
              telegramMessageId: task.statusMessageId,
            });
          }
        });
      } else {
        taskManager.completeTask(task.id);
        await this.sendReply(`📝 <b>Task Queued:</b>\n"${escapeHtml(prompt)}"\n\n<i>Agent notification recorded. The active coding agent will see this in the message queue.</i>`, replyToMessageId);
      }
    } catch (err: any) {
      taskManager.completeTask(task.id);
      await this.sendReply(`❌ <b>Failed to dispatch agent:</b> ${err.message}`, replyToMessageId);
    }
  }
}

let globalBotListener: BotListener | null = null;

export function startBotListener(config?: TelegramConfig): BotListener {
  if (!globalBotListener) {
    globalBotListener = new BotListener(config);
    globalBotListener.start();
  }
  return globalBotListener;
}

export function stopBotListener(): void {
  if (globalBotListener) {
    globalBotListener.stop();
    globalBotListener = null;
  }
}
