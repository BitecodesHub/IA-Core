import React, { useId } from "react"

// The Bitecodes brand mark, ported from Bitecodes-SAAS src/lib/brand.ts (same
// geometry). Fills with currentColor, so it follows the surrounding text color.
const BODY =
  "M18 96 L18 8 L54 8 C78 8 90 18 90 31 C90 43 77 50 60 50.5 L53 51 " +
  "C81 52 96 61 96 75 C96 89 81 96 58 96 Z"
const BITES = [
  { cx: 19, cy: 16, r: 15 },
  { cx: 34, cy: 9, r: 8 },
]
const CRUMB = { cx: 9.5, cy: 36, r: 3.8 }
const GLYPHS = ["M41 48 L30.5 56.5 L41 65", "M55 48 L65.5 56.5 L55 65", "M50.5 44.5 L42.5 68.5"]

const BitecodesLogo: React.FC<{ className?: string }> = ({ className }) => {
  const maskId = useId()
  return (
    <svg viewBox="0 0 100 100" className={className} role="img" aria-label="Bitecodes logo">
      <mask id={maskId}>
        <path d={BODY} fill="#fff" />
        {BITES.map((c) => (
          <circle key={c.cx} cx={c.cx} cy={c.cy} r={c.r} fill="#000" />
        ))}
        <g stroke="#000" strokeWidth={5.5} fill="none">
          {GLYPHS.map((d) => (
            <path key={d} d={d} />
          ))}
        </g>
      </mask>
      <rect width="100" height="100" fill="currentColor" mask={`url(#${maskId})`} />
      <circle cx={CRUMB.cx} cy={CRUMB.cy} r={CRUMB.r} fill="currentColor" />
    </svg>
  )
}

export default BitecodesLogo
