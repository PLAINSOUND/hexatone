import { fireEvent, render, screen } from "@testing-library/preact";
import { describe, expect, it, vi } from "vitest";
import TempoRow from "./tempo-row.jsx";

function timingFor(tempi) {
  return {
    sortedBars: [{ id: 1, position: 1, numerator: 4, denominator: 4 }],
    sortedTempi: tempi,
    terminalBarlinePosition: 2,
    barBeatByEventId: new Map(),
    tempoBarRelativeDraftKey: (tempoId) => String(tempoId),
    tempoBarRelativeDrafts: {},
    tempoTransitionCueMap: new Map(),
  };
}

describe("TempoRow", () => {
  it("allows piled opening tempi to be deleted while protecting a lone opening tempo", () => {
    const onDeleteTempo = vi.fn();
    const stacked = [
      { id: 1, position: 1, bpm: 60, beatNumerator: 1, beatDenominator: 4, mode: "immediate" },
      { id: 2, position: 1, bpm: 72, beatNumerator: 1, beatDenominator: 4, mode: "immediate" },
    ];
    const editing = { onDeleteTempo };
    const { rerender } = render(
      <div>
        {stacked.map((tempo) => (
          <TempoRow key={tempo.id} tempo={tempo} timing={timingFor(stacked)} editing={editing} />
        ))}
      </div>,
    );

    const deleteButtons = screen.getAllByRole("button", { name: "delete tempo marker" });
    expect(deleteButtons).toHaveLength(2);
    fireEvent.click(deleteButtons[1]);
    expect(onDeleteTempo).toHaveBeenCalledWith(2);

    rerender(<TempoRow tempo={stacked[0]} timing={timingFor([stacked[0]])} editing={editing} />);
    expect(screen.queryByRole("button", { name: "delete tempo marker" })).toBeNull();
  });
});
