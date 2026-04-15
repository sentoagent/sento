import chalk from "chalk";
import { banner, log } from "../utils/logger.js";
import { run, commandExists } from "../utils/exec.js";
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

export async function doctor(opts = {}) {
  banner();
  log.step("Running diagnostics...\n");

  const home = os.homedir();
  const fix = opts.fix || false;
  let issues = 0;
  let fixed = 0;

  // 1. Claude Code installed?
  const claudeBin = path.join(home, ".npm-global/bin/claude");
  if (await commandExists(claudeBin) || await commandExists("claude")) {
    log.success("Claude Code installed");
  } else {
    log.error("Claude Code not found");
    if (fix) {
      log.info("Installing Claude Code...");
      try {
        await run("npm", ["install", "-g", "@anthropic-ai/claude-code"], {
          env: { ...process.env, PATH: `${home}/.npm-global/bin:${process.env.PATH}` },
        });
        log.success("Fixed: Claude Code installed");
        fixed++;
      } catch { log.error("Could not install. Run: npm install -g @anthropic-ai/claude-code"); }
    }
    issues++;
  }

  // 2. OAuth token set?
  try {
    const bashrc = fs.readFileSync(path.join(home, ".bashrc"), "utf-8");
    if (bashrc.includes("CLAUDE_CODE_OAUTH_TOKEN=")) {
      log.success("OAuth token configured");
    } else {
      log.error("OAuth token not set in ~/.bashrc");
      log.info("Fix: sento config → Update OAuth token");
      issues++;
    }
  } catch {
    log.error("~/.bashrc not found");
    issues++;
  }

  // 3. Messaging channel configured?
  const channelTypes = ["discord", "telegram", "slack", "line"];
  let hasChannel = false;
  for (const ch of channelTypes) {
    const envPath = path.join(home, ".claude/channels", ch, ".env");
    if (fs.existsSync(envPath)) {
      const content = fs.readFileSync(envPath, "utf-8");
      if (content.includes("TOKEN=") && content.split("=")[1]?.trim().length > 10) {
        log.success(`${ch} bot token configured`);
        hasChannel = true;
      } else {
        log.error(`${ch} .env exists but token looks empty`);
        log.info("Fix: sento config → Update bot token");
        issues++;
      }
    }
  }

  if (!hasChannel) {
    log.error("No messaging channel configured");
    log.info("Fix: sento init (or sento config → Update bot token)");
    issues++;
  }

  // 4. Discord access.json valid?
  const accessPath = path.join(home, ".claude/channels/discord/access.json");
  if (fs.existsSync(accessPath)) {
    try {
      const access = JSON.parse(fs.readFileSync(accessPath, "utf-8"));
      const groups = Object.keys(access.groups || {});
      if (groups.length > 0) {
        log.success(`Discord: ${groups.length} channel/server ID(s)`);
      } else {
        log.error("Discord access.json has no channel IDs");
        log.info("Fix: sento channels → Add a channel or server ID");
        issues++;
      }
      if (access.dmPolicy === "disabled") {
        log.error("Discord dmPolicy is 'disabled' — blocks ALL messages including channels");
        if (fix) {
          access.dmPolicy = "allowlist";
          fs.writeFileSync(accessPath, JSON.stringify(access, null, 2));
          log.success("Fixed: dmPolicy changed to 'allowlist'");
          fixed++;
        } else {
          log.info("Fix: run sento doctor --fix");
        }
        issues++;
      }
      if (access.replyToMode === "first") {
        log.error("Discord replyToMode is 'first' — bot replies in wrong channel");
        if (fix) {
          access.replyToMode = "message";
          fs.writeFileSync(accessPath, JSON.stringify(access, null, 2));
          log.success("Fixed: replyToMode changed to 'message'");
          fixed++;
        } else {
          log.info("Fix: run sento doctor --fix");
        }
        issues++;
      }
    } catch {
      log.error("Discord access.json is malformed");
      issues++;
    }
  }

  // 5. Discord plugin patches applied?
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
            log.error(`Discord patches missing: ${missing.join(", ")}`);
            if (fix) {
              log.info("Re-applying patches...");
              try {
                const { patchChannels } = await import("../steps/patch-channels.js");
                await patchChannels({ patchAll: true });
                log.success("Fixed: Discord patches re-applied");
                fixed++;
              } catch (e) {
                log.error("Could not re-apply patches: " + e.message);
              }
            } else {
              log.info("Fix: sento update (or sento doctor --fix)");
            }
            issues++;
          }
        }
      }
    } catch {}
  }

  // 6. skipDangerousModePermissionPrompt?
  const settingsPath = path.join(home, ".claude/settings.json");
  if (fs.existsSync(settingsPath)) {
    try {
      const settings = JSON.parse(fs.readFileSync(settingsPath, "utf-8"));
      if (settings.skipDangerousModePermissionPrompt) {
        log.success("Bypass permissions prompt: skipped");
      } else {
        log.error("skipDangerousModePermissionPrompt not set — agent will hang on launch");
        if (fix) {
          settings.skipDangerousModePermissionPrompt = true;
          fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
          log.success("Fixed: skipDangerousModePermissionPrompt enabled");
          fixed++;
        } else {
          log.info("Fix: sento doctor --fix");
        }
        issues++;
      }
    } catch {
      log.error("settings.json is malformed");
      issues++;
    }
  } else {
    log.error("~/.claude/settings.json not found");
    if (fix) {
      fs.mkdirSync(path.join(home, ".claude"), { recursive: true });
      fs.writeFileSync(settingsPath, JSON.stringify({ skipDangerousModePermissionPrompt: true }, null, 2));
      log.success("Fixed: settings.json created");
      fixed++;
    }
    issues++;
  }

  // 7. Workspace exists?
  const workspace = path.join(home, "workspace");
  if (fs.existsSync(path.join(workspace, "CLAUDE.md"))) {
    log.success("Workspace: ~/workspace/CLAUDE.md exists");
  } else {
    log.error("No CLAUDE.md found in ~/workspace");
    log.info("Fix: sento init");
    issues++;
  }

  // 8. Start script exists and has correct permissions?
  const startScript = path.join(workspace, "start-agent.sh");
  if (fs.existsSync(startScript)) {
    const stats = fs.statSync(startScript);
    const mode = (stats.mode & 0o777).toString(8);
    if (mode === "700") {
      log.success("start-agent.sh: permissions OK (700)");
    } else {
      log.error(`start-agent.sh: permissions ${mode} (should be 700)`);
      if (fix) {
        fs.chmodSync(startScript, 0o700);
        log.success("Fixed: permissions set to 700");
        fixed++;
      }
      issues++;
    }
  } else {
    log.error("start-agent.sh not found");
    issues++;
  }

  // 9. Watchdog installed?
  const watchdog = path.join(workspace, "watchdog.sh");
  if (fs.existsSync(watchdog)) {
    log.success("Watchdog: installed");
  } else {
    log.error("Watchdog not installed — agent won't auto-recover from stuck state");
    log.info("Fix: sento update (or sento doctor --fix to create it)");
    issues++;
  }

  // 10. Cron jobs?
  try {
    const { stdout } = await run("crontab", ["-l"], { allowFail: true });
    const cron = stdout || "";
    const hasReboot = cron.includes("start-agent");
    const hasWatchdog = cron.includes("watchdog");

    if (hasReboot) {
      log.success("Cron: @reboot auto-start configured");
    } else {
      log.error("Cron: no @reboot entry — agent won't start after reboot");
      issues++;
    }
    if (hasWatchdog) {
      log.success("Cron: watchdog running every 5 minutes");
    } else {
      log.error("Cron: watchdog not scheduled");
      issues++;
    }
  } catch {
    log.error("Could not read crontab");
    issues++;
  }

  // 11. Agent process running?
  const agentName = getAgentName();
  try {
    const { stdout } = await run("tmux", ["ls"], { allowFail: true });
    if (stdout?.includes(agentName)) {
      log.success(`Agent "${agentName}": running`);
    } else {
      log.error(`Agent "${agentName}": not running`);
      if (fix) {
        log.info("Starting agent...");
        await run("tmux", ["new-session", "-d", "-s", agentName, startScript], { allowFail: true });
        log.success("Fixed: agent started");
        fixed++;
      } else {
        log.info("Fix: sento start");
      }
      issues++;
    }
  } catch {
    log.error("tmux not available");
    issues++;
  }

  // 12. ClawMem installed?
  const clawmemBin = path.join(home, ".bun/bin/clawmem");
  if (await commandExists(clawmemBin)) {
    log.success("ClawMem: installed");
  } else {
    log.error("ClawMem not installed — no persistent memory");
    log.info("Fix: bun install -g clawmem");
    issues++;
  }

  // Summary
  console.log("");
  if (issues === 0) {
    console.log(gold.bold("  All checks passed. Agent is healthy. ✓\n"));
  } else if (fix) {
    console.log(gold(`  ${issues} issue(s) found, ${fixed} fixed. ${issues - fixed > 0 ? (issues - fixed) + " need manual attention." : "All fixed!"}\n`));
  } else {
    console.log(chalk.yellow(`  ${issues} issue(s) found. Run ${gold("sento doctor --fix")} to auto-fix what's possible.\n`));
  }
}
