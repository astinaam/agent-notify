import type { ChildProcess } from 'node:child_process';
import { getSystemMetrics } from './monitor.js';
import { escapeHtml, clipPrompt } from './memory.js';

export interface ActiveAgentTask {
  id: string;
  agentType: 'Cursor' | 'Antigravity' | 'Shell';
  prompt: string;
  user: string;
  workspaceDir: string;
  startedAt: number;
  pid?: number;
  childProcess?: ChildProcess;
  lastActivityLine: string;
  statusMessageId?: number;
  timer?: NodeJS.Timeout;
  tickerCount: number;
  isCancelled: boolean;
}

export class AgentTaskManager {
  private activeTasks: Map<string, ActiveAgentTask> = new Map();
  private nextTaskId = 1;

  registerTask(options: {
    agentType: 'Cursor' | 'Antigravity' | 'Shell';
    prompt: string;
    user: string;
    workspaceDir: string;
    childProcess?: ChildProcess;
    pid?: number;
  }): ActiveAgentTask {
    const prefix = options.agentType.toLowerCase().slice(0, 4);
    const id = `${prefix}_${this.nextTaskId++}`;

    const task: ActiveAgentTask = {
      id,
      agentType: options.agentType,
      prompt: options.prompt,
      user: options.user,
      workspaceDir: options.workspaceDir,
      startedAt: Date.now(),
      pid: options.pid || options.childProcess?.pid,
      childProcess: options.childProcess,
      lastActivityLine: 'Initializing agent environment...',
      tickerCount: 0,
      isCancelled: false,
    };

    this.activeTasks.set(id, task);
    return task;
  }

  getTask(id: string): ActiveAgentTask | undefined {
    return this.activeTasks.get(id);
  }

  getActiveTasks(): ActiveAgentTask[] {
    return Array.from(this.activeTasks.values());
  }

  getActiveCount(): number {
    return this.activeTasks.size;
  }

  updateTaskActivity(id: string, chunk: string): void {
    const task = this.activeTasks.get(id);
    if (!task) return;

    // Strip ANSI codes and carriage returns
    const cleaned = chunk
      .replace(/\u001b\[[0-9;]*[a-zA-Z]/g, '')
      .replace(/\r/g, '')
      .trim();

    if (!cleaned) return;

    const lines = cleaned
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l.length > 0);

    if (lines.length > 0) {
      let last = lines[lines.length - 1];
      if (last.length > 90) last = last.slice(0, 87) + '...';
      task.lastActivityLine = last;
    }
  }

  setStatusMessageId(id: string, messageId: number): void {
    const task = this.activeTasks.get(id);
    if (task) {
      task.statusMessageId = messageId;
    }
  }

  startLiveTicker(
    id: string,
    intervalMs = 6000,
    onTick?: (task: ActiveAgentTask, cardText: string) => Promise<void>
  ): void {
    const task = this.activeTasks.get(id);
    if (!task) return;

    if (task.timer) {
      clearInterval(task.timer);
    }

    task.timer = setInterval(async () => {
      if (!this.activeTasks.has(id) || task.isCancelled) {
        if (task.timer) clearInterval(task.timer);
        return;
      }

      task.tickerCount++;
      const cardText = this.buildLiveStatusCard(id);

      if (onTick) {
        try {
          await onTick(task, cardText);
        } catch {
          // Ignore transient edit errors
        }
      }
    }, intervalMs);
  }

  stopLiveTicker(id: string): void {
    const task = this.activeTasks.get(id);
    if (task?.timer) {
      clearInterval(task.timer);
      task.timer = undefined;
    }
  }

  completeTask(id: string): void {
    this.stopLiveTicker(id);
    this.activeTasks.delete(id);
  }

  cancelTask(id: string): boolean {
    const task = this.activeTasks.get(id);
    if (!task) return false;

    task.isCancelled = true;
    this.stopLiveTicker(id);

    if (task.childProcess && !task.childProcess.killed) {
      try {
        task.childProcess.kill('SIGTERM');
        // Give 1 second for graceful exit, then force kill if still running
        setTimeout(() => {
          if (task.childProcess && !task.childProcess.killed) {
            try {
              task.childProcess.kill('SIGKILL');
            } catch {}
          }
        }, 1000);
      } catch {}
    }

    this.activeTasks.delete(id);
    return true;
  }

  cancelAllTasks(): number {
    const count = this.activeTasks.size;
    for (const id of Array.from(this.activeTasks.keys())) {
      this.cancelTask(id);
    }
    return count;
  }

  buildLiveStatusCard(id: string): string {
    const task = this.activeTasks.get(id);
    if (!task) return '';

    const elapsedSec = Math.max(1, Math.floor((Date.now() - task.startedAt) / 1000));
    const elapsedStr = elapsedSec >= 60
      ? `${Math.floor(elapsedSec / 60)}m ${elapsedSec % 60}s`
      : `${elapsedSec}s`;

    const spinners = ['⏳', '⚙️', '🔄', '⚡', '🧠', '✨'];
    const spinner = spinners[task.tickerCount % spinners.length];

    const metrics = getSystemMetrics();
    const activeCount = this.getActiveCount();
    const snippetPrompt = clipPrompt(task.prompt, 65);

    let card = `${spinner} <b>${task.agentType} Agent Running...</b>\n`;
    card += `🆔 <code>${task.id}</code>${task.pid ? ` (PID: ${task.pid})` : ''}\n\n`;
    card += `📝 <i>"${escapeHtml(snippetPrompt)}"</i>\n\n`;
    card += `⏱️ <b>Elapsed:</b> ${elapsedStr}\n`;
    card += `👥 <b>Active Agents:</b> ${activeCount} running\n`;
    card += `📊 <b>Host:</b> CPU ${metrics.cpu.usagePct}% | RAM ${metrics.ram.usedPct}%`;
    if (metrics.tempC !== undefined) {
      card += ` | Temp ${metrics.tempC}°C`;
    }
    card += `\n📁 <b>Workspace:</b> <code>${escapeHtml(task.workspaceDir)}</code>\n\n`;
    card += `⚡ <b>Live Activity:</b>\n<code>${escapeHtml(task.lastActivityLine || 'Processing step...')}</code>`;

    return card;
  }

  formatActiveTasksSummary(): string {
    const tasks = this.getActiveTasks();
    if (tasks.length === 0) {
      return `💤 <b>No AI agents currently running.</b>\n\n<i>You can dispatch a task anytime:</i>\n• <code>/cursor &lt;prompt&gt;</code>\n• <code>/task &lt;prompt&gt;</code>`;
    }

    let text = `🤖 <b>Active AI Agents (${tasks.length} Running):</b>\n\n`;
    tasks.forEach((t, i) => {
      const elapsed = Math.floor((Date.now() - t.startedAt) / 1000);
      const elapsedStr = elapsed >= 60 ? `${Math.floor(elapsed / 60)}m ${elapsed % 60}s` : `${elapsed}s`;
      const snippet = clipPrompt(t.prompt, 65);

      text += `<b>${i + 1}. [${t.agentType}]</b> <code>${t.id}</code>${t.pid ? ` (PID: ${t.pid})` : ''}\n`;
      text += `   📝 <i>"${escapeHtml(snippet)}"</i>\n`;
      text += `   ⏱️ <b>Time:</b> ${elapsedStr} | 📁 <code>${escapeHtml(t.workspaceDir)}</code>\n`;
      text += `   ⚡ <b>Latest:</b> <code>${escapeHtml(t.lastActivityLine)}</code>\n\n`;
    });

    text += `<i>To stop an agent: <code>/cancel &lt;id&gt;</code></i>`;
    return text;
  }
}

export const taskManager = new AgentTaskManager();
