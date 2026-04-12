import { execa } from "execa";
import ora from "ora";

export async function run(cmd, args = [], opts = {}) {
  const result = await execa(cmd, args, { ...opts, reject: false });
  if (result.exitCode !== 0 && !opts.allowFail) {
    throw new Error(result.stderr || result.stdout || `Command failed: ${cmd} ${args.join(" ")}`);
  }
  return result;
}

export async function runWithSpinner(label, cmd, args = [], opts = {}) {
  const spinner = ora({ text: label, color: "yellow" }).start();
  try {
    const result = await run(cmd, args, opts);
    spinner.succeed();
    return result;
  } catch (err) {
    spinner.fail();
    throw err;
  }
}

export async function commandExists(cmd) {
  try {
    await execa("which", [cmd]);
    return true;
  } catch {
    return false;
  }
}

export async function getVersion(cmd, args = ["--version"]) {
  try {
    const result = await execa(cmd, args);
    return result.stdout.trim();
  } catch {
    return null;
  }
}
