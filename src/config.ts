import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import dotenv from 'dotenv';
import type { TelegramConfig, MonitorConfig } from './types.js';

dotenv.config();

export function getConfigDir(): string {
  const xdgConfig = process.env.XDG_CONFIG_HOME;
  if (xdgConfig) {
    return path.join(xdgConfig, 'agent-notify');
  }
  return path.join(os.homedir(), '.config', 'agent-notify');
}

export function getConfigPath(): string {
  return path.join(getConfigDir(), 'config.json');
}

export function loadSavedConfig(): Partial<TelegramConfig> {
  const configPath = getConfigPath();
  if (fs.existsSync(configPath)) {
    try {
      const data = fs.readFileSync(configPath, 'utf8');
      return JSON.parse(data);
    } catch {
      // Ignore JSON parse errors
    }
  }
  return {};
}

export function saveConfig(config: Partial<TelegramConfig>): void {
  const dir = getConfigDir();
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  const existing = loadSavedConfig();
  const merged = {
    ...existing,
    ...config,
    monitor: config.monitor
      ? { ...(existing.monitor || {}), ...config.monitor }
      : existing.monitor,
  };
  fs.writeFileSync(getConfigPath(), JSON.stringify(merged, null, 2), { mode: 0o600 });
}

export function resolveConfig(overrides?: Partial<TelegramConfig>): TelegramConfig {
  const saved = loadSavedConfig();

  const botToken =
    overrides?.botToken ||
    process.env.TELEGRAM_BOT_TOKEN ||
    saved.botToken ||
    '';

  const chatId =
    overrides?.chatId ||
    process.env.TELEGRAM_CHAT_ID ||
    saved.chatId ||
    '';

  const topicIdStr =
    overrides?.topicId !== undefined
      ? String(overrides.topicId)
      : process.env.TELEGRAM_TOPIC_ID || (saved.topicId !== undefined ? String(saved.topicId) : undefined);

  const topicId = topicIdStr ? Number.parseInt(topicIdStr, 10) : undefined;

  const serverPortStr =
    overrides?.serverPort !== undefined
      ? String(overrides.serverPort)
      : process.env.AGENT_NOTIFY_PORT || (saved.serverPort !== undefined ? String(saved.serverPort) : '4173');

  const serverPort = Number.parseInt(serverPortStr, 10) || 4173;

  const includeLinks =
    overrides?.includeLinks !== undefined
      ? overrides.includeLinks
      : process.env.AGENT_NOTIFY_INCLUDE_LINKS !== undefined
      ? process.env.AGENT_NOTIFY_INCLUDE_LINKS !== 'false' && process.env.AGENT_NOTIFY_INCLUDE_LINKS !== '0'
      : saved.includeLinks !== undefined
      ? saved.includeLinks
      : true;

  const tailscaleHost =
    overrides?.tailscaleHost ||
    process.env.AGENT_NOTIFY_TAILSCALE_HOST ||
    saved.tailscaleHost;

  const lanHost =
    overrides?.lanHost ||
    process.env.AGENT_NOTIFY_LAN_HOST ||
    saved.lanHost;

  const monitor: MonitorConfig = {
    enabled: overrides?.monitor?.enabled ?? saved.monitor?.enabled ?? false,
    cpuThresholdPct: overrides?.monitor?.cpuThresholdPct ?? saved.monitor?.cpuThresholdPct ?? 90,
    ramThresholdPct: overrides?.monitor?.ramThresholdPct ?? saved.monitor?.ramThresholdPct ?? 90,
    diskThresholdPct: overrides?.monitor?.diskThresholdPct ?? saved.monitor?.diskThresholdPct ?? 90,
    tempThresholdC: overrides?.monitor?.tempThresholdC ?? saved.monitor?.tempThresholdC ?? 80,
    checkIntervalSec: overrides?.monitor?.checkIntervalSec ?? saved.monitor?.checkIntervalSec ?? 60,
    cooldownSec: overrides?.monitor?.cooldownSec ?? saved.monitor?.cooldownSec ?? 1800,
    alertOnRecovery: overrides?.monitor?.alertOnRecovery ?? saved.monitor?.alertOnRecovery ?? true,
  };

  return {
    botToken,
    chatId: String(chatId),
    topicId: Number.isNaN(topicId) ? undefined : topicId,
    serverPort,
    includeLinks,
    tailscaleHost,
    lanHost,
    monitor,
  };
}

export function validateConfig(config: TelegramConfig): { valid: boolean; error?: string } {
  if (!config.botToken) {
    return {
      valid: false,
      error: 'Telegram Bot Token is missing. Provide via --token, TELEGRAM_BOT_TOKEN env, or run `agent-notify setup`.',
    };
  }
  if (!config.chatId) {
    return {
      valid: false,
      error: 'Telegram Chat ID is missing. Provide via --chat-id, TELEGRAM_CHAT_ID env, or run `agent-notify setup`.',
    };
  }
  return { valid: true };
}
