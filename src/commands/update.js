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
  const npmGlobal = path.join(home, ".npm-global");
  const env = {
    ...process.env,
    NPM_CONFIG_PREFIX: npmGlobal,
    PATH: `${npmGlobal}/bin:${home}/.bun/bin:${process.env.PATH}`,
  };

  // Check if sento was initialized
  const workspace = path.join(home, "workspace");
  if (!fs.existsSync(path.join(workspace, "CLAUDE.md"))) {
    log.error("No agent found. Run 'sento init' first.");
    process.exit(1);
  }

  // Self-update sentoagent CLI
  await runWithSpinner("Updating sentoagent CLI", "npm", ["install", "-g", "--prefix", npmGlobal, "sentoagent@latest"], { env });

  // Update Claude Code
  if (await commandExists("claude")) {
    await runWithSpinner("Updating Claude Code", "npm", ["install", "-g", "--prefix", npmGlobal, "@anthropic-ai/claude-code"], { env });
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

  // Regenerate Guardian with latest template
  try {
    const configPath = path.join(workspace, ".sento-config.json");
    if (fs.existsSync(configPath)) {
      const sentoConfig = JSON.parse(fs.readFileSync(configPath, "utf-8"));
      // Read language from CLAUDE.md
      let language = "English";
      const claudeMd = fs.readFileSync(path.join(workspace, "CLAUDE.md"), "utf-8");
      const langMatch = claudeMd.match(/- Language: (.+)/);
      if (langMatch) language = langMatch[1].trim();

      const { renderGuardian } = await import("../templates/guardian.js");
      const guardianConfig = {
        agentName: sentoConfig.agentName || "agent",
        channelType: sentoConfig.channelType || "discord",
        language,
      };
      fs.writeFileSync(path.join(workspace, "guardian.mjs"), renderGuardian(guardianConfig));
      fs.chmodSync(path.join(workspace, "guardian.mjs"), 0o700);
      log.success("Guardian updated");
    }
  } catch (e) {
    log.warn("Could not update Guardian: " + e.message);
  }

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
