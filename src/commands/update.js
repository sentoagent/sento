import { banner, log } from "../utils/logger.js";
import { run, runWithSpinner, commandExists } from "../utils/exec.js";
import { patchChannels } from "../steps/patch-channels.js";
import os from "os";
import path from "path";
import fs from "fs";

export async function update() {
  banner();
  log.step("Updating Sentō agent...");

  const home = os.homedir();
  const env = {
    ...process.env,
    PATH: `${home}/.npm-global/bin:${home}/.bun/bin:${process.env.PATH}`,
  };

  // Check if sento was initialized
  const workspace = path.join(home, "workspace");
  if (!fs.existsSync(path.join(workspace, "CLAUDE.md"))) {
    log.error("No agent found. Run 'sento init' first.");
    process.exit(1);
  }

  // Update Claude Code
  if (await commandExists("claude")) {
    await runWithSpinner("Updating Claude Code", "npm", ["update", "-g", "@anthropic-ai/claude-code"], { env });
  }

  // Update plugins
  const oauthToken = process.env.CLAUDE_CODE_OAUTH_TOKEN ||
    (() => {
      try {
        const bashrc = fs.readFileSync(path.join(home, ".bashrc"), "utf-8");
        const match = bashrc.match(/CLAUDE_CODE_OAUTH_TOKEN=(.+)/);
        return match?.[1];
      } catch { return null; }
    })();

  if (oauthToken) {
    const pluginEnv = { ...env, CLAUDE_CODE_OAUTH_TOKEN: oauthToken };
    try {
      await runWithSpinner("Updating plugin marketplace", "claude",
        ["plugin", "marketplace", "update", "claude-plugins-official"], { env: pluginEnv });
    } catch {
      log.warn("Could not update plugin marketplace");
    }
  }

  // Re-apply channel patches (Discord guild matching + buffer, Telegram buffer)
  await patchChannels({ patchAll: true });

  // Update ClawMem
  const bunBin = path.join(home, ".bun/bin");
  if (await commandExists(path.join(bunBin, "clawmem"))) {
    try {
      await runWithSpinner("Updating ClawMem", path.join(bunBin, "bun"), ["update", "-g", "clawmem"], { env });
    } catch {
      log.warn("Could not update ClawMem");
    }
  }

  log.success("Update complete!");
  log.info("Restart your agent to apply changes:");
  log.dim("tmux kill-session -t <name> && tmux new-session -d -s <name> ~/workspace/start-agent.sh");
  console.log("");
}
