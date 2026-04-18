import fs from "fs";
import os from "os";
import path from "path";
import { spawn } from "child_process";
import { log } from "../utils/logger.js";

function appendToFile(filePath, key, value) {
  const content = fs.existsSync(filePath) ? fs.readFileSync(filePath, "utf-8") : "";
  const line = `export ${key}=${value}`;
  if (content.includes(`export ${key}=`)) {
    const updated = content.replace(new RegExp(`export ${key}=.*`, "g"), line);
    fs.writeFileSync(filePath, updated);
  } else {
    fs.appendFileSync(filePath, line + "\n");
  }
}

function runSetupToken(claudeBin, env) {
  return new Promise((resolve, reject) => {
    const child = spawn(claudeBin, ["setup-token"], {
      stdio: ["inherit", "pipe", "inherit"],
      env,
      timeout: 180000,
    });

    let output = "";
    let urlPrinted = false;

    child.stdout.on("data", (chunk) => {
      const text = chunk.toString();
      output += text;

      // Check for URL
      if (!urlPrinted) {
        const urlMatch = text.match(/https:\/\/claude\.com\S+/);
        if (urlMatch) {
          console.log("\n  Open this URL on your phone or laptop:\n");
          console.log(`  ${urlMatch[0]}\n`);
          console.log("  After logging in, paste the authorization code below.");
          console.log("  (This is NOT your Discord/Telegram bot token)");
          console.log("  Note: the code won't be visible as you type. That is normal. Just paste once and press Enter.\n");
          urlPrinted = true;
          return;
        }
      }

      // Before URL: suppress banner spam
      if (!urlPrinted) return;

      // After URL: pass through everything (code prompt, token, etc.)
      // but still suppress banner art if it re-renders
      if (text.includes("█") || text.includes("░") || text.includes("▓") ||
          text.includes("………") || text.includes("Welcome to Claude")) return;

      process.stdout.write(text);
    });

    child.on("close", (code) => {
      const match = output.match(/sk-ant-oat01-\S+/);
      if (match) {
        resolve(match[0]);
      } else if (code === 0) {
        reject(new Error("setup-token completed but no token found in output"));
      } else {
        reject(new Error(`setup-token exited with code ${code}`));
      }
    });

    child.on("error", reject);
  });
}

export async function configureAuth(config) {
  log.step("Configuring authentication...");

  const bashrc = path.join(os.homedir(), ".bashrc");
  const claudeBin = path.join(os.homedir(), ".npm-global/bin/claude");

  appendToFile(bashrc, "DISPLAY", ":99");
  appendToFile(bashrc, "PATH", "$HOME/.npm-global/bin:$HOME/.bun/bin:$PATH");

  const profile = path.join(os.homedir(), ".profile");
  const profileContent = fs.existsSync(profile) ? fs.readFileSync(profile, "utf-8") : "";
  if (!profileContent.includes(".bashrc")) {
    fs.appendFileSync(profile, '\nif [ -f "$HOME/.bashrc" ]; then . "$HOME/.bashrc"; fi\n');
  }

  if (config.geminiKey) {
    appendToFile(bashrc, "GEMINI_API_KEY", config.geminiKey);
    appendToFile(bashrc, "CLAWMEM_EMBED_URL", "https://generativelanguage.googleapis.com/v1beta/openai");
    appendToFile(bashrc, "CLAWMEM_EMBED_API_KEY", config.geminiKey);
    appendToFile(bashrc, "CLAWMEM_EMBED_MODEL", "gemini-embedding-001");
  }

  const claudeJson = path.join(os.homedir(), ".claude.json");
  let claudeConfig = {};
  if (fs.existsSync(claudeJson)) {
    try { claudeConfig = JSON.parse(fs.readFileSync(claudeJson, "utf-8")); } catch {}
  }
  claudeConfig.hasCompletedOnboarding = true;
  fs.writeFileSync(claudeJson, JSON.stringify(claudeConfig, null, 2));

  // If token already provided (backward compat), use it directly
  if (config.oauthToken) {
    appendToFile(bashrc, "CLAUDE_CODE_OAUTH_TOKEN", config.oauthToken);
    log.success("Auth configured");
    return;
  }

  // Run claude setup-token inline — user sees URL, opens on phone, token captured
  const env = {
    ...process.env,
    PATH: `${os.homedir()}/.npm-global/bin:${os.homedir()}/.bun/bin:${process.env.PATH}`,
  };

  log.info("Authenticating with Claude...");
  log.info("A URL will appear below. Open it on your phone or laptop to log in.\n");

  try {
    const token = await runSetupToken(claudeBin, env);
    config.oauthToken = token;
    appendToFile(bashrc, "CLAUDE_CODE_OAUTH_TOKEN", token);
    console.log("");
    log.success("Auth configured");
  } catch (err) {
    log.error(`Authentication failed: ${err.message}`);
    log.info("You can run 'claude setup-token' manually and then 'sento config' to set the token.");
    throw err;
  }
}
