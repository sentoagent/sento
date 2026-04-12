export function renderAccessJson(config = {}) {
  const groups = {};

  if (config.guildId) {
    // Guild-level: use guild ID as key (requires plugin patch)
    groups[config.guildId] = { requireMention: false, allowFrom: [] };
  } else if (config.channelIds && config.channelIds.length > 0) {
    for (const id of config.channelIds) {
      groups[id] = { requireMention: false, allowFrom: [] };
    }
  }

  return JSON.stringify(
    {
      dmPolicy: "allowlist",
      allowFrom: [],
      groups,
      ackReaction: "\uD83D\uDC40",
      replyToMode: "message",
      textChunkLimit: 2000,
      chunkMode: "newline",
    },
    null,
    2
  );
}
