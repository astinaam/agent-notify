#!/usr/bin/env bash
set -e

# ==============================================================================
# agent-notify updater for Linux & macOS
# Repository: https://github.com/astinaam/agent-notify
# ==============================================================================

# Determine repo directory
if [ -n "$AGENT_NOTIFY_DIR" ] && [ -e "$AGENT_NOTIFY_DIR/.git" ]; then
  INSTALL_DIR="$AGENT_NOTIFY_DIR"
elif [ -e "$HOME/.local/share/agent-notify/.git" ]; then
  INSTALL_DIR="$HOME/.local/share/agent-notify"
elif [ -e "$(dirname "$0")/.git" ]; then
  INSTALL_DIR="$(cd "$(dirname "$0")" && pwd)"
else
  echo -e "\033[0;31m✗ Could not locate agent-notify installation directory.\033[0m"
  echo -e "  Run the installer: curl -fsSL https://raw.githubusercontent.com/astinaam/agent-notify/main/install.sh | bash"
  exit 1
fi

BOLD='\033[1m'
GREEN='\033[0;32m'
CYAN='\033[0;36m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

echo -e "\n${BOLD}${CYAN}🔄 Updating agent-notify in $INSTALL_DIR...${NC}\n"

cd "$INSTALL_DIR"

# 1. Check if background daemon is running and stop it temporarily
WAS_RUNNING=0
if command -v agent-notify >/dev/null 2>&1; then
  if agent-notify daemon status 2>&1 | grep -q "RUNNING"; then
    echo -e "${CYAN}→ Stopping background daemon for update...${NC}"
    agent-notify daemon stop >/dev/null 2>&1 || true
    WAS_RUNNING=1
  fi
fi

# 2. Pull Latest Changes from Git
echo -e "${CYAN}→ Pulling latest updates from GitHub...${NC}"
git fetch --all --prune
git checkout main
git pull origin main

# 3. Install & Build
echo -e "${CYAN}→ Installing dependencies and rebuilding...${NC}"
npm install --silent
npm run build --silent

# 4. Refresh Binaries & Permissions
chmod +x "$INSTALL_DIR/dist/cli.js"
mkdir -p "$HOME/.local/bin"
ln -sf "$INSTALL_DIR/dist/cli.js" "$HOME/.local/bin/agent-notify"
npm link --silent >/dev/null 2>&1 || true

# 5. Update Skills
update_skill() {
  local skill_name="$1"
  local dest_dir="$2"
  local src=""
  if [ "$skill_name" = "agent-notify" ]; then
    src="$INSTALL_DIR/skills/SKILL.md"
  else
    src="$INSTALL_DIR/skills/${skill_name}/SKILL.md"
  fi
  if [ ! -f "$src" ]; then
    return 0
  fi
  mkdir -p "$dest_dir"
  cp "$src" "$dest_dir/SKILL.md"
  echo -e "${GREEN}✓ Updated $dest_dir/SKILL.md${NC}"
}

update_all_skills_into() {
  local base="$1"
  update_skill "agent-notify" "$base/agent-notify"
  update_skill "agent-channel" "$base/agent-channel"
  update_skill "orca-agent-swarm" "$base/orca-agent-swarm"
}

update_all_skills_into "$HOME/.agents/skills"

if [ -d "$HOME/.gemini" ]; then
  update_all_skills_into "$HOME/.gemini/config/skills"
fi

if [ -d "$HOME/.cursor" ]; then
  update_all_skills_into "$HOME/.cursor/skills"
  update_all_skills_into "$HOME/.cursor/skills-cursor"
fi

if [ -d "$HOME/.claude" ]; then
  update_all_skills_into "$HOME/.claude/skills"
fi

if [ -d "$HOME/.codex" ]; then
  update_all_skills_into "$HOME/.codex/skills"
fi

for agent_dir in "$HOME/.openclaw" "$HOME/.kilocode" "$HOME/.commandcode" "$HOME/.grok"; do
  if [ -d "$agent_dir" ]; then
    update_all_skills_into "$agent_dir/skills"
  fi
done

if [ -d "$HOME/.pi/agent" ]; then
  update_all_skills_into "$HOME/.pi/agent/skills"
fi

# 6. Restart Daemon if previously running
if [ "$WAS_RUNNING" -eq 1 ]; then
  echo -e "${CYAN}→ Restarting background daemon...${NC}"
  agent-notify daemon start >/dev/null 2>&1 || true
fi

LATEST_COMMIT=$(git log -1 --format="%h - %s (%cr)")

echo -e "\n${BOLD}${GREEN}✓ agent-notify updated successfully!${NC}"
echo -e "${BOLD}Current Version:${NC} $LATEST_COMMIT\n"
