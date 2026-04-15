import { banner, log } from "../utils/logger.js";
import { collectConfig, confirmConfig } from "../prompts.js";
import { checkPrerequisites } from "../steps/check-prerequisites.js";
import { installClaude } from "../steps/install-claude.js";
import { configureAuth } from "../steps/configure-auth.js";
import { configureSettings } from "../steps/configure-settings.js";
import { installPlugins } from "../steps/install-plugins.js";
import { configureChannel } from "../steps/configure-channel.js";
import { installClawmem } from "../steps/install-clawmem.js";
import { setupWorkspace } from "../steps/setup-workspace.js";
import { patchChannels } from "../steps/patch-channels.js";
import { runWithSpinner } from "../utils/exec.js";
import chalk from "chalk";
import os from "os";
import path from "path";

export async function init() {
  banner();

  try {
    await checkPrerequisites();
  } catch (err) {
    log.error(err.message);
    process.exit(1);
  }

  const config = await collectConfig();
  const proceed = await confirmConfig(config);
  if (!proceed) {
    log.info("Setup cancelled.");
    process.exit(0);
  }

  const steps = [
    ["Installing Claude Code", () => installClaude()],
    ["Configuring authentication", () => configureAuth(config)],
    ["Configuring settings", () => configureSettings()],
    ["Installing plugins", () => installPlugins(config)],
    ["Configuring messaging channel", () => configureChannel(config)],
    ["Patching channel plugins", () => patchChannels(config)],
    ["Installing ClawMem", () => installClawmem(config)],
    ["Setting up workspace", () => setupWorkspace(config)],
  ];

  for (const [name, fn] of steps) {
    try {
      await fn();
    } catch (err) {
      log.error(`${name} failed: ${err.message}`);
      log.dim("You can fix the issue and re-run 'sento init' safely.");
      process.exit(1);
    }
  }

  // Initialize Claude Code (accept workspace trust automatically)
  log.step("Initializing Claude Code...");

  const claudeBin = path.join(os.homedir(), ".npm-global/bin/claude");
  const workspace = path.join(os.homedir(), "workspace");
  const env = {
    ...process.env,
    PATH: `${os.homedir()}/.npm-global/bin:${os.homedir()}/.bun/bin:${process.env.PATH}`,
    CLAUDE_CODE_OAUTH_TOKEN: config.oauthToken,
    DISPLAY: ":99",
  };

  // Launch Claude Code in a temp tmux session, auto-accept the trust prompt,
  // then send /exit. No manual interaction needed.
  const { execFileSync } = await import("child_process");
  const initSession = "__sento_init";
  try {
    execFileSync("tmux", ["kill-session", "-t", initSession], { timeout: 5000 });
  } catch {}
  execFileSync("tmux", ["new-session", "-d", "-s", initSession, `${claudeBin} --dangerously-skip-permissions`], {
    cwd: workspace,
    env,
    timeout: 10000,
  });

  // Wait for trust prompt and auto-accept, then send /exit
  log.info("Auto-accepting workspace trust...");
  let accepted = false;
  for (let i = 0; i < 12; i++) {
    await new Promise(r => setTimeout(r, 5000));
    try {
      const output = execFileSync("tmux", ["capture-pane", "-t", initSession, "-p"], { encoding: "utf-8", timeout: 5000 });
      if (output.includes("trust this folder")) {
        execFileSync("tmux", ["send-keys", "-t", initSession, "Enter"], { timeout: 5000 });
        accepted = true;
        // Wait a moment then send /exit
        await new Promise(r => setTimeout(r, 3000));
        execFileSync("tmux", ["send-keys", "-t", initSession, "/exit", "Enter"], { timeout: 5000 });
        break;
      }
      if (output.includes("Listening for") || output.includes("❯")) {
        // Already past trust, send /exit
        execFileSync("tmux", ["send-keys", "-t", initSession, "/exit", "Enter"], { timeout: 5000 });
        accepted = true;
        break;
      }
    } catch {}
  }

  // Clean up the temp session
  await new Promise(r => setTimeout(r, 2000));
  try { execFileSync("tmux", ["kill-session", "-t", initSession], { timeout: 5000 }); } catch {}

  if (accepted) {
    log.success("Claude Code initialized");
  } else {
    log.warn("Could not auto-accept trust prompt. You may need to run Claude Code manually once.");
  }

  // Launch the agent in tmux
  log.step("Launching agent...");
  try {
    const startScript = path.join(os.homedir(), "workspace/start-agent.sh");
    await runWithSpinner(
      `Starting ${config.agentName} in tmux`,
      "tmux",
      ["new-session", "-d", "-s", config.agentName, startScript]
    );
    log.success(`Agent "${config.agentName}" is running!`);

    // Launch Guardian as a fully detached background process.
    // spawn + detached + unref so it survives after sento init exits.
    const guardianPath = path.join(os.homedir(), "workspace/guardian.mjs");
    try {
      const { spawn } = await import("child_process");
      const guardian = spawn("node", [guardianPath], {
        detached: true,
        stdio: "ignore",
        env,
        cwd: path.join(os.homedir(), "workspace"),
      });
      guardian.unref();
      log.success("Guardian active (auto-recovery enabled)");
    } catch {
      log.warn("Guardian could not start. Run manually: node ~/workspace/guardian.mjs &");
    }
  } catch (err) {
    log.warn(`Could not auto-launch: ${err.message}`);
    log.dim(`Start manually: tmux new-session -d -s ${config.agentName} ~/workspace/start-agent.sh`);
  }

  // Done!
  const gold = chalk.hex("#FFD700");
  console.log("");
  console.log(gold.bold("  ✅ Agent \"" + config.agentName + "\" is live!"));
  console.log("");
  console.log("  Your agent is now running and listening for messages.");
  console.log("");
  console.log(`  ${gold.bold("Monitor:")}  ${gold(`tmux attach -t ${config.agentName}`)}  (Ctrl+B, D to detach)`);
  console.log(`  ${gold.bold("Stop:")}     ${gold(`tmux kill-session -t ${config.agentName}`)}`);
  console.log(`  ${gold.bold("Restart:")}  ${gold(`tmux kill-session -t ${config.agentName} && tmux new-session -d -s ${config.agentName} ~/workspace/start-agent.sh`)}`);
  console.log(`  ${gold.bold("Config:")}   ${gold("~/workspace/CLAUDE.md")}`);
  if (config.channelType === "discord") {
    console.log(`  ${gold.bold("Channels:")} ${gold("~/.claude/channels/discord/access.json")}`);
  }
  console.log("");
  console.log(gold.bold("  Run this to enable the sento command:"));
  console.log(`  ${gold("source ~/.bashrc")}`);
  console.log("");
  console.log(chalk.dim("  Auto-restarts on reboot and on crash."));
  console.log(chalk.dim("  New SSH sessions will have `sento` ready automatically."));
  console.log(chalk.dim("  Talk to your agent on " + config.channelType + "!"));
  console.log("");
}
