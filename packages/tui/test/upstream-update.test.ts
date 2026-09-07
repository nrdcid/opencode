import { afterEach, expect, test } from "bun:test"
import { mkdtemp, rm } from "fs/promises"
import { tmpdir } from "os"
import path from "path"
import { checkUpstreamUpdate } from "../src/util/upstream-update"

const roots: string[] = []
const week = 7 * 24 * 60 * 60 * 1000

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

async function git(cwd: string, ...args: string[]) {
  const proc = Bun.spawn(["git", ...args], {
    cwd,
    env: { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1" },
    stdout: "pipe",
    stderr: "pipe",
  })
  const output = await new Response(proc.stdout).text()
  if (await proc.exited) throw new Error(await new Response(proc.stderr).text())
  return output.trim()
}

async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), "opencode-upstream-"))
  roots.push(root)
  const upstream = path.join(root, "upstream")
  const repo = path.join(root, "fork")
  await git(root, "init", "-b", "dev", upstream)
  await git(
    upstream,
    "-c",
    "user.name=Test",
    "-c",
    "user.email=test@example.com",
    "commit",
    "--allow-empty",
    "-m",
    "initial",
  )
  await git(root, "clone", upstream, repo)
  await git(repo, "remote", "rename", "origin", "upstream")
  return { root, upstream, repo, state: path.join(root, "state") }
}

async function advance(repo: string) {
  await git(
    repo,
    "-c",
    "user.name=Test",
    "-c",
    "user.email=test@example.com",
    "commit",
    "--allow-empty",
    "-m",
    crypto.randomUUID(),
  )
}

test("checks weekly, announces each new upstream tip once, and preserves the checkout", async () => {
  const input = await fixture()
  const head = await git(input.repo, "rev-parse", "HEAD")
  expect(await checkUpstreamUpdate({ ...input, now: week })).toBeUndefined()
  await advance(input.upstream)
  expect(await checkUpstreamUpdate({ ...input, now: week + 1 })).toBeUndefined()
  expect(await checkUpstreamUpdate({ ...input, now: week * 2 })).toBe(true)
  expect(await checkUpstreamUpdate({ ...input, now: week * 3 })).toBeUndefined()
  await advance(input.upstream)
  expect(await checkUpstreamUpdate({ ...input, now: week * 4 })).toBe(true)
  expect(await git(input.repo, "rev-parse", "HEAD")).toBe(head)
  expect(await git(input.repo, "status", "--porcelain")).toBe("")
})

test("detects upstream changes even when the fork has its own commits", async () => {
  const input = await fixture()
  await advance(input.repo)
  await advance(input.upstream)
  expect(await checkUpstreamUpdate({ ...input, now: week })).toBe(true)
})

test("stays silent when upstream is already incorporated", async () => {
  const input = await fixture()
  await advance(input.repo)
  expect(await checkUpstreamUpdate({ ...input, now: week })).toBeUndefined()
})

test("failed checks are silent and rate limited", async () => {
  const input = await fixture()
  await git(input.repo, "remote", "set-url", "upstream", path.join(input.root, "missing"))
  expect(await checkUpstreamUpdate({ ...input, now: week })).toBeUndefined()
  await git(input.repo, "remote", "set-url", "upstream", input.upstream)
  await advance(input.upstream)
  expect(await checkUpstreamUpdate({ ...input, now: week + 1 })).toBeUndefined()
  expect(await checkUpstreamUpdate({ ...input, now: week * 2 })).toBe(true)
})

test("concurrent startups only announce once", async () => {
  const input = await fixture()
  await advance(input.upstream)
  const results = await Promise.all([checkUpstreamUpdate(input), checkUpstreamUpdate(input)])
  expect(results.filter(Boolean)).toHaveLength(1)
})

test("ignores directories outside a source checkout and missing remotes", async () => {
  const input = await fixture()
  expect(await checkUpstreamUpdate({ ...input, repo: input.root })).toBeUndefined()
  await git(input.repo, "remote", "remove", "upstream")
  expect(await checkUpstreamUpdate(input)).toBeUndefined()
})
