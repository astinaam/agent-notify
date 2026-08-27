---
name: agent-notify
description: >-
  Send Telegram push notifications, upload files/logs, receive 24/7 continuous Telegram commands/prompts, run Cursor & Antigravity agents with live status updates, persistent markdown memory & system prompts, request interactive decisions (with buttons and timeout), manage auto-restarting systemd background daemon, and generate Tailscale/LAN web links.
---

# agent-notify: Telegram & Web Notification Gateway for AI Agents

`agent-notify` allows AI agents and users to communicate bidirectionally:
- **Outbound**: Push alerts to Telegram, upload files/reports, and request approvals via interactive buttons.
- **Inbound (24/7 Continuous)**: Send commands (`/cursor <prompt>`, `/task <prompt>`, `/agents`, `/cancel`, `/memory`, `/prompt`, `/dir`, `/status`, `/top`, `/logs`, `/sh <cmd>`) or text from Telegram anytime, running on an always-on auto-restarting background systemd service.
- **Live Progress Tickers**: When agents run, the bot provides dynamic in-place updates (animated spinner, elapsed time, host resource load, live stream activity, and inline `🛑 Cancel` button).
- **Persistent Memory & System Prompt**: Markdown-based persistent memory (`memory.md`) and custom system instructions (`system_prompt.md`), automatically plugged into `/cursor` and `/task` agent executions.
- **Web UI Dashboard**: Real-time message stream and monitor accessible over Local LAN and Tailscale.

---

## 🚀 Quick Usage Cheat Sheet

### 1. Sending Notifications
Always specify `--agent <Name>` so messages are organized and grouped in the Web UI:

```bash
# Success notification upon task completion
agent-notify send "Build #42 completed successfully and all tests pass." --agent "Antigravity" --level success

# Warning alert (e.g. deprecations, high resource usage)
agent-notify send "Found 3 deprecated dependencies during build." --agent "Antigravity" --level warn

# Error alert
agent-notify send "Database migration failed: table already exists." --agent "Antigravity" --level error

# Silent message (no sound on user phone)
agent-notify send "Background checkpoint saved." --agent "Antigravity" --silent
```

### 2. Piping Command Outputs / Logs
```bash
# Pipe test results or build logs directly
npm test 2>&1 | agent-notify send --agent "Jest" --level info

# Pipe last lines of an error log
tail -n 25 error.log | agent-notify send --agent "Antigravity" --level error
```

### 3. Uploading Files, Reports & Screenshots
```bash
# Send generated report
agent-notify send-file ./artifacts/report.pdf --agent "Antigravity" --caption "Benchmark Report"

# Send screenshot
agent-notify send "Here is the new UI preview" --file ./screenshot.png --agent "Antigravity" --level success
```

### 4. Two-Way Human-in-the-Loop (`ask`)
Use `agent-notify ask` when you need human confirmation or decision before proceeding with dangerous/irreversible operations:

```bash
# Prompt with clickable buttons (user can answer from Telegram OR Web UI)
agent-notify ask "Deploy build #42 to production?" --agent "Antigravity" --options "Approve,Reject"

# Free-form text reply with custom timeout (default: 300s)
agent-notify ask "Which database environment should I seed?" --agent "Antigravity" --timeout 180

# JSON output for automated scripting
agent-notify ask "Run database migration?" --agent "Antigravity" --options "Yes,No" --json
```

### 5. Persistent Memory & System Prompt Management
Markdown files live in `~/.config/agent-notify/`:
- `memory.md`: Persistent user preferences, project facts, notes.
- `system_prompt.md`: Base system instructions with `{{MEMORY}}` placeholder.

```bash
# View current persistent memory
agent-notify memory show

# Append a note to persistent memory
agent-notify memory add "Primary app runs on port 3000"

# View system prompt with memory injected
agent-notify prompt show
```

### 6. Always-On Systemd Service Management (Auto-Start on Boot & Auto-Restart)
```bash
# Install and enable 24/7 background service on boot
agent-notify service install

# Check service status
agent-notify service status

# Restart / Stop service
agent-notify service restart
agent-notify service stop
```

### 7. Inbound Telegram Commands (Available 24/7 via Bot)
You can message your Telegram bot directly at any time:

🧠 **AI Coding Agents & Live Tracking:**
- `/cursor <prompt>` — Dispatch task to **Cursor Agent** (`agent -p --trust -f`) with live progress ticker & memory
- `/task <prompt>` or `/agy <prompt>` — Dispatch task to **Antigravity AI Agent** (`agy -p`) with live progress ticker & memory
- `/agents` or `/running` — View all currently running AI agents, PIDs, prompts, and elapsed durations
- `/cancel [id]` or `/stop [id]` — Stop/kill a running agent task (or tap the inline `🛑 Cancel` button)
- `/dir [path]` — View or switch workspace execution directory

💾 **Memory & System Prompt:**
- `/memory` — View persistent memory
- `/remember <note>` or `/memory add <note>` — Append a new note to persistent memory
- `/prompt` — View effective system prompt template and plugged memory

📊 **System Health & Shell:**
- `/status` or `/metrics` — Live CPU, RAM, Disk, Temperature, and Uptime
- `/top` or `/ps` — Top processes by CPU and Memory utilization
- `/sh <cmd>` — Execute shell command on host and receive output in Telegram
- `/ping` — Daemon health check

📜 **Logs & Dashboard:**
- `/logs [n]` — View last `n` notification logs
- `/links` — Get Tailscale & Local LAN Web Dashboard URLs
- `/help` — Interactive menu with quick action buttons

### 8. Optional System Resource Alert Monitor
```bash
# Check system metrics (CPU, RAM, Disk, Temp)
agent-notify monitor status

# Enable / disable background automated resource alerts
agent-notify monitor enable
agent-notify monitor disable

# Configure thresholds
agent-notify monitor set --ram 90 --disk 85 --cpu 90 --temp 80 --cooldown 1800
```

---

## 🔌 MCP Tools (Model Context Protocol)

When running within an MCP client, use the native tool calls:

### `send_notification`
- `message` (string, required): Content to notify the user.
- `agent_name` (string, optional): Your agent identifier (e.g., `"Antigravity"`).
- `level` (enum: `"info"`, `"success"`, `"warn"`, `"error"`).
- `silent` (boolean, optional): Send quietly without notification sound.

### `send_file`
- `file_path` (string, required): Filesystem path to the file/log/screenshot.
- `caption` (string, optional): Description of the file.
- `agent_name` (string, optional).
- `level` (enum: `"info"`, `"success"`, `"warn"`, `"error"`).

### `ask_user`
- `question` (string, required): The prompt or decision needed from the human.
- `options` (array of strings, optional): e.g. `["Approve", "Reject", "Modify"]`.
- `agent_name` (string, optional).
- `timeout_seconds` (number, optional, default: 300).

### `get_memory`
- Reads persistent memory notes and host context from `memory.md`.

### `append_memory`
- `note` (string, required): The note or fact to append to persistent memory.

### `get_system_prompt`
- Returns the effective system prompt with persistent memory plugged in.

---

## 🌐 Web Dashboard & Network Links

- View all network access URLs:
  ```bash
  agent-notify links
  ```
- Check background service status:
  ```bash
  agent-notify service status
  ```
- The Web Dashboard is automatically active in the background and accessible at:
  - **Tailscale**: `http://my-node.tailnet1234.ts.net:4173`
  - **Local LAN**: `http://192.168.1.50:4173`
