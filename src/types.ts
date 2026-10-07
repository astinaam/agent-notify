export type NotificationLevel = 'info' | 'success' | 'warn' | 'error';

export type ParseMode = 'MarkdownV2' | 'HTML' | 'Markdown';

export type MessageType = 'notification' | 'file' | 'ask' | 'inbound';

export interface BotListenerConfig {
  enabled?: boolean; // default true
  allowShellCommands?: boolean; // default true (execute /sh or /exec commands)
  autoAgent?: boolean; // forward /task to agy/AI agent
  workspaceDir?: string; // default directory for agent and shell execution
  systemPromptFile?: string; // custom system prompt markdown path
  memoryFile?: string; // custom memory markdown path
}

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
  /** Display name for the human participant in the agent channel (default: Human). */
  humanName?: string;
  monitor?: MonitorConfig; // optional system resource monitor
  botListener?: BotListenerConfig; // optional continuous bot listener config
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
  prompt?: string;
  workspaceDir?: string;
  sessionId?: string;
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
  prompt?: string;
  workspaceDir?: string;
  sessionId?: string;
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

/** Default display name for the human participant in the agent channel. */
export const DEFAULT_CHANNEL_HUMAN_NAME = 'Human';

/** Undeletable primary channel code. */
export const MAIN_CHANNEL_CODE = 'main';

/** Agents heartbeat every 2 minutes. Still "active" if seen within 3 minutes. */
export const PRESENCE_ACTIVE_MS = 3 * 60 * 1000;
/** Seen within 10 minutes but not recently enough to be active. */
export const PRESENCE_AWAY_MS = 10 * 60 * 1000;

export type AgentPresence = 'active' | 'away' | 'offline';

export function agentPresence(
  lastSeenAt?: string | null,
  now = Date.now()
): { presence: AgentPresence; label: string; ageSec: number | null } {
  const t = lastSeenAt ? Date.parse(lastSeenAt) : NaN;
  if (!Number.isFinite(t)) {
    return { presence: 'offline', label: 'Offline', ageSec: null };
  }
  const age = Math.max(0, now - t);
  const ageSec = Math.floor(age / 1000);
  if (age <= PRESENCE_ACTIVE_MS) return { presence: 'active', label: 'Active now', ageSec };
  if (age <= PRESENCE_AWAY_MS) return { presence: 'away', label: 'Away', ageSec };
  return { presence: 'offline', label: 'Offline', ageSec };
}

/** @deprecated Use getHumanName() from config — kept for compatibility. */
export const CHANNEL_HUMAN_NAME = DEFAULT_CHANNEL_HUMAN_NAME;

export type ChannelMessageKind = 'say' | 'dm' | 'system';

export interface ChannelAgent {
  name: string;
  bio: string;
  model: string;
  dir: string;
  registeredAt: string;
  updatedAt: string;
  lastSeenAt: string;
}

export interface ChannelMeta {
  code: string;
  purpose: string;
  createdAt: string;
  createdBy: string;
  updatedAt?: string;
}

export interface ChannelState {
  meta: ChannelMeta;
  agents: Record<string, ChannelAgent>;
}

export interface ChannelMessage {
  id: string;
  from: string;
  to: string | null;
  body: string;
  kind: ChannelMessageKind;
  createdAt: string;
  /**
   * When false, message is stored for Portal/agents but not relayed to Telegram.
   * Default true (relay). Agents use --no-telegram when the human does not need it.
   */
  telegramRelay?: boolean;
}

export interface ChannelStatus {
  exists: boolean;
  code?: string;
  purpose?: string;
  createdAt?: string;
  createdBy?: string;
  agentCount: number;
  messageCount: number;
  deletable?: boolean;
}

export interface ChannelSummary {
  code: string;
  purpose: string;
  createdAt: string;
  createdBy: string;
  updatedAt?: string;
  agentCount: number;
  messageCount: number;
  deletable: boolean;
}

export interface ChannelArchiveInfo {
  filename: string;
  path: string;
  archivedAt: string;
  messageCount: number;
  agentCount?: number;
  channelCode?: string;
  /** true when this archive was created by clear (history emptied after). */
  cleared?: boolean;
  /** true when entire channel was deleted and archived. */
  channelDeleted?: boolean;
  label?: string;
}

export interface ChannelArchiveRecord {
  archivedAt: string;
  messageCount: number;
  messages: ChannelMessage[];
  /** Roster snapshotted at archive time (live roster is cleared). */
  agents?: ChannelAgent[];
  agentCount?: number;
  channelCode?: string;
  channelPurpose?: string;
  cleared?: boolean;
  channelDeleted?: boolean;
  label?: string;
}
