import fs from "fs";
import os from "os";
import path from "path";
import { run } from "../utils/exec.js";
import { log } from "../utils/logger.js";
import { renderClaudeMd } from "../templates/claude-md.js";
import { renderCronTrigger } from "../templates/cron-trigger.js";
import { renderStartAgent } from "../templates/start-agent.js";
import { renderWatchdog } from "../templates/watchdog.js";
import { renderGuardian } from "../templates/guardian.js";
import { renderSendMessage } from "../templates/send-message.js";
import crypto from "crypto";
import net from "net";

function findOpenPort(start) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.listen(start, "0.0.0.0", () => {
      server.close(() => resolve(start));
    });
    server.on("error", () => resolve(findOpenPort(start + 1)));
  });
}

export async function setupWorkspace(config) {
  log.step("Setting up workspace...");

  const workspace = path.join(os.homedir(), "workspace");
  const dirs = ["skills/custom", "memory"];
  for (const dir of dirs) {
    fs.mkdirSync(path.join(workspace, dir), { recursive: true });
  }

  // Generate agent code and save config
  const configPath = path.join(workspace, ".sento-config.json");
  let sentoConfig = {};
  if (fs.existsSync(configPath)) {
    try { sentoConfig = JSON.parse(fs.readFileSync(configPath, "utf-8")); } catch {}
  }
  if (!sentoConfig.agentCode) {
    sentoConfig.agentCode = "SENTO-" + crypto.randomBytes(4).toString("hex").toUpperCase().slice(0, 8);
  }
  sentoConfig.agentName = config.agentName;
  sentoConfig.pairedAgents = sentoConfig.pairedAgents || {};
  if (!sentoConfig.commsPort) {
    sentoConfig.commsPort = await findOpenPort(9876);
  }
  // Channel type + monitor ID for Guardian alerts/commands
  sentoConfig.channelType = config.channelType;
  if (config.telegramChatId) sentoConfig.monitorChatId = config.telegramChatId;
  if (config.slackChannelId) sentoConfig.monitorChatId = config.slackChannelId;
  if (config.guildId) sentoConfig.monitorChannel = config.guildId;
  if (config.channelIds?.length) sentoConfig.monitorChannel = config.channelIds[0];
  fs.writeFileSync(configPath, JSON.stringify(sentoConfig, null, 2));

  // Project-level Claude Code permissions (prevents permission prompts for common tools)
  const projectClaudeDir = path.join(workspace, ".claude");
  fs.mkdirSync(projectClaudeDir, { recursive: true });
  fs.writeFileSync(path.join(projectClaudeDir, "settings.json"), JSON.stringify({
    permissions: {
      allow: [
        "Bash(curl *)",
        "Bash(crontab *)",
        "Bash(tmux *)",
        "Bash(node ~/workspace/*.mjs*)",
        "Bash(node ~/workspace/*.js*)",
        "Bash(sento *)",
        "Bash(clawmem *)",
        "Bash(whisper *)",
        "Bash(git *)",
        "Bash(pip*)",
        "Bash(npm *)",
        "Bash(npx *)",
        "Bash(bun *)",
        "mcp__plugin_discord_discord__*",
        "mcp__plugin_telegram_telegram__*",
        "mcp__plugin_slack_slack__*",
        "mcp__clawmem__*",
        "mcp__plugin_context7_context7__*",
      ],
    },
  }, null, 2));

  // CLAUDE.md
  fs.writeFileSync(path.join(workspace, "CLAUDE.md"), renderClaudeMd(config));

  // FIRST_RUN.md — triggers onboarding interview on first message
  fs.writeFileSync(path.join(workspace, "FIRST_RUN.md"), "This file triggers the first-run onboarding. The agent will delete it after setup.\n");

  // cron-trigger.sh
  const cronPath = path.join(workspace, "cron-trigger.sh");
  fs.writeFileSync(cronPath, renderCronTrigger());
  fs.chmodSync(cronPath, 0o700);

  // start-agent.sh
  const startPath = path.join(workspace, "start-agent.sh");
  fs.writeFileSync(startPath, renderStartAgent(config));
  fs.chmodSync(startPath, 0o700);

  // watchdog.sh — auto-recovery for stuck agents
  const watchdogPath = path.join(workspace, "watchdog.sh");
  fs.writeFileSync(watchdogPath, renderWatchdog(config));
  fs.chmodSync(watchdogPath, 0o700);

  // Cron entries (Linux only): @reboot + watchdog every 5 min
  if (os.platform() === "linux") {
    try {
      const { stdout } = await run("crontab", ["-l"], { allowFail: true });
      const existing = stdout || "";
      // Remove all sento-related entries before re-adding
      const filtered = existing.split("\n")
        .filter((l) => !l.includes("start-agent") && !l.includes("watchdog") && !l.includes("guardian") && !l.includes("cron-trigger"))
        .filter((l) => l.trim())
        .join("\n");
      const sentoEntries = [
        `@reboot tmux new-session -d -s ${config.agentName} ~/workspace/start-agent.sh`,
        `@reboot node ~/workspace/guardian.mjs &`,
        `*/5 * * * * ~/workspace/watchdog.sh`,
        `55 3 * * * ~/workspace/cron-trigger.sh ${config.agentName} "End of day. Write your daily notes to ~/workspace/memory/$(date +\\%Y-\\%m-\\%d).md. Include: key conversations, decisions made, tasks completed, anything worth remembering. Keep it concise. Then run: clawmem update"`,
      ].join("\n");
      const newCron = filtered ? `${filtered}\n${sentoEntries}\n` : `${sentoEntries}\n`;
      await run("bash", ["-c", `echo '${newCron.replace(/'/g, "'\\''")}' | crontab -`]);
      log.success("Auto-restart on reboot + watchdog configured");
    } catch {
      log.warn("Could not set up cron entries. You can add them manually.");
    }
  }

  // guardian.mjs — unkillable agent monitor with Discord communication
  const guardianPath = path.join(workspace, "guardian.mjs");
  fs.writeFileSync(guardianPath, renderGuardian(config));
  fs.chmodSync(guardianPath, 0o700);

  // send-message.sh — agent-to-agent communication
  const sendMsgPath = path.join(workspace, "send-message.sh");
  fs.writeFileSync(sendMsgPath, renderSendMessage());
  fs.chmodSync(sendMsgPath, 0o700);

  log.success("Workspace ready at ~/workspace");
}
