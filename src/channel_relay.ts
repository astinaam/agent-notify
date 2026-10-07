import { TelegramClient } from './telegram.js';
import { resolveConfig, validateConfig, getHumanName, isHumanName } from './config.js';
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

export async function relayChannelCreated(meta: {
  code: string;
  purpose: string;
  createdBy: string;
}): Promise<void> {
  await relay(
    `📡 <b>Channel created</b> <code>#${escapeHtml(meta.code)}</code>\n` +
      `Purpose: ${escapeHtml(meta.purpose)}\n` +
      `By: <b>${escapeHtml(meta.createdBy)}</b>`
  );
}

export async function relayChannelUpdated(meta: { code: string; purpose: string }): Promise<void> {
  await relay(
    `✏️ <b>Channel updated</b> <code>#${escapeHtml(meta.code)}</code>\n` +
      `Purpose: ${escapeHtml(meta.purpose)}`
  );
}

export async function relayChannelDeleted(code: string, archivePath: string): Promise<void> {
  await relay(
    `🗑️ <b>Channel deleted</b> <code>#${escapeHtml(code)}</code>\n` +
      `Full channel archived.\n<code>${escapeHtml(archivePath)}</code>`
  );
}

export async function relayAgentRegistered(agent: ChannelAgent, channelCode = 'main'): Promise<void> {
  await relay(
    `👋 <b>Agent registered</b> on <code>#${escapeHtml(channelCode)}</code>\n` +
      `Name: <b>${escapeHtml(agent.name)}</b>\n` +
      `Bio: ${escapeHtml(agent.bio)}\n` +
      `Model: <code>${escapeHtml(agent.model)}</code>\n` +
      `Dir: <code>${escapeHtml(agent.dir)}</code>`
  );
}

export async function relayAgentUpdated(agent: ChannelAgent, channelCode = 'main'): Promise<void> {
  await relay(
    `🔄 <b>Agent status updated</b> on <code>#${escapeHtml(channelCode)}</code>\n` +
      `Name: <b>${escapeHtml(agent.name)}</b>\n` +
      `Bio: ${escapeHtml(agent.bio)}\n` +
      `Model: <code>${escapeHtml(agent.model)}</code>\n` +
      `Dir: <code>${escapeHtml(agent.dir)}</code>`
  );
}

export async function relayAgentUnregistered(agent: ChannelAgent, channelCode = 'main'): Promise<void> {
  await relay(
    `🚪 <b>Agent unregistered</b> from <code>#${escapeHtml(channelCode)}</code>\n` +
      `Name: <b>${escapeHtml(agent.name)}</b>`
  );
}

export async function relayChannelMessage(msg: ChannelMessage, channelCode = 'main'): Promise<void> {
  if (msg.telegramRelay === false) return;

  if (msg.kind === 'dm') {
    await relay(
      `🔒 <b>DM</b> <code>#${escapeHtml(channelCode)}</code> <b>${escapeHtml(msg.from)}</b> → <b>${escapeHtml(msg.to || '?')}</b>\n${escapeHtml(msg.body)}`
    );
    return;
  }
  const label = isHumanName(msg.from) ? getHumanName() : 'Channel';
  await relay(
    `💬 <b>${escapeHtml(label)}</b> <code>#${escapeHtml(channelCode)}</code> · <b>${escapeHtml(msg.from)}</b>\n${escapeHtml(msg.body)}`
  );
}

export async function relayHistoryArchived(
  archivePath: string,
  messageCount: number,
  agentCount = 0,
  channelCode = 'main'
): Promise<void> {
  await relay(
    `📦 <b>Channel archived</b> <code>#${escapeHtml(channelCode)}</code> (live chat kept; roster reset)\n` +
      `${messageCount} message(s) · ${agentCount} agent(s)\n` +
      `<code>${escapeHtml(archivePath)}</code>`
  );
}

export async function relayHistoryCleared(
  archivePath: string,
  messageCount: number,
  agentCount = 0,
  channelCode = 'main'
): Promise<void> {
  await relay(
    `🧹 <b>Channel cleared</b> <code>#${escapeHtml(channelCode)}</code>\n` +
      `Archived ${messageCount} message(s) · ${agentCount} agent(s); live chat & roster emptied\n` +
      `<code>${escapeHtml(archivePath)}</code>`
  );
}
