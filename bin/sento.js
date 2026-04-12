#!/usr/bin/env node
import { program } from "commander";
import { init } from "../src/commands/init.js";
import { update } from "../src/commands/update.js";
import { status } from "../src/commands/status.js";
import { config } from "../src/commands/config.js";
import { channels } from "../src/commands/channels.js";
import { skills } from "../src/commands/skills.js";
import { logs } from "../src/commands/logs.js";
import { start, stop, restart } from "../src/commands/process.js";
import { doctor } from "../src/commands/doctor.js";
import { pair } from "../src/commands/pair.js";
import { agents } from "../src/commands/agents.js";

program
  .name("sento")
  .description("Sentō 戦闘 — Agents sent to fight your battles")
  .version("1.0.0");

program
  .command("init")
  .description("Initialize a new AI agent")
  .action(init);

program
  .command("status")
  .description("Check if your agent is running and healthy")
  .action(status);

program
  .command("config")
  .description("Change model, tokens, keys, and settings")
  .action(config);

program
  .command("channels")
  .description("Manage Discord/Telegram/Slack channels")
  .action(channels);

program
  .command("skills")
  .description("List, install, export, or import skills")
  .argument("[action]", "list, install, export, or import", "list")
  .action(skills);

program
  .command("logs")
  .description("View agent output and watchdog history")
  .option("-n, --lines <number>", "Number of lines to show", "30")
  .option("-w, --watchdog", "Show watchdog restart log")
  .action((opts) => logs(opts));

program
  .command("update")
  .description("Update Claude Code, plugins, and re-apply patches")
  .action(update);

program
  .command("start")
  .description("Start the agent")
  .action(start);

program
  .command("stop")
  .description("Stop the agent")
  .action(stop);

program
  .command("restart")
  .description("Restart the agent")
  .action(restart);

program
  .command("doctor")
  .description("Diagnose and fix common issues")
  .option("-f, --fix", "Auto-fix issues where possible")
  .action(doctor);

program
  .command("pair")
  .description("Pair with another Sentō agent for communication")
  .action(pair);

program
  .command("agents")
  .description("List this agent's info and paired agents")
  .action(agents);

program.parse();
