// Screenshot downscaling for vision-model payloads.
//
// `sharp` is a native module: it needs a platform-specific .node binary plus
// libvips DLLs. In a packaged app those must be asar-unpacked, and on Windows a
// missing Visual C++ runtime or an AV quarantine can still make the load fail.
// A failed `require("sharp")` previously took the whole screenshot-analysis path
// down with an opaque error, so this module falls back to Electron's built-in
// `nativeImage`, which needs no native dependency at all.

import fs from "node:fs"
import { nativeImage } from "electron"

const isDev = process.env.NODE_ENV === "development"

type SharpModule = typeof import("sharp")

/** null = not yet attempted, false = attempted and unavailable. */
let cachedSharp: SharpModule | false | null = null

function loadSharp(): SharpModule | false {
  if (cachedSharp !== null) return cachedSharp
  try {
    // Lazy + guarded: a hard import at module scope would throw during main
    // process startup rather than at the point of use.
    cachedSharp = require("sharp") as SharpModule
  } catch (err) {
    if (isDev) console.warn("[image] sharp unavailable, using nativeImage fallback:", err)
    cachedSharp = false
  }
  return cachedSharp
}

export interface ResizeOptions {
  maxWidth?: number
  quality?: number
}

/**
 * Downscale an on-disk image to a JPEG buffer.
 * Prefers sharp (better resampling and encoder), falls back to nativeImage.
 */
export async function toResizedJpeg(
  imagePath: string,
  { maxWidth = 1536, quality = 92 }: ResizeOptions = {}
): Promise<Buffer> {
  const sharp = loadSharp()
  if (sharp) {
    try {
      return await sharp(imagePath)
        .resize({ width: maxWidth, withoutEnlargement: true })
        .jpeg({ quality })
        .toBuffer()
    } catch (err) {
      // A per-image sharp failure (corrupt PNG, unsupported colour profile)
      // should still fall through rather than fail the capture outright.
      if (isDev) console.warn("[image] sharp resize failed, falling back:", err)
    }
  }
  return resizeWithNativeImage(imagePath, maxWidth, quality)
}

function resizeWithNativeImage(imagePath: string, maxWidth: number, quality: number): Buffer {
  const image = nativeImage.createFromBuffer(fs.readFileSync(imagePath))
  if (image.isEmpty()) {
    throw new Error(`Could not decode image: ${imagePath}`)
  }
  const { width } = image.getSize()
  // nativeImage.resize UPSCALES when the target exceeds the source, which would
  // inflate the payload for no gain. Only ever shrink.
  const resized = width > maxWidth ? image.resize({ width: maxWidth, quality: "best" }) : image
  const jpeg = resized.toJPEG(quality)
  if (!jpeg || jpeg.length === 0) {
    throw new Error(`Could not encode image: ${imagePath}`)
  }
  return jpeg
}
