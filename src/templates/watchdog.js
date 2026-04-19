export function renderWatchdog(config) {
  return `#!/bin/bash
# Sentō Watchdog — Auto-recovery for stuck agents
# Runs via cron every 5 minutes. Zero tokens. Pure bash.
# Only acts when messages are received but not answered.

SESSION="${config.agentName}"
STATE_FILE="/tmp/sento-watchdog-\${SESSION}.state"
RESTART_LOG="/tmp/sento-watchdog-\${SESSION}.restarts"
LOG="\$HOME/workspace/memory/watchdog.log"

# ─── Guardian health check ───
# If Guardian is not running, relaunch it (may have exited after auto-update)
if ! pgrep -u "$(whoami)" -f "guardian.mjs" > /dev/null 2>&1; then
  echo "$(date): Guardian not running. Relaunching..." >> "\$LOG"
  cd "\$HOME/workspace" && nohup node guardian.mjs >> memory/guardian.log 2>&1 &
fi

# ─── Capture tmux output ───
OUTPUT=$(tmux capture-pane -t "\$SESSION" -p -S -30 2>/dev/null)
if [ -z "\$OUTPUT" ]; then
  exit 0
fi

# ─── Count signals ───
INCOMING=$(echo "\$OUTPUT" | grep -c "← discord\\|← telegram\\|← slack\\|← imessage")
REPLIES=$(echo "\$OUTPUT" | grep -c "discord - reply\\|telegram.*reply\\|slack.*reply")
ERRORS=$(echo "\$OUTPUT" | grep -c "API Error:\\|error.*Overloaded\\|Could not process")
WORKING=$(echo "\$OUTPUT" | grep -c "Crunching\\|Pondering\\|Baked\\|Bash(\\|Read(\\|Edit(\\|Write(\\|Web Search\\|WebFetch\\|esc to interrupt")

# ─── Decision logic ───

# Nobody talking → nothing to do
if [ "\$INCOMING" -eq 0 ]; then
  rm -f "\$STATE_FILE"
  exit 0
fi

# Agent has replies → healthy
if [ "\$REPLIES" -gt 0 ]; then
  rm -f "\$STATE_FILE"
  exit 0
fi

# Agent is actively working → give it time
if [ "\$WORKING" -gt 0 ]; then
  echo "working" > "\$STATE_FILE"
  exit 0
fi

# Messages in, no replies, no work activity — check for errors
if [ "\$ERRORS" -gt 1 ]; then
  # Check previous state
  PREV=""
  if [ -f "\$STATE_FILE" ]; then
    PREV=$(cat "\$STATE_FILE")
  fi

  if [ "\$PREV" = "flagged" ]; then
    # ─── STUCK: Second consecutive flag → restart ───

    # Check restart count (exponential backoff)
    RESTART_COUNT=0
    if [ -f "\$RESTART_LOG" ]; then
      # Count restarts in last 30 minutes
      CUTOFF=$(date -d '30 minutes ago' +%s 2>/dev/null || date -v-30M +%s 2>/dev/null)
      RESTART_COUNT=$(awk -v cutoff="\$CUTOFF" '\$1 > cutoff' "\$RESTART_LOG" 2>/dev/null | wc -l | tr -d ' ')
    fi

    if [ "\$RESTART_COUNT" -ge 3 ]; then
      # Too many restarts — notify owner, stop trying
      echo "\$(date +%s) GAVE_UP" >> "\$RESTART_LOG"
      echo "\$(date): \$SESSION - 3 restarts in 30min, giving up. Manual intervention needed." >> "\$LOG"
      rm -f "\$STATE_FILE"
      ${config.discordWebhook ? `
      # Notify owner via Discord webhook
      curl -s -X POST "${config.discordWebhook}" \\
        -H "Content-Type: application/json" \\
        -d '{"content":"⚠️ Agent **'\$SESSION'** is stuck and auto-restart failed 3 times. Check manually: \`tmux attach -t '\$SESSION'\`"}' > /dev/null 2>&1
      ` : '# No Discord webhook configured for notifications'}
      exit 0
    fi

    # Save state before restart
    tmux capture-pane -t "\$SESSION" -p -S -50 > "\$HOME/workspace/memory/watchdog-restart-\$(date +%Y%m%d-%H%M%S).log" 2>/dev/null

    # Restart
    echo "\$(date +%s) RESTART" >> "\$RESTART_LOG"
    echo "\$(date): \$SESSION - Stuck detected (msgs:\$INCOMING replies:\$REPLIES errors:\$ERRORS). Restarting." >> "\$LOG"
    tmux kill-session -t "\$SESSION" 2>/dev/null
    sleep 5
    tmux new-session -d -s "\$SESSION" "\$HOME/workspace/start-agent.sh"

    # Verify recovery after 30 seconds
    sleep 30
    VERIFY=$(tmux capture-pane -t "\$SESSION" -p 2>/dev/null | grep -c "Listening for channel messages")
    if [ "\$VERIFY" -gt 0 ]; then
      echo "\$(date): \$SESSION - Restart successful, agent recovered." >> "\$LOG"
    else
      echo "\$(date): \$SESSION - Restart completed but agent may not have recovered." >> "\$LOG"
    fi

    rm -f "\$STATE_FILE"
  else
    # First flag — mark and wait for next check
    echo "flagged" > "\$STATE_FILE"
  fi
fi

# Clean restart log (keep last 20 entries)
if [ -f "\$RESTART_LOG" ]; then
  tail -20 "\$RESTART_LOG" > "\$RESTART_LOG.tmp" && mv "\$RESTART_LOG.tmp" "\$RESTART_LOG"
fi
`;
}
