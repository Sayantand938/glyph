import { describe, expect, it } from "vitest"

import { createLayerStack, type Layer } from "./layers"

function setup() {
  const calls: string[] = []
  const history = {
    pushState: () => void calls.push("push"),
    go: (n: number) => void calls.push(`go ${n}`),
  }
  const tasks: (() => void)[] = []
  const stack = createLayerStack(history, (run) => tasks.push(run))
  const flush = () => {
    while (tasks.length) tasks.shift()?.()
  }
  return { calls, stack, flush }
}

function layer(overrides: Partial<Layer> = {}) {
  const log = { backs: 0 }
  const l: Layer = {
    onBack: () => void (log.backs += 1),
    blocked: () => false,
    ...overrides,
  }
  return { l, log }
}

describe("createLayerStack", () => {
  it("pushes one history entry per layer", () => {
    const { calls, stack, flush } = setup()
    stack.add(layer().l)
    stack.add(layer().l)
    flush()
    expect(calls).toEqual(["push", "push"])
  })

  it("closes only the top layer on Back", () => {
    const { stack, flush } = setup()
    const bottom = layer()
    const top = layer()
    stack.add(bottom.l)
    stack.add(top.l)
    flush()
    stack.handlePop()
    flush()
    expect(top.log.backs).toBe(1)
    expect(bottom.log.backs).toBe(0)
    stack.handlePop()
    expect(bottom.log.backs).toBe(1)
  })

  it("does nothing on Back with no layers", () => {
    const { calls, stack, flush } = setup()
    stack.handlePop()
    flush()
    expect(calls).toEqual([])
  })

  it("pops its own entry when a page closes in the UI, and ignores that event", () => {
    const { calls, stack, flush } = setup()
    const a = layer()
    const remove = stack.add(a.l)
    flush()
    remove()
    flush()
    expect(calls).toEqual(["push", "go -1"])
    stack.handlePop()
    expect(a.log.backs).toBe(0)
  })

  it("does no history work when one page is swapped for another at once", () => {
    const { calls, stack, flush } = setup()
    const remove = stack.add(layer().l)
    flush()
    remove()
    stack.add(layer().l)
    flush()
    expect(calls).toEqual(["push"])
  })

  it("goes back several entries at once", () => {
    const { calls, stack, flush } = setup()
    const removeA = stack.add(layer().l)
    const removeB = stack.add(layer().l)
    flush()
    removeB()
    removeA()
    flush()
    expect(calls).toEqual(["push", "push", "go -2"])
  })

  it("puts the entry back when a layer is blocked", () => {
    const { calls, stack, flush } = setup()
    const busy = layer({ blocked: () => true })
    stack.add(busy.l)
    flush()
    stack.handlePop()
    flush()
    expect(busy.log.backs).toBe(0)
    expect(calls).toEqual(["push", "push"])
  })

  it("puts the entry back when onBack declines to close", () => {
    const { calls, stack, flush } = setup()
    stack.add(layer({ onBack: () => false }).l)
    flush()
    stack.handlePop()
    flush()
    expect(calls).toEqual(["push", "push"])
  })

  it("lets a layer that stays open be closed by Back later", () => {
    const { stack, flush } = setup()
    let stay = true
    const l = layer({ onBack: () => (stay ? false : undefined) })
    stack.add(l.l)
    flush()
    stack.handlePop()
    flush()
    stay = false
    stack.handlePop()
    flush()
    // Closed: a further Back reaches no layer.
    let reached = false
    stack.add({
      onBack: () => void (reached = true),
      blocked: () => false,
    })
    stack.handlePop()
    expect(reached).toBe(true)
  })
})
