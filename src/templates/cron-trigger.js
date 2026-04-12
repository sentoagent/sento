export function renderCronTrigger() {
  return `#!/bin/bash
# Sends a prompt directly into an agent's tmux session.
# Usage: ./cron-trigger.sh <session-name> "Your message here"
SESSION=\${1:-"agent"}
MESSAGE="$2"

if [ -z "$MESSAGE" ]; then
  echo "Usage: ./cron-trigger.sh <session-name> \\"message\\""
  exit 1
fi

tmux send-keys -t "$SESSION" "$MESSAGE" Enter
`;
}
