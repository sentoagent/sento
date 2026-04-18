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
cd ~/workspace
while true; do
  claude --dangerously-skip-permissions --model ${config.model || "sonnet"} --channels ${channelPlugin}
  sleep 15
done
`;
}
