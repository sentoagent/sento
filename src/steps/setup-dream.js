import fs from "fs";
import os from "os";
import path from "path";
import { run } from "../utils/exec.js";
import { log } from "../utils/logger.js";
import { renderDreamPrompt, renderSelfTemplate, renderDreamingSection } from "../templates/dream.js";

// Scaffolds the Dream Engine: the private memory files, the silent nightly
// dream prompt, and the cron that fires it. Idempotent + non-destructive —
// SELF.md and the evolving memory files are never clobbered, so this is safe
// to run again via `sento update` on an already-living agent.
export async function setupDream(config) {
  log.step("Setting up dream engine...");

  const workspace = path.join(os.homedir(), "workspace");
  const memory = path.join(workspace, "memory");
  fs.mkdirSync(path.join(memory, "dreams"), { recursive: true });

  const writeIfMissing = (p, content) => {
    if (!fs.existsSync(p)) fs.writeFileSync(p, content);
  };

  // Evolving files — create once, NEVER overwrite (they hold the agent's growth).
  writeIfMissing(path.join(memory, "SELF.md"), renderSelfTemplate(config));
  writeIfMissing(
    path.join(memory, "PREP.md"),
    "# PREP — what's coming up (I read this first thing)\n- (the dream fills this)\n"
  );
  writeIfMissing(
    path.join(memory, "fleet-candidates.md"),
    "# Fleet candidates — GENERAL facts only (tool/framework quirks), never my views or strategy.\n- (empty)\n"
  );
  writeIfMissing(path.join(memory, "episodes.jsonl"), "");

  // The dream prompt is a template, not state — always refresh it.
  fs.writeFileSync(path.join(workspace, "dream-prompt.txt"), renderDreamPrompt(config));

  // Ensure CLAUDE.md carries the Dreaming & Growth section. New agents already
  // have it (baked into renderClaudeMd); this covers `sento update` retrofits of
  // agents whose CLAUDE.md predates the dream engine. Append only if missing.
  const claudeMdPath = path.join(workspace, "CLAUDE.md");
  if (fs.existsSync(claudeMdPath)) {
    const md = fs.readFileSync(claudeMdPath, "utf-8");
    if (!md.includes("Dreaming & Growth")) {
      fs.writeFileSync(claudeMdPath, md.trimEnd() + "\n\n" + renderDreamingSection() + "\n");
    }
  }

  // Dream cron: 03:55 UTC (11:55 PM ET). It runs `clawmem update` itself, so it
  // replaces any prior clawmem-only 55-3 entry. Leaves @reboot/watchdog crons intact.
  if (os.platform() === "linux") {
    try {
      const { stdout } = await run("crontab", ["-l"], { allowFail: true });
      const existing = stdout || "";
      const filtered = existing
        .split("\n")
        .filter((l) => !l.includes("dream-prompt"))
        .filter((l) => !(l.includes("55 3") && l.includes("clawmem")))
        .filter((l) => l.trim())
        .join("\n");
      const dreamCron = `55 3 * * * ~/workspace/cron-trigger.sh ${config.agentName} "$(cat ~/workspace/dream-prompt.txt)"`;
      const newCron = filtered ? `${filtered}\n${dreamCron}\n` : `${dreamCron}\n`;
      await run("bash", ["-c", `echo '${newCron.replace(/'/g, "'\\''")}' | crontab -`]);
      log.success("Nightly dream scheduled (03:55 UTC / 11:55 PM ET)");
    } catch {
      log.warn("Could not set up the dream cron. Add it manually.");
    }
  }

  log.success("Dream engine ready — the agent reflects, calibrates, and grows nightly");
}
