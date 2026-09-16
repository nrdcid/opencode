import type { BunPlugin } from "bun"
import { createSolidTransformPlugin } from "@opentui/solid/bun-plugin"
import { createHash } from "crypto"
import { rename, rm } from "fs/promises"
import path from "path"
import { writeText } from "./util/persistence"

export function createCachedSolidPlugin(input: { directory: string; version: string }): BunPlugin {
  const plugin = createSolidTransformPlugin()
  return {
    name: "opencode-cached-solid",
    setup(build) {
      return plugin.setup({
        ...build,
        onLoad(options, load) {
          return build.onLoad(options, async (args) => {
            const source = await Bun.file(args.path.split(/[?#]/, 1)[0]).text()
            const key = createHash("sha256")
              .update(JSON.stringify([input.version, Bun.version, args.path, source]))
              .digest("hex")
            const file = path.join(input.directory, `${key}.js`)
            const cached = await Bun.file(file)
              .text()
              .catch(() => undefined)
            if (cached !== undefined) return { contents: cached, loader: "js" }
            const result = await load(args)
            if (result?.loader === "js" && typeof result.contents === "string") {
              // Atomic publication keeps simultaneous TUI processes from reading partial output.
              const temporary = `${file}.${crypto.randomUUID()}.tmp`
              await writeText(temporary, result.contents)
                .then(() => rename(temporary, file))
                .catch(() => rm(temporary, { force: true }).catch(() => undefined))
            }
            return result
          })
        },
      })
    },
  }
}
