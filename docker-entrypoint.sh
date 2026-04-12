#!/bin/bash
set -e

# Required env vars
if [ -z "$CLAUDE_TOKEN" ]; then
  echo "Error: CLAUDE_TOKEN is required"
  echo "Usage: docker run -e CLAUDE_TOKEN=sk-ant-oat01-... sento/agent"
  exit 1
fi

if [ -z "$AGENT_NAME" ]; then
  AGENT_NAME="agent"
fi

CHANNEL_TYPE="${CHANNEL_TYPE:-discord}"
CHANNEL_PLUGIN="plugin:${CHANNEL_TYPE}@claude-plugins-official"

# Export tokens
export CLAUDE_CODE_OAUTH_TOKEN="$CLAUDE_TOKEN"
export DISPLAY=:99
export PATH="/root/.npm-global/bin:/root/.bun/bin:$PATH"

# Gemini (optional)
if [ -n "$GEMINI_KEY" ]; then
  export GEMINI_API_KEY="$GEMINI_KEY"
  export CLAWMEM_EMBED_URL="https://generativelanguage.googleapis.com/v1beta/openai"
  export CLAWMEM_EMBED_API_KEY="$GEMINI_KEY"
  export CLAWMEM_EMBED_MODEL="gemini-embedding-001"
fi

# Skip interactive prompts
cat > /root/.claude.json << EOF
{"hasCompletedOnboarding": true, "mcpServers": {"playwright": {"command": "npx", "args": ["@playwright/mcp"], "env": {"DISPLAY": ":99"}}}}
EOF

mkdir -p /root/.claude
cat > /root/.claude/settings.json << EOF
{"skipDangerousModePermissionPrompt": true}
EOF

# Pre-trust workspace
mkdir -p /root/.claude/projects/-root-workspace

# Install plugins (first run only — cached in volume)
if [ ! -f /root/.claude/.plugins-installed ]; then
  echo "Installing plugins (first run)..."
  claude plugin marketplace add anthropics/claude-plugins-official 2>/dev/null || true
  claude plugin marketplace update claude-plugins-official 2>/dev/null || true
  for P in discord telegram slack imessage superpowers context7 code-review code-simplifier commit-commands feature-dev frontend-design hookify pr-review-toolkit security-guidance skill-creator claude-md-management typescript-lsp; do
    claude plugin install $P@claude-plugins-official 2>/dev/null || true
  done
  touch /root/.claude/.plugins-installed
  echo "Plugins installed."
fi

# Configure messaging channel
if [ -n "$BOT_TOKEN" ]; then
  mkdir -p /root/.claude/channels/$CHANNEL_TYPE

  if [ "$CHANNEL_TYPE" = "discord" ]; then
    echo "DISCORD_BOT_TOKEN=$BOT_TOKEN" > /root/.claude/channels/discord/.env

    # Build access.json
    if [ -n "$SERVER_ID" ]; then
      echo "{\"dmPolicy\":\"allowlist\",\"allowFrom\":[],\"groups\":{\"$SERVER_ID\":{\"requireMention\":false,\"allowFrom\":[]}},\"ackReaction\":\"👀\",\"replyToMode\":\"message\",\"textChunkLimit\":2000,\"chunkMode\":\"newline\"}" > /root/.claude/channels/discord/access.json
    elif [ -n "$CHANNEL_IDS" ]; then
      python3 -c "
import json
ids = '$CHANNEL_IDS'.split(',')
groups = {i.strip(): {'requireMention': False, 'allowFrom': []} for i in ids}
print(json.dumps({'dmPolicy': 'allowlist', 'allowFrom': [], 'groups': groups, 'ackReaction': '\uD83D\uDC40', 'replyToMode': 'message', 'textChunkLimit': 2000, 'chunkMode': 'newline'}))
" > /root/.claude/channels/discord/access.json
    fi
  elif [ "$CHANNEL_TYPE" = "telegram" ]; then
    echo "TELEGRAM_BOT_TOKEN=$BOT_TOKEN" > /root/.claude/channels/telegram/.env
  elif [ "$CHANNEL_TYPE" = "slack" ]; then
    echo "SLACK_BOT_TOKEN=$BOT_TOKEN" > /root/.claude/channels/slack/.env
  fi

  chmod 600 /root/.claude/channels/$CHANNEL_TYPE/.env
fi

# Apply Discord patches (guild matching + message buffer)
if [ "$CHANNEL_TYPE" = "discord" ]; then
  node /opt/sento/bin/sento.js doctor --fix 2>/dev/null || true
fi

# Generate CLAUDE.md if not exists (persisted via volume)
if [ ! -f /root/workspace/CLAUDE.md ]; then
  ROLE="${AGENT_ROLE:-General-purpose assistant}"
  PERSONALITY="${AGENT_PERSONALITY:-Chill, helpful, keeps it real}"
  CREATOR="${AGENT_CREATOR:-the owner}"
  TIMEZONE="${AGENT_TIMEZONE:-America/New_York}"

  cat > /root/workspace/CLAUDE.md << MDEOF
# $AGENT_NAME - AI Agent

## Identity
- Name: $AGENT_NAME
- Role: $ROLE
- Vibe: $PERSONALITY
- Creator: $CREATOR

## The Law
NEVER take action on external APIs without explicit approval from $CREATOR.

## Permission Rules
- Freely: read/write files, git, web search, local commands
- Ask first: any API call that modifies external systems

## Response Timing
The Discord plugin buffers messages for 30-90 seconds before you see them. Just respond naturally. Do NOT add any sleep or delay.

## Timezone
- $CREATOR is in $TIMEZONE
- Always show times in their local timezone

## Self-Management
- You can modify your own CLAUDE.md, memory files, and config
MDEOF

  echo "This file triggers the first-run onboarding. The agent will delete it after setup." > /root/workspace/FIRST_RUN.md
  echo "CLAUDE.md created for $AGENT_NAME"
fi

# Install ClawMem (first run only)
if [ ! -f /root/.bun/install/global/node_modules/clawmem/bin/clawmem ]; then
  echo "Installing ClawMem..."
  bun install -g clawmem 2>/dev/null || true
  clawmem bootstrap /root/workspace --name workspace 2>/dev/null || true
  clawmem setup hooks 2>/dev/null || true
  clawmem setup mcp 2>/dev/null || true
fi

# Start Guardian in background
node /opt/sento/bin/sento.js 2>/dev/null &

echo "Starting $AGENT_NAME ($CHANNEL_TYPE)..."

# Run Claude Code (restarts on crash)
while true; do
  claude --dangerously-skip-permissions --channels $CHANNEL_PLUGIN
  echo "Agent exited. Restarting in 15s..."
  sleep 15
done
