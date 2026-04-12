import chalk from "chalk";
import { banner, log } from "../utils/logger.js";
import fs from "fs";
import os from "os";
import path from "path";

const gold = chalk.hex("#FFD700");

export async function agents() {
  banner();

  const configPath = path.join(os.homedir(), "workspace/.sento-config.json");

  if (!fs.existsSync(configPath)) {
    log.error("No agent config found. Run 'sento init' first.");
    return;
  }

  const config = JSON.parse(fs.readFileSync(configPath, "utf-8"));
  const paired = config.pairedAgents || {};
  const names = Object.keys(paired);

  console.log("");
  console.log(`  ${gold.bold("This agent:")}`);
  console.log(`  Name: ${config.agentName}`);
  console.log(`  Code: ${config.agentCode}`);
  console.log(`  Port: ${config.commsPort || 9876}`);
  console.log("");

  if (names.length === 0) {
    console.log(chalk.dim("  No paired agents. Run 'sento pair' to connect with another agent."));
  } else {
    console.log(`  ${gold.bold("Paired agents:")}`);
    for (const name of names) {
      const p = paired[name];
      console.log(`  ${gold("●")} ${name} — ${p.host}:${p.port} (${p.code})`);
    }
  }
  console.log("");
}
