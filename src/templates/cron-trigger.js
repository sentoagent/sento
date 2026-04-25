export function renderCronTrigger() {
  return `#!/bin/bash
# Sends a prompt into an agent's tmux session.
# Only used for infrastructure tasks now. Agent tasks use /loop.
# Usage: ./cron-trigger.sh <session-name> "Your message here"
SESSION=\${1:-"agent"}
MESSAGE="$2"

if [ -z "$MESSAGE" ]; then
  echo "Usage: ./cron-trigger.sh <session-name> \\"message\\""
  exit 1
fi

# Long prompts (>5 lines) get treated as a "paste" by Claude Code's TUI and
# need extra Enter presses to actually submit (Enter Enter alone is consumed
# as paste-content, not as submit). Short prompts submit cleanly with Enter
# Enter. Detect length and use the appropriate strategy.
LINES=$(printf '%s' "$MESSAGE" | wc -l)
if [ "$LINES" -gt 5 ]; then
  tmux send-keys -t "$SESSION" "$MESSAGE"
  sleep 0.5
  tmux send-keys -t "$SESSION" Enter
  sleep 0.5
  tmux send-keys -t "$SESSION" Enter
  sleep 0.5
  tmux send-keys -t "$SESSION" Enter
else
  tmux send-keys -t "$SESSION" "$MESSAGE" Enter Enter
fi
`;
}
