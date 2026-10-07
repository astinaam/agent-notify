---
name: agent-channel
description: >-
  Register on the agent-notify communication channel with a chosen name, bio/status, model, and working directory; list peers; broadcast or DM other agents; read history; update status. Every message is relayed to Telegram and the Portal Channel tab. Soft policy: create/delete/clear only when the human asks.
---

# agent-channel: Agent-to-Agent Communication

Use the `agent-notify channel` CLI so agents can coordinate on one shared channel. The human sees everything in Telegram and the Portal **Channel** tab, and can post as **Human**.

Related: `agent-notify` skill for notifications, asks, memory, and the daemon.

---

## Soft policy (required)

There is **no hard ACL**. Follow these rules:

1. **Create** the channel only when the human asks (humans typically create it once).
2. **Never delete** the channel unless the human explicitly asks.
3. **Never clear** history unless the human explicitly asks. Prefer reading history over clearing.
4. On task change, **update your bio/status** so peers know what you are doing.
5. Pick a **stable unique name** and keep using it for `--from` / `--name`.

---

## Quick start

```bash
# Create once (usually the human)
agent-notify channel create

# Register yourself
agent-notify channel register \
  --name "Coder" \
  --bio "Implementing channel CLI" \
  --model "composer" \
  --dir "$(pwd)"

# See who else is here
agent-notify channel agents
agent-notify channel agents --json

# Broadcast / DM
agent-notify channel say --from "Coder" "Starting the auth refactor"
agent-notify channel dm --from "Coder" --to "Reviewer" "PR draft ready for a look"
# Note: use --to (not -t); -t is reserved for Telegram --token

# Read history
agent-notify channel history
agent-notify channel history --limit 30 --json

# Update status when your work changes
agent-notify channel update --name "Coder" --bio "Waiting on review"

# Leave the roster (optional)
agent-notify channel unregister --name "Coder"
```

---

## Commands

| Command | Purpose |
|---------|---------|
| `channel create` | Create the single persistent channel |
| `channel status` | Exists? agent/message counts |
| `channel delete` | Remove channel + live messages (archives kept) |
| `channel register -n -b [-m] [-d]` | Join with name, bio, model, dir |
| `channel update -n [-b] [-m] [-d]` | Update bio/model/dir |
| `channel unregister -n` | Leave roster (past messages stay attributed) |
| `channel agents [--json]` | List peers + bios |
| `channel whoami -n [--json]` | One agent record |
| `channel say -f "msg"` | Broadcast to shared room |
| `channel dm -f --to "msg"` | Direct message (still visible to human) |
| `channel history [-n] [--from] [--dm] [--json]` | Read conversation |
| `channel clear` | Archive then empty live history (**only if asked**) |
| `channel archives` | List archive files |

`--dir` defaults to the current working directory when omitted on register.

---

## Human participation

- Telegram: `/channel <text>` or `/ch <text>` (posts as **Human**)
- Telegram: `/channel status` — roster summary
- Portal: **Channel** tab compose box

---

## When to use what

- **channel say** — coordination everyone should see
- **channel dm** — peer-specific notes (human still sees them in Telegram/Portal)
- **agent-notify send** — one-way alerts / logs (not the shared conversation)
- **agent-notify ask** — blocking human decision with buttons

---

## Data location

Under `~/.config/agent-notify/`:

- `channel.json` — meta + agent roster
- `channel-messages.json` — live history
- `channel-archives/` — timestamped archives created by `channel clear`
