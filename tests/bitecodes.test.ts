import { describe, expect, it, vi } from "vitest"
import {
  BitecodesProvider,
  BITECODES_DEFAULT_ENDPOINT,
  isAllowedBitecodesEndpoint,
  pollPairing,
  startPairing,
} from "../electron/llm/bitecodes"
import type { AiProviderSettings } from "../electron/config/schema"

const config = {
  id: "bitecodes",
  type: "bitecodes",
  label: "Bitecodes",
  enabled: true,
  endpoint: BITECODES_DEFAULT_ENDPOINT,
  timeoutMs: 5000,
} as unknown as AiProviderSettings

function sse(chunks: string[]): Response {
  const enc = new TextEncoder()
  const body = new ReadableStream({
    start(c) {
      for (const ch of chunks) c.enqueue(enc.encode(ch))
      c.close()
    },
  })
  return new Response(body, { status: 200, headers: { "Content-Type": "text/event-stream" } })
}

const req = (extra: Record<string, unknown> = {}) =>
  ({ prompt: "hi", options: { numPredict: 100 }, ...extra }) as any

describe("isAllowedBitecodesEndpoint", () => {
  it.each([
    ["https://www.bitecodes.com", true],
    ["https://bitecodes.com", true],
    ["http://localhost:3000", true],
    ["http://127.0.0.1:3000", true],
    ["http://www.bitecodes.com", false],
    ["https://bitecodes.com.evil.io", false],
    ["https://evilbitecodes.com", false],
    ["https://user:pw@www.bitecodes.com", false],
    ["not a url", false],
  ])("%s → %s", (url, ok) => expect(isAllowedBitecodesEndpoint(url)).toBe(ok))
})

describe("BitecodesProvider", () => {
  it("exposes a single opaque vision-capable model", async () => {
    const models = await new BitecodesProvider(config, () => "t").listModels()
    expect(models).toHaveLength(1)
    expect(models[0]).toMatchObject({ name: "bitecodes", vision: true })
  })

  it("refuses to call the server when signed out", async () => {
    const fetchImpl = vi.fn()
    const p = new BitecodesProvider(config, () => null, { fetchImpl: fetchImpl as any })
    await expect(p.generate(req())).rejects.toThrow(/401.*Sign in/)
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it("streams token events and sends the bearer token", async () => {
    const fetchImpl = vi.fn(async () =>
      sse(['event: token\ndata: {"delta":"Hel', 'lo"}\n\nevent: token\ndata: {"delta":" world"}\n\nevent: done\ndata: {}\n\n'])
    )
    const tokens: string[] = []
    const p = new BitecodesProvider(config, () => "bcd_abc", {
      fetchImpl: fetchImpl as any,
      client: "Notes/1.7.0 (darwin; arm64)",
    })
    const out = await p.generate(req({ onToken: (t: string) => tokens.push(t), images: ["b64"], kind: "screenshot" }))
    expect(out).toBe("Hello world")
    expect(tokens).toEqual(["Hello", " world"])
    const [url, init] = fetchImpl.mock.calls[0] as any
    expect(url).toBe("https://www.bitecodes.com/api/v1/desktop/assistant")
    expect(init.headers.Authorization).toBe("Bearer bcd_abc")
    // The build and request type feed the operator's activity log.
    expect(init.headers["X-Notes-Client"]).toBe("Notes/1.7.0 (darwin; arm64)")
    expect(JSON.parse(init.body)).toEqual({ prompt: "hi", images: ["b64"], maxTokens: 100, kind: "screenshot" })
  })

  it("turns a server error event into a fallback-eligible 502", async () => {
    const fetchImpl = vi.fn(async () => sse(['event: error\ndata: {"message":"all upstreams failed"}\n\n']))
    const p = new BitecodesProvider(config, () => "t", { fetchImpl: fetchImpl as any })
    await expect(p.generate(req())).rejects.toThrow(/502: all upstreams failed/)
  })

  it("treats an empty stream as a failure", async () => {
    const fetchImpl = vi.fn(async () => sse(["event: done\ndata: {}\n\n"]))
    const p = new BitecodesProvider(config, () => "t", { fetchImpl: fetchImpl as any })
    await expect(p.generate(req())).rejects.toThrow(/No response content/)
  })

  it("adds a sign-in hint on 401", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ message: "Token revoked" }), { status: 401 }))
    const p = new BitecodesProvider(config, () => "t", { fetchImpl: fetchImpl as any })
    await expect(p.generate(req())).rejects.toThrow(/401: Token revoked Sign in/)
  })
})

describe("pairing", () => {
  it("rejects a verification URL on another origin", async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(JSON.stringify({ deviceCode: "d", userCode: "ABCD-EFGH", verificationUrl: "https://evil.example/x" }))
    )
    await expect(startPairing(BITECODES_DEFAULT_ENDPOINT, "Notes", fetchImpl as any)).rejects.toThrow(/unexpected/)
  })

  it("parses a valid pairing start", async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(
        JSON.stringify({
          deviceCode: "dvc_1",
          userCode: "ABCD-EFGH",
          verificationUrl: "https://www.bitecodes.com/app/desktop?code=ABCD-EFGH",
          expiresAt: new Date(Date.now() + 60_000).toISOString(),
          interval: 3,
        })
      )
    )
    const p = await startPairing(BITECODES_DEFAULT_ENDPOINT, "Notes", fetchImpl as any)
    expect(p).toMatchObject({ deviceCode: "dvc_1", userCode: "ABCD-EFGH", intervalMs: 3000 })
  })

  it.each([
    [200, { status: "approved", token: "bcd_x" }, { status: "approved", token: "bcd_x" }],
    [202, { status: "pending" }, { status: "pending" }],
    [403, {}, { status: "denied" }],
    [410, {}, { status: "expired" }],
    [503, {}, { status: "pending" }],
  ])("poll HTTP %i", async (status, body, expected) => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify(body), { status }))
    expect(await pollPairing(BITECODES_DEFAULT_ENDPOINT, "dvc_1", fetchImpl as any)).toEqual(expected)
  })
})

import { migrations } from "../electron/config/migrations"

describe("migration 6 → Bitecodes default", () => {
  it("makes Bitecodes active and keeps the old provider as the first fallback", () => {
    const out = migrations[6]!({ ai: { activeProviderId: "nvidia", fallbackProviderIds: ["openrouter", "nvidia"] } }) as any
    expect(out.ai.activeProviderId).toBe("bitecodes")
    expect(out.ai.fallbackProviderIds).toEqual(["nvidia", "openrouter"])
  })
  it("is a no-op when Bitecodes is already active", () => {
    const out = migrations[6]!({ ai: { activeProviderId: "bitecodes", fallbackProviderIds: ["x"] } }) as any
    expect(out.ai.fallbackProviderIds).toEqual(["x"])
  })
})

describe("revocation", () => {
  it("reports a 401 so the app can sign out immediately", async () => {
    const onUnauthorized = vi.fn()
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ message: "Token revoked" }), { status: 401 }))
    const p = new BitecodesProvider(config, () => "t", { fetchImpl: fetchImpl as any, onUnauthorized })
    await expect(p.generate(req())).rejects.toThrow(/401/)
    expect(onUnauthorized).toHaveBeenCalledOnce()
  })
  it("does not report other failures as revocation", async () => {
    const onUnauthorized = vi.fn()
    const fetchImpl = vi.fn(async () => new Response("busy", { status: 503 }))
    const p = new BitecodesProvider(config, () => "t", { fetchImpl: fetchImpl as any, onUnauthorized })
    await expect(p.generate(req())).rejects.toThrow(/503/)
    expect(onUnauthorized).not.toHaveBeenCalled()
  })
})
