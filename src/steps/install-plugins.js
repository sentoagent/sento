import { run, runWithSpinner } from "../utils/exec.js";
import { log } from "../utils/logger.js";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";

const PLUGINS = [
  "discord", "telegram", "slack", "imessage",
  "superpowers", "context7", "code-review", "code-simplifier",
  "commit-commands", "feature-dev", "frontend-design", "hookify",
  "pr-review-toolkit", "security-guidance", "skill-creator",
  "claude-md-management", "typescript-lsp",
];

// Channels Sentō ships locally instead of pulling from the official marketplace.
// Until these get upstreamed (or moved to a sentoagent/claude-plugins-sento
// marketplace), we install them by pointing `claude plugin install` at the
// path on disk. See plugins/<channel>/README.md for status.
const LOCAL_PLUGINS = ["line", "whatsapp"];

function localPluginPath(name) {
  // src/steps/install-plugins.js → ../../plugins/<name>
  const here = path.dirname(fileURLToPath(import.meta.url));
  return path.resolve(here, "..", "..", "plugins", name);
}

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

  // Local Sentō plugins — only install the one matching the chosen channel,
  // since installing all of them would fail noisily for users who pick
  // discord/telegram/slack/imessage.
  if (LOCAL_PLUGINS.includes(config.channelType)) {
    const pluginPath = localPluginPath(config.channelType);
    try {
      process.stdout.write(`  Installing local ${config.channelType} plugin...\r`);
      await run("claude", ["plugin", "install", pluginPath], { env });
      log.success(`Local ${config.channelType} plugin installed (WIP)`);
    } catch (err) {
      log.warn(`Failed to install local ${config.channelType} plugin: ${err.message}`);
      log.warn("This plugin is still WIP — see plugins/" + config.channelType + "/README.md");
    }
  }

  console.log("");
  log.success(`${installed}/${PLUGINS.length} plugins installed`);
}
