import { run, runWithSpinner } from "../utils/exec.js";
import { log } from "../utils/logger.js";
import os from "os";
import path from "path";
import fs from "fs";

export async function installClaude() {
  log.step("Installing Claude Code...");

  // Force npm global prefix to ~/.npm-global (avoids EACCES on /usr/lib).
  // We set it three ways to make sure it sticks:
  //   1. mkdir + npm config set (persists to ~/.npmrc)
  //   2. NPM_CONFIG_PREFIX env var (overrides any system config)
  //   3. --prefix flag on install commands (direct, no config lookup)
  const npmGlobal = path.join(os.homedir(), ".npm-global");
  fs.mkdirSync(npmGlobal, { recursive: true });
  await run("npm", ["config", "set", "prefix", npmGlobal], { allowFail: true });

  const env = {
    ...process.env,
    NPM_CONFIG_PREFIX: npmGlobal,
    PATH: `${npmGlobal}/bin:${os.homedir()}/.bun/bin:${process.env.PATH}`,
  };

  const claudePath = path.join(npmGlobal, "bin/claude");
  if (fs.existsSync(claudePath)) {
    log.success("Claude Code already installed");
  } else {
    await runWithSpinner(
      "Installing @anthropic-ai/claude-code",
      "npm",
      ["install", "-g", "--prefix", npmGlobal, "@anthropic-ai/claude-code"],
      { env }
    );
  }

  await runWithSpinner(
    "Installing @upstash/context7-mcp",
    "npm",
    ["install", "-g", "--prefix", npmGlobal, "@upstash/context7-mcp"],
    { env }
  );

  // Install sentoagent globally so `sento` command is available after init
  const sentoPath = path.join(npmGlobal, "bin/sento");
  if (!fs.existsSync(sentoPath)) {
    await runWithSpinner(
      "Installing sentoagent CLI",
      "npm",
      ["install", "-g", "--prefix", npmGlobal, "sentoagent"],
      { env }
    );
  }
}
