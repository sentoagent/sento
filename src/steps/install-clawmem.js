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
  // Even with a Gemini key, ClawMem must work if the key is invalid or quota runs out.
  // Strategy: set Gemini as primary, but always ensure local fallback works.
  if (config.geminiKey) {
    env.GEMINI_API_KEY = config.geminiKey;
    env.CLAWMEM_EMBED_URL = "https://generativelanguage.googleapis.com/v1beta/openai";
    env.CLAWMEM_EMBED_API_KEY = config.geminiKey;
    env.CLAWMEM_EMBED_MODEL = "gemini-embedding-001";
  }

  // Disable remote LLM localhost fallback (no local LLM server running)
  // ClawMem tries localhost:8089 for enrichment by default — doesn't exist on VPS
  env.CLAWMEM_REMOTE_LLM_URL = "";
  // If no Gemini key, also disable remote embed (prevents localhost:8088 spam)
  if (!config.geminiKey) {
    env.CLAWMEM_REMOTE_EMBED_URL = "";
  }
  // Always allow local model fallback (works even if Gemini key is bad/expired)
  env.CLAWMEM_LOCAL_FALLBACK = "true";

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
