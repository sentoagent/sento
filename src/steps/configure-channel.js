import fs from "fs";
import os from "os";
import path from "path";
import { log } from "../utils/logger.js";
import { renderAccessJson } from "../templates/access-json.js";

const TOKEN_VAR_NAMES = {
  discord: "DISCORD_BOT_TOKEN",
  telegram: "TELEGRAM_BOT_TOKEN",
  slack: "SLACK_BOT_TOKEN",
  line: "LINE_CHANNEL_TOKEN",
  // whatsapp uses Baileys creds.json instead of an env token — no entry here
};

export async function configureChannel(config) {
  log.step(`Configuring ${config.channelType} channel...`);

  if (config.channelType === "imessage") {
    log.success("iMessage requires no additional config");
    return;
  }

  if (config.channelType === "whatsapp") {
    // WhatsApp doesn't take a bot token at install time. Auth happens at
    // first run via QR or pairing code. Just create the state dir; the
    // plugin server will populate creds.json + access.json on first launch.
    const channelDir = path.join(os.homedir(), ".claude", "channels", "whatsapp");
    fs.mkdirSync(channelDir, { recursive: true });
    log.success("whatsapp state dir ready (auth happens at first launch)");
    return;
  }

  const channelDir = path.join(os.homedir(), ".claude", "channels", config.channelType);
  fs.mkdirSync(channelDir, { recursive: true });

  // Write bot token .env
  const tokenVar = TOKEN_VAR_NAMES[config.channelType];
  const envLines = [`${tokenVar}=${config.botToken}`];

  // LINE needs both the channel access token AND the channel secret
  if (config.channelType === "line" && config.lineChannelSecret) {
    envLines.push(`LINE_CHANNEL_SECRET=${config.lineChannelSecret}`);
  }

  const envPath = path.join(channelDir, ".env");
  fs.writeFileSync(envPath, envLines.join("\n") + "\n");
  fs.chmodSync(envPath, 0o600);

  // Discord-specific: write access.json
  if (config.channelType === "discord") {
    const accessPath = path.join(channelDir, "access.json");
    fs.writeFileSync(accessPath, renderAccessJson({
      guildId: config.guildId,
      channelIds: config.channelIds,
    }));
  }

  log.success(`${config.channelType} configured`);
}
