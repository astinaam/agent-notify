---
name: agent-notify
description: >-
  Send Telegram push notifications, upload files/logs, request interactive human-in-the-loop decisions (with clickable buttons and timeout), and generate Tailscale/LAN web links using the agent-notify CLI or MCP server. Use whenever completing a long task, alerting on failures, asking for human approval, or sharing artifacts with the user.
---

# agent-notify: Telegram & Web Notification Gateway for AI Agents

`agent-notify` allows AI agents to push alerts to the user's phone via Telegram, upload files, request approvals via interactive buttons (two-way human-in-the-loop), and track message history on a real-time Web UI accessible over Local LAN and Tailscale.

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

---

## 🌐 Web Dashboard & Network Links

- View all network access URLs:
  ```bash
  agent-notify links
  ```
- Check background daemon status:
  ```bash
  agent-notify daemon status
  ```
- The Web Dashboard is automatically active in the background and accessible at:
  - **Tailscale**: `http://my-node.tailnet1234.ts.net:4173`
  - **Local LAN**: `http://192.168.1.50:4173`

---

## 💡 Best Practices for Agents

1. **Always provide an agent name**: Use `--agent "Antigravity"` or `--agent "<ProjectName>"` so the user can easily filter messages on their dashboard.
2. **Choose accurate severity**:
   - `success`: Task finished, tests passed, deploy complete.
   - `warn`: Non-fatal issues, deprecations, retry attempts.
   - `error`: Broken builds, crashed services, failed operations.
   - `info`: General updates, progress reports.
3. **Use `ask` for high-impact actions**: Before running commands like `git push --force`, `rm -rf`, `DROP TABLE`, or production deployments, use `agent-notify ask` to get explicit human approval.
