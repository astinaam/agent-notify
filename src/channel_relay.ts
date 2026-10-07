import { TelegramClient } from './telegram.js';
import { resolveConfig, validateConfig } from './config.js';
import type { ChannelAgent, ChannelMessage } from './types.js';

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

async function getClient(): Promise<TelegramClient | null> {
  try {
    const config = resolveConfig();
    const validation = validateConfig(config);
    if (!validation.valid) return null;
    return new TelegramClient(config);
  } catch {
    return null;
  }
}

async function relay(text: string): Promise<void> {
  const client = await getClient();
  if (!client) return;
  try {
    await client.sendMessage({
      text,
      agent: 'Channel',
      parseMode: 'HTML',
      level: 'info',
      includeLinks: false,
    });
  } catch {
    // Relay failures should not break CLI/API flows
  }
}

export async function relayChannelCreated(createdBy: string): Promise<void> {
  await relay(
    `📡 <b>Channel created</b>\nBy: <b>${escapeHtml(createdBy)}</b>\n\nAgents can now register and chat.`
  );
}

export async function relayChannelDeleted(): Promise<void> {
  await relay(`🗑️ <b>Channel deleted</b>\nLive roster and messages removed. Archives kept.`);
}

export async function relayAgentRegistered(agent: ChannelAgent): Promise<void> {
  await relay(
    `👋 <b>Agent registered</b>\n` +
      `Name: <b>${escapeHtml(agent.name)}</b>\n` +
      `Bio: ${escapeHtml(agent.bio)}\n` +
      `Model: <code>${escapeHtml(agent.model)}</code>\n` +
      `Dir: <code>${escapeHtml(agent.dir)}</code>`
  );
}

export async function relayAgentUpdated(agent: ChannelAgent): Promise<void> {
  await relay(
    `🔄 <b>Agent status updated</b>\n` +
      `Name: <b>${escapeHtml(agent.name)}</b>\n` +
      `Bio: ${escapeHtml(agent.bio)}\n` +
      `Model: <code>${escapeHtml(agent.model)}</code>\n` +
      `Dir: <code>${escapeHtml(agent.dir)}</code>`
  );
}

export async function relayAgentUnregistered(agent: ChannelAgent): Promise<void> {
  await relay(`🚪 <b>Agent unregistered</b>\nName: <b>${escapeHtml(agent.name)}</b>`);
}

export async function relayChannelMessage(msg: ChannelMessage): Promise<void> {
  if (msg.kind === 'dm') {
    await relay(
      `🔒 <b>DM</b> <b>${escapeHtml(msg.from)}</b> → <b>${escapeHtml(msg.to || '?')}</b>\n${escapeHtml(msg.body)}`
    );
    return;
  }
  const label = msg.from.toLowerCase() === 'human' ? 'Human' : 'Channel';
  await relay(
    `💬 <b>${escapeHtml(label)}</b> · <b>${escapeHtml(msg.from)}</b>\n${escapeHtml(msg.body)}`
  );
}

export async function relayHistoryCleared(archivePath: string, messageCount: number): Promise<void> {
  await relay(
    `🧹 <b>Channel history cleared</b>\n` +
      `Archived ${messageCount} message(s)\n` +
      `<code>${escapeHtml(archivePath)}</code>`
  );
}
