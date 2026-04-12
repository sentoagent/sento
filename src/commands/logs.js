import chalk from "chalk";
import { log } from "../utils/logger.js";
import { run } from "../utils/exec.js";
import fs from "fs";
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

export async function logs(opts = {}) {
  const agentName = getAgentName();

  if (opts.watchdog) {
    const logPath = path.join(os.homedir(), "workspace/memory/watchdog.log");
    if (!fs.existsSync(logPath)) {
      console.log(chalk.dim("  No watchdog events yet. The agent hasn't needed a restart."));
      return;
    }
    console.log(gold.bold("\n  Watchdog Log:\n"));
    const content = fs.readFileSync(logPath, "utf-8");
    console.log(content.split("\n").map((l) => "  " + l).join("\n"));
    return;
  }

  const lines = opts.lines || 30;

  try {
    const { stdout } = await run("tmux", ["capture-pane", "-t", agentName, "-p", "-S", `-${lines}`], { allowFail: true });
    if (stdout) {
      console.log(stdout);
    } else {
      log.error(`No tmux session '${agentName}' found. Is the agent running?`);
    }
  } catch {
    log.error(`Could not read tmux session '${agentName}'.`);
  }
}
