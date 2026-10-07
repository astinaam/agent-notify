#!/usr/bin/env bash
set -e

# ==============================================================================
# agent-notify installer for Linux & macOS
# Repository: https://github.com/astinaam/agent-notify
# ==============================================================================

REPO_URL="https://github.com/astinaam/agent-notify.git"
# Determine repo directory
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd)"
if [ -n "$AGENT_NOTIFY_DIR" ] && [ -e "$AGENT_NOTIFY_DIR/.git" ]; then
  INSTALL_DIR="$AGENT_NOTIFY_DIR"
elif [ -e "$SCRIPT_DIR/.git" ] && [ -e "$SCRIPT_DIR/package.json" ]; then
  INSTALL_DIR="$SCRIPT_DIR"
elif [ -e "$HOME/.local/share/agent-notify/.git" ]; then
  INSTALL_DIR="$HOME/.local/share/agent-notify"
else
  INSTALL_DIR="${AGENT_NOTIFY_DIR:-$HOME/.local/share/agent-notify}"
fi
BIN_DIR="$HOME/.local/bin"

# Styling helpers
BOLD='\033[1m'
GREEN='\033[0;32m'
CYAN='\033[0;36m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

echo -e "\n${BOLD}${CYAN}📡 Installing agent-notify...${NC}\n"

# 1. Check Dependencies
check_dep() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo -e "${RED}✗ Error: '$1' is required but not installed.${NC}"
    echo -e "  Please install $1 and re-run this script."
    exit 1
  fi
}

check_dep "git"
check_dep "node"
check_dep "npm"

# Check Node.js version >= 18
NODE_VERSION=$(node -v | tr -d 'v' | cut -d. -f1)
if [ "$NODE_VERSION" -lt 18 ]; then
  echo -e "${RED}✗ Error: Node.js 18 or higher is required. Found v$(node -v).${NC}"
  echo -e "  Please upgrade Node.js and re-run this script."
  exit 1
fi

echo -e "${GREEN}✓ Prerequisites met: Node.js $(node -v), npm $(npm -v), git${NC}"

# 2. Clone or Update Repository
if [ "$INSTALL_DIR" = "$SCRIPT_DIR" ]; then
  echo -e "${CYAN}→ Using local repository at $INSTALL_DIR...${NC}"
  cd "$INSTALL_DIR"
elif [ -e "$INSTALL_DIR/.git" ]; then
  echo -e "${CYAN}→ Updating existing repository at $INSTALL_DIR...${NC}"
  cd "$INSTALL_DIR"
  git fetch --all --prune
  git checkout main
  git pull origin main
else
  echo -e "${CYAN}→ Cloning repository into $INSTALL_DIR...${NC}"
  mkdir -p "$(dirname "$INSTALL_DIR")"
  git clone "$REPO_URL" "$INSTALL_DIR"
  cd "$INSTALL_DIR"
fi

# 3. Install Dependencies & Build
echo -e "${CYAN}→ Installing dependencies and building bundles...${NC}"
npm install --silent
npm run build --silent

# 4. Configure Binary Symlink
mkdir -p "$BIN_DIR"
chmod +x "$INSTALL_DIR/dist/cli.js"

# Create symlink in ~/.local/bin
ln -sf "$INSTALL_DIR/dist/cli.js" "$BIN_DIR/agent-notify"

# Also try npm link for global package managers
npm link --silent >/dev/null 2>&1 || true

echo -e "${GREEN}✓ Binary linked to $BIN_DIR/agent-notify${NC}"

# 5. Install Agent Skills (Always in ~/.agents, and in all active agent harnesses)
echo -e "${CYAN}→ Installing AI agent skills...${NC}"

install_skill() {
  local skill_name="$1"
  local dest_dir="$2"
  local src=""
  if [ "$skill_name" = "agent-notify" ]; then
    src="$INSTALL_DIR/skills/SKILL.md"
  else
    src="$INSTALL_DIR/skills/${skill_name}/SKILL.md"
  fi
  if [ ! -f "$src" ]; then
    echo -e "${YELLOW}⚠ Skill source missing: $src${NC}"
    return 0
  fi
  mkdir -p "$dest_dir"
  cp "$src" "$dest_dir/SKILL.md"
  echo -e "${GREEN}✓ Installed skill into $dest_dir/SKILL.md${NC}"
}

install_all_skills_into() {
  local base="$1"
  install_skill "agent-notify" "$base/agent-notify"
  install_skill "agent-channel" "$base/agent-channel"
}

# 1. Always install into global ~/.agents
install_all_skills_into "$HOME/.agents/skills"

# 2. If .gemini exists, install into Gemini / Antigravity global skill directory
if [ -d "$HOME/.gemini" ]; then
  install_all_skills_into "$HOME/.gemini/config/skills"
fi

# 3. If .cursor exists, install into Cursor global skill directories
if [ -d "$HOME/.cursor" ]; then
  install_all_skills_into "$HOME/.cursor/skills"
  install_all_skills_into "$HOME/.cursor/skills-cursor"
fi

# 4. If .claude exists, install into Claude global skill directory
if [ -d "$HOME/.claude" ]; then
  install_all_skills_into "$HOME/.claude/skills"
fi

# 5. If .codex exists, install into Codex global skill directory
if [ -d "$HOME/.codex" ]; then
  install_all_skills_into "$HOME/.codex/skills"
fi

# 6. Other agent harnesses if present
for agent_dir in "$HOME/.openclaw" "$HOME/.kilocode" "$HOME/.commandcode" "$HOME/.grok"; do
  if [ -d "$agent_dir" ]; then
    install_all_skills_into "$agent_dir/skills"
  fi
done

if [ -d "$HOME/.pi/agent" ]; then
  install_all_skills_into "$HOME/.pi/agent/skills"
fi

# 6. Check PATH
case ":$PATH:" in
  *":$BIN_DIR:"*) ;;
  *)
    echo -e "\n${YELLOW}⚠️  Note: $BIN_DIR is not currently in your \$PATH.${NC}"
    echo -e "   Add the following line to your ~/.bashrc or ~/.zshrc:"
    echo -e "   ${BOLD}export PATH=\"\$HOME/.local/bin:\$PATH\"${NC}"
    ;;
esac

# 7. Optional Firewall prompt (Linux UFW)
if command -v ufw >/dev/null 2>&1 && sudo -n true 2>/dev/null; then
  sudo ufw allow 4173/tcp comment 'agent-notify Web Dashboard' >/dev/null 2>&1 || true
fi

echo -e "\n${BOLD}${GREEN}🎉 agent-notify installed successfully!${NC}\n"
echo -e "${BOLD}Next Steps:${NC}"
echo -e "  1. Configure your Telegram Bot & Chat ID:"
echo -e "     ${CYAN}agent-notify setup${NC}\n"
echo -e "  2. Test sending your first notification:"
echo -e "     ${CYAN}agent-notify send \"Hello from AI!\" --agent \"Antigravity\" --level success${NC}\n"
echo -e "  3. Optional System Resource Alert Monitor:"
echo -e "     ${CYAN}agent-notify monitor status${NC}"
echo -e "     ${CYAN}agent-notify monitor enable${NC}\n"
echo -e "  4. Start / view Web Dashboard:"
echo -e "     ${CYAN}agent-notify links${NC}\n"
