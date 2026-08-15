#!/usr/bin/env bash
set -e

# ==============================================================================
# agent-notify installer for Linux & macOS
# Repository: https://github.com/astinaam/agent-notify
# ==============================================================================

REPO_URL="https://github.com/astinaam/agent-notify.git"
INSTALL_DIR="${AGENT_NOTIFY_DIR:-$HOME/.local/share/agent-notify}"
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

echo -e "${GREEN}✓ Prerequisites met: Node.js $(node -v), npm $(npm -v), git$(NC)"

# 2. Clone or Update Repository
if [ -e "$INSTALL_DIR/.git" ]; then
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

# 5. Install Agent Skills (Always in ~/.agents, and in ~/.gemini & ~/.cursor if available)
echo -e "${CYAN}→ Installing AI agent skills...${NC}"

# 1. Always install into global ~/.agents
mkdir -p "$HOME/.agents/skills/agent-notify"
cp "$INSTALL_DIR/skills/SKILL.md" "$HOME/.agents/skills/agent-notify/SKILL.md"
echo -e "${GREEN}✓ Installed skill into ~/.agents/skills/agent-notify/SKILL.md${NC}"

# 2. If .gemini exists, install into Gemini / Antigravity global skill directory
if [ -d "$HOME/.gemini" ]; then
  mkdir -p "$HOME/.gemini/config/skills/agent-notify"
  cp "$INSTALL_DIR/skills/SKILL.md" "$HOME/.gemini/config/skills/agent-notify/SKILL.md"
  echo -e "${GREEN}✓ Installed skill into ~/.gemini/config/skills/agent-notify/SKILL.md${NC}"
fi

# 3. If .cursor exists, install into Cursor global skill directory
if [ -d "$HOME/.cursor" ]; then
  mkdir -p "$HOME/.cursor/skills/agent-notify"
  cp "$INSTALL_DIR/skills/SKILL.md" "$HOME/.cursor/skills/agent-notify/SKILL.md"
  echo -e "${GREEN}✓ Installed skill into ~/.cursor/skills/agent-notify/SKILL.md${NC}"
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
