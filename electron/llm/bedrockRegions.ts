// Amazon Bedrock regions and endpoint validation. Pure (no Electron imports), so
// the settings UI (region picker) and the settings coercion (SSRF guard) share
// one source of truth.

export interface BedrockRegion {
  code: string
  label: string
}

/** Regions that serve the Bedrock runtime. Sydney first: the app's default. */
export const BEDROCK_REGIONS: BedrockRegion[] = [
  { code: "ap-southeast-2", label: "Asia Pacific (Sydney)" },
  { code: "ap-southeast-4", label: "Asia Pacific (Melbourne)" },
  { code: "ap-southeast-1", label: "Asia Pacific (Singapore)" },
  { code: "ap-northeast-1", label: "Asia Pacific (Tokyo)" },
  { code: "ap-northeast-2", label: "Asia Pacific (Seoul)" },
  { code: "ap-northeast-3", label: "Asia Pacific (Osaka)" },
  { code: "ap-south-1", label: "Asia Pacific (Mumbai)" },
  { code: "ap-south-2", label: "Asia Pacific (Hyderabad)" },
  { code: "us-east-1", label: "US East (N. Virginia)" },
  { code: "us-east-2", label: "US East (Ohio)" },
  { code: "us-west-2", label: "US West (Oregon)" },
  { code: "us-west-1", label: "US West (N. California)" },
  { code: "ca-central-1", label: "Canada (Central)" },
  { code: "sa-east-1", label: "South America (São Paulo)" },
  { code: "eu-central-1", label: "Europe (Frankfurt)" },
  { code: "eu-central-2", label: "Europe (Zurich)" },
  { code: "eu-west-1", label: "Europe (Ireland)" },
  { code: "eu-west-2", label: "Europe (London)" },
  { code: "eu-west-3", label: "Europe (Paris)" },
  { code: "eu-north-1", label: "Europe (Stockholm)" },
  { code: "eu-south-1", label: "Europe (Milan)" },
  { code: "eu-south-2", label: "Europe (Spain)" },
  { code: "me-central-1", label: "Middle East (UAE)" },
  { code: "il-central-1", label: "Israel (Tel Aviv)" },
  { code: "us-gov-west-1", label: "AWS GovCloud (US-West)" },
]

export const DEFAULT_BEDROCK_REGION = "ap-southeast-2"

export function bedrockRuntimeEndpoint(region: string): string {
  return `https://bedrock-runtime.${region}.amazonaws.com`
}

/**
 * The only shape a Bedrock endpoint may take. The endpoint receives the API key
 * and every screenshot, so a renderer-supplied value must never point anywhere
 * but an AWS Bedrock runtime host. (Region is free-form so a newly launched
 * region works without an app update.)
 */
const RUNTIME_HOST = /^bedrock-runtime(?:-fips)?\.([a-z]{2}(?:-gov)?-[a-z]+-\d)\.amazonaws\.com$/

/** Region code of a valid Bedrock runtime endpoint, or null if it is not one. */
export function bedrockRegionOf(endpoint: string): string | null {
  try {
    const url = new URL(endpoint)
    if (url.protocol !== "https:" || url.port || url.username || url.password) return null
    if (url.pathname !== "/" && url.pathname !== "") return null
    const m = url.hostname.toLowerCase().match(RUNTIME_HOST)
    return m ? m[1] : null
  } catch {
    return null
  }
}

/** Control-plane host (model + inference-profile listing) for a runtime endpoint. */
export function bedrockControlEndpoint(runtimeEndpoint: string): string {
  const region = bedrockRegionOf(runtimeEndpoint) ?? DEFAULT_BEDROCK_REGION
  const fips = /bedrock-runtime-fips\./i.test(runtimeEndpoint)
  return `https://bedrock${fips ? "-fips" : ""}.${region}.amazonaws.com`
}
