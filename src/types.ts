export type NotificationLevel = 'info' | 'success' | 'warn' | 'error';

export type ParseMode = 'MarkdownV2' | 'HTML' | 'Markdown';

export type MessageType = 'notification' | 'file' | 'ask';

export interface MonitorConfig {
  enabled: boolean;
  cpuThresholdPct?: number; // e.g. 90 (90%)
  ramThresholdPct?: number; // e.g. 90 (90%)
  diskThresholdPct?: number; // e.g. 90 (90%)
  tempThresholdC?: number; // e.g. 80 (80°C)
  checkIntervalSec?: number; // default 60
  cooldownSec?: number; // default 1800 (30 mins between duplicate alerts)
  alertOnRecovery?: boolean; // default true
}

export interface SystemMetrics {
  hostname: string;
  uptimeSec: number;
  cpu: {
    usagePct: number;
    loadAvg: number[];
    cores: number;
  };
  ram: {
    usedPct: number;
    usedMb: number;
    freeMb: number;
    totalMb: number;
  };
  disk: {
    usedPct: number;
    usedGb: number;
    freeGb: number;
    totalGb: number;
    path: string;
  };
  tempC?: number;
  timestamp: string;
}

export interface TelegramConfig {
  botToken: string;
  chatId: string;
  topicId?: number; // message_thread_id for forum topics
  serverPort?: number; // default 4173
  includeLinks?: boolean; // include Tailscale & LAN links in messages (default true)
  tailscaleHost?: string; // custom tailscale IP or MagicDNS override
  lanHost?: string; // custom LAN IP override
  monitor?: MonitorConfig; // optional system resource monitor
}

export interface StoredMessage {
  id: string;
  agent: string; // e.g. "Antigravity", "Claude", "SystemMonitor"
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
  options?: string[];
  timeoutSeconds?: number;
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
