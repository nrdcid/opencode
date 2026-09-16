import { plugin } from "bun"
import { createHash } from "crypto"
import os from "os"
import path from "path"
import { createCachedSolidPlugin } from "./solid-cache"

// Source edits are checked per file; the lockfile invalidates compiler dependency changes.
const lock = await Bun.file(path.resolve(import.meta.dir, "../../../bun.lock")).text()
plugin(
  createCachedSolidPlugin({
    directory: path.join(
      process.env.XDG_CACHE_HOME ?? path.join(os.homedir(), ".cache"),
      "opencode",
      "solid-transform-v1",
    ),
    version: createHash("sha256").update(lock).digest("hex"),
  }),
)
