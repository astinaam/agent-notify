# agent-notify 📡

> Telegram notification & interactive human-in-the-loop CLI, Model Context Protocol (MCP) server, and Real-Time Web History Dashboard for AI agents.

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)
[![Node.js](https://img.shields.io/badge/Node.js-%3E%3D18.0.0-brightgreen.svg)](https://nodejs.org/)
[![MCP Ready](https://img.shields.io/badge/MCP-Compatible-orange.svg)](https://modelcontextprotocol.io/)

**agent-notify** enables AI agents (Antigravity, Claude, Cursor, Windsurf, LangChain, custom scripts) to push alerts to your phone via Telegram, request approvals/decisions with interactive inline buttons, and view full persistent message history grouped by agents on a clean Web UI accessible over **Local LAN** and **Tailscale**.

---

## ✨ Features

- 🚀 **Dual Interfaces**: Use as a terminal CLI tool or as an MCP Server (`agent-notify mcp`).
- 🌐 **Real-Time Web Dashboard (`agent-notify serve`)**:
  - **Dual Views**: Toggle between **💬 Messages Feed** and **📊 System Metrics & 7-Day Graphs**.
  - Persistent message history stored locally in `~/.config/agent-notify/messages.json`.
  - **Grouped by Agents** (e.g. `Antigravity`, `Claude`, `ReviewBot`, `Deployer`).
  - **1-Click Copy Buttons**: Copy full message text, markdown, or direct links.
  - **Dual Network Links**: Dual access via **Tailscale** (`http://<tailscale-ip>:4173`) and **Local LAN** (`http://<lan-ip>:4173`).
  - **Real-Time SSE Live Stream**: Messages appear instantly in the browser without page refresh.
  - Search, filter by severity level (`INFO`, `SUCCESS`, `WARN`, `ERROR`), and filter by message type.
- 📊 **Ultra-Lightweight System Resource Alerts & 7-Day History**:
  - Near-zero overhead (< 0.1ms per tick, 0 extra daemons) monitor for CPU, RAM, Disk, and Temperature.
  - Automated Telegram alert notifications when thresholds are breached, with auto-recovery alerts.
  - 7-day historical time-series storage with responsive SVG charts (1h, 6h, 24h, 7d ranges).
- 🤖 **Interactive Human-in-the-Loop (`ask`)**: AI agents can prompt you with questions and clickable buttons (e.g. `[Approve] [Reject]`), blocking until you tap a choice on Telegram or the Web UI.
- 🎨 **Telegram Inline Web Links**: Each Telegram message automatically includes inline buttons for instant web view over Tailscale & LAN.
- 📎 **File & Media Delivery**: Upload logs, screenshots, images, PDFs, and diffs.
- 📥 **UNIX Pipe Support**: Pipe command outputs directly (`cat build.log | agent-notify send --level error`).
- 🧙‍♂️ **Guided Setup Wizard**: One command (`agent-notify setup`) validates your bot token and auto-detects your Telegram chat ID.
- 🧠 **Multi-Environment Agent Skills**: Automatically installs skill files into `~/.agents`, `~/.gemini`, and `~/.cursor`.

---

## 📦 Installation

### Option 1: One-Line Installer (Recommended)
Run the automated installer to clone, build, link the CLI globally, and install agent skills:

```bash
curl -fsSL https://raw.githubusercontent.com/astinaam/agent-notify/main/install.sh | bash
```

### Option 2: Manual Clone & Install
```bash
git clone https://github.com/astinaam/agent-notify.git
cd agent-notify
./install.sh
```

---

## 🔄 Updating to Latest Version

Run the updater anytime to pull the latest changes, rebuild, and reload background daemons:

```bash
# Via one-liner:
curl -fsSL https://raw.githubusercontent.com/astinaam/agent-notify/main/update.sh | bash

# Or from inside the cloned directory:
./update.sh
```

---

## ⚡ Quick Start & Setup

### Step 1: Configure Telegram Bot
Run the guided interactive setup:

```bash
agent-notify setup
```

The wizard will:
1. Guide you to get a Bot Token from [@BotFather](https://t.me/BotFather) and validate it.
2. Auto-detect your Chat ID when you send a message to your bot.
3. Send a test ping to confirm everything is working.

### Step 2: Open / Start Web Dashboard
The web dashboard auto-spawns silently in the background whenever you send a message or ask a question. To view your access links:

```bash
agent-notify links
```

Output:
```
  Access URLs:
  🏠 Local LAN:   http://192.168.1.50:4173
  🌐 Tailscale:   http://my-node.tailnet1234.ts.net:4173
  💻 Localhost:   http://localhost:4173
```

---

## 💻 CLI Usage

### 1. Send Notifications with Agent Name
```bash
# Send with agent identifier and status level
agent-notify send "Build #104 passed all tests" --agent "Antigravity" --level success

# Send warning / error
agent-notify send "High CPU usage detected on cluster" --agent "MonitorBot" --level warn
agent-notify send "Database connection failed" --agent "Backend" --level error

# Silent message (no phone notification sound)
agent-notify send "Nightly backup finished" --silent
```

### 2. Pipe from Shell Commands
```bash
# Pipe stdout/stderr into notification
npm test 2>&1 | agent-notify send --agent "Jest" --level info

# Send error log
tail -n 20 error.log | agent-notify send --agent "CrashReporter" --level error
```

### 3. Send Files, Images & Logs
```bash
# Upload a file with caption
agent-notify send-file ./artifacts/report.pdf --agent "Benchmarker" --caption "Performance Report"

# Or send via send command
agent-notify send "Screenshot of generated UI" --file ./screenshot.png --agent "Designer"
```

### 4. Interactive Human-in-the-Loop (`ask`)
Prompt the user with quick inline buttons or text reply and wait for their response:

```bash
# Prompt with clickable buttons (blocks until user taps on Telegram)
agent-notify ask "Deploy build to production?" --agent "Deployer" --options "Approve,Reject"

# Free-form answer with custom timeout (default: 300s)
agent-notify ask "Which branch should I merge into main?" --timeout 120

# Output as JSON for automated scripts
agent-notify ask "Run migration?" --options "Yes,No" --json
```

### 5. Optional System Resource Alert Monitor (Default: OFF)
Ultra-lightweight (< 0.1ms execution, near-zero CPU overhead) system health alerts:

```bash
# Check current system utilization and threshold status
agent-notify monitor status

# Enable / disable background automated resource alerts
agent-notify monitor enable
agent-notify monitor disable

# Customize alert thresholds and cooldowns
agent-notify monitor set --ram 90 --disk 85 --cpu 90 --temp 80 --cooldown 1800

# Immediate one-off check
agent-notify monitor check
```

### 6. View Network & Message Links
```bash
agent-notify links            # View dashboard links (Tailscale, LAN, Localhost)
agent-notify links <msg_id>   # View direct link for a specific message
```

---

## 🔌 MCP Server (Model Context Protocol)

Connect `agent-notify` to AI assistants (Antigravity, Claude Desktop, Cursor, Windsurf) so agents can natively notify you, upload files, or ask for approvals.

### Claude Desktop / Antigravity Configuration
Add to your MCP settings file:

```json
{
  "mcpServers": {
    "agent-notify": {
      "command": "agent-notify",
      "args": ["mcp"]
    }
  }
}
```

### MCP Tools Provided

| Tool | Parameters | Description |
|---|---|---|
| `send_notification` | `message`, `agent_name`, `level` (`info`/`success`/`warn`/`error`), `silent`, `include_links` | Sends a formatted Telegram message with Tailscale/LAN web view buttons. |
| `send_file` | `file_path`, `caption`, `agent_name`, `level`, `silent`, `include_links` | Uploads and sends a file, screenshot, or log to Telegram. |
| `ask_user` | `question`, `agent_name`, `options` (array of buttons), `timeout_seconds`, `level`, `include_links` | Asks the human user a question and waits for their response (Human-in-the-loop). |

---

## 🌐 Web Dashboard Features

1. **Dual Views**: Toggle between **💬 Messages Feed** and **📊 System Metrics & Performance Charts**.
2. **7-Day Historical Charts**: Interactive time-series SVG graphs for CPU %, RAM %, Disk %, and Thermal °C with hover tooltips and range selectors (`1h`, `6h`, `24h`, `7d`).
3. **Agent Grouping**: Filter message feeds by specific agents (`Antigravity`, `Claude`, etc.) with message counters and last-active times.
4. **Copy Actions**: Instant 1-click button to copy message content, markdown, or shareable direct URLs.
5. **Interactive 2-Way Approvals**: Answer agent questions directly from the browser or Telegram.
6. **Deep Linking**: Access specific messages directly via `/m/<msg_id>` or `/#msg-<msg_id>`.
7. **Tailscale & LAN Support**: Automatically detects Tailscale MagicDNS/IP and Local LAN IP to provide access from your laptop, mobile phone, or desktop on any network.
8. **Real-Time Live Feed**: Uses Server-Sent Events (SSE) to display incoming agent messages without browser refresh.

---

## ⚙️ Configuration

Stored in `~/.config/agent-notify/config.json` (or via ENV variables):

```json
{
  "botToken": "123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11",
  "chatId": "987654321",
  "topicId": null,
  "serverPort": 4173,
  "includeLinks": true,
  "tailscaleHost": "my-node.tailnet1234.ts.net",
  "lanHost": "192.168.1.50",
  "monitor": {
    "enabled": false,
    "cpuThresholdPct": 90,
    "ramThresholdPct": 90,
    "diskThresholdPct": 85,
    "tempThresholdC": 80,
    "checkIntervalSec": 60,
    "cooldownSec": 1800,
    "alertOnRecovery": true
  }
}
```

---

## 📄 License
MIT © 2026
