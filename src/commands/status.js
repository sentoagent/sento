import { banner, log } from "../utils/logger.js";
import { run, commandExists } from "../utils/exec.js";
import os from "os";
import path from "path";
import fs from "fs";
import chalk from "chalk";

export async function status() {
  banner();

  const home = os.homedir();
  const gold = chalk.hex("#FFD700");

  // Check if sento was initialized
  const workspace = path.join(home, "workspace");
  if (!fs.existsSync(path.join(workspace, "CLAUDE.md"))) {
    log.error("No agent found. Run 'sento init' first.");
    process.exit(1);
  }

  // Read agent name from start-agent.sh or cron
  let agentName = "agent";
  try {
    const { stdout } = await run("crontab", ["-l"], { allowFail: true });
    const match = stdout?.match(/@reboot tmux new-session -d -s (\S+)/);
    if (match) agentName = match[1];
  } catch {}

  console.log("");

  // Check tmux session
  try {
    const { stdout } = await run("tmux", ["ls"], { allowFail: true });
    if (stdout?.includes(agentName)) {
      log.success(`Agent "${agentName}" is running`);
    } else {
      log.error(`Agent "${agentName}" is not running`);
      log.dim(`Start: tmux new-session -d -s ${agentName} ~/workspace/start-agent.sh`);
    }
  } catch {
    log.error("No tmux sessions found");
  }

  // Check Claude Code
  if (await commandExists(path.join(home, ".npm-global/bin/claude"))) {
    const { stdout } = await run(path.join(home, ".npm-global/bin/claude"), ["--version"], { allowFail: true });
    log.success(`Claude Code ${stdout?.trim() || "installed"}`);
  } else {
    log.error("Claude Code not installed");
  }

  // Check Discord config
  const accessPath = path.join(home, ".claude/channels/discord/access.json");
  if (fs.existsSync(accessPath)) {
    try {
      const access = JSON.parse(fs.readFileSync(accessPath, "utf-8"));
      const groups = Object.keys(access.groups || {});
      log.success(`Discord: ${groups.length} channel/server ID(s) configured`);
    } catch {
      log.warn("Discord: access.json exists but could not be read");
    }
  }

  // Check Telegram config
  const telegramEnv = path.join(home, ".claude/channels/telegram/.env");
  if (fs.existsSync(telegramEnv)) {
    log.success("Telegram: configured");
  }

  // Check Slack config
  const slackEnv = path.join(home, ".claude/channels/slack/.env");
  if (fs.existsSync(slackEnv)) {
    log.success("Slack: configured");
  }

  // Check ClawMem
  const bunBin = path.join(home, ".bun/bin");
  if (await commandExists(path.join(bunBin, "clawmem"))) {
    try {
      const { stdout } = await run(path.join(bunBin, "clawmem"), ["status"], {
        allowFail: true,
        env: { ...process.env, PATH: `${bunBin}:${process.env.PATH}` },
      });
      const docsMatch = stdout?.match(/Documents:\s+(\d+)/);
      if (docsMatch) {
        log.success(`ClawMem: ${docsMatch[1]} documents indexed`);
      } else {
        log.success("ClawMem: installed");
      }
    } catch {
      log.success("ClawMem: installed");
    }
  } else {
    log.warn("ClawMem: not installed");
  }

  // Check Discord patches
  const cacheDir = path.join(home, ".claude/plugins/cache/claude-plugins-official/discord");
  if (fs.existsSync(cacheDir)) {
    try {
      const versions = fs.readdirSync(cacheDir);
      for (const ver of versions) {
        const serverTs = path.join(cacheDir, ver, "server.ts");
        if (fs.existsSync(serverTs)) {
          const content = fs.readFileSync(serverTs, "utf-8");
          const hasGuild = content.includes("msg.guildId ? access.groups[msg.guildId]");
          const hasBuffer = content.includes("messageBuffer");
          const hasReply = content.includes("ch.guildId && ch.guildId in access.groups");
          if (hasGuild && hasBuffer && hasReply) {
            log.success("Discord patches: all applied");
          } else {
            const missing = [];
            if (!hasGuild) missing.push("guild inbound");
            if (!hasReply) missing.push("guild reply");
            if (!hasBuffer) missing.push("message buffer");
            log.warn(`Discord patches: missing ${missing.join(", ")}. Run 'sento update'`);
          }
        }
      }
    } catch {}
  }

  // Check auto-restart
  try {
    const { stdout } = await run("crontab", ["-l"], { allowFail: true });
    if (stdout?.includes("start-agent")) {
      log.success("Auto-restart on reboot: enabled");
    } else {
      log.warn("Auto-restart on reboot: not configured");
    }
  } catch {
    log.warn("Auto-restart on reboot: not configured");
  }

  // CLAUDE.md info
  try {
    const claudeMd = fs.readFileSync(path.join(workspace, "CLAUDE.md"), "utf-8");
    const nameMatch = claudeMd.match(/- Name: (.+)/);
    const roleMatch = claudeMd.match(/- Role: (.+)/);
    if (nameMatch || roleMatch) {
      console.log("");
      if (nameMatch) console.log(`  ${gold.bold("Name:")}    ${nameMatch[1]}`);
      if (roleMatch) console.log(`  ${gold.bold("Role:")}    ${roleMatch[1]}`);
    }
  } catch {}

  console.log("");
}
