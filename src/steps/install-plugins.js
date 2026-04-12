import { run, runWithSpinner } from "../utils/exec.js";
import { log } from "../utils/logger.js";
import os from "os";

const PLUGINS = [
  "discord", "telegram", "slack", "imessage",
  "superpowers", "context7", "code-review", "code-simplifier",
  "commit-commands", "feature-dev", "frontend-design", "hookify",
  "pr-review-toolkit", "security-guidance", "skill-creator",
  "claude-md-management", "typescript-lsp",
];

export async function installPlugins(config) {
  log.step("Installing plugins...");

  const env = {
    ...process.env,
    PATH: `${os.homedir()}/.npm-global/bin:${os.homedir()}/.bun/bin:${process.env.PATH}`,
    CLAUDE_CODE_OAUTH_TOKEN: config.oauthToken,
  };

  await runWithSpinner(
    "Adding plugin marketplace",
    "claude",
    ["plugin", "marketplace", "add", "anthropics/claude-plugins-official"],
    { env }
  );

  await run("claude", ["plugin", "marketplace", "update", "claude-plugins-official"], { env, allowFail: true });

  let installed = 0;
  for (const plugin of PLUGINS) {
    try {
      process.stdout.write(`  [${installed + 1}/${PLUGINS.length}] Installing ${plugin}...\r`);
      await run("claude", ["plugin", "install", `${plugin}@claude-plugins-official`], { env });
      installed++;
    } catch {
      log.warn(`Failed to install ${plugin} (non-fatal)`);
    }
  }
  console.log("");
  log.success(`${installed}/${PLUGINS.length} plugins installed`);
}
