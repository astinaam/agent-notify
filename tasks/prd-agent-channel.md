# PRD: Agent Communication Channel

## Introduction / Overview

Add an **agent communication channel** to `agent-notify` so registered agents can talk in a shared room and via direct messages, with every message relayed to Telegram and visible in a new Portal chat tab. Agents register with a chosen name, short bio/status, and metadata (model, working directory, etc.). Other agents can list peers and read bios. The human participates as a special participant from Telegram and the Portal. Soft policy (via skill docs) governs create/delete/clear — no hard ACL gatekeeping.

## Goals

- Let agents register, update status/bio/metadata, list peers, and chat (broadcast + DM) entirely via CLI
- Relay every channel event (register, status update, chat, clear, delete) to the configured Telegram chat
- Let the human read and post in the channel from Telegram and the Portal
- Add a Portal **Channel** tab: live chat + agent roster with details (name, bio, model, dir, etc.)
- Persist conversation history; support clear-with-archive; agents can read history via CLI
- Ship a new global `agent-channel` skill (installed like `agent-notify`) with behavioral instructions

## Locked decisions

- Messaging: shared room **and** DMs
- Human: observe **and** participate (Telegram + Portal)
- Identity: name-only (unique name); no join/per-agent tokens; metadata includes model, cwd/dir, optional extras
- Lifetime: single persistent channel; no multi-channel or TTL
- Auth/policy: no hard gatekeeping; skill instructs who creates/deletes/clears

## User Stories

### US-001: Channel store and data model
**Description:** As a developer, I need persistent channel state so registrations, bios, and messages survive restarts.

**Acceptance Criteria:**
- [ ] Store under `~/.config/agent-notify/` (e.g. `channel.json` + `channel-messages.json` or equivalent)
- [ ] Model includes: channel meta (createdAt, createdBy), agents (name, bio/status, model, dir, registeredAt, updatedAt, lastSeenAt), messages (id, from, to|null for broadcast, body, createdAt, kind)
- [ ] Archives written under e.g. `~/.config/agent-notify/channel-archives/` when history is cleared
- [ ] Typecheck/lint passes

### US-002: Create / status / delete channel (CLI)
**Description:** As a human (or agent asked by the human), I want CLI commands to create, inspect, and delete the single channel.

**Acceptance Criteria:**
- [ ] `agent-notify channel create` creates the channel if missing; fails clearly if already exists
- [ ] `agent-notify channel status` shows whether channel exists, agent count, message count, created info
- [ ] `agent-notify channel delete` removes channel state (agents + live messages); does not delete archives unless flagged
- [ ] Each of create/delete is relayed to Telegram
- [ ] No hard ACL — any local CLI user can run these; policy lives in skill
- [ ] Typecheck/lint passes

### US-003: Agent registration and status updates (CLI)
**Description:** As an agent, I want to register with a unique name, bio, and metadata, and update them later.

**Acceptance Criteria:**
- [ ] `agent-notify channel register --name <Name> --bio "..." --model <model> --dir <path> [optional flags]`
- [ ] Duplicate name rejected with clear error
- [ ] `agent-notify channel update --name <Name> --bio ... --model ... --dir ...` updates fields
- [ ] `agent-notify channel unregister --name <Name>` removes agent from roster
- [ ] Register/update/unregister relayed to Telegram with agent details
- [ ] Typecheck/lint passes

### US-004: List peers and read bios (CLI)
**Description:** As an agent, I want to easily see who is on the channel and what they are doing.

**Acceptance Criteria:**
- [ ] `agent-notify channel agents` lists registered agents with name, bio/status, model, dir, updatedAt
- [ ] `--json` for machine-readable output
- [ ] `agent-notify channel whoami --name <Name>` shows one agent’s record
- [ ] Typecheck/lint passes

### US-005: Broadcast and DM messaging (CLI)
**Description:** As an agent, I want to post to the shared room or DM another agent.

**Acceptance Criteria:**
- [ ] `agent-notify channel say --from <Name> "message"` posts broadcast
- [ ] `agent-notify channel dm --from <Name> --to <Name> "message"` posts DM
- [ ] Both require sender to be registered; DM requires recipient registered
- [ ] Every say/dm is persisted and relayed to Telegram (DMs labeled as such; human still sees them)
- [ ] Typecheck/lint passes

### US-006: Conversation history and clear-with-archive (CLI)
**Description:** As an agent or human, I want to read history and clear it with archival when asked.

**Acceptance Criteria:**
- [ ] `agent-notify channel history [--limit N] [--from Name] [--dm WithName] [--json]` reads messages
- [ ] `agent-notify channel clear` archives current messages to timestamped archive file, then empties live history
- [ ] Clear is relayed to Telegram; archive path reported in CLI
- [ ] `agent-notify channel archives` lists archive files
- [ ] Typecheck/lint passes

### US-007: Human participation (Telegram + Portal)
**Description:** As the human, I want to post into the channel from Telegram and the Portal as participant `You` (or fixed display name).

**Acceptance Criteria:**
- [ ] Telegram command or reply path posts as human into the shared room (e.g. `/channel <text>` or documented equivalent)
- [ ] Portal Channel tab has a compose box that posts as human
- [ ] Human messages persisted and visible to agents via `history`
- [ ] Human posts also appear in Telegram stream (consistent with other relays)
- [ ] Typecheck/lint passes
- [ ] Verify Portal compose in browser using dev-browser skill

### US-008: Portal Channel tab
**Description:** As the human, I want a Channel tab that looks like a chat, with agent roster and details.

**Acceptance Criteria:**
- [ ] New tab alongside Messages / System in `src/web/index.html`
- [ ] Main pane: chronological chat (broadcast + DMs clearly marked)
- [ ] Side roster: agents with name, bio/status, model, dir; click filters or highlights
- [ ] Live updates via existing SSE/poll patterns used by the Portal
- [ ] Empty states when channel missing or no messages
- [ ] Typecheck/lint passes
- [ ] Verify in browser using dev-browser skill

### US-009: Telegram relay formatting
**Description:** As the human, I want every channel event clearly labeled in Telegram.

**Acceptance Criteria:**
- [ ] Formats distinguish register / status / say / dm / human / clear / create / delete
- [ ] Uses existing Telegram client + message store patterns where sensible
- [ ] Typecheck/lint passes

### US-010: Global `agent-channel` skill + installer
**Description:** As an agent harness user, I want a dedicated skill installed globally that teaches channel usage and soft policy.

**Acceptance Criteria:**
- [ ] New skill source e.g. `skills/agent-channel/SKILL.md`
- [ ] Skill documents: register with name/bio/model/dir; list peers; say/dm; history; when to create/delete/clear
- [ ] Soft policy explicit: only create when human asks / human typically creates; never delete or clear unless human asks; prefer updating bio when task changes
- [ ] `install.sh` and `update.sh` install/copy `agent-channel` to the same global destinations as `agent-notify`
- [ ] Existing agent-notify skill briefly cross-links to agent-channel where useful

## Functional Requirements

- FR-1: Single persistent channel per agent-notify install/config dir
- FR-2: Agent registration requires unique `--name`, `--bio`, and should capture `--model` and `--dir` (auto-detect cwd if `--dir` omitted)
- FR-3: Agents can update bio/status and metadata anytime
- FR-4: `channel agents` / `whoami` expose peer bios and metadata for easy reading
- FR-5: Broadcast (`say`) and DM (`dm`) messaging
- FR-6: Every channel mutation and message is relayed to Telegram
- FR-7: Agents can read full (or limited) conversation history via CLI
- FR-8: `channel clear` archives then empties live history
- FR-9: Human can post from Telegram and Portal; messages stored as from human participant
- FR-10: Portal Channel tab shows chat + agent details (name, bio, model, dir, timestamps)
- FR-11: Channel create/status/delete via CLI without hard ACL
- FR-12: New global `agent-channel` skill installed by install/update scripts
- FR-13: DMs are visible to human (Telegram + Portal) even though peer-addressed

## Non-Goals

- Multi-channel / named rooms / TTL session channels
- Cryptographic auth, join tokens, or per-agent secrets
- End-to-end encrypted DMs hidden from the human
- Cross-host / multi-machine agent mesh (local daemon + config dir only)
- Replacing existing `send` / `ask` notification flows
- Full Slack-like threads, reactions, file sharing inside the channel (v1)
- Hard permission system preventing agents from create/delete/clear

## Design Considerations

- Reuse Portal tab pattern in `src/web/index.html` / `src/web/app.js`
- Chat UI: chronological bubbles; DM badge; roster sidebar (not a dashboard of cards)
- Human participant display name fixed (`Human`) for clarity
- Keep visual language consistent with existing Portal; do not invent a second design system

## Technical Considerations

- Extend CLI in `src/cli.ts` with `channel` subcommands
- New store module alongside `src/store.ts` for channel state + archives
- Server/API endpoints in `src/server.ts` for Portal live view + human compose
- Telegram relay via `src/telegram.ts`; inbound human posts via `src/bot_listener.ts`
- Types in `src/types.ts`
- Skill install mirrors existing agent-notify paths in install.sh / update.sh

Suggested CLI surface:

```bash
agent-notify channel create
agent-notify channel status
agent-notify channel delete
agent-notify channel register --name X --bio "..." --model M --dir PATH
agent-notify channel update --name X [--bio] [--model] [--dir]
agent-notify channel unregister --name X
agent-notify channel agents [--json]
agent-notify channel say --from X "msg"
agent-notify channel dm --from X --to Y "msg"   # --to required; -t is global --token
agent-notify channel history [--limit N] [--json]
agent-notify channel clear
agent-notify channel archives
```

## Success Metrics

- Two agents can register, see each other’s bios, broadcast and DM within one CLI session each
- Every message appears in Telegram and Portal Channel tab without manual refresh (live)
- Clear produces a readable archive file and empty live history
- Fresh install places `agent-channel` skill beside `agent-notify` in global skill dirs

## Open Questions

- Exact Telegram inbound command spelling (`/channel` vs `/ch` vs free-text prefix) — **Resolved: `/channel <text>`**
- Whether unregistering an agent should anonymize or leave their past messages attributed — **Resolved: leave attributed**
- Whether `channel delete` should refuse while agents are still registered or force-remove all — **Resolved: force-remove all**
