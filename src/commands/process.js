import chalk from "chalk";
import { banner, log } from "../utils/logger.js";
import { run, runWithSpinner } from "../utils/exec.js";
import os from "os";
import path from "path";
import { execFileSync } from "child_process";

const gold = chalk.hex("#FFD700");

function getAgentName() {
  try {
    const stdout = execFileSync("crontab", ["-l"], { encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] });
    const match = stdout.match(/@reboot tmux new-session -d -s (\S+)/);
    return match?.[1] || "agent";
  } catch {
    return "agent";
  }
}

export async function start() {
  const agentName = getAgentName();
  const startScript = path.join(os.homedir(), "workspace/start-agent.sh");

  // Check if already running
  try {
    const { stdout } = await run("tmux", ["ls"], { allowFail: true });
    if (stdout?.includes(agentName)) {
      log.warn(`Agent "${agentName}" is already running.`);
      log.dim(`Attach: tmux attach -t ${agentName}`);
      return;
    }
  } catch {}

  await runWithSpinner(
    `Starting ${agentName}`,
    "tmux",
    ["new-session", "-d", "-s", agentName, startScript]
  );
  log.success(`Agent "${agentName}" started.`);
  log.dim(`Attach: tmux attach -t ${agentName}`);
}

export async function stop() {
  const agentName = getAgentName();

  try {
    const { stdout } = await run("tmux", ["ls"], { allowFail: true });
    if (!stdout?.includes(agentName)) {
      log.warn(`Agent "${agentName}" is not running.`);
      return;
    }
  } catch {
    log.warn("No tmux sessions found.");
    return;
  }

  await run("tmux", ["kill-session", "-t", agentName], { allowFail: true });
  log.success(`Agent "${agentName}" stopped.`);
}

export async function restart() {
  const agentName = getAgentName();
  const startScript = path.join(os.homedir(), "workspace/start-agent.sh");

  log.info(`Restarting ${agentName}...`);

  await run("tmux", ["kill-session", "-t", agentName], { allowFail: true });
  await new Promise((r) => setTimeout(r, 3000));

  await runWithSpinner(
    `Starting ${agentName}`,
    "tmux",
    ["new-session", "-d", "-s", agentName, startScript]
  );
  log.success(`Agent "${agentName}" restarted.`);
  log.dim(`Attach: tmux attach -t ${agentName}`);
}
