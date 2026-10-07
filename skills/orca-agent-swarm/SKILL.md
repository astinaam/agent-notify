---
name: orca-agent-swarm
description: >-
  Orchestrate parallel AI coding agents in isolated Orca worktrees with custom model selection, coordinated via agent-notify channels. Use when launching multi-agent swarms (Codex, Claude Code, Gemini, Opencode), assigning models/reasoning efforts, tracking worktree lifecycles, and managing peer-to-peer collaboration with human-in-the-loop escalation.
---

# Orca Agent Swarm: Parallel Coding Agents with Custom Models & Channel Collaboration

This skill guides agents and coordinators in launching and managing autonomous multi-agent coding swarms. It combines **Orca's worktree/terminal engine** for isolated execution with **`agent-notify` multi-channel rooms** for synchronized communication, real-time presence, and human-in-the-loop escalation.

---

## Architecture Overview

```
                 ┌──────────────────────────────────────────────┐
                 │          Human (Telegram & Web UI)           │
                 └──────────────────────▲───────────────────────┘
                                        │ agent-notify ask / send
                 ┌──────────────────────▼───────────────────────┐
                 │   Coordinator Agent (Lead / Architect)       │
                 └──────────────┬───────────────────────────────┘
                                │ orca worktree create & terminal
        ┌───────────────────────┴───────────────────────┐
        ▼                                               ▼
┌───────────────────────────────┐       ┌───────────────────────────────┐
│ Worker A (e.g. Codex)         │       │ Worker B (e.g. Claude Code)   │
│ Model: gpt-5.3-codex (high)   │       │ Model: claude-3-7-sonnet      │
│ Worktree: ./worktrees/feat-be │       │ Worktree: ./worktrees/feat-fe │
└───────────────┬───────────────┘       └───────────────┬───────────────┘
                │                                       │
                ▼                                       ▼
        ┌───────────────────────────────────────────────────────┐
        │ agent-notify channel (#task-code)                     │
        │ - Agent Roster (Name, Model, Worktree Dir, Status)    │
        │ - Peer DMs & Updates (--no-telegram by default)       │
        └───────────────────────────────────────────────────────┘
```

---

## 1. Model Selection & Roles

Match model strengths to specific agent assignments in the swarm:

| Swarm Role | Recommended Agent & Model Flags | Strengths |
|---|---|---|
| **Lead / Architect** | `claude-3-7-sonnet` or `gemini-2.5-pro` | High context window, deep system reasoning, planning |
| **Backend / Algorithms** | `codex --model gpt-5.3-codex -c model_reasoning_effort=high` | Intense reasoning, algorithmic accuracy, edge-case handling |
| **Frontend / UI / Polish** | `claude --model claude-3-7-sonnet` | Component architecture, responsive styling, design systems |
| **Test Suite / Docs** | `claude --model claude-3-5-sonnet` or `gemini-2.5-flash` | Fast execution, test generation, documentation |
| **Open Weights / Local** | `opencode --model deepseek-r1` or `ollama/...` | Local privacy, zero token cost |

---

## 2. Step-by-Step Coordination Workflow

### Step 1: Initialize Task Channel in `agent-notify`

Create a dedicated room for the task. Keep room codes lowercase alphanumeric with dashes:

```bash
TASK_CODE="feat-auth-jwt"
agent-notify channel create --code "$TASK_CODE" --purpose "Refactor authentication to JWT with test suite"
```

### Step 2: Spawn Isolated Worktrees & Launch Agents

Do **not** share working trees across parallel agents. Create an isolated worktree for each worker.

#### Option A: Quick Spawn with Default Agent Launcher
When Orca's default model for that agent is sufficient:
```bash
orca worktree create \
  --name "auth-backend" \
  --agent codex \
  --no-parent \
  --prompt "Join agent-notify channel $TASK_CODE. Register as BackendWorker. Implement JWT auth." \
  --json
```

#### Option B: Precise Model Selection & Reasoning Effort
When you need explicit models, reasoning effort, or custom CLI flags:

1. **Create the clean worktree:**
   ```bash
   orca worktree create --name "auth-backend" --no-parent --json
   ```

2. **Launch the agent with custom model flags:**
   ```bash
   # For Codex with high reasoning effort:
   orca terminal create --worktree name:auth-backend --command "codex --model gpt-5.3-codex -c model_reasoning_effort=high" --json

   # For Claude Code with specific model:
   orca terminal create --worktree name:auth-frontend --command "claude --model claude-3-7-sonnet" --json

   # For Gemini CLI:
   orca terminal create --worktree name:auth-docs --command "gemini --model gemini-2.5-pro" --json
   ```

3. **Send the initial task prompt to the agent:**
   ```bash
   orca terminal send --worktree name:auth-backend --input "Join agent-notify channel $TASK_CODE. Register your directory and model, then implement the JWT token service.\n"
   ```

---

## 3. Worker In-Room Collaboration Protocol

Each worker agent must adhere to the channel collaboration protocol once active:

### 1. Register Identity, Model & Directory
Immediately register on the task channel with your unique name, active model, and worktree path:

```bash
agent-notify channel register \
  -C "$TASK_CODE" \
  -n "BackendWorker" \
  -m "gpt-5.3-codex (high)" \
  -d "$PWD" \
  -b "Implementing JWT token issue and verify services"
```

### 2. Maintain Heartbeat
Send a heartbeat every 2 minutes while active, or run any channel command:
```bash
agent-notify channel heartbeat -C "$TASK_CODE" -n "BackendWorker"
```

### 3. Tagged Status Updates (Silent by Default)
Always pass `--no-telegram` for agent-to-agent chatter to prevent spamming the user's phone. Use clear tags:

* `[CLAIM]` — Claiming an unassigned file or sub-endpoint:
  ```bash
  agent-notify channel say -C "$TASK_CODE" --from "BackendWorker" --no-telegram "[CLAIM] Implementing src/auth/jwt.ts"
  ```
* `[PROGRESS]` — Major milestone reached:
  ```bash
  agent-notify channel say -C "$TASK_CODE" --from "BackendWorker" --no-telegram "[PROGRESS] JWT unit tests passing 12/12"
  ```
* `[BLOCKED]` — Announcing a blocker or dependency:
  ```bash
  agent-notify channel say -C "$TASK_CODE" --from "FrontendWorker" --no-telegram "[BLOCKED] Waiting on JWT payload schema from BackendWorker"
  ```
* `[READY]` — Worktree ready for review:
  ```bash
  agent-notify channel say -C "$TASK_CODE" --from "BackendWorker" --no-telegram "[READY] Endpoints committed on branch auth-backend. Ready for integration test."
  ```

### 4. Direct Messaging Between Workers
Send private peer messages within the room:
```bash
agent-notify channel dm -C "$TASK_CODE" --from "BackendWorker" --to "FrontendWorker" --no-telegram "JWT claims export added to src/types/auth.ts"
```

---

## 4. Supervision & Terminal Control

The Lead / Coordinator inspects progress without guessing:

```bash
# Check who is active, their models, and current status:
agent-notify channel state -C "$TASK_CODE" --json

# Read live terminal output of a worker:
orca terminal read --worktree name:auth-backend

# Send follow-up instructions or nudges:
orca terminal send --worktree name:auth-backend --input "Please also add refresh token rotation.\n"

# Wait for terminal to finish if running a test:
orca terminal wait --worktree name:auth-backend --for prompt
```

---

## 5. Human-in-the-Loop Escalation Policy

Agents should collaborate autonomously by default, escalating to the human only when strictly necessary:

1. **Interactive Decision / Approval Required:**
   ```bash
   agent-notify ask --question "Migrating user table to add jwt_secret. OK to run migration on staging?" --options "Yes, proceed|No, pause" --timeout 180
   ```
2. **Missing Secrets or External Credentials:**
   ```bash
   agent-notify channel say -C main --from "Coordinator" "Need JWT_SIGNING_KEY in .env before running integration tests."
   ```
3. **Critical Errors:**
   ```bash
   agent-notify send "Build pipeline broken on main branch" --agent "Coordinator" --level error
   ```

---

## 6. Completion, Integration & Teardown

When all workers post `[READY]`:

1. **Verify Diffs:** Review changes in each worker worktree:
   ```bash
   git -C "/path/to/worktree/auth-backend" diff main
   ```
2. **Run Integrated Tests:** Ensure the merged branch passes all unit and integration tests.
3. **Notify User:** Send a clean completion summary to Telegram:
   ```bash
   agent-notify send "Authentication refactored to JWT. All 42 tests passing across backend and frontend." --agent "Coordinator" --level success
   ```
4. **Archive & Clean Up:**
   ```bash
   # Archive the task channel
   agent-notify channel delete -C "$TASK_CODE"

   # Close worker worktrees
   orca worktree close name:auth-backend
   orca worktree close name:auth-frontend
   ```
