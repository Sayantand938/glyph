// @vitest-environment jsdom
import { render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"

import { summarizeSession } from "@/lib/session"

import { FinishedState } from "./end-states"

describe("FinishedState", () => {
  it("opens at the top with focus on the heading, not the bottom button", () => {
    const scroll = vi.spyOn(window, "scrollTo").mockImplementation(() => {})
    render(
      <FinishedState
        summary={summarizeSession([])}
        records={[]}
        scopeName="Sample Subject"
        onExit={() => {}}
      />
    )
    const heading = screen.getByRole("heading", { name: "Session complete" })
    expect(document.activeElement).toBe(heading)
    expect(scroll).toHaveBeenCalledWith(0, 0)
    scroll.mockRestore()
  })
})
