import fs from "fs";
import os from "os";
import path from "path";
import { log } from "../utils/logger.js";

export async function configureSettings() {
  log.step("Configuring settings...");

  const claudeDir = path.join(os.homedir(), ".claude");
  fs.mkdirSync(claudeDir, { recursive: true });

  // Skip dangerous mode prompt
  const settingsPath = path.join(claudeDir, "settings.json");
  let settings = {};
  if (fs.existsSync(settingsPath)) {
    try { settings = JSON.parse(fs.readFileSync(settingsPath, "utf-8")); } catch {}
  }
  settings.skipDangerousModePermissionPrompt = true;
  fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2));

  // Pre-trust the workspace folder so Claude Code doesn't prompt on first run
  const workspace = path.join(os.homedir(), "workspace");
  const projectSlug = workspace.replace(/\//g, "-");
  const projectDir = path.join(claudeDir, "projects", projectSlug);
  fs.mkdirSync(projectDir, { recursive: true });

  // Add Playwright MCP to .claude.json
  const claudeJsonPath = path.join(os.homedir(), ".claude.json");
  let claudeJson = {};
  if (fs.existsSync(claudeJsonPath)) {
    try { claudeJson = JSON.parse(fs.readFileSync(claudeJsonPath, "utf-8")); } catch {}
  }
  if (!claudeJson.mcpServers) claudeJson.mcpServers = {};
  claudeJson.mcpServers.playwright = {
    command: "npx",
    args: ["@playwright/mcp"],
    env: { DISPLAY: ":99" },
  };
  fs.writeFileSync(claudeJsonPath, JSON.stringify(claudeJson, null, 2));

  log.success("Settings configured");
}
