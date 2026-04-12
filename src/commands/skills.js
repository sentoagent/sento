import chalk from "chalk";
import { banner, log } from "../utils/logger.js";
import { run, runWithSpinner } from "../utils/exec.js";
import fs from "fs";
import os from "os";
import path from "path";

const gold = chalk.hex("#FFD700");

export async function skills(action) {
  banner();

  const home = os.homedir();
  const customSkills = path.join(home, "workspace/skills/custom");
  const env = {
    ...process.env,
    PATH: `${home}/.npm-global/bin:${home}/.bun/bin:${process.env.PATH}`,
    CLAUDE_CODE_OAUTH_TOKEN: process.env.CLAUDE_CODE_OAUTH_TOKEN || (() => {
      try {
        const bashrc = fs.readFileSync(path.join(home, ".bashrc"), "utf-8");
        return bashrc.match(/CLAUDE_CODE_OAUTH_TOKEN=(.*)/)?.[1] || "";
      } catch { return ""; }
    })(),
  };

  if (action === "list" || !action) {
    log.step("Installed Skills");

    // Plugins (from Claude Code)
    console.log("");
    console.log(gold.bold("  Plugins:"));
    try {
      const { stdout } = await run("claude", ["plugin", "list"], { env, allowFail: true });
      if (stdout) {
        console.log(stdout.split("\n").map((l) => "  " + l).join("\n"));
      }
    } catch {
      log.dim("Could not list plugins. Is Claude Code installed?");
    }

    // Custom skills (agent-created)
    console.log("");
    console.log(gold.bold("  Custom skills (agent-created):"));
    fs.mkdirSync(customSkills, { recursive: true });
    const skills = fs.readdirSync(customSkills).filter((f) => f.endsWith(".md") || f.endsWith(".txt"));
    if (skills.length === 0) {
      log.dim("No custom skills yet. The agent creates these automatically after complex tasks.");
    } else {
      for (const skill of skills) {
        const content = fs.readFileSync(path.join(customSkills, skill), "utf-8");
        const firstLine = content.split("\n")[0].replace(/^#\s*/, "").trim();
        console.log(`  ${gold("●")} ${skill} — ${firstLine || "no description"}`);
      }
    }
    console.log("");
  }

  if (action === "install") {
    log.step("Install a Plugin");
    log.info("Available plugins from the marketplace:\n");

    const plugins = [
      "discord", "telegram", "slack", "imessage",
      "superpowers", "context7", "code-review", "code-simplifier",
      "commit-commands", "feature-dev", "frontend-design", "hookify",
      "pr-review-toolkit", "security-guidance", "skill-creator",
      "claude-md-management", "typescript-lsp",
    ];

    for (const p of plugins) {
      console.log(`  ${gold("●")} ${p}@claude-plugins-official`);
    }
    console.log("");

    const inquirer = await import("inquirer");
    const { plugin } = await inquirer.default.prompt([{
      type: "input",
      name: "plugin",
      message: "Plugin name to install (e.g. context7):",
    }]);

    if (plugin) {
      const name = plugin.includes("@") ? plugin : `${plugin}@claude-plugins-official`;
      await runWithSpinner(`Installing ${name}`, "claude", ["plugin", "install", name], { env });
    }
  }

  if (action === "export") {
    log.step("Export a Custom Skill");
    const skills = fs.readdirSync(customSkills).filter((f) => f.endsWith(".md") || f.endsWith(".txt"));
    if (skills.length === 0) {
      log.error("No custom skills to export.");
      return;
    }

    const inquirer = await import("inquirer");
    const { skill } = await inquirer.default.prompt([{
      type: "list",
      name: "skill",
      message: "Which skill to export?",
      choices: skills,
    }]);

    const dest = path.join(home, `${skill}`);
    fs.copyFileSync(path.join(customSkills, skill), dest);
    log.success(`Exported to ~/${skill}. Share this file with other Sentō agents.`);
  }

  if (action === "import") {
    log.step("Import a Skill");
    const inquirer = await import("inquirer");
    const { filePath } = await inquirer.default.prompt([{
      type: "input",
      name: "filePath",
      message: "Path to skill file:",
    }]);

    if (!fs.existsSync(filePath)) {
      log.error("File not found: " + filePath);
      return;
    }

    const dest = path.join(customSkills, path.basename(filePath));
    fs.copyFileSync(filePath, dest);
    log.success(`Imported ${path.basename(filePath)} to custom skills.`);
  }
}
