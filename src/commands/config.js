import inquirer from "inquirer";
import chalk from "chalk";
import { banner, log } from "../utils/logger.js";
import { run } from "../utils/exec.js";
import fs from "fs";
import os from "os";
import path from "path";
import { execSync } from "child_process";

const gold = chalk.hex("#FFD700");

function getAgentName() {
  try {
    const stdout = execSync("crontab -l 2>/dev/null", { encoding: "utf-8" });
    const match = stdout.match(/@reboot tmux new-session -d -s (\S+)/);
    return match?.[1] || "agent";
  } catch {
    return "agent";
  }
}

export async function config() {
  banner();
  log.step("Agent Configuration");

  const home = os.homedir();
  const bashrc = path.join(home, ".bashrc");
  const startScript = path.join(home, "workspace/start-agent.sh");
  const claudeMd = path.join(home, "workspace/CLAUDE.md");

  const { action } = await inquirer.prompt([{
    type: "list",
    name: "action",
    message: "What do you want to configure?",
    choices: [
      { name: "Change model (Sonnet/Opus/Haiku)", value: "model" },
      { name: "Update OAuth token", value: "oauth" },
      { name: "Update bot token", value: "bottoken" },
      { name: "Update Gemini API key", value: "gemini" },
      { name: "Set Discord webhook (for watchdog notifications)", value: "webhook" },
      { name: "View current config", value: "view" },
    ],
  }]);

  if (action === "model") {
    const { model } = await inquirer.prompt([{
      type: "list",
      name: "model",
      message: "Select model:",
      choices: [
        { name: "Sonnet 4.6 (fast, recommended)", value: "sonnet" },
        { name: "Opus 4.6 (powerful, slower)", value: "opus" },
        { name: "Haiku 4.5 (fastest, lighter)", value: "haiku" },
      ],
    }]);

    try {
      const agentName = getAgentName();
      await run("tmux", ["send-keys", "-t", agentName, `/model ${model}`, "Enter"], { allowFail: true });
      log.success(`Model changed to ${model}. Takes effect on next message.`);
    } catch {
      log.warn(`Could not send command to agent. Run manually: /model ${model}`);
    }
  }

  if (action === "oauth") {
    const { token } = await inquirer.prompt([{
      type: "password",
      name: "token",
      message: "New OAuth token (sk-ant-oat01-...):",
      mask: "*",
      validate: (v) => v.startsWith("sk-ant-oat01-") || "Should start with sk-ant-oat01-",
    }]);

    const content = fs.readFileSync(bashrc, "utf-8");
    fs.writeFileSync(bashrc, content.replace(/export CLAUDE_CODE_OAUTH_TOKEN=.*/, `export CLAUDE_CODE_OAUTH_TOKEN=${token}`));

    if (fs.existsSync(startScript)) {
      const script = fs.readFileSync(startScript, "utf-8");
      fs.writeFileSync(startScript, script.replace(/export CLAUDE_CODE_OAUTH_TOKEN=.*/, `export CLAUDE_CODE_OAUTH_TOKEN=${token}`));
    }

    log.success("OAuth token updated. Restart agent for it to take effect.");
  }

  if (action === "bottoken") {
    const channelDirs = ["discord", "telegram", "slack"];
    const existing = channelDirs.filter((c) =>
      fs.existsSync(path.join(home, ".claude/channels", c, ".env"))
    );

    if (existing.length === 0) { log.error("No messaging channels configured."); return; }

    const { channel } = await inquirer.prompt([{
      type: "list",
      name: "channel",
      message: "Which bot token?",
      choices: existing.map((c) => ({ name: c.charAt(0).toUpperCase() + c.slice(1), value: c })),
    }]);

    const { token } = await inquirer.prompt([{
      type: "password",
      name: "token",
      message: `New ${channel} bot token:`,
      mask: "*",
      validate: (v) => v.length > 10 || "Token too short",
    }]);

    const tokenVars = { discord: "DISCORD_BOT_TOKEN", telegram: "TELEGRAM_BOT_TOKEN", slack: "SLACK_BOT_TOKEN" };
    const envPath = path.join(home, ".claude/channels", channel, ".env");
    fs.writeFileSync(envPath, `${tokenVars[channel]}=${token}\n`);
    fs.chmodSync(envPath, 0o600);

    log.success(`${channel} bot token updated. Restart agent for it to take effect.`);
  }

  if (action === "gemini") {
    const { key } = await inquirer.prompt([{
      type: "password",
      name: "key",
      message: "Gemini API key (or press Enter to remove):",
      mask: "*",
    }]);

    let content = fs.readFileSync(bashrc, "utf-8");
    const vars = ["GEMINI_API_KEY", "CLAWMEM_EMBED_API_KEY"];

    if (key) {
      for (const v of vars) {
        if (content.includes(`export ${v}=`)) {
          content = content.replace(new RegExp(`export ${v}=.*`), `export ${v}=${key}`);
        } else {
          content += `\nexport ${v}=${key}`;
        }
      }
      log.success("Gemini key updated. Restart agent for it to take effect.");
    } else {
      for (const v of vars) {
        content = content.replace(new RegExp(`export ${v}=.*\n?`), "");
      }
      log.success("Gemini key removed. Memory will use keyword search only.");
    }
    fs.writeFileSync(bashrc, content);
  }

  if (action === "webhook") {
    const { url } = await inquirer.prompt([{
      type: "input",
      name: "url",
      message: "Discord webhook URL (for watchdog notifications):",
      suffix: chalk.dim("\n  Create one: Discord > Server Settings > Integrations > Webhooks\n  >"),
    }]);

    if (url) {
      const configPath = path.join(home, "workspace/.sento-config.json");
      let cfg = {};
      if (fs.existsSync(configPath)) {
        try { cfg = JSON.parse(fs.readFileSync(configPath, "utf-8")); } catch {}
      }
      cfg.discordWebhook = url;
      fs.writeFileSync(configPath, JSON.stringify(cfg, null, 2));
      log.success("Webhook saved. Watchdog will notify this channel if agent gets stuck.");
    }
  }

  if (action === "view") {
    console.log("");
    try {
      const content = fs.readFileSync(bashrc, "utf-8");
      const oauth = content.match(/CLAUDE_CODE_OAUTH_TOKEN=(.*)/)?.[1];
      const gemini = content.match(/GEMINI_API_KEY=(.*)/)?.[1];
      console.log(`  ${gold.bold("OAuth:")}    ${oauth ? oauth.slice(0, 20) + "..." : "not set"}`);
      console.log(`  ${gold.bold("Gemini:")}   ${gemini ? "configured" : "not set"}`);
    } catch {}

    for (const ch of ["discord", "telegram", "slack"]) {
      if (fs.existsSync(path.join(home, ".claude/channels", ch, ".env"))) {
        console.log(`  ${gold.bold(ch + ":")} configured`);
      }
    }

    if (fs.existsSync(claudeMd)) {
      const md = fs.readFileSync(claudeMd, "utf-8");
      const name = md.match(/- Name: (.+)/)?.[1];
      const role = md.match(/- Role: (.+)/)?.[1];
      if (name) console.log(`  ${gold.bold("Name:")}     ${name}`);
      if (role) console.log(`  ${gold.bold("Role:")}     ${role}`);
    }
    console.log("");
  }
}
