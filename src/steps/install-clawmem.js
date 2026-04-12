import { runWithSpinner, run, commandExists } from "../utils/exec.js";
import { log } from "../utils/logger.js";
import os from "os";
import path from "path";

export async function installClawmem(config) {
  log.step("Installing ClawMem (persistent memory)...");

  const env = {
    ...process.env,
    PATH: `${os.homedir()}/.bun/bin:${os.homedir()}/.npm-global/bin:${process.env.PATH}`,
  };

  if (config.geminiKey) {
    env.GEMINI_API_KEY = config.geminiKey;
    env.CLAWMEM_EMBED_URL = "https://generativelanguage.googleapis.com/v1beta/openai";
    env.CLAWMEM_EMBED_API_KEY = config.geminiKey;
    env.CLAWMEM_EMBED_MODEL = "gemini-embedding-001";
  }

  const bunBin = path.join(os.homedir(), ".bun/bin");
  if (await commandExists(path.join(bunBin, "clawmem"))) {
    log.success("ClawMem already installed");
  } else {
    await runWithSpinner("Installing ClawMem", path.join(os.homedir(), ".bun/bin/bun"), ["install", "-g", "clawmem"], { env });
  }

  const workspace = path.join(os.homedir(), "workspace");
  await run(path.join(bunBin, "clawmem"), ["bootstrap", workspace, "--name", "workspace"], { env, allowFail: true });
  await run(path.join(bunBin, "clawmem"), ["setup", "hooks"], { env, allowFail: true });
  await run(path.join(bunBin, "clawmem"), ["setup", "mcp"], { env, allowFail: true });

  log.success("ClawMem configured");
}
