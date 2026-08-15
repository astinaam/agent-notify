import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { EventEmitter } from 'node:events';
import { getConfigDir } from './config.js';
import type { StoredMessage } from './types.js';

class MessageStore extends EventEmitter {
  private filePath: string;
  private messages: Map<string, StoredMessage> = new Map();
  private lastMtime = 0;

  constructor() {
    super();
    this.filePath = path.join(getConfigDir(), 'messages.json');
    this.reloadIfChanged();

    // Watch for cross-process updates with unref so it never holds CLI processes open
    try {
      if (fs.existsSync(this.filePath)) {
        const watcher = fs.watch(this.filePath, () => {
          this.reloadIfChanged(true);
        });
        watcher.unref();
      }
    } catch {}
  }

  private reloadIfChanged(emitEvents = false): void {
    if (!fs.existsSync(this.filePath)) return;

    try {
      const stat = fs.statSync(this.filePath);
      if (stat.mtimeMs <= this.lastMtime) return;

      const raw = fs.readFileSync(this.filePath, 'utf8');
      const list: StoredMessage[] = JSON.parse(raw);
      if (Array.isArray(list)) {
        const oldKeys = new Set(this.messages.keys());
        for (const msg of list) {
          if (msg && msg.id) {
            const isNew = !oldKeys.has(msg.id);
            const prev = this.messages.get(msg.id);
            this.messages.set(msg.id, msg);

            if (emitEvents) {
              if (isNew) {
                this.emit('message_added', msg);
              } else if (prev && prev.updatedAt !== msg.updatedAt) {
                this.emit('message_updated', msg);
                if (msg.type === 'ask' && msg.status === 'answered' && prev.status !== 'answered') {
                  this.emit(`answer_${msg.id}`, { response: msg.response, answeredBy: msg.answeredBy });
                }
              }
            }
          }
        }
      }
      this.lastMtime = stat.mtimeMs;
    } catch {}
  }

  private persist(): void {
    const dir = path.dirname(this.filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    const array = Array.from(this.messages.values());
    fs.writeFileSync(this.filePath, JSON.stringify(array, null, 2), 'utf8');
    if (fs.existsSync(this.filePath)) {
      this.lastMtime = fs.statSync(this.filePath).mtimeMs;
    }
  }

  generateId(): string {
    const datePrefix = Date.now().toString(36);
    const randomSuffix = crypto.randomBytes(4).toString('hex');
    return `msg_${datePrefix}_${randomSuffix}`;
  }

  saveMessage(msg: StoredMessage): StoredMessage {
    this.reloadIfChanged();
    this.messages.set(msg.id, msg);
    this.persist();
    this.emit('message_added', msg);
    return msg;
  }

  updateMessage(id: string, updates: Partial<StoredMessage>): StoredMessage | null {
    this.reloadIfChanged();
    const existing = this.messages.get(id);
    if (!existing) return null;

    const updated: StoredMessage = {
      ...existing,
      ...updates,
      updatedAt: new Date().toISOString(),
    };

    this.messages.set(id, updated);
    this.persist();
    this.emit('message_updated', updated);
    return updated;
  }

  respondToQuestion(id: string, response: string, answeredBy = 'Web User'): StoredMessage | null {
    this.reloadIfChanged();
    const msg = this.messages.get(id);
    if (!msg || msg.type !== 'ask') return null;

    const updated = this.updateMessage(id, {
      status: 'answered',
      response,
      answeredBy,
    });

    if (updated) {
      this.emit(`answer_${id}`, { response, answeredBy });
    }
    return updated;
  }

  getMessage(id: string): StoredMessage | null {
    this.reloadIfChanged();
    return this.messages.get(id) || null;
  }

  getMessages(filters?: {
    agent?: string;
    level?: string;
    type?: string;
    search?: string;
    limit?: number;
    offset?: number;
  }): { items: StoredMessage[]; total: number } {
    this.reloadIfChanged();
    let list = Array.from(this.messages.values());

    list.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

    if (filters?.agent) {
      const target = filters.agent.toLowerCase();
      list = list.filter((m) => m.agent.toLowerCase() === target);
    }

    if (filters?.level) {
      const target = filters.level.toLowerCase();
      list = list.filter((m) => m.level.toLowerCase() === target);
    }

    if (filters?.type) {
      const target = filters.type.toLowerCase();
      list = list.filter((m) => m.type.toLowerCase() === target);
    }

    if (filters?.search) {
      const q = filters.search.toLowerCase();
      list = list.filter(
        (m) =>
          m.content.toLowerCase().includes(q) ||
          m.agent.toLowerCase().includes(q) ||
          (m.title && m.title.toLowerCase().includes(q)) ||
          (m.fileName && m.fileName.toLowerCase().includes(q)) ||
          (m.response && m.response.toLowerCase().includes(q))
      );
    }

    const total = list.length;
    const offset = filters?.offset || 0;
    const limit = filters?.limit || 100;
    const items = list.slice(offset, offset + limit);

    return { items, total };
  }

  getAgents(): Array<{ name: string; count: number; lastActive: string }> {
    this.reloadIfChanged();
    const map = new Map<string, { name: string; count: number; lastActive: string }>();

    for (const msg of this.messages.values()) {
      const agent = msg.agent || 'default';
      const existing = map.get(agent);
      if (!existing) {
        map.set(agent, {
          name: agent,
          count: 1,
          lastActive: msg.createdAt,
        });
      } else {
        existing.count += 1;
        if (new Date(msg.createdAt) > new Date(existing.lastActive)) {
          existing.lastActive = msg.createdAt;
        }
      }
    }

    return Array.from(map.values()).sort((a, b) => b.count - a.count);
  }

  getStats(): {
    total: number;
    byLevel: Record<string, number>;
    byType: Record<string, number>;
    agentCount: number;
  } {
    this.reloadIfChanged();
    const byLevel: Record<string, number> = { info: 0, success: 0, warn: 0, error: 0 };
    const byType: Record<string, number> = { notification: 0, file: 0, ask: 0 };

    for (const msg of this.messages.values()) {
      byLevel[msg.level] = (byLevel[msg.level] || 0) + 1;
      byType[msg.type] = (byType[msg.type] || 0) + 1;
    }

    const agents = this.getAgents();

    return {
      total: this.messages.size,
      byLevel,
      byType,
      agentCount: agents.length,
    };
  }

  deleteMessage(id: string): boolean {
    this.reloadIfChanged();
    const exists = this.messages.has(id);
    if (exists) {
      this.messages.delete(id);
      this.persist();
      this.emit('message_deleted', id);
    }
    return exists;
  }

  clearAll(): void {
    this.messages.clear();
    this.persist();
    this.emit('messages_cleared');
  }
}

export const messageStore = new MessageStore();
