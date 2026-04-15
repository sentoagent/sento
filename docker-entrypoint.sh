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

# Multi-channel support: CHANNELS env var (comma-separated) takes priority,
# falls back to single CHANNEL_TYPE for backwards compat.
CHANNEL_TYPE="${CHANNEL_TYPE:-discord}"
if [ -n "$CHANNELS" ]; then
  CHANNEL_LIST="$CHANNELS"
else
  CHANNEL_LIST="$CHANNEL_TYPE"
fi

# Build --channels flags (all plugins from official marketplace)
build_channel_flags() {
  local flags=""
  IFS=',' read -ra PLATFORMS <<< "$1"
  for p in "${PLATFORMS[@]}"; do
    p=$(echo "$p" | xargs)  # trim whitespace
    flags="$flags --channels plugin:${p}@claude-plugins-official"
  done
  echo "$flags"
}
CHANNEL_FLAGS=$(build_channel_flags "$CHANNEL_LIST")

# Export tokens
export CLAUDE_CODE_OAUTH_TOKEN="$CLAUDE_TOKEN"
export DISPLAY=:99
export PATH="$HOME/.npm-global/bin:$HOME/.bun/bin:$PATH"

# Gemini (optional)
if [ -n "$GEMINI_KEY" ]; then
  export GEMINI_API_KEY="$GEMINI_KEY"
  export CLAWMEM_EMBED_URL="https://generativelanguage.googleapis.com/v1beta/openai"
  export CLAWMEM_EMBED_API_KEY="$GEMINI_KEY"
  export CLAWMEM_EMBED_MODEL="gemini-embedding-001"
fi

# Skip interactive prompts
cat > $HOME/.claude.json << EOF
{"hasCompletedOnboarding": true, "mcpServers": {"playwright": {"command": "npx", "args": ["@playwright/mcp"], "env": {"DISPLAY": ":99"}}}}
EOF

mkdir -p $HOME/.claude
cat > $HOME/.claude/settings.json << EOF
{"skipDangerousModePermissionPrompt": true, "trustedDirectories": ["$HOME/workspace"]}
EOF

# Pre-trust workspace
mkdir -p "$HOME/.claude/projects/--home--sento--workspace"

# Install plugins (first run only — cached in volume)
if [ ! -f $HOME/.claude/.plugins-installed ]; then
  echo "Installing plugins (first run)..."
  claude plugin marketplace add anthropics/claude-plugins-official 2>/dev/null || true
  claude plugin marketplace update claude-plugins-official 2>/dev/null || true
  for P in discord telegram slack imessage superpowers context7 code-review code-simplifier commit-commands feature-dev frontend-design hookify pr-review-toolkit security-guidance skill-creator claude-md-management typescript-lsp; do
    claude plugin install $P@claude-plugins-official 2>/dev/null || true
  done
  touch $HOME/.claude/.plugins-installed
  echo "Plugins installed."
fi

# Configure messaging channels
# Each platform reads from its own env var: BOT_TOKEN (Discord/fallback),
# DISCORD_BOT_TOKEN, TELEGRAM_BOT_TOKEN, SLACK_BOT_TOKEN
IFS=',' read -ra PLATFORMS_ARRAY <<< "$CHANNEL_LIST"
for PLAT in "${PLATFORMS_ARRAY[@]}"; do
  PLAT=$(echo "$PLAT" | xargs)
  mkdir -p $HOME/.claude/channels/$PLAT

  if [ "$PLAT" = "discord" ]; then
    DISC_TOKEN="${DISCORD_BOT_TOKEN:-$BOT_TOKEN}"
    if [ -n "$DISC_TOKEN" ]; then
      echo "DISCORD_BOT_TOKEN=$DISC_TOKEN" > $HOME/.claude/channels/discord/.env
      chmod 600 $HOME/.claude/channels/discord/.env
      if [ -n "$SERVER_ID" ]; then
        echo "{\"dmPolicy\":\"allowlist\",\"allowFrom\":[],\"groups\":{\"$SERVER_ID\":{\"requireMention\":false,\"allowFrom\":[]}},\"ackReaction\":\"👀\",\"replyToMode\":\"message\",\"textChunkLimit\":2000,\"chunkMode\":\"newline\"}" > $HOME/.claude/channels/discord/access.json
      elif [ -n "$CHANNEL_IDS" ]; then
        python3 -c "
import json
ids = '$CHANNEL_IDS'.split(',')
groups = {i.strip(): {'requireMention': False, 'allowFrom': []} for i in ids}
print(json.dumps({'dmPolicy': 'allowlist', 'allowFrom': [], 'groups': groups, 'ackReaction': '\uD83D\uDC40', 'replyToMode': 'message', 'textChunkLimit': 2000, 'chunkMode': 'newline'}))
" > $HOME/.claude/channels/discord/access.json
      fi
    fi
  elif [ "$PLAT" = "telegram" ]; then
    TELE_TOKEN="${TELEGRAM_BOT_TOKEN:-$BOT_TOKEN}"
    if [ -n "$TELE_TOKEN" ]; then
      echo "TELEGRAM_BOT_TOKEN=$TELE_TOKEN" > $HOME/.claude/channels/telegram/.env
      chmod 600 $HOME/.claude/channels/telegram/.env
    fi
  elif [ "$PLAT" = "slack" ]; then
    SLACK_TOKEN="${SLACK_BOT_TOKEN:-$BOT_TOKEN}"
    if [ -n "$SLACK_TOKEN" ]; then
      echo "SLACK_BOT_TOKEN=$SLACK_TOKEN" > $HOME/.claude/channels/slack/.env
      chmod 600 $HOME/.claude/channels/slack/.env
    fi
  elif [ "$PLAT" = "imessage" ]; then
    # iMessage needs no config.
    true
  fi
done

# Apply Discord patches (guild matching + message buffer)
if echo "$CHANNEL_LIST" | grep -q "discord"; then
  node /opt/sento/bin/sento.js doctor --fix 2>/dev/null || true
fi

# Generate CLAUDE.md if not exists (persisted via volume)
if [ ! -f $HOME/workspace/CLAUDE.md ]; then
  ROLE="${AGENT_ROLE:-General-purpose assistant}"
  PERSONALITY="${AGENT_PERSONALITY:-Chill, helpful, keeps it real}"
  CREATOR="${AGENT_CREATOR:-the owner}"
  LANGUAGE="${AGENT_LANGUAGE:-English}"
  TIMEZONE="${AGENT_TIMEZONE:-America/New_York}"

  cat > $HOME/workspace/CLAUDE.md << MDEOF
# $AGENT_NAME - AI Agent

## Identity
- Name: $AGENT_NAME
- Role: $ROLE
- Vibe: $PERSONALITY
- Language: $LANGUAGE
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

  echo "This file triggers the first-run onboarding. The agent will delete it after setup." > $HOME/workspace/FIRST_RUN.md
  echo "CLAUDE.md created for $AGENT_NAME"
fi

# Install ClawMem (first run only)
if [ ! -f $HOME/.bun/install/global/node_modules/clawmem/bin/clawmem ]; then
  echo "Installing ClawMem..."
  bun install -g clawmem 2>/dev/null || true
  clawmem bootstrap $HOME/workspace --name workspace 2>/dev/null || true
  clawmem setup hooks 2>/dev/null || true
  clawmem setup mcp 2>/dev/null || true
fi

# Start Guardian in background
node /opt/sento/bin/sento.js 2>/dev/null &

echo "Starting $AGENT_NAME (channels: $CHANNEL_LIST)..."

# Run Claude Code with all configured channels (restarts on crash)
while true; do
  claude --dangerously-skip-permissions $CHANNEL_FLAGS
  echo "Agent exited. Restarting in 15s..."
  sleep 15
done
