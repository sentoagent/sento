import inquirer from "inquirer";
import chalk from "chalk";
import http from "http";
import { banner, log } from "../utils/logger.js";
import fs from "fs";
import os from "os";
import path from "path";

const gold = chalk.hex("#FFD700");

export async function pair() {
  banner();
  log.step("Agent Pairing");

  const home = os.homedir();
  const configPath = path.join(home, "workspace/.sento-config.json");

  if (!fs.existsSync(configPath)) {
    log.error("No agent config found. Run 'sento init' first.");
    process.exit(1);
  }

  const config = JSON.parse(fs.readFileSync(configPath, "utf-8"));

  console.log(`  Your agent code: ${gold.bold(config.agentCode)}`);
  console.log(`  Your comms port: ${gold(config.commsPort || 9876)}`);
  console.log("");

  const { action } = await inquirer.prompt([{
    type: "list",
    name: "action",
    message: "What do you want to do?",
    choices: [
      { name: "Send a pairing request to another agent", value: "request" },
      { name: "View my agent code (share with others)", value: "code" },
      { name: "View paired agents", value: "list" },
      { name: "Remove a paired agent", value: "remove" },
    ],
  }]);

  if (action === "code") {
    console.log("");
    console.log(`  Share this with the other agent's owner:`);
    console.log("");
    console.log(`  ${gold.bold("Agent Code:")} ${config.agentCode}`);
    console.log(`  ${gold.bold("Agent Name:")} ${config.agentName}`);
    console.log(`  ${gold.bold("Comms Port:")} ${config.commsPort || 9876}`);
    console.log("");
    console.log(chalk.dim("  The other agent's owner needs your host address and this info to pair."));
    console.log("");
  }

  if (action === "request") {
    const answers = await inquirer.prompt([
      {
        type: "input",
        name: "host",
        message: "Other agent's host (IP or domain):",
        validate: (v) => v.trim().length > 0 || "Required",
      },
      {
        type: "number",
        name: "port",
        message: "Other agent's comms port:",
        default: 9876,
      },
    ]);

    log.info("Sending pairing request...");

    const requestData = JSON.stringify({
      fromName: config.agentName,
      fromCode: config.agentCode,
      fromHost: answers.host, // This should be OUR host for them to call back
      fromPort: config.commsPort || 9876,
    });

    // Ask for our own host address so the other agent can reach us
    const { myHost } = await inquirer.prompt([{
      type: "input",
      name: "myHost",
      message: "Your host address (how the other agent reaches you):",
      suffix: chalk.dim("\n  Your public IP or domain name\n  >"),
      validate: (v) => v.trim().length > 0 || "Required",
    }]);

    const correctedData = JSON.stringify({
      fromName: config.agentName,
      fromCode: config.agentCode,
      fromHost: myHost.trim(),
      fromPort: config.commsPort || 9876,
    });

    try {
      await new Promise((resolve, reject) => {
        const req = http.request({
          hostname: answers.host.trim(),
          port: answers.port,
          path: "/pair-request",
          method: "POST",
          headers: { "Content-Type": "application/json", "Content-Length": correctedData.length },
          timeout: 10000,
        }, (res) => {
          let body = "";
          res.on("data", (c) => { body += c; });
          res.on("end", () => {
            if (res.statusCode === 200) resolve(body);
            else reject(new Error("Rejected: " + body));
          });
        });
        req.on("error", reject);
        req.on("timeout", () => { req.destroy(); reject(new Error("Connection timed out")); });
        req.write(correctedData);
        req.end();
      });

      log.success("Pairing request sent! Waiting for the other agent's owner to accept.");
      log.dim("They'll see a notification on Discord. Once they reply 'accept', you'll be paired.");
    } catch (err) {
      log.error("Could not reach the other agent: " + err.message);
      log.dim("Make sure the other agent's Guardian is running and the port is open.");
    }
  }

  if (action === "list") {
    const paired = config.pairedAgents || {};
    const names = Object.keys(paired);
    console.log("");
    if (names.length === 0) {
      log.info("No paired agents yet.");
    } else {
      for (const name of names) {
        const p = paired[name];
        console.log(`  ${gold.bold(name)} — ${p.host}:${p.port} (code: ${p.code})`);
      }
    }
    console.log("");
  }

  if (action === "remove") {
    const paired = config.pairedAgents || {};
    const names = Object.keys(paired);
    if (names.length === 0) {
      log.info("No paired agents to remove.");
      return;
    }

    const { name } = await inquirer.prompt([{
      type: "list",
      name: "name",
      message: "Remove which agent?",
      choices: names,
    }]);

    delete config.pairedAgents[name];
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
    log.success(`Unpaired from ${name}.`);
  }
}
