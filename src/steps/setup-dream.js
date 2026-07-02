import fs from "fs";
import os from "os";
import path from "path";
import { run } from "../utils/exec.js";
import { log } from "../utils/logger.js";
import {
  renderDreamPrompt, renderSelfTemplate, renderDreamingSection,
  renderConsolidatePrompt, renderCouncilPrompt, renderFleetSeed,
} from "../templates/dream.js";

// Scaffolds the Dream Engine + Fleet Brain + weekly consolidation. Idempotent +
// non-destructive — SELF.md and evolving files are never clobbered, so it's safe
// to re-run via `sento update` on a living agent.
//
// Env knobs (for multi-agent fleets on one box):
//   SENTO_FLEET_DIR      shared fleet-brain dir (default ~/sento-fleet). Point every
//                        agent at the same group-writable path (e.g. /srv/sento-fleet).
//   SENTO_FLEET_COUNCIL=1  make THIS agent the weekly council (curates FLEET.md).
//                          Enable on exactly one agent per fleet.
export async function setupDream(config) {
  log.step("Setting up dream engine + fleet brain...");

  const workspace = path.join(os.homedir(), "workspace");
  const memory = path.join(workspace, "memory");
  fs.mkdirSync(path.join(memory, "dreams"), { recursive: true });

  const fleetDir = process.env.SENTO_FLEET_DIR || path.join(os.homedir(), "sento-fleet");
  const council = process.env.SENTO_FLEET_COUNCIL === "1";

  const writeIfMissing = (p, content) => { if (!fs.existsSync(p)) fs.writeFileSync(p, content); };

  // Private evolving files — create once, NEVER overwrite (they hold the agent's growth).
  writeIfMissing(path.join(memory, "SELF.md"), renderSelfTemplate(config));
  writeIfMissing(path.join(memory, "PREP.md"), "# PREP — what's coming up (I read this first thing)\n- (the dream fills this)\n");
  writeIfMissing(path.join(memory, "episodes.jsonl"), "");

  // Fleet Brain shared store. Best-effort: a locked-down shared dir may already be
  // provisioned by the operator and not writable at this step — that's fine.
  try {
    fs.mkdirSync(path.join(fleetDir, "candidates", "archive"), { recursive: true });
    writeIfMissing(path.join(fleetDir, "FLEET.md"), renderFleetSeed());
  } catch { /* shared dir provisioned externally */ }

  // Prompts are templates, not state — always refresh.
  fs.writeFileSync(path.join(workspace, "dream-prompt.txt"), renderDreamPrompt(config, fleetDir));
  fs.writeFileSync(path.join(workspace, "consolidate-prompt.txt"), renderConsolidatePrompt());
  fs.writeFileSync(path.join(workspace, "council-prompt.txt"), renderCouncilPrompt(fleetDir));

  // Ensure CLAUDE.md carries the CURRENT Dreaming & Growth section (fleet-read + ledger).
  // Replace any older block so a `sento update` upgrades it in place.
  const claudeMdPath = path.join(workspace, "CLAUDE.md");
  if (fs.existsSync(claudeMdPath)) {
    let md = fs.readFileSync(claudeMdPath, "utf-8");
    const current = md.includes("Dreaming & Growth") && md.includes(`${fleetDir}/FLEET.md`);
    if (!current) {
      md = md.replace(/\n?## Dreaming & Growth[\s\S]*?(?=\n## |\s*$)/, "").trimEnd();
      md += "\n\n" + renderDreamingSection(fleetDir) + "\n";
      fs.writeFileSync(claudeMdPath, md);
    }
  }

  // Crons (Linux): nightly dream + weekly consolidation (+ weekly council if designated).
  if (os.platform() === "linux") {
    try {
      const { stdout } = await run("crontab", ["-l"], { allowFail: true });
      const keep = (stdout || "").split("\n")
        .filter((l) => !l.includes("dream-prompt") && !l.includes("consolidate-prompt") && !l.includes("council-prompt"))
        .filter((l) => !(l.includes("55 3") && l.includes("clawmem")))
        .filter((l) => l.trim());
      const N = config.agentName;
      keep.push(`55 3 * * * ~/workspace/cron-trigger.sh ${N} "$(cat ~/workspace/dream-prompt.txt)"`);
      keep.push(`15 4 * * 0 ~/workspace/cron-trigger.sh ${N} "$(cat ~/workspace/consolidate-prompt.txt)"`);
      if (council) {
        keep.push(`30 4 * * 0 ~/workspace/cron-trigger.sh ${N} "$(cat ~/workspace/council-prompt.txt)"`);
      }
      const newCron = keep.join("\n") + "\n";
      await run("bash", ["-c", `echo '${newCron.replace(/'/g, "'\\''")}' | crontab -`]);
      log.success(`Dreams scheduled (nightly 03:55 UTC + weekly consolidation${council ? " + council" : ""})`);
    } catch {
      log.warn("Could not set up dream crons. Add them manually.");
    }
  }

  log.success(`Dream engine + fleet brain ready${council ? " (this agent is the fleet council)" : ""}`);
}
