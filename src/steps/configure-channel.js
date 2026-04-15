import fs from "fs";
import os from "os";
import path from "path";
import { log } from "../utils/logger.js";
import { renderAccessJson } from "../templates/access-json.js";

const TOKEN_VAR_NAMES = {
  discord: "DISCORD_BOT_TOKEN",
  telegram: "TELEGRAM_BOT_TOKEN",
  slack: "SLACK_BOT_TOKEN",
};

export async function configureChannel(config) {
  log.step(`Configuring ${config.channelType} channel...`);

  if (config.channelType === "imessage") {
    log.success("iMessage requires no additional config");
    return;
  }

  const channelDir = path.join(os.homedir(), ".claude", "channels", config.channelType);
  fs.mkdirSync(channelDir, { recursive: true });

  // Write bot token .env
  const tokenVar = TOKEN_VAR_NAMES[config.channelType];
  const envLines = [`${tokenVar}=${config.botToken}`];

  const envPath = path.join(channelDir, ".env");
  fs.writeFileSync(envPath, envLines.join("\n") + "\n");
  fs.chmodSync(envPath, 0o600);

  // Write access.json with owner pre-approved
  if (config.channelType === "discord") {
    const accessPath = path.join(channelDir, "access.json");
    fs.writeFileSync(accessPath, renderAccessJson({
      guildId: config.guildId,
      channelIds: config.channelIds,
    }));
  } else if (config.channelType === "telegram" && config.telegramChatId) {
    const accessPath = path.join(channelDir, "access.json");
    fs.writeFileSync(accessPath, JSON.stringify({
      dmPolicy: "allowlist",
      allowFrom: [config.telegramChatId],
      groups: {},
    }, null, 2));
  } else if (config.channelType === "slack" && config.slackChannelId) {
    const accessPath = path.join(channelDir, "access.json");
    fs.writeFileSync(accessPath, JSON.stringify({
      dmPolicy: "allowlist",
      allowFrom: [config.slackChannelId],
      groups: {},
    }, null, 2));
  }

  log.success(`${config.channelType} configured`);
}
