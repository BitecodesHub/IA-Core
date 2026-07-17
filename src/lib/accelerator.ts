export function codeToAcceleratorToken(code: string): string | null {
  if (/^Key[A-Z]$/.test(code)) return code.slice(3)
  if (/^Digit[0-9]$/.test(code)) return code.slice(5)
  if (/^F([1-9]|1[0-9]|2[0-4])$/.test(code)) return code
  if (/^Numpad[0-9]$/.test(code)) return "num" + code.slice(6)
  const named: Record<string, string> = {
    ArrowUp: "Up",
    ArrowDown: "Down",
    ArrowLeft: "Left",
    ArrowRight: "Right",
    Space: "Space",
    Enter: "Return",
    NumpadEnter: "Return",
    Tab: "Tab",
    Backspace: "Backspace",
    Delete: "Delete",
    Escape: "Escape",
    Home: "Home",
    End: "End",
    PageUp: "PageUp",
    PageDown: "PageDown",
    Insert: "Insert",
    Minus: "-",
    Equal: "=",
    BracketLeft: "[",
    BracketRight: "]",
    Backslash: "\\",
    Semicolon: ";",
    Quote: "'",
    Comma: ",",
    Period: ".",
    Slash: "/",
    Backquote: "`",
  }
  return named[code] ?? null
}

export function keyboardEventToAccelerator(
  e: Pick<KeyboardEvent, "code" | "metaKey" | "ctrlKey" | "altKey" | "shiftKey">
): string | null {
  const token = codeToAcceleratorToken(e.code)
  if (!token) return null
  const parts: string[] = []
  if (e.metaKey || e.ctrlKey) parts.push("CommandOrControl")
  if (e.altKey) parts.push("Alt")
  if (e.shiftKey) parts.push("Shift")
  parts.push(token)
  return parts.join("+")
}

export function acceleratorsEqual(
  a: string | null | undefined,
  b: string | null | undefined
): boolean {
  return Boolean(a && b && a.toLowerCase() === b.toLowerCase())
}
