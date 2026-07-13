export function renderStartAgent(config) {
  const channelPlugin = `plugin:${config.channelType}@claude-plugins-official`;

  const envLines = [
    `export PATH=$HOME/.npm-global/bin:$HOME/.bun/bin:/usr/local/bin:/usr/bin:/bin`,
    `export CLAUDE_CODE_OAUTH_TOKEN=${config.oauthToken}`,
    `export DISPLAY=:99`,
  ];

  if (config.geminiKey) {
    envLines.push(
      `export GEMINI_API_KEY=${config.geminiKey}`,
      `export CLAWMEM_EMBED_URL=https://generativelanguage.googleapis.com/v1beta/openai`,
      `export CLAWMEM_EMBED_API_KEY=${config.geminiKey}`,
      `export CLAWMEM_EMBED_MODEL=gemini-embedding-001`
    );
  }

  return `#!/bin/bash
${envLines.join("\n")}

# ── Repair relative \`bun\` in channel plugin .mcp.json BEFORE launching claude ──
# The official channel plugins ship "command": "bun", which does not reliably resolve at
# MCP spawn time. When it fails, the bridge never starts and the agent comes up ALIVE,
# HEALTHY, AND COMPLETELY MUTE — it reasons fine, logs no error, and cannot send or
# receive a single message. A host reboot once did this to an entire 10-agent fleet at
# once; nobody noticed until a human said "they're offline".
#
# We repair on EVERY start, not once: the fix lives in the plugin CACHE, so any plugin
# update rewrites the file and the relative path comes straight back. Prevention here
# (zero mute window); the watchdog's bridge guard is the backstop if this ever misses.
for M in "$HOME"/.claude/plugins/cache/*/*/*/.mcp.json; do
  [ -f "$M" ] || continue
  grep -q '"command": *"bun"' "$M" 2>/dev/null && \\
    sed -i "s|\\"command\\": *\\"bun\\"|\\"command\\": \\"$HOME/.bun/bin/bun\\"|g" "$M"
done

cd ~/workspace
while true; do
  claude --dangerously-skip-permissions --model ${config.model || "sonnet"} --channels ${channelPlugin}
  sleep 15
done
`;
}
