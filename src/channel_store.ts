import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { EventEmitter } from 'node:events';
import { getConfigDir } from './config.js';
import type {
  ChannelAgent,
  ChannelArchiveInfo,
  ChannelMessage,
  ChannelMessageKind,
  ChannelState,
  ChannelStatus,
} from './types.js';

function nowIso(): string {
  return new Date().toISOString();
}

class ChannelStore extends EventEmitter {
  private statePath: string;
  private messagesPath: string;
  private archivesDir: string;
  private state: ChannelState | null = null;
  private messages: ChannelMessage[] = [];
  private stateMtime = 0;
  private messagesMtime = 0;

  constructor() {
    super();
    const dir = getConfigDir();
    this.statePath = path.join(dir, 'channel.json');
    this.messagesPath = path.join(dir, 'channel-messages.json');
    this.archivesDir = path.join(dir, 'channel-archives');
    this.reloadIfChanged();
    this.watchFiles();
  }

  private watchFiles(): void {
    try {
      const dir = getConfigDir();
      this.ensureDir(dir);
      const watcher = fs.watch(dir, (event, filename) => {
        if (!filename) return;
        const name = filename.toString();
        if (name === 'channel.json' || name === 'channel-messages.json') {
          this.reloadIfChanged(true);
        }
      });
      watcher.unref();
    } catch {
      // ignore watch failures
    }
  }

  private ensureDir(dir: string): void {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }

  private reloadIfChanged(emitEvents = false): void {
    const prevAgentCount = this.state ? Object.keys(this.state.agents).length : 0;
    const prevMsgCount = this.messages.length;

    if (fs.existsSync(this.statePath)) {
      try {
        const stat = fs.statSync(this.statePath);
        if (stat.mtimeMs > this.stateMtime) {
          const raw = fs.readFileSync(this.statePath, 'utf8');
          const parsed = JSON.parse(raw) as ChannelState;
          if (parsed?.meta && parsed.agents && typeof parsed.agents === 'object') {
            this.state = parsed;
            this.stateMtime = stat.mtimeMs;
          }
        }
      } catch {
        // keep previous state
      }
    } else {
      this.state = null;
      this.stateMtime = 0;
    }

    if (fs.existsSync(this.messagesPath)) {
      try {
        const stat = fs.statSync(this.messagesPath);
        if (stat.mtimeMs > this.messagesMtime) {
          const raw = fs.readFileSync(this.messagesPath, 'utf8');
          const parsed = JSON.parse(raw) as ChannelMessage[];
          if (Array.isArray(parsed)) {
            this.messages = parsed;
            this.messagesMtime = stat.mtimeMs;
          }
        }
      } catch {
        // keep previous messages
      }
    } else {
      this.messages = [];
      this.messagesMtime = 0;
    }

    if (emitEvents) {
      const agentCount = this.state ? Object.keys(this.state.agents).length : 0;
      if (agentCount !== prevAgentCount || this.messages.length !== prevMsgCount) {
        this.emit('channel_changed');
      }
    }
  }

  private persistState(): void {
    this.ensureDir(path.dirname(this.statePath));
    if (!this.state) {
      if (fs.existsSync(this.statePath)) fs.unlinkSync(this.statePath);
      this.stateMtime = 0;
      return;
    }
    fs.writeFileSync(this.statePath, JSON.stringify(this.state, null, 2), 'utf8');
    this.stateMtime = fs.statSync(this.statePath).mtimeMs;
  }

  private persistMessages(): void {
    this.ensureDir(path.dirname(this.messagesPath));
    fs.writeFileSync(this.messagesPath, JSON.stringify(this.messages, null, 2), 'utf8');
    this.messagesMtime = fs.statSync(this.messagesPath).mtimeMs;
  }

  generateId(prefix = 'ch'): string {
    return `${prefix}_${Date.now().toString(36)}_${crypto.randomBytes(4).toString('hex')}`;
  }

  exists(): boolean {
    this.reloadIfChanged();
    return this.state !== null;
  }

  requireChannel(): ChannelState {
    this.reloadIfChanged();
    if (!this.state) {
      throw new Error('No channel exists. Create one with: agent-notify channel create');
    }
    return this.state;
  }

  getStatus(): ChannelStatus {
    this.reloadIfChanged();
    if (!this.state) {
      return { exists: false, agentCount: 0, messageCount: 0 };
    }
    return {
      exists: true,
      createdAt: this.state.meta.createdAt,
      createdBy: this.state.meta.createdBy,
      agentCount: Object.keys(this.state.agents).length,
      messageCount: this.messages.length,
    };
  }

  getState(): ChannelState | null {
    this.reloadIfChanged();
    return this.state;
  }

  create(createdBy = 'Human'): ChannelState {
    this.reloadIfChanged();
    if (this.state) {
      throw new Error('Channel already exists. Use `agent-notify channel status` to inspect it.');
    }
    this.state = {
      meta: { createdAt: nowIso(), createdBy },
      agents: {},
    };
    this.messages = [];
    this.persistState();
    this.persistMessages();
    this.emit('channel_changed');
    this.emit('channel_created', this.state);
    return this.state;
  }

  delete(options?: { purgeArchives?: boolean }): void {
    this.reloadIfChanged();
    if (!this.state) {
      throw new Error('No channel exists to delete.');
    }
    this.state = null;
    this.messages = [];
    this.persistState();
    this.persistMessages();
    if (options?.purgeArchives && fs.existsSync(this.archivesDir)) {
      fs.rmSync(this.archivesDir, { recursive: true, force: true });
    }
    this.emit('channel_changed');
    this.emit('channel_deleted');
  }

  register(input: {
    name: string;
    bio: string;
    model?: string;
    dir?: string;
  }): ChannelAgent {
    const state = this.requireChannel();
    const name = input.name.trim();
    if (!name) throw new Error('Agent name is required.');
    if (name.toLowerCase() === 'human') {
      throw new Error('Name "Human" is reserved for the human participant.');
    }
    const key = name.toLowerCase();
    const existingKey = Object.keys(state.agents).find((k) => k.toLowerCase() === key);
    if (existingKey) {
      throw new Error(`Agent "${state.agents[existingKey].name}" is already registered.`);
    }
    const ts = nowIso();
    const agent: ChannelAgent = {
      name,
      bio: (input.bio || '').trim() || '(no bio)',
      model: (input.model || '').trim() || 'unknown',
      dir: path.resolve(input.dir || process.cwd()),
      registeredAt: ts,
      updatedAt: ts,
      lastSeenAt: ts,
    };
    state.agents[name] = agent;
    this.persistState();
    this.emit('channel_changed');
    this.emit('agent_registered', agent);
    return agent;
  }

  update(input: {
    name: string;
    bio?: string;
    model?: string;
    dir?: string;
  }): ChannelAgent {
    const state = this.requireChannel();
    const agent = this.findAgent(input.name);
    if (!agent) throw new Error(`Agent "${input.name}" is not registered.`);
    if (input.bio !== undefined) agent.bio = input.bio.trim() || agent.bio;
    if (input.model !== undefined) agent.model = input.model.trim() || agent.model;
    if (input.dir !== undefined) agent.dir = path.resolve(input.dir);
    agent.updatedAt = nowIso();
    agent.lastSeenAt = agent.updatedAt;
    state.agents[agent.name] = agent;
    this.persistState();
    this.emit('channel_changed');
    this.emit('agent_updated', agent);
    return agent;
  }

  unregister(name: string): ChannelAgent {
    const state = this.requireChannel();
    const agent = this.findAgent(name);
    if (!agent) throw new Error(`Agent "${name}" is not registered.`);
    delete state.agents[agent.name];
    this.persistState();
    this.emit('channel_changed');
    this.emit('agent_unregistered', agent);
    return agent;
  }

  findAgent(name: string): ChannelAgent | null {
    this.reloadIfChanged();
    if (!this.state) return null;
    const key = name.trim().toLowerCase();
    for (const agent of Object.values(this.state.agents)) {
      if (agent.name.toLowerCase() === key) return agent;
    }
    return null;
  }

  listAgents(): ChannelAgent[] {
    this.reloadIfChanged();
    if (!this.state) return [];
    return Object.values(this.state.agents).sort((a, b) => a.name.localeCompare(b.name));
  }

  touchAgent(name: string): void {
    const state = this.requireChannel();
    const agent = this.findAgent(name);
    if (!agent) return;
    agent.lastSeenAt = nowIso();
    state.agents[agent.name] = agent;
    this.persistState();
  }

  postMessage(input: {
    from: string;
    to?: string | null;
    body: string;
    kind?: ChannelMessageKind;
    requireRegistered?: boolean;
  }): ChannelMessage {
    this.requireChannel();
    const body = (input.body || '').trim();
    if (!body) throw new Error('Message body is required.');

    const from = input.from.trim();
    const kind: ChannelMessageKind = input.kind || (input.to ? 'dm' : 'say');
    const requireRegistered = input.requireRegistered !== false;

    if (requireRegistered && from.toLowerCase() !== 'human') {
      const sender = this.findAgent(from);
      if (!sender) throw new Error(`Sender "${from}" is not registered. Register first.`);
      this.touchAgent(sender.name);
    }

    let to: string | null = null;
    if (kind === 'dm') {
      if (!input.to?.trim()) throw new Error('DM requires --to <Name>.');
      const recipient = this.findAgent(input.to);
      if (!recipient && input.to.trim().toLowerCase() !== 'human') {
        throw new Error(`Recipient "${input.to}" is not registered.`);
      }
      to = recipient?.name || input.to.trim();
    }

    const msg: ChannelMessage = {
      id: this.generateId('cmsg'),
      from: this.findAgent(from)?.name || from,
      to,
      body,
      kind,
      createdAt: nowIso(),
    };
    this.messages.push(msg);
    this.persistMessages();
    this.emit('channel_changed');
    this.emit('message_posted', msg);
    return msg;
  }

  getHistory(filters?: {
    limit?: number;
    from?: string;
    dmWith?: string;
    chronological?: boolean;
  }): ChannelMessage[] {
    this.reloadIfChanged();
    let list = [...this.messages];

    if (filters?.from) {
      const f = filters.from.toLowerCase();
      list = list.filter((m) => m.from.toLowerCase() === f);
    }

    if (filters?.dmWith) {
      const peer = filters.dmWith.toLowerCase();
      list = list.filter(
        (m) =>
          m.kind === 'dm' &&
          (m.from.toLowerCase() === peer || (m.to && m.to.toLowerCase() === peer))
      );
    }

    list.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());

    if (filters?.limit && filters.limit > 0) {
      list = list.slice(-filters.limit);
    }

    if (filters?.chronological === false) {
      list = list.reverse();
    }

    return list;
  }

  clear(): { archivePath: string; messageCount: number } {
    this.requireChannel();
    this.reloadIfChanged();
    const messageCount = this.messages.length;
    this.ensureDir(this.archivesDir);
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `channel-archive-${stamp}.json`;
    const archivePath = path.join(this.archivesDir, filename);
    const archive = {
      archivedAt: nowIso(),
      messageCount,
      messages: this.messages,
    };
    fs.writeFileSync(archivePath, JSON.stringify(archive, null, 2), 'utf8');
    this.messages = [];
    this.persistMessages();
    this.emit('channel_changed');
    this.emit('history_cleared', { archivePath, messageCount });
    return { archivePath, messageCount };
  }

  listArchives(): ChannelArchiveInfo[] {
    this.ensureDir(this.archivesDir);
    if (!fs.existsSync(this.archivesDir)) return [];
    const files = fs.readdirSync(this.archivesDir).filter((f) => f.endsWith('.json'));
    const infos: ChannelArchiveInfo[] = [];
    for (const filename of files) {
      const full = path.join(this.archivesDir, filename);
      try {
        const raw = JSON.parse(fs.readFileSync(full, 'utf8'));
        infos.push({
          filename,
          path: full,
          archivedAt: raw.archivedAt || '',
          messageCount: Array.isArray(raw.messages) ? raw.messages.length : raw.messageCount || 0,
        });
      } catch {
        infos.push({ filename, path: full, archivedAt: '', messageCount: 0 });
      }
    }
    return infos.sort((a, b) => b.archivedAt.localeCompare(a.archivedAt));
  }

  getSnapshot(): {
    status: ChannelStatus;
    agents: ChannelAgent[];
    messages: ChannelMessage[];
  } {
    return {
      status: this.getStatus(),
      agents: this.listAgents(),
      messages: this.getHistory(),
    };
  }
}

export const channelStore = new ChannelStore();
