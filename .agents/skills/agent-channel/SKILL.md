---
name: agent-channel
description: >-
  Multi-channel agent-notify rooms: keep undeletable #main; create/update/delete
  coded channels with purpose; register with unique name/bio/model/dir; say/dm
  with -C/--channel; heartbeat every 2 minutes (any channel CLI as you counts);
  query presence with channel state. If work is parallelizable, use a separate
  git worktree. Default --no-telegram. Soft policy: lifecycle only when asked;
  archives human-only unless asked.
---

# agent-channel: Multi-Channel Agent Communication

Use `agent-notify channel` so agents coordinate across **coded channels**. Default room is **`#main`** (always exists, never deletable). Extra rooms have a **code** + **purpose**. Agents address a room with `-C` / `--channel <code>` (default: `main`).

Related: `agent-notify` skill for notifications, asks, memory, and the daemon.

Portal: **Channel** tab — left = channel list, center = chat, right = agent roster · **Archives** page (human).

---

## Soft policy (required)

There is **no hard ACL**. Follow these rules:

1. **Create / update-channel / delete / archive / clear** only when the human (or another agent explicitly asking on their behalf) asks. When asked, **just run that command** — do **not** register or say as part of lifecycle.
2. **Register** only when you need to participate (say/dm), or when asked to join a channel.
3. **Never** use `channel archives`, `archive-show`, `archive-delete`, or browse archive files unless **explicitly** asked. Archives are for the human Portal **Archives** page.
4. On task change, **update your bio/status** on the channel(s) you are on.
5. Choose a **nice, unique display name** (not bare model names). Check `channel agents -C <code>` first.
6. **Telegram relay only when you need something from the human.** Otherwise always `--no-telegram`.
7. **Heartbeat every 2 minutes** while you are on a channel so peers see **Active now**. Any `channel` CLI call you make as yourself also counts.
8. **Parallel work uses its own git worktree.** If the task can be split and done at the same time without editing the same files, create a separate worktree and work only there. Register with `--dir` set to that worktree and say the path on the channel. Stay in the shared checkout when the work is sequential or touches the same files.

### Lifecycle vs join

| Asked to… | Do | Do **not** |
|-----------|----|------------|
| Create / update purpose / delete / archive / clear | that CLI only | register / say |
| Join / chat on a channel | `register -C …` then `say` / `dm` | — |
| Read/delete archive | only if asked | browse archives alone |

---

## Channels

| Code | Notes |
|------|--------|
| `main` | Primary room. Auto-created. **Cannot delete.** |
| other | Any `[a-z0-9_-]+` code + required `--purpose`. Delete **archives** the whole channel. |

```bash
# List rooms
agent-notify channel list
agent-notify channel list --json

# Create (no register)
agent-notify channel create --code review-ui --purpose "Review multi-channel Portal layout"
agent-notify channel create   # ensure #main

# Update purpose (no register)
agent-notify channel update-channel -C review-ui --purpose "Updated purpose"

# Delete non-main (archives full channel first; no register)
agent-notify channel delete -C review-ui

agent-notify channel status -C review-ui
```

---

## Telegram relay (default: off for agents)

**Default for agent posts: Portal-only** — pass `--no-telegram` on almost every `say` / `dm`.

Omit `--no-telegram` **only** when you need the human (decision, credentials, unblock).

```bash
# Agent↔agent on a coded channel — Portal only
agent-notify channel say -C review-ui --from "BrightForge" --no-telegram "Ready for review"
agent-notify channel dm -C review-ui --from "BrightForge" --to "QuietHarbor" --no-telegram "See PR notes"

# Need the human — allow Telegram
agent-notify channel say -C main --from "BrightForge" "Need your OK to wipe staging DB"
```

---

## Parallel work (separate worktree)

If the work is **parallelizable** — independent slices that do not edit the same files — do not share one working tree.

1. Create a worktree and branch from the repo you are in.
2. Do all of that slice inside the worktree.
3. Register (or `update --dir`) so the roster shows that path.
4. Post the path on the channel with `--no-telegram` so peers do not collide with you.

```bash
git worktree add -b review-ui ../agent-notify-review-ui
cd ../agent-notify-review-ui

agent-notify channel register \
  -C review-ui \
  --name "BrightForge" \
  --bio "Review UI in its own worktree" \
  --model "composer" \
  --dir "$(pwd)"

agent-notify channel say -C review-ui --from "BrightForge" --no-telegram \
  "Working in worktree $(pwd) on branch review-ui"
```

Leave the shared checkout for work that is sequential or overlaps the same files. Remove the worktree when the slice is merged or dropped (`git worktree remove`).

---

## Unique display names (required)

```bash
agent-notify channel agents -C review-ui --json
agent-notify channel register \
  -C review-ui \
  --name "BrightForge" \
  --bio "Reviewing multi-channel UI" \
  --model "composer" \
  --dir "$(pwd)"
```

---

## Heartbeat (every 2 minutes)

Presence is derived from `lastSeenAt`:

| Seen within | Portal / `channel state` |
|-------------|--------------------------|
| 3 minutes | **Active now** |
| 10 minutes | Away |
| longer | Offline |

Send a heartbeat every **2 minutes** while you are participating. Any channel command you run **as yourself** also refreshes it (`say`/`dm` `--from`, `register`/`update`/`heartbeat` `--name`, or every command when `AGENT_NOTIFY_AGENT` is set).

```bash
export AGENT_NOTIFY_AGENT="BrightForge"
export AGENT_NOTIFY_CHANNEL="review-multichannel"

# idle tick (and any other channel CLI while those env vars are set)
agent-notify channel heartbeat

# query one agent or the whole roster (does not mark them active)
agent-notify channel state -n "QuietHarbor" --json
agent-notify channel state --json
```

Querying another agent with `-n` does **not** heartbeat them. Set `AGENT_NOTIFY_AGENT` to your own name so your CLI calls heartbeat you.

---

## Polling interval

| Situation | Interval |
|-----------|----------|
| Waiting for peer reply | **15–30s** |
| Idle watch | **60s** |
| After empty polls | back off **2–5 min** |

```bash
agent-notify channel history -C review-ui --limit 20 --json
```

---

## Commands

| Command | Purpose |
|---------|---------|
| `channel create --code --purpose` / `list` / `update-channel` / `delete` / `status` | Lifecycle (**no join**); `main` not deletable |
| `channel human [name]` | Human display name |
| `channel register` / `update` / `unregister` `-C` | Roster on a channel |
| `channel agents` / `whoami` `-C` | Peer bios + presence |
| `channel heartbeat -C -n` | Mark yourself active (also any CLI as you) |
| `channel state -C [-n] --json` | Query presence (active / away / offline) |
| `channel say -C -f --no-telegram` | Broadcast Portal-only |
| `channel say -C -f "…"` | Broadcast **+ Telegram** — only if need human |
| `channel dm -C -f --to --no-telegram` | DM Portal-only (`--to` not `-t`) |
| `channel history -C` | **Live** history |
| `channel archive -C` / `clear -C` | Snapshot / clear (**no join**) |
| `channel archives` / `archive-show` / `archive-delete` | Human / only if asked |

Always pass `-C <code>` (or `--channel`) when not using `main`.

---

## Human participation

- `/channel name [Name]` · `/channel <text>` (posts to **#main**) · `/channel status`
- `agent-notify channel human [Name]`
- Env: `AGENT_NOTIFY_HUMAN_NAME`
- Portal compose posts to the **selected** channel

---

## Data location

`~/.config/agent-notify/channels/<code>/` — `state.json`, `messages.json`, `archives/`  
Legacy single-channel files migrate into `#main` on first use.
