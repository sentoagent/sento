export function renderCronTrigger() {
  return `#!/bin/bash
# Smart cron trigger: sends to agent if idle, queues if busy.
# Guardian drains the queue when agent goes idle.
# Usage: ./cron-trigger.sh <session-name> "Your message here"
SESSION=\${1:-"agent"}
MESSAGE="$2"
QUEUE="$HOME/workspace/.cron-queue"
CRONLOG="$HOME/workspace/memory/cron.log"

if [ -z "$MESSAGE" ]; then
  echo "Usage: ./cron-trigger.sh <session-name> \\"message\\""
  exit 1
fi

# Lockfile: only one cron can run at a time. Skip if another is waiting.
LOCKFILE="/tmp/sento-cron-\${SESSION}.lock"
exec 200>"$LOCKFILE"
flock -n 200 || {
  echo "\$(date): Skipped (another cron active): \${MESSAGE:0:80}..." >> "$CRONLOG" 2>/dev/null
  exit 0
}

# Add [CRON] prefix for hook detection
TAGGED="[CRON] $MESSAGE"

# Check if agent is idle or busy
OUTPUT=\$(tmux capture-pane -t "$SESSION" -p 2>/dev/null | tail -5)
IS_BUSY=false

if echo "$OUTPUT" | grep -q "esc to interrupt"; then
  IS_BUSY=true
elif echo "$OUTPUT" | grep -qE "Crunching|Pondering|Baked|Brewing|Cooking|Swooping|Accomplishing|Philosophising|Concocting|thinking"; then
  IS_BUSY=true
fi

if [ "$IS_BUSY" = "true" ]; then
  # Agent is busy — queue for Guardian to deliver when idle
  echo "$TAGGED" >> "$QUEUE"
  echo "\$(date): Queued (busy): \${MESSAGE:0:80}..." >> "$CRONLOG" 2>/dev/null
else
  # Agent is idle — send directly
  tmux send-keys -t "$SESSION" "$TAGGED" Enter
  echo "\$(date): Sent: \${MESSAGE:0:80}..." >> "$CRONLOG" 2>/dev/null
fi
`;
}
