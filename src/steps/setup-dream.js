import fs from "fs";
import os from "os";
import path from "path";
import { run } from "../utils/exec.js";
import { log } from "../utils/logger.js";
import {
  renderDreamPrompt, renderSelfTemplate, renderDreamingSection,
  renderConsolidatePrompt, renderCouncilPrompt, renderFleetSeed,
  renderCouncilGuard,
} from "../templates/dream.js";
import { discoverAgents, resolveFleetDir, electCurator } from "../utils/fleet.js";

// Scaffolds the Dream Engine + Fleet Brain + weekly consolidation. Idempotent +
// non-destructive — SELF.md and evolving files are never clobbered, so it's safe
// to re-run via `sento update` on a living agent.
//
// The fleet self-organizes — no env knobs required. Agents discover each other on the
// box, share one brain automatically, and elect a curator among themselves (see
// utils/fleet.js). SENTO_FLEET_DIR still overrides if an operator wants a custom path.
//
// This used to require SENTO_FLEET_DIR + SENTO_FLEET_COUNCIL=1, documented only in a
// code comment. Nobody set them, so N agents on one box became N isolated one-member
// fleets with no council — and every init printed "success". Defaults must not fail silently.
export async function setupDream(config) {
  log.step("Setting up dream engine + fleet brain...");

  const workspace = path.join(os.homedir(), "workspace");
  const memory = path.join(workspace, "memory");
  fs.mkdirSync(path.join(memory, "dreams"), { recursive: true });

  // Auto-discovery: alone -> private fleet. Siblings on the box -> we SHARE one, silently.
  const siblings = discoverAgents();
  const fleetDir = resolveFleetDir();
  if (siblings.length > 1) {
    log.success(`Found ${siblings.length} agents on this box — joining the shared fleet brain at ${fleetDir}`);
  }

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

  // Self-electing council guard — same script on every agent, only the curator acts.
  const guardPath = path.join(workspace, "fleet-council.sh");
  fs.writeFileSync(guardPath, renderCouncilGuard(config, fleetDir));
  fs.chmodSync(guardPath, 0o755);

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
      // The council cron ships to EVERY agent. The guard elects the curator at run time
      // (deterministic, monthly rotation) so exactly one acts and the rest exit silently.
      // Nobody designates anything; adding/removing an agent reshuffles the rotation itself.
      keep.push(`30 4 * * 0 ~/workspace/fleet-council.sh`);
      keep.filter((l) => !l.includes("council-prompt.txt")); // drop the old designated-council line
      const newCron = keep.filter((l) => !l.includes("council-prompt.txt")).join("\n") + "\n";
      await run("bash", ["-c", `echo '${newCron.replace(/'/g, "'\\''")}' | crontab -`]);
      log.success("Dreams scheduled (nightly 03:55 + weekly consolidation + self-electing fleet council)");
    } catch {
      log.warn("Could not set up dream crons. Add them manually.");
    }
  }

  const curator = electCurator(siblings);
  if (siblings.length > 1) {
    log.success(`Fleet council rotates monthly — this month's curator: ${curator}${curator === config.agentName ? " (that's you)" : ""}`);
  }
  log.success("Dream engine + fleet brain ready");
}
