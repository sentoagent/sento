import { run, runWithSpinner, commandExists } from "../utils/exec.js";
import { log } from "../utils/logger.js";
import os from "os";
import path from "path";
import fs from "fs";

export async function installClaude() {
  log.step("Installing Claude Code...");

  // Set npm global prefix to ~/.npm-global (avoids EACCES on /usr/lib)
  const npmGlobal = path.join(os.homedir(), ".npm-global");
  fs.mkdirSync(npmGlobal, { recursive: true });
  await run("npm", ["config", "set", "prefix", npmGlobal]);

  const env = {
    ...process.env,
    PATH: `${npmGlobal}/bin:${os.homedir()}/.bun/bin:${process.env.PATH}`,
  };

  if (await commandExists("claude")) {
    log.success("Claude Code already installed");
  } else {
    await runWithSpinner(
      "Installing @anthropic-ai/claude-code",
      "npm",
      ["install", "-g", "@anthropic-ai/claude-code"],
      { env }
    );
  }

  await runWithSpinner(
    "Installing @upstash/context7-mcp",
    "npm",
    ["install", "-g", "@upstash/context7-mcp"],
    { env }
  );
}
