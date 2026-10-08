// Screenshot downscaling for vision-model payloads.
//
// `sharp` is a native module: it needs a platform-specific .node binary plus
// libvips DLLs. In a packaged app those must be asar-unpacked, and on Windows a
// missing Visual C++ runtime or an AV quarantine can still make the load fail.
// A failed `require("sharp")` previously took the whole screenshot-analysis path
// down with an opaque error, so this module falls back to Electron's built-in
// `nativeImage`, which needs no native dependency at all.

import fs from "node:fs"
import { nativeImage, screen } from "electron"
import {
  targetWidthForCapture,
  pixelsPerLogicalPoint,
  type DisplayGeometry,
} from "./scale"

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
  /**
   * Explicit target width. Omit to derive it from the connected displays, which
   * is what keeps text legible across platforms — see ./scale. A hard-coded
   * value here is almost always a bug: 1536 px is right for a Retina Mac and
   * destroys text on a 1440p or 4K Windows desktop.
   */
  maxWidth?: number
  quality?: number
}

/** Geometry of every connected display, for the DPI-aware width calculation. */
export function currentDisplayGeometry(): DisplayGeometry[] {
  try {
    return screen.getAllDisplays().map((d) => {
      const scale = d.scaleFactor > 0 ? d.scaleFactor : 1
      return { logicalWidth: d.size.width, physicalWidth: Math.round(d.size.width * scale) }
    })
  } catch {
    // screen is unavailable before app-ready; the caller falls back to the
    // image's own width, which never downscales below legibility.
    return []
  }
}

/** Pixel width of an on-disk image, or 0 if it cannot be decoded. */
function imageWidth(buffer: Buffer): number {
  const probe = nativeImage.createFromBuffer(buffer)
  return probe.isEmpty() ? 0 : probe.getSize().width
}

/**
 * Downscale an on-disk image to a JPEG buffer.
 * Prefers sharp (better resampling and encoder), falls back to nativeImage.
 */
export async function toResizedJpeg(
  imagePath: string,
  { maxWidth, quality = 92 }: ResizeOptions = {}
): Promise<Buffer> {
  const source = await fs.promises.readFile(imagePath)
  let target = maxWidth
  if (target == null) {
    const displays = currentDisplayGeometry()
    const width = imageWidth(source)
    target = targetWidthForCapture(width || 1536, displays)
    if (isDev) {
      const ratio = pixelsPerLogicalPoint(width || 1536, displays)
      console.log(
        `[image] ${width}px capture -> ${target}px (${ratio.toFixed(2)} px per logical point)`
      )
    }
  }
  return encodeJpeg(imagePath, source, target, quality)
}

async function encodeJpeg(
  imagePath: string,
  source: Buffer,
  maxWidth: number,
  quality: number
): Promise<Buffer> {
  const sharp = loadSharp()
  if (sharp) {
    try {
      return await sharp(source)
        .resize({ width: maxWidth, withoutEnlargement: true })
        .jpeg({ quality })
        .toBuffer()
    } catch (err) {
      // A per-image sharp failure (corrupt PNG, unsupported colour profile)
      // should still fall through rather than fail the capture outright.
      if (isDev) console.warn("[image] sharp resize failed, falling back:", err)
    }
  }
  return resizeWithNativeImage(imagePath, source, maxWidth, quality)
}

function resizeWithNativeImage(
  imagePath: string,
  source: Buffer,
  maxWidth: number,
  quality: number
): Buffer {
  const image = nativeImage.createFromBuffer(source)
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
