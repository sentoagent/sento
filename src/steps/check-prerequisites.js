import { commandExists, getVersion, run, runWithSpinner } from "../utils/exec.js";
import { log } from "../utils/logger.js";
import os from "os";
import path from "path";

export async function checkPrerequisites() {
  log.step("Checking prerequisites...");

  if (os.platform() !== "linux" && os.platform() !== "darwin") {
    log.warn(`Running on ${os.platform()}. Sento works best on Linux or macOS.`);
  }

  if (process.getuid?.() === 0) {
    log.warn("Running as root is not recommended. Create a regular user instead.");
  }

  // Node.js
  const nodeVersion = await getVersion("node", ["-v"]);
  if (nodeVersion) {
    const major = parseInt(nodeVersion.replace("v", ""));
    if (major >= 20) {
      log.success(`Node.js ${nodeVersion}`);
    } else {
      throw new Error(`Node.js 20+ required (found ${nodeVersion}). Install: curl -fsSL https://deb.nodesource.com/setup_20.x | sudo bash - && sudo apt-get install -y nodejs`);
    }
  } else {
    throw new Error("Node.js not found. Install: curl -fsSL https://deb.nodesource.com/setup_20.x | sudo bash - && sudo apt-get install -y nodejs");
  }

  // npm
  const npmVersion = await getVersion("npm", ["-v"]);
  if (npmVersion) log.success(`npm ${npmVersion}`);

  // Set npm global prefix to user directory
  const npmGlobal = path.join(os.homedir(), ".npm-global");
  await run("mkdir", ["-p", npmGlobal], { allowFail: true });
  await run("npm", ["config", "set", "prefix", npmGlobal], { allowFail: true });

  // Bun
  const bunPath = path.join(os.homedir(), ".bun/bin/bun");
  if ((await commandExists("bun")) || (await commandExists(bunPath))) {
    const bunVersion = await getVersion("bun", ["--version"]);
    log.success(`Bun ${bunVersion || "found"}`);
  } else {
    log.info("Bun not found. Installing...");
    await runWithSpinner("Installing Bun", "bash", ["-c", "curl -fsSL https://bun.sh/install | bash"], { allowFail: true });
    if (await commandExists(bunPath)) {
      log.success("Bun installed");
    } else {
      log.warn("Bun install may need a shell restart. Continuing anyway.");
    }
  }

  // System packages (Linux only)
  if (os.platform() === "linux") {
    const sysPackages = ["tmux", "git", "python3", "cmake"];
    const missing = [];
    for (const pkg of sysPackages) {
      if (await commandExists(pkg)) {
        log.success(pkg);
      } else {
        missing.push(pkg);
      }
    }

    if (missing.length > 0) {
      log.info(`Missing: ${missing.join(", ")}. Installing...`);
      await runWithSpinner(
        `Installing ${missing.join(", ")}`,
        "sudo",
        ["apt-get", "install", "-y", ...missing, "build-essential"],
        { allowFail: true }
      );
    }

    // Xvfb + Chromium (for Playwright browser automation)
    if (await commandExists("Xvfb")) {
      log.success("Xvfb");
    } else {
      log.info("Xvfb not found. Installing (needed for browser automation)...");
      await runWithSpinner("Installing Xvfb + Chromium", "sudo", [
        "apt-get", "install", "-y", "xvfb", "chromium",
      ], { allowFail: true });
    }
  }
}
