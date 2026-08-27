import fs from 'node:fs';
import path from 'node:path';
import type {
  TelegramConfig,
  SendMessageOptions,
  SendFileOptions,
  AskUserOptions,
  AskUserResult,
  NotificationLevel,
  StoredMessage,
} from './types.js';
import { messageStore } from './store.js';
import { getMessageLinks } from './network.js';
import { ensureServerRunning, isServerRunning } from './server.js';

export class TelegramClient {
  private botToken: string;
  private chatId: string;
  private topicId?: number;
  private config: TelegramConfig;
  private apiBase: string;

  constructor(config: TelegramConfig) {
    this.config = config;
    this.botToken = config.botToken;
    this.chatId = config.chatId;
    this.topicId = config.topicId;
    this.apiBase = `https://api.telegram.org/bot${this.botToken}`;
  }

  private async request<T = any>(method: string, body?: any, isFormData = false): Promise<T> {
    const url = `${this.apiBase}/${method}`;
    const headers: Record<string, string> = {};

    let payload: any;
    if (isFormData) {
      payload = body;
    } else if (body) {
      headers['Content-Type'] = 'application/json';
      payload = JSON.stringify(body);
    }

    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: payload,
    });

    const data: any = await response.json();
    if (!data.ok) {
      const desc = data.description || response.statusText;
      throw new Error(`Telegram API error (${data.error_code || response.status}): ${desc}`);
    }
    return data.result;
  }

  async getMe(): Promise<{ id: number; is_bot: boolean; first_name: string; username?: string }> {
    return this.request('getMe');
  }

  private formatLevelPrefix(level?: NotificationLevel, agent?: string): string {
    if (agent === 'SystemMonitor') return '';
    const agentTag = agent ? `[<b>${agent}</b>] ` : '';
    switch (level) {
      case 'success':
        return `✅ ${agentTag}<b>SUCCESS</b>\n`;
      case 'warn':
        return `⚠️ ${agentTag}<b>WARNING</b>\n`;
      case 'error':
        return `🚨 ${agentTag}<b>ERROR</b>\n`;
      case 'info':
        return `ℹ️ ${agentTag}<b>INFO</b>\n`;
      default:
        return agent ? `🤖 <b>[${agent}]</b>\n` : '';
    }
  }

  private buildUrlKeyboard(links: { tailscale: string; lan: string }): Array<{ text: string; url: string }> {
    return [
      { text: '🌐 Tailscale View', url: links.tailscale },
      { text: '🏠 LAN View', url: links.lan },
    ];
  }

  async sendMessage(options: SendMessageOptions): Promise<{ message_id: number; chat: { id: number }; messageRecord: StoredMessage }> {
    // Auto-ensure background server is active so links work seamlessly
    ensureServerRunning(this.config.serverPort).catch(() => {});

    const msgId = messageStore.generateId();
    const links = getMessageLinks(msgId, this.config.serverPort, this.config);
    const agent = options.agent || 'default';
    const level = options.level || 'info';

    // Store message record
    const record: StoredMessage = {
      id: msgId,
      agent,
      type: 'notification',
      level,
      content: options.text,
      title: options.title,
      status: 'delivered',
      prompt: options.prompt,
      workspaceDir: options.workspaceDir,
      sessionId: options.sessionId,
      links,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    messageStore.saveMessage(record);

    const prefix = this.formatLevelPrefix(level, options.agent);
    let fullText = prefix ? `${prefix}\n${options.text}` : options.text;

    const includeLinks = options.includeLinks !== undefined ? options.includeLinks : this.config.includeLinks !== false;
    const parseMode = options.parseMode || (prefix ? 'HTML' : undefined);

    const inlineKeyboard: any[] = options.inlineKeyboard ? [...options.inlineKeyboard] : [];
    if (includeLinks) {
      inlineKeyboard.push(this.buildUrlKeyboard(links));
    }

    const payload: Record<string, any> = {
      chat_id: this.chatId,
      text: fullText,
      disable_notification: Boolean(options.silent),
    };

    if (this.topicId) {
      payload.message_thread_id = this.topicId;
    }

    if (options.replyToMessageId) {
      payload.reply_to_message_id = options.replyToMessageId;
    }

    if (parseMode) {
      payload.parse_mode = parseMode;
    }

    if (inlineKeyboard.length > 0) {
      payload.reply_markup = { inline_keyboard: inlineKeyboard };
    }

    try {
      const res = await this.request('sendMessage', payload);
      messageStore.updateMessage(msgId, { telegramMessageId: res.message_id });
      return { ...res, messageRecord: record };
    } catch (err: any) {
      if (parseMode && (err.message.includes('can\'t parse entities') || err.message.includes('parse_mode'))) {
        delete payload.parse_mode;
        payload.text = `[${agent.toUpperCase()}] [${level.toUpperCase()}]\n\n${options.text}`;
        const res = await this.request('sendMessage', payload);
        messageStore.updateMessage(msgId, { telegramMessageId: res.message_id });
        return { ...res, messageRecord: record };
      }
      messageStore.updateMessage(msgId, { status: 'failed' });
      throw err;
    }
  }

  async sendFile(options: SendFileOptions): Promise<{ message_id: number; messageRecord: StoredMessage }> {
    ensureServerRunning(this.config.serverPort).catch(() => {});

    if (!fs.existsSync(options.filePath)) {
      throw new Error(`File not found at path: ${options.filePath}`);
    }

    const stat = fs.statSync(options.filePath);
    if (!stat.isFile()) {
      throw new Error(`Path is not a regular file: ${options.filePath}`);
    }

    const filename = path.basename(options.filePath);
    const msgId = messageStore.generateId();
    const links = getMessageLinks(msgId, this.config.serverPort, this.config);
    const agent = options.agent || 'default';
    const level = options.level || 'info';

    const record: StoredMessage = {
      id: msgId,
      agent,
      type: 'file',
      level,
      content: options.caption || `Uploaded file: ${filename}`,
      title: options.title || filename,
      filePath: path.resolve(options.filePath),
      fileName: filename,
      fileSize: stat.size,
      status: 'delivered',
      links,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    messageStore.saveMessage(record);

    const fileBuffer = fs.readFileSync(options.filePath);
    const fileBlob = new Blob([fileBuffer]);

    const ext = path.extname(filename).toLowerCase();
    const isImage = ['.png', '.jpg', '.jpeg', '.webp', '.gif'].includes(ext);
    const method = isImage ? 'sendPhoto' : 'sendDocument';
    const fileField = isImage ? 'photo' : 'document';

    const formData = new FormData();
    formData.append('chat_id', this.chatId);
    if (this.topicId) {
      formData.append('message_thread_id', String(this.topicId));
    }
    if (options.silent) {
      formData.append('disable_notification', 'true');
    }

    let caption = options.caption || '';
    const prefix = this.formatLevelPrefix(level, options.agent);
    caption = prefix ? `${prefix}${caption}`.trim() : caption;
    formData.append('parse_mode', 'HTML');
    if (caption) {
      formData.append('caption', caption);
    }

    const includeLinks = options.includeLinks !== undefined ? options.includeLinks : this.config.includeLinks !== false;
    if (includeLinks) {
      formData.append('reply_markup', JSON.stringify({
        inline_keyboard: [this.buildUrlKeyboard(links)],
      }));
    }

    formData.append(fileField, fileBlob, filename);

    try {
      const res = await this.request(method, formData, true);
      messageStore.updateMessage(msgId, { telegramMessageId: res.message_id });
      return { ...res, messageRecord: record };
    } catch (err: any) {
      messageStore.updateMessage(msgId, { status: 'failed' });
      throw err;
    }
  }

  async getUpdates(offset?: number, timeout = 0): Promise<any[]> {
    const payload: Record<string, any> = {
      timeout,
      allowed_updates: ['message', 'callback_query'],
    };
    if (offset !== undefined) {
      payload.offset = offset;
    }
    return this.request('getUpdates', payload);
  }

  async answerCallbackQuery(callbackQueryId: string, text?: string): Promise<boolean> {
    return this.request('answerCallbackQuery', {
      callback_query_id: callbackQueryId,
      text,
    });
  }

  async editMessageText(messageId: number, text: string, parseMode?: string, replyMarkup?: any): Promise<any> {
    const payload: Record<string, any> = {
      chat_id: this.chatId,
      message_id: messageId,
      text,
    };
    if (parseMode) {
      payload.parse_mode = parseMode;
    }
    if (replyMarkup) {
      payload.reply_markup = replyMarkup;
    }
    return this.request('editMessageText', payload);
  }

  async askUser(options: AskUserOptions): Promise<AskUserResult> {
    ensureServerRunning(this.config.serverPort).catch(() => {});

    const timeoutSeconds = options.timeoutSeconds || 300;
    const startTime = Date.now();
    const deadline = startTime + timeoutSeconds * 1000;
    const msgId = messageStore.generateId();
    const links = getMessageLinks(msgId, this.config.serverPort, this.config);
    const agent = options.agent || 'default';
    const level = options.level || 'info';

    // Store ask record
    const record: StoredMessage = {
      id: msgId,
      agent,
      type: 'ask',
      level,
      content: options.question,
      options: options.options,
      status: 'delivered',
      links,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    messageStore.saveMessage(record);

    // Setup listener for Web UI response event (Two-Way Communication via Web)
    let webAnswerReceived: { response: string; answeredBy: string } | null = null;
    const webAnswerListener = (data: { response: string; answeredBy: string }) => {
      webAnswerReceived = data;
    };
    messageStore.once(`answer_${msgId}`, webAnswerListener);

    // Step 1: Flushes previous updates
    let latestOffset = 0;
    try {
      const initialUpdates = await this.getUpdates(-1, 0);
      if (initialUpdates.length > 0) {
        latestOffset = initialUpdates[initialUpdates.length - 1].update_id + 1;
      }
    } catch {}

    // Step 2: Build inline keyboard with option buttons and link buttons
    const inlineKeyboard: any[] = [];
    const optionMap = new Map<string, string>();

    if (options.options && options.options.length > 0) {
      const row: Array<{ text: string; callback_data: string }> = [];
      options.options.forEach((opt, idx) => {
        const callbackData = `btn_${idx}`;
        optionMap.set(callbackData, opt);
        row.push({
          text: opt,
          callback_data: callbackData,
        });
      });
      inlineKeyboard.push(row);
    }

    const includeLinks = options.includeLinks !== undefined ? options.includeLinks : this.config.includeLinks !== false;
    if (includeLinks) {
      inlineKeyboard.push(this.buildUrlKeyboard(links));
    }

    // Step 3: Send question message
    const agentTag = agent ? `[<b>${agent}</b>] ` : '';
    const questionText = options.options && options.options.length > 0
      ? `❓ ${agentTag}<b>QUESTION</b>\n\n${options.question}\n\n<i>(Tap an option below or reply to this message)</i>`
      : `❓ ${agentTag}<b>QUESTION</b>\n\n${options.question}\n\n<i>(Reply to this message with your answer)</i>`;

    const sent = await this.sendMessage({
      text: questionText,
      agent: options.agent,
      parseMode: 'HTML',
      inlineKeyboard,
      level: options.level,
      includeLinks: false,
    });

    const questionMessageId = sent.message_id;
    messageStore.updateMessage(msgId, { telegramMessageId: questionMessageId });

    // Step 4: Long polling & Web/Daemon event checking
    while (Date.now() < deadline) {
      // Check if user answered via Web Dashboard or background BotListener
      const currentStored = messageStore.getMessage(msgId);
      if (webAnswerReceived || (currentStored && currentStored.status === 'answered' && currentStored.response)) {
        const answer = webAnswerReceived ? (webAnswerReceived as any).response : currentStored!.response!;
        const answeredBy = webAnswerReceived ? (webAnswerReceived as any).answeredBy || 'User' : currentStored!.answeredBy || 'User';

        messageStore.removeListener(`answer_${msgId}`, webAnswerListener);
        return {
          messageId: msgId,
          answered: true,
          response: answer,
          answeredBy,
          timestamp: Date.now(),
        };
      }

      // If background daemon is running, BotListener handles polling; we just wait on events
      const daemonActive = await isServerRunning(this.config.serverPort);
      if (daemonActive) {
        await new Promise((resolve) => setTimeout(resolve, 500));
        continue;
      }

      const remainingTime = Math.max(1, Math.min(5, Math.floor((deadline - Date.now()) / 1000)));

      try {
        const updates = await this.getUpdates(latestOffset, remainingTime);

        for (const update of updates) {
          latestOffset = update.update_id + 1;

          if (update.callback_query) {
            const cq = update.callback_query;
            const message = cq.message;
            if (message && message.message_id === questionMessageId) {
              const selectedValue = optionMap.get(cq.data) || cq.data;
              await this.answerCallbackQuery(cq.id, `Selected: ${selectedValue}`);

              const answeredBy = cq.from?.username ? `@${cq.from.username}` : cq.from?.first_name || 'User';

              messageStore.updateMessage(msgId, {
                status: 'answered',
                response: selectedValue,
                answeredBy,
              });
              messageStore.removeListener(`answer_${msgId}`, webAnswerListener);

              const finalMarkup = includeLinks ? { inline_keyboard: [this.buildUrlKeyboard(links)] } : undefined;
              await this.editMessageText(
                questionMessageId,
                `❓ ${agentTag}<b>QUESTION</b>\n\n${options.question}\n\n<b>Answered:</b> <code>${selectedValue}</code> ✅ <i>(by ${answeredBy})</i>`,
                'HTML',
                finalMarkup
              ).catch(() => {});

              return {
                messageId: msgId,
                answered: true,
                response: selectedValue,
                answeredBy,
                timestamp: Date.now(),
              };
            }
          }

          if (update.message) {
            const msg = update.message;
            const isFromSameChat = String(msg.chat.id) === String(this.chatId);
            const isReplyToQuestion = msg.reply_to_message && msg.reply_to_message.message_id === questionMessageId;

            if (isFromSameChat && (isReplyToQuestion || (!options.options && msg.text))) {
              const answerText = msg.text || '';
              const answeredBy = msg.from?.username ? `@${msg.from.username}` : msg.from?.first_name || 'User';

              messageStore.updateMessage(msgId, {
                status: 'answered',
                response: answerText,
                answeredBy,
              });
              messageStore.removeListener(`answer_${msgId}`, webAnswerListener);

              const finalMarkup = includeLinks ? { inline_keyboard: [this.buildUrlKeyboard(links)] } : undefined;
              await this.editMessageText(
                questionMessageId,
                `❓ ${agentTag}<b>QUESTION</b>\n\n${options.question}\n\n<b>Answered:</b> <code>${answerText}</code> ✅ <i>(by ${answeredBy})</i>`,
                'HTML',
                finalMarkup
              ).catch(() => {});

              return {
                messageId: msgId,
                answered: true,
                response: answerText,
                answeredBy,
                timestamp: Date.now(),
              };
            }
          }
        }
      } catch {
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
    }

    messageStore.removeListener(`answer_${msgId}`, webAnswerListener);

    // Timed out
    messageStore.updateMessage(msgId, { status: 'timed_out' });
    const finalMarkup = includeLinks ? { inline_keyboard: [this.buildUrlKeyboard(links)] } : undefined;
    await this.editMessageText(
      questionMessageId,
      `❓ ${agentTag}<b>QUESTION</b>\n\n${options.question}\n\n⌛ <i>[Timed out after ${timeoutSeconds}s with no response]</i>`,
      'HTML',
      finalMarkup
    ).catch(() => {});

    return {
      messageId: msgId,
      answered: false,
      timedOut: true,
      timestamp: Date.now(),
    };
  }
}
