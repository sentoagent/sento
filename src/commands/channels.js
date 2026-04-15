import inquirer from "inquirer";
import chalk from "chalk";
import { banner, log } from "../utils/logger.js";
import fs from "fs";
import os from "os";
import path from "path";

const gold = chalk.hex("#FFD700");

const PLATFORMS = {
  discord: { name: "Discord", tokenVar: "DISCORD_BOT_TOKEN", hasAccessJson: true },
  telegram: { name: "Telegram", tokenVar: "TELEGRAM_BOT_TOKEN" },
  slack: { name: "Slack", tokenVar: "SLACK_BOT_TOKEN" },
  imessage: { name: "iMessage", tokenVar: null },
};

function getActivePlatforms() {
  const home = os.homedir();
  const active = [];
  for (const [key, info] of Object.entries(PLATFORMS)) {
    const dir = path.join(home, ".claude/channels", key);
    if (fs.existsSync(dir)) {
      const hasEnv = fs.existsSync(path.join(dir, ".env"));
      if (hasEnv || key === "imessage") {
        active.push({ key, ...info });
      }
    }
  }
  return active;
}

function getStartScript() {
  return path.join(os.homedir(), "workspace/start-agent.sh");
}

function updateStartScript(platforms) {
  const scriptPath = getStartScript();
  if (!fs.existsSync(scriptPath)) return;

  let content = fs.readFileSync(scriptPath, "utf-8");

  const channelFlags = platforms
    .map((p) => `--channels plugin:${p}@claude-plugins-official`)
    .join(" ");

  content = content.replace(
    /claude --dangerously-skip-permissions.*$/m,
    `claude --dangerously-skip-permissions ${channelFlags}`
  );

  fs.writeFileSync(scriptPath, content);
}

export async function channels(subcommand) {
  banner();

  const active = getActivePlatforms();

  if (subcommand === "add") {
    return await addChannel();
  }
  if (subcommand === "remove") {
    return await removeChannel(active);
  }

  // Default: show menu
  const activeNames = active.map((p) => p.name).join(", ") || "none";

  const { action } = await inquirer.prompt([{
    type: "list",
    name: "action",
    message: `Active platforms: ${gold(activeNames)}`,
    choices: [
      { name: "View active communication channels", value: "view" },
      { name: "Add a communication channel", value: "add" },
      { name: "Remove a communication channel", value: "remove" },
      new inquirer.Separator(),
      { name: "Manage Discord server/channel IDs", value: "discord-ids" },
    ],
  }]);

  if (action === "view") return viewChannels(active);
  if (action === "add") return await addChannel();
  if (action === "remove") return await removeChannel(active);
  if (action === "discord-ids") return await manageDiscordIds();
}

function viewChannels(active) {
  console.log("");
  if (active.length === 0) {
    log.warn("No communication channels configured. Run 'sento channels add' to set one up.");
  } else {
    for (const p of active) {
      console.log(`  ${gold("●")} ${p.name}`);
    }
  }
  console.log("");
  console.log(chalk.dim("  Add more: sento channels add"));
  console.log(chalk.dim("  Remove:   sento channels remove"));
  console.log("");
}

async function addChannel() {
  const home = os.homedir();
  const active = getActivePlatforms();
  const activeKeys = active.map((p) => p.key);

  const available = Object.entries(PLATFORMS)
    .filter(([key]) => !activeKeys.includes(key))
    .map(([key, info]) => {
      let label = info.name;
      if (key === "imessage") label += " (macOS only)";
      return { name: label, value: key };
    });

  if (available.length === 0) {
    log.info("All supported platforms are already configured!");
    return;
  }

  const { platform } = await inquirer.prompt([{
    type: "list",
    name: "platform",
    message: "Add which communication channel?",
    choices: available,
  }]);

  const channelDir = path.join(home, ".claude/channels", platform);
  fs.mkdirSync(channelDir, { recursive: true });

  // Platform-specific credential collection
  if (platform === "imessage") {
    // No config needed
  } else if (platform === "discord") {
    const { token } = await inquirer.prompt([{
      type: "password",
      name: "token",
      message: "Discord bot token:",
      suffix: chalk.dim("\n  discord.com/developers/applications > Bot > Reset Token\n  Enable: Message Content Intent + Server Members Intent\n  >"),
      mask: "*",
      validate: (v) => v.length > 10 || "Token too short",
    }]);

    fs.writeFileSync(path.join(channelDir, ".env"), `DISCORD_BOT_TOKEN=${token}\n`);
    fs.chmodSync(path.join(channelDir, ".env"), 0o600);

    const { scope } = await inquirer.prompt([{
      type: "list",
      name: "scope",
      message: "Where should the bot respond?",
      choices: [
        { name: "All channels in a server", value: "server" },
        { name: "Specific channels only", value: "channels" },
      ],
    }]);

    if (scope === "server") {
      const { id } = await inquirer.prompt([{
        type: "input",
        name: "id",
        message: "Discord server ID:",
        validate: (v) => /^\d+$/.test(v.trim()) || "Numbers only",
      }]);
      const access = { dmPolicy: "allowlist", allowFrom: [], groups: { [id.trim()]: { requireMention: false, allowFrom: [] } }, ackReaction: "\uD83D\uDC40", replyToMode: "message", textChunkLimit: 2000, chunkMode: "newline" };
      fs.writeFileSync(path.join(channelDir, "access.json"), JSON.stringify(access, null, 2));
    } else {
      const { ids } = await inquirer.prompt([{
        type: "input",
        name: "ids",
        message: "Channel IDs (comma-separated):",
        validate: (v) => v.split(",").filter(Boolean).length > 0 || "At least one ID",
      }]);
      const groups = {};
      for (const id of ids.split(",").map((s) => s.trim()).filter(Boolean)) {
        groups[id] = { requireMention: false, allowFrom: [] };
      }
      const access = { dmPolicy: "allowlist", allowFrom: [], groups, ackReaction: "\uD83D\uDC40", replyToMode: "message", textChunkLimit: 2000, chunkMode: "newline" };
      fs.writeFileSync(path.join(channelDir, "access.json"), JSON.stringify(access, null, 2));
    }
  } else {
    // Telegram, Slack
    const info = PLATFORMS[platform];
    const { token } = await inquirer.prompt([{
      type: "password",
      name: "token",
      message: `${info.name} bot token:`,
      mask: "*",
      validate: (v) => v.length > 10 || "Token too short",
    }]);
    fs.writeFileSync(path.join(channelDir, ".env"), `${info.tokenVar}=${token}\n`);
    fs.chmodSync(path.join(channelDir, ".env"), 0o600);
  }

  updateStartScriptWithPlatform(platform);
  log.success(`${PLATFORMS[platform].name} added. Restart agent to activate.`);
}

function updateStartScriptWithPlatform(newPlatform) {
  const active = getActivePlatforms();
  const platforms = active.map((p) => p.key);
  if (!platforms.includes(newPlatform)) platforms.push(newPlatform);
  updateStartScript(platforms);
}

async function removeChannel(active) {
  if (active.length === 0) {
    log.error("No channels to remove.");
    return;
  }

  if (active.length === 1) {
    log.warn(`Only ${active[0].name} is configured. Removing it means your agent won't respond to any messages.`);
  }

  const { platform } = await inquirer.prompt([{
    type: "list",
    name: "platform",
    message: "Remove which communication channel?",
    choices: active.map((p) => ({ name: p.name, value: p.key })),
  }]);

  const { confirm } = await inquirer.prompt([{
    type: "confirm",
    name: "confirm",
    message: `Remove ${PLATFORMS[platform].name}? The bot will stop responding on this platform.`,
    default: false,
  }]);

  if (!confirm) return;

  const home = os.homedir();
  const channelDir = path.join(home, ".claude/channels", platform);

  fs.rmSync(channelDir, { recursive: true, force: true });

  const remaining = active.filter((p) => p.key !== platform).map((p) => p.key);
  updateStartScript(remaining);

  log.success(`${PLATFORMS[platform].name} removed. Restart agent to apply.`);
}

async function manageDiscordIds() {
  const home = os.homedir();
  const accessPath = path.join(home, ".claude/channels/discord/access.json");

  if (!fs.existsSync(accessPath)) {
    log.error("Discord is not configured. Run 'sento channels add' first.");
    return;
  }

  let access = {};
  try { access = JSON.parse(fs.readFileSync(accessPath, "utf-8")); } catch {}
  const groups = access.groups || {};
  const ids = Object.keys(groups);

  const { action } = await inquirer.prompt([{
    type: "list",
    name: "action",
    message: `Discord IDs configured: ${ids.length}`,
    choices: [
      { name: "View IDs", value: "view" },
      { name: "Add a channel or server ID", value: "add" },
      { name: "Remove an ID", value: "remove" },
      { name: "Switch to server-wide", value: "server" },
    ],
  }]);

  if (action === "view") {
    console.log("");
    for (const id of ids) {
      const mention = groups[id].requireMention ? "mention required" : "no mention needed";
      console.log(`  ${gold(id)} (${mention})`);
    }
    console.log("");
  }

  if (action === "add") {
    const { id } = await inquirer.prompt([{
      type: "input",
      name: "id",
      message: "Channel or server ID:",
      validate: (v) => /^\d+$/.test(v.trim()) || "Numbers only",
    }]);
    groups[id.trim()] = { requireMention: false, allowFrom: [] };
    access.groups = groups;
    fs.writeFileSync(accessPath, JSON.stringify(access, null, 2));
    log.success(`Added ${id.trim()}. Restart agent to apply.`);
  }

  if (action === "remove") {
    if (ids.length === 0) { log.error("No IDs to remove."); return; }
    const { id } = await inquirer.prompt([{
      type: "list",
      name: "id",
      message: "Remove which ID?",
      choices: ids,
    }]);
    delete groups[id];
    access.groups = groups;
    fs.writeFileSync(accessPath, JSON.stringify(access, null, 2));
    log.success(`Removed ${id}. Restart agent to apply.`);
  }

  if (action === "server") {
    const { id } = await inquirer.prompt([{
      type: "input",
      name: "id",
      message: "Discord server ID:",
      validate: (v) => /^\d+$/.test(v.trim()) || "Numbers only",
    }]);
    access.groups = { [id.trim()]: { requireMention: false, allowFrom: [] } };
    fs.writeFileSync(accessPath, JSON.stringify(access, null, 2));
    log.success(`Server-wide listening on ${id.trim()}. Restart agent to apply.`);
  }
}
