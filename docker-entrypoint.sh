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
mkdir -p "$HOME/.claude/projects/-home-sento-workspace"

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
# Generate CLAUDE.md using the full template (same as sento init)
if [ ! -f $HOME/workspace/CLAUDE.md ]; then
  ROLE="${AGENT_ROLE:-General-purpose assistant}"
  PERSONALITY="${AGENT_PERSONALITY:-Chill, helpful, keeps it real}"
  CREATOR="${AGENT_CREATOR:-the owner}"
  LANGUAGE="${AGENT_LANGUAGE:-English}"
  TIMEZONE="${AGENT_TIMEZONE:-America/New_York}"

  node -e "
    import('/opt/sento/src/templates/claude-md.js').then(m => {
      process.stdout.write(m.renderClaudeMd({
        agentName: '$AGENT_NAME',
        role: '$ROLE',
        personality: '$PERSONALITY',
        language: '$LANGUAGE',
        creatorName: '$CREATOR',
        timezone: '$TIMEZONE',
        channelType: '$(echo $CHANNEL_LIST | cut -d, -f1)',
      }));
    });
  " > $HOME/workspace/CLAUDE.md

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

# Generate workspace scripts if missing (first run)
if [ ! -f $HOME/workspace/start-agent.sh ]; then
  cat > $HOME/workspace/start-agent.sh << SCRIPT
#!/bin/bash
export PATH=$HOME/.npm-global/bin:$HOME/.bun/bin:/usr/local/bin:/usr/bin:/bin
export CLAUDE_CODE_OAUTH_TOKEN=$CLAUDE_TOKEN
export DISPLAY=:99
cd ~/workspace
while true; do
  claude --dangerously-skip-permissions $CHANNEL_FLAGS
  sleep 15
done
SCRIPT
  chmod 700 $HOME/workspace/start-agent.sh
fi

if [ ! -f $HOME/workspace/watchdog.sh ]; then
  cat > $HOME/workspace/watchdog.sh << 'WATCHDOG'
#!/bin/bash
SESSION=$(cat ~/workspace/.sento-config.json 2>/dev/null | python3 -c "import json,sys; print(json.load(sys.stdin).get('agentName','agent'))" 2>/dev/null || echo "agent")
if ! tmux has-session -t "$SESSION" 2>/dev/null; then
  echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) Watchdog: $SESSION not running. Restarting..." >> ~/workspace/memory/watchdog.log
  tmux new-session -d -s "$SESSION" ~/workspace/start-agent.sh
fi
WATCHDOG
  chmod 700 $HOME/workspace/watchdog.sh
fi

if [ ! -f $HOME/workspace/cron-trigger.sh ]; then
  cat > $HOME/workspace/cron-trigger.sh << 'CRON'
#!/bin/bash
SESSION="${1:-agent}"
MSG="${2:-hello}"
tmux send-keys -t "$SESSION" "$MSG" Enter 2>/dev/null
CRON
  chmod 700 $HOME/workspace/cron-trigger.sh
fi

if [ ! -f $HOME/workspace/.sento-config.json ]; then
  AGENT_CODE="SENTO-$(head -c 4 /dev/urandom | od -A n -t x1 | tr -d ' \n' | tr 'a-f' 'A-F' | head -c 8)"
  cat > $HOME/workspace/.sento-config.json << CONF
{
  "agentCode": "$AGENT_CODE",
  "agentName": "$AGENT_NAME",
  "channelType": "$(echo $CHANNEL_LIST | cut -d, -f1)",
  "pairedAgents": {},
  "commsPort": 9876
}
CONF
fi

# Set up cron (watchdog every 5 min + daily memory notes)
(crontab -l 2>/dev/null || echo ""; cat << CRONEOF
*/5 * * * * $HOME/workspace/watchdog.sh
55 3 * * * $HOME/workspace/cron-trigger.sh $AGENT_NAME "End of day. Write your daily notes to ~/workspace/memory/\$(date +\%Y-\%m-\%d).md. Include: key conversations, decisions made, tasks completed, anything worth remembering. Keep it concise. Then run: clawmem update"
CRONEOF
) | sort -u | crontab - 2>/dev/null || true

# Start cron daemon (needs sudo since cron runs as root)
sudo cron 2>/dev/null || true

# Start Guardian in background
node /opt/sento/bin/sento.js 2>/dev/null &

echo "Starting $AGENT_NAME (channels: $CHANNEL_LIST)..."

# Run Claude Code in tmux (needs a PTY to run interactively)
tmux new-session -d -s $AGENT_NAME "while true; do claude --dangerously-skip-permissions $CHANNEL_FLAGS; echo 'Agent exited. Restarting in 15s...'; sleep 15; done"

# Auto-accept the "trust this folder" prompt (first run only).
# Retry up to 30 seconds in case Claude Code is slow to start.
for i in $(seq 1 6); do
  sleep 5
  OUTPUT=$(tmux capture-pane -t $AGENT_NAME -p 2>/dev/null || true)
  if echo "$OUTPUT" | grep -q "trust this folder"; then
    tmux send-keys -t $AGENT_NAME Enter 2>/dev/null || true
    echo "Auto-accepted trust prompt"
    break
  fi
  if echo "$OUTPUT" | grep -q "Listening for channel"; then
    break  # Already past the prompt
  fi
done

# Keep container alive and tail the tmux output
while true; do
  sleep 30
  if ! tmux has-session -t $AGENT_NAME 2>/dev/null; then
    echo "Session died. Restarting..."
    tmux new-session -d -s $AGENT_NAME "while true; do claude --dangerously-skip-permissions $CHANNEL_FLAGS; sleep 15; done"
  fi
done
