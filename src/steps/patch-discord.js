import fs from "fs";
import os from "os";
import path from "path";
import { log } from "../utils/logger.js";


function findServerTsFiles() {
  const base = path.join(os.homedir(), ".claude/plugins");
  const files = [];

  // external_plugins version
  const ext = path.join(base, "marketplaces/claude-plugins-official/external_plugins/discord/server.ts");
  if (fs.existsSync(ext)) files.push(ext);

  // cache versions (e.g. cache/claude-plugins-official/discord/0.0.4/server.ts)
  const cacheDir = path.join(base, "cache/claude-plugins-official/discord");
  if (fs.existsSync(cacheDir)) {
    try {
      for (const ver of fs.readdirSync(cacheDir)) {
        const cached = path.join(cacheDir, ver, "server.ts");
        if (fs.existsSync(cached)) files.push(cached);
      }
    } catch {}
  }

  return files;
}

function patchFile(filePath) {
  let content = fs.readFileSync(filePath, "utf-8");
  let changed = false;

  // Patch 1: Guild-level group matching
  const guildTarget = "const policy = access.groups[channelId]";
  const guildReplacement = "const policy = access.groups[channelId] || (msg.guildId ? access.groups[msg.guildId] : undefined)";

  if (content.includes(guildTarget) && !content.includes("msg.guildId ? access.groups[msg.guildId]")) {
    content = content.replace(guildTarget, guildReplacement);
    changed = true;
  }

  // Patch 1b: Guild-level reply allowlist (outbound gate)
  const replyTarget = "if (key in access.groups) return ch";
  const replyReplacement = "if (key in access.groups || (ch.guildId && ch.guildId in access.groups)) return ch";

  if (content.includes(replyTarget) && !content.includes("ch.guildId && ch.guildId in access.groups")) {
    content = content.replace(replyTarget, replyReplacement);
    changed = true;
  }

  // Patch 2: Message buffer (30-90 second delay)
  if (content.includes("client.on('messageCreate'") && !content.includes("messageBuffer")) {
    const oldHandler = `client.on('messageCreate', msg => {
  if (msg.author.bot) return
  handleInbound(msg).catch(e => process.stderr.write(\`discord: handleInbound failed: \${e}\\n\`))
})`;

    const newHandler = `// Message buffer - collects messages per channel, delays before forwarding to Claude
const messageBuffer = new Map()

client.on('messageCreate', msg => {
  if (msg.author.bot) return

  const channelId = msg.channelId
  let buffer = messageBuffer.get(channelId)

  if (!buffer) {
    buffer = { messages: [], timer: null }
    messageBuffer.set(channelId, buffer)
  }

  buffer.messages.push(msg)

  if (!buffer.timer) {
    const delay = Math.floor(Math.random() * 61 + 30) * 1000
    process.stderr.write(\`discord: buffering messages in \${channelId}, will process in \${Math.round(delay/1000)}s\\n\`)

    buffer.timer = setTimeout(async () => {
      const msgs = buffer.messages
      buffer.messages = []
      buffer.timer = null

      for (const m of msgs) {
        await handleInbound(m).catch(e =>
          process.stderr.write(\`discord: handleInbound failed: \${e}\\n\`)
        )
      }
    }, delay)
  }
})`;

    if (content.includes(oldHandler)) {
      content = content.replace(oldHandler, newHandler);
      changed = true;
    }
  }

  if (changed) {
    fs.writeFileSync(filePath, content);
  }
  return changed;
}

export async function patchDiscord(config) {
  if (config.channelType !== "discord") return;

  log.step("Patching Discord plugin...");

  const files = findServerTsFiles();
  if (files.length === 0) {
    log.warn("Discord plugin server.ts not found, skipping patch");
    return;
  }

  let patchedCount = 0;
  for (const file of files) {
    if (patchFile(file)) patchedCount++;
  }

  if (patchedCount > 0) {
    log.success(`Patched ${patchedCount} plugin file(s): guild matching + message buffer`);
  } else {
    log.success("Discord plugin already patched");
  }
}
