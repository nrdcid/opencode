import path from "path"
import { execFile } from "child_process"
import { promisify } from "util"
import { Flock } from "@opencode-ai/core/util/flock"
import { readJson, writeJsonAtomic } from "./persistence"

const exec = promisify(execFile)
const week = 7 * 24 * 60 * 60 * 1000
// Resolve the running source tree, not the user's current project.
const source = path.resolve(import.meta.dir, "../../../..")

export async function checkUpstreamUpdate(input: { state: string; repo?: string; now?: number }) {
  const repo = input.repo ?? source
  const file = path.join(input.state, `upstream-update-${Bun.hash(repo).toString(16)}.json`)
  return Flock.withLock(
    file,
    async () => {
      const now = input.now ?? Date.now()
      const previous = await readJson<{ checked?: number; notified?: string }>(file).catch(() => undefined)
      if (typeof previous?.checked === "number" && now - previous.checked < week) return

      // Record attempts too, so offline startups don't retry on every launch.
      await writeJsonAtomic(file, { checked: now, notified: previous?.notified })
      if ((await git(repo, "rev-parse", "--show-toplevel")) !== repo) return
      await git(
        repo,
        "fetch",
        "--quiet",
        "--no-tags",
        "--no-write-fetch-head",
        "upstream",
        "+refs/heads/dev:refs/remotes/upstream/dev",
      )
      const tip = await git(repo, "rev-parse", "refs/remotes/upstream/dev")
      if (tip === previous?.notified) return
      if (Number(await git(repo, "rev-list", "--count", "HEAD..refs/remotes/upstream/dev")) === 0) return
      await writeJsonAtomic(file, { checked: now, notified: tip })
      return true
    },
    { dir: path.join(input.state, "locks"), timeoutMs: 1000 },
  ).catch(() => undefined)
}

async function git(cwd: string, ...args: string[]) {
  const result = await exec("git", args, {
    cwd,
    timeout: 15_000,
    killSignal: "SIGKILL",
    env: { ...process.env, GIT_TERMINAL_PROMPT: "0", GIT_SSH_COMMAND: "ssh -oBatchMode=yes -oConnectTimeout=10" },
    windowsHide: true,
  })
  return result.stdout.trim()
}
