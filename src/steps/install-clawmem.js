import { runWithSpinner, run, commandExists } from "../utils/exec.js";
import { log } from "../utils/logger.js";
import fs from "fs";
import os from "os";
import path from "path";

export async function installClawmem(config) {
  log.step("Installing ClawMem (persistent memory)...");

  const env = {
    ...process.env,
    PATH: `${os.homedir()}/.bun/bin:${os.homedir()}/.npm-global/bin:${process.env.PATH}`,
  };

  // Configure embedding source
  if (config.geminiKey) {
    env.GEMINI_API_KEY = config.geminiKey;
    env.CLAWMEM_EMBED_URL = "https://generativelanguage.googleapis.com/v1beta/openai";
    env.CLAWMEM_EMBED_API_KEY = config.geminiKey;
    env.CLAWMEM_EMBED_MODEL = "gemini-embedding-001";
  }

  // Disable remote LLM/embed localhost fallback (no local servers running)
  // This prevents ClawMem from trying localhost:8088/8089 and spamming errors
  env.CLAWMEM_REMOTE_LLM_URL = "";
  env.CLAWMEM_REMOTE_EMBED_URL = config.geminiKey
    ? "https://generativelanguage.googleapis.com/v1beta/openai"
    : "";

  const bunBin = path.join(os.homedir(), ".bun/bin");
  if (await commandExists(path.join(bunBin, "clawmem"))) {
    log.success("ClawMem already installed");
  } else {
    await runWithSpinner("Installing ClawMem", path.join(os.homedir(), ".bun/bin/bun"), ["install", "-g", "clawmem"], { env });
  }

  const clawmem = path.join(bunBin, "clawmem");
  const workspace = path.join(os.homedir(), "workspace");

  // Bootstrap: initialize collection + index files
  try {
    await run(clawmem, ["bootstrap", workspace, "--name", "workspace"], { env, allowFail: true });
  } catch {
    log.warn("ClawMem bootstrap had errors (non-fatal, memory will work with keyword search)");
  }

  // Verify .clawmem directory was created
  const clawmemDir = path.join(workspace, ".clawmem");
  if (!fs.existsSync(clawmemDir)) {
    log.warn("ClawMem directory not created. Initializing manually...");
    try {
      await run(clawmem, ["init", workspace], { env, allowFail: true });
      await run(clawmem, ["collection", "add", workspace, "--name", "workspace"], { env, allowFail: true });
    } catch {
      log.warn("Could not initialize ClawMem. Memory will use keyword search only.");
    }
  }

  // Setup hooks and MCP
  await run(clawmem, ["setup", "hooks"], { env, allowFail: true });
  await run(clawmem, ["setup", "mcp"], { env, allowFail: true });

  log.success("ClawMem configured");
}
