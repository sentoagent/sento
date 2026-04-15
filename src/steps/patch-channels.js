import fs from "fs";
import os from "os";
import path from "path";
import { log } from "../utils/logger.js";

function findPluginServerTs(pluginName) {
  const base = path.join(os.homedir(), ".claude/plugins");
  const files = [];

  const ext = path.join(base, `marketplaces/claude-plugins-official/external_plugins/${pluginName}/server.ts`);
  if (fs.existsSync(ext)) files.push(ext);

  const cacheDir = path.join(base, `cache/claude-plugins-official/${pluginName}`);
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

// ─── Discord patches ───

function patchDiscordFile(filePath) {
  let content = fs.readFileSync(filePath, "utf-8");
  let changed = false;

  // Guild-level group matching
  const guildTarget = "const policy = access.groups[channelId]";
  const guildReplacement = "const policy = access.groups[channelId] || (msg.guildId ? access.groups[msg.guildId] : undefined)";
  if (content.includes(guildTarget) && !content.includes("msg.guildId ? access.groups[msg.guildId]")) {
    content = content.replace(guildTarget, guildReplacement);
    changed = true;
  }

  // Guild-level reply allowlist
  const replyTarget = "if (key in access.groups) return ch";
  const replyReplacement = "if (key in access.groups || (ch.guildId && ch.guildId in access.groups)) return ch";
  if (content.includes(replyTarget) && !content.includes("ch.guildId && ch.guildId in access.groups")) {
    content = content.replace(replyTarget, replyReplacement);
    changed = true;
  }

  // Message buffer (30-90s delay)
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

  if (changed) fs.writeFileSync(filePath, content);
  return changed;
}

// ─── Telegram patches ───

function patchTelegramFile(filePath) {
  let content = fs.readFileSync(filePath, "utf-8");
  let changed = false;

  // Message buffer (30-90s delay) — same concept as Discord
  if (content.includes("bot.on('message:text'") && !content.includes("telegramBuffer")) {
    const oldHandler = `bot.on('message:text', async ctx => {
  await handleInbound(ctx, ctx.message.text, undefined)
})`;

    const newHandler = `// Message buffer - collects messages per chat, delays before forwarding to Claude
const telegramBuffer = new Map()

bot.on('message:text', async ctx => {
  const chatId = ctx.chat.id
  let buffer = telegramBuffer.get(chatId)

  if (!buffer) {
    buffer = { messages: [], timer: null }
    telegramBuffer.set(chatId, buffer)
  }

  buffer.messages.push({ ctx, text: ctx.message.text })

  if (!buffer.timer) {
    const delay = Math.floor(Math.random() * 61 + 30) * 1000
    process.stderr.write(\`telegram: buffering messages in \${chatId}, will process in \${Math.round(delay/1000)}s\\n\`)

    buffer.timer = setTimeout(async () => {
      const msgs = buffer.messages
      buffer.messages = []
      buffer.timer = null

      for (const m of msgs) {
        await handleInbound(m.ctx, m.text, undefined)
      }
    }, delay)
  }
})`;

    if (content.includes(oldHandler)) {
      content = content.replace(oldHandler, newHandler);
      changed = true;
    }
  }

  if (changed) fs.writeFileSync(filePath, content);
  return changed;
}

// ─── Main export ───

export async function patchChannels(config) {
  // Discord patches
  if (config.channelType === "discord" || config.patchAll) {
    log.step("Patching Discord plugin...");
    const discordFiles = findPluginServerTs("discord");
    if (discordFiles.length === 0) {
      log.warn("Discord plugin not found, skipping patch");
    } else {
      let count = 0;
      for (const f of discordFiles) { if (patchDiscordFile(f)) count++; }
      if (count > 0) log.success(`Patched ${count} Discord plugin file(s)`);
      else log.success("Discord plugin already patched");
    }
  }

  // Telegram patches
  if (config.channelType === "telegram" || config.patchAll) {
    log.step("Patching Telegram plugin...");
    const telegramFiles = findPluginServerTs("telegram");
    if (telegramFiles.length === 0) {
      log.warn("Telegram plugin not found, skipping patch");
    } else {
      let count = 0;
      for (const f of telegramFiles) { if (patchTelegramFile(f)) count++; }
      if (count > 0) log.success(`Patched ${count} Telegram plugin file(s)`);
      else log.success("Telegram plugin already patched");
    }
  }
}

// Backwards compat — old init.js imports patchDiscord
export const patchDiscord = patchChannels;
