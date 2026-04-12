import chalk from "chalk";

const gold = chalk.hex("#FFD700");

export const log = {
  info: (msg) => console.log(gold("  " + msg)),
  success: (msg) => console.log(gold("  ✓ " + msg)),
  warn: (msg) => console.log(chalk.yellow("  ⚠ " + msg)),
  error: (msg) => console.log(chalk.red("  ✗ " + msg)),
  step: (msg) => console.log(gold.bold("\n" + msg)),
  dim: (msg) => console.log(chalk.dim("    " + msg)),
};

export function banner() {
  const c = chalk.hex("#FFD700");
  console.log("");
  console.log(c("    ▗▄▄▖ ▗▄▄▄▖▗▖  ▗▖▗▄▄▄▖ ▗▄▖"));
  console.log(c("   ▐▌    ▐▌   ▐▛▚▖▐▌  █  ▐▌ ▐▌"));
  console.log(c("    ▝▀▚▖ ▐▛▀▀▘▐▌ ▝▜▌  █  ▐▌ ▐▌"));
  console.log(c("   ▗▄▄▞▘ ▐▙▄▄▖▐▌  ▐▌  █  ▝▚▄▞▘"));
  console.log(c("                           戦闘"));
  console.log("");
  console.log(chalk.dim("   Agents sent to fight your battles · v1.0.0"));
  console.log("");
}
