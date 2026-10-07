import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { EventEmitter } from 'node:events';
import { getConfigDir, getHumanName, isHumanName } from './config.js';
import type {
  ChannelAgent,
  ChannelArchiveInfo,
  ChannelArchiveRecord,
  ChannelMessage,
  ChannelMessageKind,
  ChannelMeta,
  ChannelState,
  ChannelStatus,
  ChannelSummary,
} from './types.js';
import { agentPresence, DEFAULT_CHANNEL_HUMAN_NAME, MAIN_CHANNEL_CODE } from './types.js';
import type { AgentPresence } from './types.js';

function nowIso(): string {
  return new Date().toISOString();
}

function normalizeCode(code: string): string {
  const cleaned = code
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '');
  if (!cleaned || cleaned.length > 48) {
    throw new Error('Channel code must be 1–48 chars: letters, numbers, _ or -');
  }
  return cleaned;
}

class ChannelStore extends EventEmitter {
  private rootDir: string;
  private legacyStatePath: string;
  private legacyMessagesPath: string;
  private legacyArchivesDir: string;
  private globalArchivesDir: string;
  private cache = new Map<string, { state: ChannelState; messages: ChannelMessage[]; stateMtime: number; messagesMtime: number }>();
  private watching = false;

  constructor() {
    super();
    const dir = getConfigDir();
    this.rootDir = path.join(dir, 'channels');
    this.legacyStatePath = path.join(dir, 'channel.json');
    this.legacyMessagesPath = path.join(dir, 'channel-messages.json');
    this.legacyArchivesDir = path.join(dir, 'channel-archives');
    this.globalArchivesDir = path.join(dir, 'channel-archives');
    this.ensureDir(this.rootDir);
    this.migrateLegacyIfNeeded();
    this.ensureMain();
    // File watching is opt-in (daemon/server) so short CLI commands can exit.
  }

  /** Start watching channel files (call from daemon/server only). */
  startWatching(): void {
    if (this.watching) return;
    this.watching = true;
    this.watchFiles();
  }

  private ensureDir(dir: string): void {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  }

  private channelDir(code: string): string {
    return path.join(this.rootDir, code);
  }

  private statePath(code: string): string {
    return path.join(this.channelDir(code), 'state.json');
  }

  private messagesPath(code: string): string {
    return path.join(this.channelDir(code), 'messages.json');
  }

  private archivesDir(code: string): string {
    return path.join(this.channelDir(code), 'archives');
  }

  private migrateLegacyIfNeeded(): void {
    const mainState = this.statePath(MAIN_CHANNEL_CODE);
    if (fs.existsSync(mainState)) return;
    if (!fs.existsSync(this.legacyStatePath)) return;

    try {
      const raw = JSON.parse(fs.readFileSync(this.legacyStatePath, 'utf8')) as ChannelState;
      const messages: ChannelMessage[] = fs.existsSync(this.legacyMessagesPath)
        ? JSON.parse(fs.readFileSync(this.legacyMessagesPath, 'utf8'))
        : [];
      const createdAt = raw?.meta?.createdAt || nowIso();
      const createdBy = (raw as any)?.meta?.createdBy || DEFAULT_CHANNEL_HUMAN_NAME;
      const state: ChannelState = {
        meta: {
          code: MAIN_CHANNEL_CODE,
          purpose: (raw as any)?.meta?.purpose || 'Primary agent communication channel',
          createdAt,
          createdBy,
          updatedAt: nowIso(),
        },
        agents: raw?.agents && typeof raw.agents === 'object' ? raw.agents : {},
      };
      this.ensureDir(this.channelDir(MAIN_CHANNEL_CODE));
      fs.writeFileSync(mainState, JSON.stringify(state, null, 2), 'utf8');
      fs.writeFileSync(this.messagesPath(MAIN_CHANNEL_CODE), JSON.stringify(Array.isArray(messages) ? messages : [], null, 2), 'utf8');
      this.ensureDir(this.archivesDir(MAIN_CHANNEL_CODE));
      if (fs.existsSync(this.legacyArchivesDir)) {
        for (const f of fs.readdirSync(this.legacyArchivesDir).filter((x) => x.endsWith('.json'))) {
          const src = path.join(this.legacyArchivesDir, f);
          const dest = path.join(this.archivesDir(MAIN_CHANNEL_CODE), f);
          if (!fs.existsSync(dest)) fs.copyFileSync(src, dest);
        }
      }
    } catch {
      // ignore migration errors; ensureMain will create empty main
    }
  }

  private watchFiles(): void {
    try {
      this.ensureDir(this.rootDir);
      const watcher = fs.watch(this.rootDir, { recursive: true }, () => {
        this.cache.clear();
        this.emit('channel_changed');
      });
      watcher.unref();
    } catch {
      // ignore
    }
  }

  generateId(prefix = 'ch'): string {
    return `${prefix}_${Date.now().toString(36)}_${crypto.randomBytes(4).toString('hex')}`;
  }

  ensureMain(createdBy?: string): ChannelState {
    const existing = this.loadChannel(MAIN_CHANNEL_CODE);
    if (existing) return existing.state;
    return this.createChannel({
      code: MAIN_CHANNEL_CODE,
      purpose: 'Primary agent communication channel',
      createdBy: createdBy || getHumanName(),
    });
  }

  listChannelCodes(): string[] {
    this.ensureDir(this.rootDir);
    if (!fs.existsSync(this.statePath(MAIN_CHANNEL_CODE))) {
      this.ensureMain();
    }
    const codes = fs
      .readdirSync(this.rootDir, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name)
      .filter((name) => fs.existsSync(this.statePath(name)));
    return codes.sort((a, b) => {
      if (a === MAIN_CHANNEL_CODE) return -1;
      if (b === MAIN_CHANNEL_CODE) return 1;
      return a.localeCompare(b);
    });
  }

  listChannels(): ChannelSummary[] {
    return this.listChannelCodes().map((code) => {
      const status = this.getStatus(code);
      const state = this.requireChannel(code);
      return {
        code,
        purpose: state.meta.purpose,
        createdAt: state.meta.createdAt,
        createdBy: state.meta.createdBy,
        updatedAt: state.meta.updatedAt,
        agentCount: status.agentCount,
        messageCount: status.messageCount,
        deletable: code !== MAIN_CHANNEL_CODE,
      };
    });
  }

  private loadChannel(code: string): { state: ChannelState; messages: ChannelMessage[] } | null {
    const stateFile = this.statePath(code);
    if (!fs.existsSync(stateFile)) return null;

    const cached = this.cache.get(code);
    let stateMtime = 0;
    let messagesMtime = 0;
    try {
      stateMtime = fs.statSync(stateFile).mtimeMs;
      if (fs.existsSync(this.messagesPath(code))) {
        messagesMtime = fs.statSync(this.messagesPath(code)).mtimeMs;
      }
    } catch {
      return null;
    }

    if (cached && cached.stateMtime === stateMtime && cached.messagesMtime === messagesMtime) {
      return { state: cached.state, messages: cached.messages };
    }

    try {
      const state = JSON.parse(fs.readFileSync(stateFile, 'utf8')) as ChannelState;
      if (!state?.meta || !state.agents) return null;
      if (!state.meta.code) state.meta.code = code;
      if (!state.meta.purpose) state.meta.purpose = code === MAIN_CHANNEL_CODE ? 'Primary agent communication channel' : '';
      let messages: ChannelMessage[] = [];
      if (fs.existsSync(this.messagesPath(code))) {
        const parsed = JSON.parse(fs.readFileSync(this.messagesPath(code), 'utf8'));
        if (Array.isArray(parsed)) messages = parsed;
      }
      this.cache.set(code, { state, messages, stateMtime, messagesMtime });
      return { state, messages };
    } catch {
      return null;
    }
  }

  private persist(code: string, state: ChannelState, messages: ChannelMessage[]): void {
    this.ensureDir(this.channelDir(code));
    fs.writeFileSync(this.statePath(code), JSON.stringify(state, null, 2), 'utf8');
    fs.writeFileSync(this.messagesPath(code), JSON.stringify(messages, null, 2), 'utf8');
    const stateMtime = fs.statSync(this.statePath(code)).mtimeMs;
    const messagesMtime = fs.statSync(this.messagesPath(code)).mtimeMs;
    this.cache.set(code, { state, messages, stateMtime, messagesMtime });
  }

  exists(code = MAIN_CHANNEL_CODE): boolean {
    return this.loadChannel(normalizeCode(code)) !== null;
  }

  requireChannel(code = MAIN_CHANNEL_CODE): ChannelState {
    const c = normalizeCode(code);
    let loaded = this.loadChannel(c);
    if (!loaded && c === MAIN_CHANNEL_CODE) {
      this.ensureMain();
      loaded = this.loadChannel(c);
    }
    if (!loaded) {
      throw new Error(
        `Channel "${c}" does not exist. Create with: agent-notify channel create --code ${c} --purpose "..."`
      );
    }
    return loaded.state;
  }

  private requireLoaded(code = MAIN_CHANNEL_CODE): {
    code: string;
    state: ChannelState;
    messages: ChannelMessage[];
  } {
    const c = normalizeCode(code);
    let loaded = this.loadChannel(c);
    if (!loaded && c === MAIN_CHANNEL_CODE) {
      this.ensureMain();
      loaded = this.loadChannel(c);
    }
    if (!loaded) throw new Error(`Channel "${c}" does not exist.`);
    return { code: c, state: loaded.state, messages: loaded.messages };
  }

  getStatus(code = MAIN_CHANNEL_CODE): ChannelStatus {
    const c = normalizeCode(code);
    const loaded = this.loadChannel(c);
    if (!loaded) {
      if (c === MAIN_CHANNEL_CODE) {
        this.ensureMain();
        return this.getStatus(MAIN_CHANNEL_CODE);
      }
      return { exists: false, code: c, agentCount: 0, messageCount: 0, deletable: c !== MAIN_CHANNEL_CODE };
    }
    return {
      exists: true,
      code: c,
      purpose: loaded.state.meta.purpose,
      createdAt: loaded.state.meta.createdAt,
      createdBy: loaded.state.meta.createdBy,
      agentCount: Object.keys(loaded.state.agents).length,
      messageCount: loaded.messages.length,
      deletable: c !== MAIN_CHANNEL_CODE,
    };
  }

  createChannel(input: { code: string; purpose: string; createdBy?: string }): ChannelState {
    const code = normalizeCode(input.code);
    const purpose = (input.purpose || '').trim();
    if (!purpose) throw new Error('Channel purpose is required.');
    if (this.exists(code)) {
      throw new Error(`Channel "${code}" already exists.`);
    }
    const ts = nowIso();
    const state: ChannelState = {
      meta: {
        code,
        purpose,
        createdAt: ts,
        createdBy: (input.createdBy || getHumanName()).trim() || DEFAULT_CHANNEL_HUMAN_NAME,
        updatedAt: ts,
      },
      agents: {},
    };
    this.persist(code, state, []);
    this.ensureDir(this.archivesDir(code));
    this.emit('channel_changed');
    this.emit('channel_created', state);
    return state;
  }

  /** Back-compat: ensure main exists. */
  create(createdBy?: string): ChannelState {
    if (this.exists(MAIN_CHANNEL_CODE)) {
      throw new Error('Channel "main" already exists. Use --code to create another channel.');
    }
    return this.createChannel({
      code: MAIN_CHANNEL_CODE,
      purpose: 'Primary agent communication channel',
      createdBy,
    });
  }

  updateChannel(code: string, updates: { purpose?: string }): ChannelState {
    const loaded = this.requireLoaded(code);
    if (updates.purpose !== undefined) {
      const purpose = updates.purpose.trim();
      if (!purpose) throw new Error('Channel purpose cannot be empty.');
      loaded.state.meta.purpose = purpose;
    }
    loaded.state.meta.updatedAt = nowIso();
    this.persist(loaded.code, loaded.state, loaded.messages);
    this.emit('channel_changed');
    return loaded.state;
  }

  /** Delete a non-main channel: full archive then remove. */
  deleteChannel(code: string): { archivePath: string; filename: string; code: string } {
    const c = normalizeCode(code);
    if (c === MAIN_CHANNEL_CODE) {
      throw new Error('Channel "main" cannot be deleted.');
    }
    const loaded = this.requireLoaded(c);
    const result = this.writeFullChannelArchive(loaded.code, loaded.state, loaded.messages, {
      channelDeleted: true,
      label: `deleted:${c}`,
    });
    fs.rmSync(this.channelDir(c), { recursive: true, force: true });
    this.cache.delete(c);
    this.emit('channel_changed');
    this.emit('channel_deleted', { code: c, ...result });
    return { ...result, code: c };
  }

  /** Legacy single-channel delete — only allowed conceptually for clearing main content? Keep as refuse for main wipe. */
  delete(options?: { purgeArchives?: boolean }): void {
    void options;
    throw new Error('Use `agent-notify channel delete --code <code>` for non-main channels. "main" cannot be deleted.');
  }

  findAgent(code: string, name: string): ChannelAgent | null {
    const state = this.requireChannel(code);
    const key = name.trim().toLowerCase();
    for (const agent of Object.values(state.agents)) {
      if (agent.name.toLowerCase() === key) return agent;
    }
    return null;
  }

  listAgents(code = MAIN_CHANNEL_CODE): ChannelAgent[] {
    const state = this.requireChannel(code);
    return Object.values(state.agents).sort((a, b) => a.name.localeCompare(b.name));
  }

  register(
    code: string,
    input: { name: string; bio: string; model?: string; dir?: string }
  ): ChannelAgent {
    const loaded = this.requireLoaded(code);
    const name = input.name.trim();
    if (!name) throw new Error('Agent name is required.');
    if (isHumanName(name)) {
      throw new Error(`Name "${getHumanName()}" is reserved for the human participant.`);
    }
    const key = name.toLowerCase();
    const existingKey = Object.keys(loaded.state.agents).find((k) => k.toLowerCase() === key);
    if (existingKey) {
      throw new Error(`Agent "${loaded.state.agents[existingKey].name}" is already registered on #${loaded.code}.`);
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
    loaded.state.agents[name] = agent;
    loaded.state.meta.updatedAt = ts;
    this.persist(loaded.code, loaded.state, loaded.messages);
    this.emit('channel_changed');
    this.emit('agent_registered', { channel: loaded.code, agent });
    return agent;
  }

  update(
    code: string,
    input: { name: string; bio?: string; model?: string; dir?: string }
  ): ChannelAgent {
    const loaded = this.requireLoaded(code);
    const agent = this.findAgent(loaded.code, input.name);
    if (!agent) throw new Error(`Agent "${input.name}" is not registered on #${loaded.code}.`);
    if (input.bio !== undefined) agent.bio = input.bio.trim() || agent.bio;
    if (input.model !== undefined) agent.model = input.model.trim() || agent.model;
    if (input.dir !== undefined) agent.dir = path.resolve(input.dir);
    agent.updatedAt = nowIso();
    agent.lastSeenAt = agent.updatedAt;
    loaded.state.agents[agent.name] = agent;
    loaded.state.meta.updatedAt = agent.updatedAt;
    this.persist(loaded.code, loaded.state, loaded.messages);
    this.emit('channel_changed');
    this.emit('agent_updated', { channel: loaded.code, agent });
    return agent;
  }

  unregister(code: string, name: string): ChannelAgent {
    const loaded = this.requireLoaded(code);
    const agent = this.findAgent(loaded.code, name);
    if (!agent) throw new Error(`Agent "${name}" is not registered on #${loaded.code}.`);
    delete loaded.state.agents[agent.name];
    loaded.state.meta.updatedAt = nowIso();
    this.persist(loaded.code, loaded.state, loaded.messages);
    this.emit('channel_changed');
    this.emit('agent_unregistered', { channel: loaded.code, agent });
    return agent;
  }

  /**
   * Record a heartbeat. Skips the write if the agent was seen in the last 20s
   * so a burst of CLI calls still counts without rewriting on every flag.
   */
  touchAgent(code: string, name: string): ChannelAgent | null {
    const loaded = this.requireLoaded(code);
    const agent = this.findAgent(loaded.code, name);
    if (!agent) return null;
    const prev = Date.parse(agent.lastSeenAt);
    if (Number.isFinite(prev) && Date.now() - prev < 20_000) return agent;
    agent.lastSeenAt = nowIso();
    loaded.state.agents[agent.name] = agent;
    this.persist(loaded.code, loaded.state, loaded.messages);
    this.emit('channel_changed');
    return agent;
  }

  agentState(code: string, name: string): ChannelAgent & {
    channel: string;
    presence: AgentPresence;
    presenceLabel: string;
    ageSec: number | null;
  } {
    const c = normalizeCode(code);
    const agent = this.findAgent(c, name);
    if (!agent) throw new Error(`Agent "${name}" is not registered on #${c}.`);
    const p = agentPresence(agent.lastSeenAt);
    return {
      channel: c,
      ...agent,
      presence: p.presence,
      presenceLabel: p.label,
      ageSec: p.ageSec,
    };
  }

  listAgentStates(code = MAIN_CHANNEL_CODE) {
    return this.listAgents(code).map((a) => this.agentState(code, a.name));
  }

  postMessage(
    code: string,
    input: {
      from: string;
      to?: string | null;
      body: string;
      kind?: ChannelMessageKind;
      requireRegistered?: boolean;
      telegramRelay?: boolean;
    }
  ): ChannelMessage {
    const loaded = this.requireLoaded(code);
    const body = (input.body || '').trim();
    if (!body) throw new Error('Message body is required.');

    const from = input.from.trim();
    const kind: ChannelMessageKind = input.kind || (input.to ? 'dm' : 'say');
    const requireRegistered = input.requireRegistered !== false;
    const telegramRelay = input.telegramRelay !== false;

    if (requireRegistered && !isHumanName(from)) {
      const sender = this.findAgent(loaded.code, from);
      if (!sender) throw new Error(`Sender "${from}" is not registered on #${loaded.code}.`);
      this.touchAgent(loaded.code, sender.name);
    }

    let to: string | null = null;
    if (kind === 'dm') {
      if (!input.to?.trim()) throw new Error('DM requires --to <Name>.');
      const recipient = this.findAgent(loaded.code, input.to);
      if (!recipient && !isHumanName(input.to)) {
        throw new Error(`Recipient "${input.to}" is not registered on #${loaded.code}.`);
      }
      to = recipient?.name || (isHumanName(input.to) ? getHumanName() : input.to.trim());
    }

    // refresh after touch
    const fresh = this.requireLoaded(loaded.code);
    const resolvedFrom = isHumanName(from)
      ? getHumanName()
      : this.findAgent(fresh.code, from)?.name || from;

    const msg: ChannelMessage = {
      id: this.generateId('cmsg'),
      from: resolvedFrom,
      to,
      body,
      kind,
      createdAt: nowIso(),
      telegramRelay,
    };
    fresh.messages.push(msg);
    fresh.state.meta.updatedAt = msg.createdAt;
    this.persist(fresh.code, fresh.state, fresh.messages);
    this.emit('channel_changed');
    this.emit('message_posted', { channel: fresh.code, message: msg });
    return msg;
  }

  getHistory(
    code = MAIN_CHANNEL_CODE,
    filters?: {
      limit?: number;
      from?: string;
      dmWith?: string;
      chronological?: boolean;
    }
  ): ChannelMessage[] {
    const loaded = this.requireLoaded(code);
    let list = [...loaded.messages];

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
    if (filters?.limit && filters.limit > 0) list = list.slice(-filters.limit);
    if (filters?.chronological === false) list = list.reverse();
    return list;
  }

  private writeArchiveFile(
    code: string,
    state: ChannelState,
    messages: ChannelMessage[],
    options?: { clearAfter?: boolean; channelDeleted?: boolean; label?: string; global?: boolean }
  ): { archivePath: string; filename: string; messageCount: number; agentCount: number; record: ChannelArchiveRecord } {
    const agents = Object.values(state.agents).map((a) => ({ ...a }));
    const messageCount = messages.length;
    const agentCount = agents.length;
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = options?.channelDeleted
      ? `channel-deleted-${code}-${stamp}.json`
      : `channel-archive-${stamp}.json`;
    const dir = options?.global || options?.channelDeleted ? this.globalArchivesDir : this.archivesDir(code);
    this.ensureDir(dir);
    const archivePath = path.join(dir, filename);
    const record: ChannelArchiveRecord = {
      archivedAt: nowIso(),
      messageCount,
      agentCount,
      messages: [...messages],
      agents,
      channelCode: code,
      channelPurpose: state.meta.purpose,
      cleared: Boolean(options?.clearAfter),
      channelDeleted: Boolean(options?.channelDeleted),
      label: options?.label?.trim() || undefined,
    };
    fs.writeFileSync(archivePath, JSON.stringify(record, null, 2), 'utf8');
    return { archivePath, filename, messageCount, agentCount, record };
  }

  private writeFullChannelArchive(
    code: string,
    state: ChannelState,
    messages: ChannelMessage[],
    options?: { channelDeleted?: boolean; label?: string }
  ) {
    return this.writeArchiveFile(code, state, messages, { ...options, global: true });
  }

  archive(code = MAIN_CHANNEL_CODE, label?: string) {
    const loaded = this.requireLoaded(code);
    const result = this.writeArchiveFile(loaded.code, loaded.state, loaded.messages, {
      clearAfter: false,
      label,
    });
    loaded.state.meta.updatedAt = nowIso();
    this.persist(loaded.code, loaded.state, loaded.messages);
    this.emit('channel_changed');
    this.emit('history_archived', { channel: loaded.code, ...result });
    return result;
  }

  clear(code = MAIN_CHANNEL_CODE, label?: string) {
    const loaded = this.requireLoaded(code);
    const result = this.writeArchiveFile(loaded.code, loaded.state, loaded.messages, {
      clearAfter: true,
      label,
    });
    loaded.state.agents = {};
    loaded.messages = [];
    loaded.state.meta.updatedAt = nowIso();
    this.persist(loaded.code, loaded.state, loaded.messages);
    this.emit('channel_changed');
    this.emit('history_cleared', { channel: loaded.code, ...result });
    return result;
  }

  private resolveArchivePath(code: string, filename: string): string {
    const base = path.basename(filename);
    if (base !== filename || !base.endsWith('.json') || base.includes('..')) {
      throw new Error('Invalid archive filename.');
    }
    const local = path.join(this.archivesDir(code), base);
    if (fs.existsSync(local)) return local;
    const global = path.join(this.globalArchivesDir, base);
    if (fs.existsSync(global)) return global;
    throw new Error(`Archive not found: ${filename}`);
  }

  listArchives(code?: string): ChannelArchiveInfo[] {
    const infos: ChannelArchiveInfo[] = [];
    const addFromDir = (dir: string, channelCode?: string) => {
      if (!fs.existsSync(dir)) return;
      for (const filename of fs.readdirSync(dir).filter((f) => f.endsWith('.json'))) {
        const full = path.join(dir, filename);
        try {
          const raw = JSON.parse(fs.readFileSync(full, 'utf8')) as ChannelArchiveRecord;
          const agents = Array.isArray(raw.agents) ? raw.agents : [];
          infos.push({
            filename,
            path: full,
            archivedAt: raw.archivedAt || '',
            messageCount: Array.isArray(raw.messages) ? raw.messages.length : raw.messageCount || 0,
            agentCount: raw.agentCount ?? agents.length,
            channelCode: raw.channelCode || channelCode,
            cleared: Boolean(raw.cleared),
            channelDeleted: Boolean(raw.channelDeleted),
            label: raw.label,
          });
        } catch {
          infos.push({ filename, path: full, archivedAt: '', messageCount: 0, agentCount: 0, channelCode });
        }
      }
    };

    if (code) {
      addFromDir(this.archivesDir(normalizeCode(code)), normalizeCode(code));
    } else {
      for (const c of this.listChannelCodes()) addFromDir(this.archivesDir(c), c);
      addFromDir(this.globalArchivesDir);
    }

    const seen = new Set<string>();
    return infos
      .filter((i) => {
        if (seen.has(i.path)) return false;
        seen.add(i.path);
        return true;
      })
      .sort((a, b) => b.archivedAt.localeCompare(a.archivedAt));
  }

  getArchive(filename: string, code = MAIN_CHANNEL_CODE): ChannelArchiveRecord & { filename: string; path: string } {
    const full = this.resolveArchivePath(code, filename);
    const raw = JSON.parse(fs.readFileSync(full, 'utf8')) as ChannelArchiveRecord;
    const agents = Array.isArray(raw.agents) ? raw.agents : [];
    return {
      filename: path.basename(full),
      path: full,
      archivedAt: raw.archivedAt || '',
      messageCount: Array.isArray(raw.messages) ? raw.messages.length : raw.messageCount || 0,
      agentCount: raw.agentCount ?? agents.length,
      messages: Array.isArray(raw.messages) ? raw.messages : [],
      agents,
      channelCode: raw.channelCode,
      channelPurpose: raw.channelPurpose,
      cleared: Boolean(raw.cleared),
      channelDeleted: Boolean(raw.channelDeleted),
      label: raw.label,
    };
  }

  deleteArchive(filename: string, code = MAIN_CHANNEL_CODE): { filename: string; path: string } {
    const full = this.resolveArchivePath(code, filename);
    fs.unlinkSync(full);
    this.emit('channel_changed');
    this.emit('archive_deleted', { filename: path.basename(full), path: full });
    return { filename: path.basename(full), path: full };
  }

  getSnapshot(code = MAIN_CHANNEL_CODE): {
    status: ChannelStatus;
    agents: ChannelAgent[];
    messages: ChannelMessage[];
    humanName: string;
    archives: ChannelArchiveInfo[];
    channels: ChannelSummary[];
    activeCode: string;
  } {
    const c = normalizeCode(code);
    if (c === MAIN_CHANNEL_CODE) this.ensureMain();
    return {
      status: this.getStatus(c),
      agents: this.exists(c) ? this.listAgents(c) : [],
      messages: this.exists(c) ? this.getHistory(c) : [],
      humanName: getHumanName(),
      archives: this.listArchives(c),
      channels: this.listChannels(),
      activeCode: c,
    };
  }
}

export const channelStore = new ChannelStore();
export { normalizeCode };
