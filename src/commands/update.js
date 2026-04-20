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

  // Regenerate Guardian + permissions from the NEWLY INSTALLED package (not the running code)
  try {
    const configPath = path.join(workspace, ".sento-config.json");
    if (fs.existsSync(configPath)) {
      const sentoConfig = JSON.parse(fs.readFileSync(configPath, "utf-8"));
      let language = "English";
      const claudeMd = fs.readFileSync(path.join(workspace, "CLAUDE.md"), "utf-8");
      const langMatch = claudeMd.match(/- Language: (.+)/);
      if (langMatch) language = langMatch[1].trim();

      // Import from the NEWLY INSTALLED package, not the currently-running code
      const newPkg = path.join(npmGlobal, "lib/node_modules/sentoagent/src/templates/guardian.js");
      const guardianMod = fs.existsSync(newPkg.replace(".js", ".js"))
        ? await import("file://" + newPkg)
        : await import("../templates/guardian.js");

      const guardianConfig = {
        agentName: sentoConfig.agentName || "agent",
        channelType: sentoConfig.channelType || "discord",
        language,
      };
      fs.writeFileSync(path.join(workspace, "guardian.mjs"), guardianMod.renderGuardian(guardianConfig));
      fs.chmodSync(path.join(workspace, "guardian.mjs"), 0o700);
      log.success("Guardian updated");
    }
  } catch (e) {
    log.warn("Could not update Guardian: " + e.message);
  }

  // Generate/update permissions allowlist (settings.json)
  try {
    const projectClaudeDir = path.join(workspace, ".claude");
    fs.mkdirSync(projectClaudeDir, { recursive: true });
    const settingsPath = path.join(projectClaudeDir, "settings.json");
    // Merge with existing settings if present
    let existing = {};
    if (fs.existsSync(settingsPath)) {
      try { existing = JSON.parse(fs.readFileSync(settingsPath, "utf-8")); } catch {}
    }
    existing.permissions = {
      allow: [
        "Bash(curl *)", "Bash(crontab *)", "Bash(tmux *)", "Bash(node *)",
        "Bash(sento *)", "Bash(clawmem *)", "Bash(whisper *)", "Bash(ffmpeg *)",
        "Bash(git *)", "Bash(pip*)", "Bash(npm *)", "Bash(npx *)", "Bash(bun *)",
        "Bash(python3 *)", "Bash(python *)", "Bash(pkill *)", "Bash(kill *)",
        "Bash(pgrep *)", "Bash(chmod *)", "Bash(chown *)", "Bash(mkdir *)",
        "Bash(cat *)", "Bash(echo *)", "Bash(wget *)", "Bash(source *)",
        "Bash(playwright *)", "Bash(npx playwright *)",
        "Edit(*)", "Write(*)", "Read(*)",
        "mcp__plugin_discord_discord__*", "mcp__plugin_telegram_telegram__*",
        "mcp__plugin_slack_slack__*", "mcp__clawmem__*",
        "mcp__plugin_context7_context7__*", "mcp__plugin_playwright_playwright__*",
      ],
    };
    fs.writeFileSync(settingsPath, JSON.stringify(existing, null, 2));
    log.success("Permissions updated");
  } catch (e) {
    log.warn("Could not update permissions: " + e.message);
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
