import type { WebContents } from "electron"

export class RequestRegistry {
  private owners = new Map<WebContents, {
    controllers: Map<string, AbortController>
    dispose: () => void
  }>()

  begin(owner: WebContents, id: string) {
    this.cancel(owner, id)
    let state = this.owners.get(owner)
    if (!state) {
      const cancel = () => this.cancelOwner(owner)
      const navigate = (_event: unknown, _url: string, inPlace: boolean, mainFrame: boolean) => {
        if (mainFrame && !inPlace) cancel()
      }
      owner.once("destroyed", cancel)
      owner.on("did-start-navigation", navigate)
      state = {
        controllers: new Map(),
        dispose: () => {
          owner.removeListener("destroyed", cancel)
          owner.removeListener("did-start-navigation", navigate)
        },
      }
      this.owners.set(owner, state)
    }
    const controller = new AbortController()
    state.controllers.set(id, controller)
    if (owner.isDestroyed()) this.cancelOwner(owner)
    return {
      signal: controller.signal,
      active: () => !owner.isDestroyed() && !controller.signal.aborted &&
        this.owners.get(owner)?.controllers.get(id) === controller,
      finish: () => {
        if (this.owners.get(owner)?.controllers.get(id) !== controller) return
        state.controllers.delete(id)
        this.release(owner)
      },
    }
  }

  cancel(owner: WebContents, id: string) {
    const controller = this.owners.get(owner)?.controllers.get(id)
    this.owners.get(owner)?.controllers.delete(id)
    controller?.abort()
    this.release(owner)
  }

  cancelAll() {
    for (const owner of this.owners.keys()) this.cancelOwner(owner)
  }

  private cancelOwner(owner: WebContents) {
    const state = this.owners.get(owner)
    if (!state) return
    this.owners.delete(owner)
    state.dispose()
    for (const controller of state.controllers.values()) controller.abort()
  }

  private release(owner: WebContents) {
    const state = this.owners.get(owner)
    if (state?.controllers.size === 0) {
      state.dispose()
      this.owners.delete(owner)
    }
  }
}
