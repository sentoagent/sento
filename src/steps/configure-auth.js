import fs from "fs";
import os from "os";
import path from "path";
import { log } from "../utils/logger.js";

function appendToFile(filePath, key, value) {
  const content = fs.existsSync(filePath) ? fs.readFileSync(filePath, "utf-8") : "";
  const line = `export ${key}=${value}`;
  if (content.includes(`export ${key}=`)) {
    // Replace existing
    const updated = content.replace(new RegExp(`export ${key}=.*`, "g"), line);
    fs.writeFileSync(filePath, updated);
  } else {
    fs.appendFileSync(filePath, line + "\n");
  }
}

export async function configureAuth(config) {
  log.step("Configuring authentication...");

  const bashrc = path.join(os.homedir(), ".bashrc");

  appendToFile(bashrc, "CLAUDE_CODE_OAUTH_TOKEN", config.oauthToken);
  appendToFile(bashrc, "DISPLAY", ":99");
  appendToFile(bashrc, "PATH", "$HOME/.npm-global/bin:$HOME/.bun/bin:$PATH");

  if (config.geminiKey) {
    appendToFile(bashrc, "GEMINI_API_KEY", config.geminiKey);
    appendToFile(bashrc, "CLAWMEM_EMBED_URL", "https://generativelanguage.googleapis.com/v1beta/openai");
    appendToFile(bashrc, "CLAWMEM_EMBED_API_KEY", config.geminiKey);
    appendToFile(bashrc, "CLAWMEM_EMBED_MODEL", "gemini-embedding-001");
  }

  // Create .claude.json with onboarding complete
  const claudeJson = path.join(os.homedir(), ".claude.json");
  let claudeConfig = {};
  if (fs.existsSync(claudeJson)) {
    try { claudeConfig = JSON.parse(fs.readFileSync(claudeJson, "utf-8")); } catch {}
  }
  claudeConfig.hasCompletedOnboarding = true;
  fs.writeFileSync(claudeJson, JSON.stringify(claudeConfig, null, 2));

  log.success("Auth configured");
}
