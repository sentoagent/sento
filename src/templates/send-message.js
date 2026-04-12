export function renderSendMessage() {
  return `#!/bin/bash
# Sentō Agent-to-Agent Message Sender
# Usage: ./send-message.sh <agent-name> "your message"

AGENT_NAME="\$1"
MESSAGE="\$2"
CONFIG="\$HOME/workspace/.sento-config.json"

if [ -z "\$AGENT_NAME" ] || [ -z "\$MESSAGE" ]; then
  echo "Usage: ./send-message.sh <agent-name> \\"message\\""
  exit 1
fi

# Read paired agent info from config
HOST=\$(python3 -c "
import json, sys
try:
    c = json.load(open('\$CONFIG'))
    a = c.get('pairedAgents', {}).get('\$AGENT_NAME', {})
    print(a.get('host', ''))
except:
    pass
")
PORT=\$(python3 -c "
import json, sys
try:
    c = json.load(open('\$CONFIG'))
    a = c.get('pairedAgents', {}).get('\$AGENT_NAME', {})
    print(a.get('port', '9876'))
except:
    print('9876')
")
SECRET=\$(python3 -c "
import json, sys
try:
    c = json.load(open('\$CONFIG'))
    a = c.get('pairedAgents', {}).get('\$AGENT_NAME', {})
    print(a.get('secret', ''))
except:
    pass
")
FROM=\$(python3 -c "
import json
try:
    c = json.load(open('\$CONFIG'))
    print(c.get('agentName', 'unknown'))
except:
    print('unknown')
")

if [ -z "\$HOST" ] || [ -z "\$SECRET" ]; then
  echo "Agent '\$AGENT_NAME' is not paired. Run: sento pair"
  exit 1
fi

# Build JSON payload
BODY="{\\"from\\":\\"\$FROM\\",\\"to\\":\\"\$AGENT_NAME\\",\\"message\\":\\"\$MESSAGE\\",\\"timestamp\\":\\"\$(date -Iseconds)\\"}"

# Sign with HMAC-SHA256
SIGNATURE=\$(echo -n "\$BODY" | openssl dgst -sha256 -hmac "\$SECRET" | awk '{print \$NF}')

# Send
curl -s -X POST "http://\$HOST:\$PORT/message" \\
  -H "Content-Type: application/json" \\
  -H "X-Sento-Signature: \$SIGNATURE" \\
  -d "\$BODY"

echo ""
`;
}
