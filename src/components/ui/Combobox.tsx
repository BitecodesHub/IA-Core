import React, { useEffect, useId, useLayoutEffect, useRef, useState } from "react"
import { createPortal } from "react-dom"
import { ChevronsUpDown, Check } from "lucide-react"
import { filterOptions, capOptions, type ComboOption } from "../../lib/modelOptions"

interface ComboboxProps {
  ariaLabel: string
  value: string
  onChange: (value: string) => void
  options: ComboOption[]
  /** Hint text (also exposed via aria-describedby). */
  hint?: string
  disabled?: boolean
  loading?: boolean
  emptyText?: string
  /** Max options rendered at once (perf for providers with hundreds of models). */
  maxVisible?: number
  className?: string
}

/**
 * Editable, searchable combobox (WAI-ARIA 1.2). Type to filter, arrow keys to
 * navigate (wrapping), Enter to commit, Escape to cancel. The listbox is
 * portalled to <body> and positioned with fixed coordinates so the Settings
 * panel's own scroll/overflow never clips it — while staying inside the
 * content-protected window (no OS-drawn native <select> surface). An explicit
 * "Auto" option and a preserved "(configured)" value come from buildModelOptions.
 */
const Combobox: React.FC<ComboboxProps> = ({
  ariaLabel,
  value,
  onChange,
  options,
  hint,
  disabled,
  loading,
  emptyText = "No matches",
  maxVisible = 100,
  className,
}) => {
  const baseId = useId()
  const listId = `${baseId}-list`
  const hintId = hint ? `${baseId}-hint` : undefined
  const wrapRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const menuRef = useRef<HTMLUListElement>(null)
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState("")
  const [active, setActive] = useState(0)
  const [menuStyle, setMenuStyle] = useState<React.CSSProperties>({})

  const selected = options.find((o) => o.value === value)
  const selectedLabel = selected?.label ?? (value || "Auto")

  const { visible, hiddenCount } = open
    ? capOptions(filterOptions(options, query), maxVisible)
    : { visible: options, hiddenCount: 0 }

  // Keep the active index within the current visible range.
  useEffect(() => {
    if (active >= visible.length) setActive(Math.max(0, visible.length - 1))
  }, [visible.length, active])

  // Position the portalled menu under (or above) the field. useLayoutEffect so the
  // coordinates are set synchronously before paint (no first-frame flash/jump).
  useLayoutEffect(() => {
    if (!open) return
    const reposition = () => {
      const el = wrapRef.current
      if (!el) return
      const r = el.getBoundingClientRect()
      const belowSpace = window.innerHeight - r.bottom
      // Flip above only when there is little room below AND more room above; then
      // bound the height to the side actually used so the list never overflows the
      // (small, content-protected) window and gets clipped by the OS bounds.
      const placeAbove = belowSpace < 160 && r.top > belowSpace
      const space = placeAbove ? r.top : belowSpace
      const maxH = Math.max(96, Math.min(220, space - 8))
      setMenuStyle({
        position: "fixed",
        left: Math.max(4, Math.min(r.left, window.innerWidth - r.width - 4)),
        width: r.width,
        maxHeight: maxH,
        ...(placeAbove ? { bottom: window.innerHeight - r.top + 4 } : { top: r.bottom + 4 }),
      })
    }
    reposition()
    window.addEventListener("scroll", reposition, true)
    window.addEventListener("resize", reposition)
    return () => {
      window.removeEventListener("scroll", reposition, true)
      window.removeEventListener("resize", reposition)
    }
  }, [open])

  // Keep the active option scrolled into view during keyboard navigation.
  useEffect(() => {
    if (!open) return
    document.getElementById(`${baseId}-opt-${active}`)?.scrollIntoView({ block: "nearest" })
  }, [active, open, baseId])

  // Close on outside interaction. The menu is portalled to <body>, so it is NOT a
  // descendant of wrapRef — must also exempt the menu itself, or dragging its
  // scrollbar / clicking a non-option row would be misread as an outside click.
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      const target = e.target as Node
      if (wrapRef.current?.contains(target)) return
      if (menuRef.current?.contains(target)) return
      close()
    }
    document.addEventListener("mousedown", onDown)
    return () => document.removeEventListener("mousedown", onDown)
  }, [open])

  const openMenu = () => {
    if (disabled) return
    setQuery("")
    // Clamp to the rendered (capped) slice: a selected option past maxVisible is
    // not rendered while browsing, and letting the range-clamp effect park the
    // highlight on the last visible row would commit the wrong model on Enter.
    // Fall back to index 0 (Auto), matching the value-not-in-list case.
    const idx = options.findIndex((o) => o.value === value)
    setActive(idx >= 0 && idx < maxVisible ? idx : 0)
    setOpen(true)
  }
  const close = () => {
    setOpen(false)
    setQuery("")
  }
  const commit = (opt: ComboOption | undefined) => {
    if (!opt) return
    onChange(opt.value)
    close()
    inputRef.current?.blur()
  }

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault()
      if (!open) return openMenu()
      setActive((a) => (visible.length ? (a + 1) % visible.length : 0))
    } else if (e.key === "ArrowUp") {
      e.preventDefault()
      if (!open) return openMenu()
      setActive((a) => (visible.length ? (a - 1 + visible.length) % visible.length : 0))
    } else if (e.key === "Enter") {
      if (open) {
        e.preventDefault()
        commit(visible[active])
      }
    } else if (e.key === "Escape") {
      if (open) {
        e.preventDefault()
        close()
      }
    }
  }

  const activeId = open && visible[active] ? `${baseId}-opt-${active}` : undefined

  // Section headers ("Free models" / "All models") are a browse affordance: shown
  // only for the unfiltered list, since a search re-ranks by match quality and
  // would interleave the groups. Headers are presentation-only <li> rows rendered
  // BEFORE the option at the boundary index, so option ids/indices (keyboard nav,
  // scrollIntoView) are untouched. No free models → no headers (flat list).
  const showSections = query.trim() === ""
  const freeStartIdx = showSections
    ? visible.findIndex((o) => o.kind === "model" && o.free)
    : -1
  const paidStartIdx =
    freeStartIdx >= 0 ? visible.findIndex((o) => o.kind === "model" && !o.free) : -1
  // Non-option rows must prevent the mousedown default like option rows do:
  // otherwise clicking one blurs the input while the menu stays open (it is
  // inside menuRef, so the outside-click closer exempts it), leaving arrows,
  // Enter, Escape, and typing dead until the input is clicked again.
  const keepFocus = (e: React.MouseEvent) => e.preventDefault()
  const sectionHeader = (label: string) => (
    <li
      role="presentation"
      onMouseDown={keepFocus}
      className="px-2 pt-1.5 pb-0.5 text-[9px] uppercase tracking-wider text-white/40 select-none"
    >
      {label}
    </li>
  )

  return (
    <div ref={wrapRef} className={`relative ${className ?? "w-48"}`}>
      <div
        className={`flex items-center gap-1 bg-black border rounded px-1.5 py-0.5 ${
          selected?.kind === "configured" ? "border-amber-400" : "border-white/30"
        } ${disabled ? "opacity-50" : ""}`}
      >
        <input
          ref={inputRef}
          role="combobox"
          aria-label={ariaLabel}
          aria-expanded={open}
          aria-controls={listId}
          aria-activedescendant={activeId}
          aria-autocomplete="list"
          aria-describedby={hintId}
          disabled={disabled}
          spellCheck={false}
          autoComplete="off"
          className="flex-1 min-w-0 bg-transparent text-white text-xs outline-none"
          value={open ? query : selectedLabel}
          placeholder={open ? selectedLabel : undefined}
          onChange={(e) => {
            setQuery(e.target.value)
            setActive(0)
            if (!open) setOpen(true)
          }}
          onFocus={openMenu}
          onClick={openMenu}
          onKeyDown={onKeyDown}
        />
        {loading ? (
          <span className="text-[9px] text-white/50" aria-hidden>
            …
          </span>
        ) : (
          <ChevronsUpDown className="w-3 h-3 text-white/60 shrink-0" aria-hidden />
        )}
      </div>
      {hint && (
        <span id={hintId} className="sr-only">
          {hint}
        </span>
      )}

      {open &&
        createPortal(
          <ul
            id={listId}
            ref={menuRef}
            role="listbox"
            aria-label={ariaLabel}
            style={menuStyle}
            // The portal escapes every data-overlay-interactive container, and the
            // window's click-through hit-test (App.tsx) only captures the mouse over
            // tagged elements — untagged, the open menu forwards hover but lets
            // clicks and wheel fall through the overlay to the app behind it.
            data-overlay-interactive
            className="z-50 overflow-y-auto bg-black border border-white/30 rounded shadow-lg text-xs"
          >
            {visible.length === 0 && (
              <li className="px-2 py-1 text-white/60" role="presentation" onMouseDown={keepFocus}>
                {emptyText}
              </li>
            )}
            {visible.map((opt, i) => {
              const isSel = opt.value === value
              return (
                <React.Fragment key={`${opt.kind}:${opt.value}`}>
                  {i === freeStartIdx && sectionHeader("Free models")}
                  {i === paidStartIdx && sectionHeader("All models")}
                  <li
                    id={`${baseId}-opt-${i}`}
                    role="option"
                    aria-selected={isSel}
                    className={`flex items-center gap-1.5 px-2 py-1 cursor-pointer ${
                      i === active ? "bg-white text-black" : "text-white hover:bg-white/10"
                    } ${opt.kind === "configured" ? "text-amber-300" : ""}`}
                    // onMouseDown (not onClick) so it fires before the input blur.
                    onMouseDown={(e) => {
                      e.preventDefault()
                      commit(opt)
                    }}
                    onMouseEnter={() => setActive(i)}
                  >
                    <span className="flex-1 min-w-0">
                      <span className="block truncate">{opt.label}</span>
                      {opt.detail && (
                        <span
                          className={`block truncate text-[10px] ${
                            i === active ? "text-black/60" : "text-white/45"
                          }`}
                        >
                          {opt.detail}
                        </span>
                      )}
                    </span>
                    {opt.badges?.map((b) => (
                      <span
                        key={b.text}
                        className={`text-[10px] px-1 rounded border shrink-0 ${
                          i === active
                            ? "border-black/40"
                            : b.tone === "ok"
                              ? "border-green-400/50 text-green-300"
                              : b.tone === "warn"
                                ? "border-amber-400/50 text-amber-300"
                                : "border-white/25 text-white/60"
                        }`}
                      >
                        {b.text}
                      </span>
                    ))}
                    {opt.free && (
                      <span
                        className={`text-[10px] px-1 rounded border ${
                          i === active ? "border-black/40" : "border-emerald-400/50 text-emerald-300"
                        }`}
                        aria-label="free"
                      >
                        free
                      </span>
                    )}
                    {opt.vision && (
                      <span
                        className={`text-[10px] px-1 rounded border ${
                          i === active ? "border-black/40" : "border-white/30 text-white/70"
                        }`}
                        aria-label="vision-capable"
                      >
                        vision
                      </span>
                    )}
                    {isSel && <Check className="w-3 h-3 shrink-0" aria-hidden />}
                  </li>
                </React.Fragment>
              )
            })}
            {hiddenCount > 0 && (
              <li className="px-2 py-1 text-white/60" role="presentation" onMouseDown={keepFocus}>
                +{hiddenCount} more — keep typing to narrow
              </li>
            )}
          </ul>,
          document.body
        )}
    </div>
  )
}

export default Combobox
