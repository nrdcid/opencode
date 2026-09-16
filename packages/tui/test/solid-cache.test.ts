import { afterEach, expect, test } from "bun:test"
import { mkdtemp, rm } from "fs/promises"
import os from "os"
import path from "path"
import { createCachedSolidPlugin } from "../src/solid-cache"

const roots: string[] = []
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), "opencode-solid-cache-"))
  roots.push(root)
  const source = path.join(root, "entry.tsx")
  const directory = path.join(root, "cache")
  await Bun.write(source, "export const value: number = 1")
  return { root, source, directory }
}

async function build(source: string, directory: string, version = "test") {
  const result = await Bun.build({
    entrypoints: [source],
    target: "bun",
    external: ["@opentui/solid"],
    plugins: [createCachedSolidPlugin({ directory, version })],
  })
  expect(result.success).toBe(true)
  return result.outputs[0].text()
}

test("reuses transformed source and invalidates edits and dependency versions", async () => {
  const input = await fixture()
  const first = await build(input.source, input.directory)
  const files = await Array.fromAsync(new Bun.Glob("*.js").scan(input.directory))
  expect(files).toHaveLength(1)
  const cached = Bun.file(path.join(input.directory, files[0]))
  const modified = (await cached.stat()).mtimeMs
  expect(await build(input.source, input.directory)).toBe(first)
  expect((await cached.stat()).mtimeMs).toBe(modified)

  await Bun.write(input.source, "export const value: number = 2")
  expect(await build(input.source, input.directory)).not.toBe(first)
  expect(await Array.fromAsync(new Bun.Glob("*.js").scan(input.directory))).toHaveLength(2)
  await build(input.source, input.directory, "updated dependencies")
  expect(await Array.fromAsync(new Bun.Glob("*.js").scan(input.directory))).toHaveLength(3)
})

test("cache write failures do not prevent loading source", async () => {
  const input = await fixture()
  expect(await build(input.source, path.join(input.source, "not-a-directory"))).toContain("value = 1")
})

test("cached JSX keeps the Solid transform", async () => {
  const input = await fixture()
  await Bun.write(input.source, "export const view = () => <text>Hello</text>")
  const first = await build(input.source, input.directory)
  expect(first).toContain("@opentui/solid")
  expect(first).not.toContain("react/jsx")
  expect(await build(input.source, input.directory)).toBe(first)
})
