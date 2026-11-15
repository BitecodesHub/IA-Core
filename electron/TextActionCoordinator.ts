import { randomUUID } from "node:crypto"

export type PendingTextAction =
  | { id: string; kind: "selection"; text: string }
  | { id: string; kind: "error"; error: string }

type NativeFailure = { ok: false; error: string; code: string }

interface Dependencies {
  selection: (signal: AbortSignal) => Promise<{ ok: true; text: string } | NativeFailure>
  paste: (signal: AbortSignal) => Promise<{ ok: true } | NativeFailure>
  session: () => string | null
  blocked: () => boolean
  notify: (openChat: boolean) => void
}

export class TextActionCoordinator {
  private pending: PendingTextAction | null = null
  private selectionController: AbortController | null = null
  private pasteController: AbortController | null = null

  constructor(private readonly dependencies: Dependencies) {}

  cancel(): void {
    this.pending = null
    this.selectionController?.abort()
    this.selectionController = null
    this.pasteController?.abort()
    this.pasteController = null
  }

  claim(): PendingTextAction | null {
    if (!this.dependencies.session() || this.dependencies.blocked()) {
      this.cancel()
      return null
    }
    const action = this.pending
    this.pending = null
    return action
  }

  private publish(action: PendingTextAction, openChat: boolean): void {
    this.pending = action
    this.dependencies.notify(openChat)
  }

  async analyze(): Promise<void> {
    this.selectionController?.abort()
    this.pending = null
    const session = this.dependencies.session()
    if (!session || this.dependencies.blocked()) {
      this.dependencies.notify(true)
      return
    }
    const controller = new AbortController()
    this.selectionController = controller
    try {
      const result = await this.dependencies.selection(controller.signal)
      if (controller.signal.aborted || session !== this.dependencies.session() || this.dependencies.blocked()) return
      const id = randomUUID()
      this.publish(result.ok === true ? { id, kind: "selection", text: result.text } : { id, kind: "error", error: result.error }, true)
    } catch {
      if (!controller.signal.aborted && session === this.dependencies.session() && !this.dependencies.blocked()) {
        this.publish({ id: randomUUID(), kind: "error", error: "Could not read the selection. Try again." }, true)
      }
    } finally {
      if (this.selectionController === controller) this.selectionController = null
    }
  }

  async paste(): Promise<void> {
    if (this.pasteController) return
    const controller = new AbortController()
    this.pasteController = controller
    try {
      const result = await this.dependencies.paste(controller.signal)
      if (!controller.signal.aborted && result.ok === false) {
        this.publish({ id: randomUUID(), kind: "error", error: result.error }, false)
      }
    } catch {
      if (!controller.signal.aborted) {
        this.publish({ id: randomUUID(), kind: "error", error: "Could not paste. Check Accessibility access in Shortcuts settings." }, false)
      }
    } finally {
      if (this.pasteController === controller) this.pasteController = null
    }
  }
}
