import fs from "fs";
import os from "os";
import path from "path";
import chalk from "chalk";
import { log } from "../utils/logger.js";
import { renderAccessJson } from "../templates/access-json.js";

const LINE_DEFAULT_PORT = 8765;

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

  // LINE needs the channel secret (for webhook signature validation) AND
  // a webhook port. Default port is 8765 unless the user sets it explicitly.
  if (config.channelType === "line") {
    if (config.lineChannelSecret) {
      envLines.push(`LINE_CHANNEL_SECRET=${config.lineChannelSecret}`);
    }
    envLines.push(`LINE_WEBHOOK_PORT=${LINE_DEFAULT_PORT}`);
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

  // LINE has a critical follow-up step the user has to do manually: paste
  // the webhook URL into the LINE Messaging API console. Print it loudly
  // so it doesn't get lost in scrollback.
  if (config.channelType === "line") {
    const banner = chalk.bold.yellow;
    const url = chalk.underline(
      `https://<your-public-host>/line/webhook`
    );
    console.log("");
    console.log(banner("  ┌──────────────────────────────────────────────┐"));
    console.log(banner("  │  Final manual step: set your LINE webhook    │"));
    console.log(banner("  └──────────────────────────────────────────────┘"));
    console.log(
      `  1. Open ${chalk.cyan("https://developers.line.biz")} → your provider → your channel`
    );
    console.log(`  2. Messaging API tab → Webhook settings → ${chalk.bold("Edit")}`);
    console.log(`  3. Paste:  ${url}`);
    console.log(
      `     ${chalk.dim(
        `(replace <your-public-host> with your VPS domain — Sentō listens on port ${LINE_DEFAULT_PORT})`
      )}`
    );
    console.log(`  4. Toggle ${chalk.bold("Use webhook")} to ON, then ${chalk.bold("Verify")}`);
    console.log("");
    console.log(
      `  ${chalk.dim(
        `Behind a reverse proxy? Forward https://<host>/line/webhook → http://localhost:${LINE_DEFAULT_PORT}/line/webhook`
      )}`
    );
    console.log("");
  }
}
