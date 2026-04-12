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
  sentoConfig.commsPort = sentoConfig.commsPort || 9876;
  fs.writeFileSync(configPath, JSON.stringify(sentoConfig, null, 2));

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
      const filtered = existing.split("\n")
        .filter((l) => !l.includes("start-agent") && !l.includes("watchdog"))
        .join("\n");
      const newCron = `${filtered}\n@reboot tmux new-session -d -s ${config.agentName} ~/workspace/start-agent.sh\n@reboot node ~/workspace/guardian.mjs &\n*/5 * * * * ~/workspace/watchdog.sh\n`;
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
