export type NotificationLevel = 'info' | 'success' | 'warn' | 'error';

export type ParseMode = 'MarkdownV2' | 'HTML' | 'Markdown';

export type MessageType = 'notification' | 'file' | 'ask';

export interface TelegramConfig {
  botToken: string;
  chatId: string;
  topicId?: number; // message_thread_id for forum topics
  serverPort?: number; // default 4173
  includeLinks?: boolean; // include Tailscale & LAN links in messages (default true)
  tailscaleHost?: string; // custom tailscale IP or MagicDNS override
  lanHost?: string; // custom LAN IP override
}

export interface StoredMessage {
  id: string;
  agent: string; // e.g. "Antigravity", "Claude", "DeployBot"
  type: MessageType;
  level: NotificationLevel;
  content: string;
  title?: string;
  filePath?: string;
  fileName?: string;
  fileSize?: number;
  options?: string[]; // For ask questions
  response?: string; // Answer given by user
  answeredBy?: string;
  status: 'delivered' | 'answered' | 'timed_out' | 'failed';
  telegramMessageId?: number;
  links?: {
    tailscale: string;
    lan: string;
    local: string;
  };
  createdAt: string; // ISO
  updatedAt: string; // ISO
}

export interface SendMessageOptions {
  text: string;
  agent?: string;
  title?: string;
  level?: NotificationLevel;
  parseMode?: ParseMode;
  silent?: boolean;
  replyToMessageId?: number;
  includeLinks?: boolean;
  inlineKeyboard?: Array<Array<{ text: string; callback_data: string }>>;
}

export interface SendFileOptions {
  filePath: string;
  caption?: string;
  agent?: string;
  title?: string;
  level?: NotificationLevel;
  silent?: boolean;
  includeLinks?: boolean;
}

export interface AskUserOptions {
  question: string;
  agent?: string;
  options?: string[]; // e.g. ["Approve", "Reject"] or free-form if empty
  timeoutSeconds?: number; // default 300 (5 mins)
  level?: NotificationLevel;
  includeLinks?: boolean;
}

export interface AskUserResult {
  messageId: string;
  answered: boolean;
  response?: string;
  timedOut?: boolean;
  answeredBy?: string;
  timestamp?: number;
}

export interface NetworkAddresses {
  port: number;
  localLanIp: string;
  localLanUrl: string;
  tailscaleIp?: string;
  tailscaleDns?: string;
  tailscaleUrl?: string;
  localhostUrl: string;
}
