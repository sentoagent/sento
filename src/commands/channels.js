import inquirer from "inquirer";
import chalk from "chalk";
import { banner, log } from "../utils/logger.js";
import fs from "fs";
import os from "os";
import path from "path";

const gold = chalk.hex("#FFD700");

export async function channels() {
  banner();
  log.step("Channel Management");

  const home = os.homedir();
  const discordAccess = path.join(home, ".claude/channels/discord/access.json");

  if (!fs.existsSync(discordAccess)) {
    log.error("No Discord channel config found. Run 'sento init' first.");
    return;
  }

  let access = {};
  try { access = JSON.parse(fs.readFileSync(discordAccess, "utf-8")); } catch {}

  const groups = access.groups || {};
  const ids = Object.keys(groups);

  const { action } = await inquirer.prompt([{
    type: "list",
    name: "action",
    message: "What do you want to do?",
    choices: [
      { name: `View current channels (${ids.length} configured)`, value: "view" },
      { name: "Add a channel or server ID", value: "add" },
      { name: "Remove a channel or server ID", value: "remove" },
      { name: "Switch to server-wide (listen to all channels)", value: "server" },
    ],
  }]);

  if (action === "view") {
    console.log("");
    if (ids.length === 0) {
      log.warn("No channels configured. The bot won't respond to any messages.");
    } else {
      for (const id of ids) {
        const policy = groups[id];
        const mention = policy.requireMention ? "mention required" : "no mention needed";
        console.log(`  ${gold(id)} (${mention})`);
      }
    }
    console.log("");
    console.log(chalk.dim(`  replyToMode: ${access.replyToMode || "message"}`));
    console.log(chalk.dim(`  dmPolicy: ${access.dmPolicy || "allowlist"}`));
    console.log("");
  }

  if (action === "add") {
    const { id } = await inquirer.prompt([{
      type: "input",
      name: "id",
      message: "Channel ID or Server ID:",
      suffix: chalk.dim("\n  Right-click channel/server > Copy ID (Developer Mode must be on)\n  >"),
      validate: (v) => /^\d+$/.test(v.trim()) || "ID should be numbers only",
    }]);

    const { mention } = await inquirer.prompt([{
      type: "confirm",
      name: "mention",
      message: "Require @mention to respond?",
      default: false,
    }]);

    groups[id.trim()] = { requireMention: mention, allowFrom: [] };
    access.groups = groups;
    fs.writeFileSync(discordAccess, JSON.stringify(access, null, 2));
    log.success(`Added ${id.trim()}. Restart agent for it to take effect.`);
  }

  if (action === "remove") {
    if (ids.length === 0) {
      log.error("No channels to remove.");
      return;
    }

    const { id } = await inquirer.prompt([{
      type: "list",
      name: "id",
      message: "Remove which ID?",
      choices: ids.map((id) => ({ name: id, value: id })),
    }]);

    delete groups[id];
    access.groups = groups;
    fs.writeFileSync(discordAccess, JSON.stringify(access, null, 2));
    log.success(`Removed ${id}. Restart agent for it to take effect.`);
  }

  if (action === "server") {
    const { id } = await inquirer.prompt([{
      type: "input",
      name: "id",
      message: "Discord server ID:",
      suffix: chalk.dim("\n  Right-click server name > Copy Server ID\n  >"),
      validate: (v) => /^\d+$/.test(v.trim()) || "ID should be numbers only",
    }]);

    // Replace all groups with just the server ID
    access.groups = { [id.trim()]: { requireMention: false, allowFrom: [] } };
    fs.writeFileSync(discordAccess, JSON.stringify(access, null, 2));
    log.success(`Now listening to all channels in server ${id.trim()}. Restart agent for it to take effect.`);
  }
}
