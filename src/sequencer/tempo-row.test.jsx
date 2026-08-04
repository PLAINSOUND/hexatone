import { fireEvent, render, screen } from "@testing-library/preact";
import userEvent from "@testing-library/user-event";
import { useState } from "preact/hooks";
import { describe, expect, it, vi } from "vitest";
import TempoRow from "./tempo-row.jsx";

function timingFor(tempi, tempoBarRelativeDrafts = {}) {
  return {
    sortedBars: [{ id: 1, position: 1, numerator: 4, denominator: 4 }],
    sortedTempi: tempi,
    terminalBarlinePosition: 2,
    barBeatByEventId: new Map(),
    tempoBarRelativeDraftKey: (tempoId) => String(tempoId),
    tempoBarRelativeDrafts,
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

  it("commits a focused beat fraction and bar-relative draft with one checkmark press", async () => {
    const user = userEvent.setup();

    const Harness = () => {
      const [tempo, setTempo] = useState({
        id: 1,
        position: 1,
        bpm: 60,
        beatNumerator: 1,
        beatDenominator: 4,
        mode: "immediate",
      });
      const [draft, setDraft] = useState({
        draftKey: "1",
        tempoId: 1,
        barNumber: "2",
        beat: "1",
        numerator: "0",
        denominator: "1",
      });
      const editing = {
        handleEnterCommit: (event, commit) => {
          if (event.key === "Enter") commit();
        },
        handleBlurCommit: (event, commit) => commit(event.currentTarget.value),
        updateTempoBeatFraction: (_tempoId, beatNumerator, beatDenominator) =>
          setTempo((current) => ({ ...current, beatNumerator, beatDenominator })),
        updateTempoBpm: (_tempoId, bpm) =>
          setTempo((current) => ({ ...current, bpm: Number(bpm) })),
        updateTempoPosition: (_tempoId, position) =>
          setTempo((current) => ({ ...current, position: Number(position) })),
        updateTempoBarRelativeDraftField: vi.fn(),
        commitTempoBarRelativeDraft: () => {
          setTempo((current) => ({ ...current, position: 2 }));
          setDraft(null);
        },
        cancelTempoBarRelativeDraft: () => setDraft(null),
        updateTempoMode: vi.fn(),
        onDeleteTempo: vi.fn(),
      };
      const instanceKey = `${tempo.position}:${tempo.bpm}:${tempo.beatNumerator}:${tempo.beatDenominator}`;
      return (
        <>
          <output data-testid="tempo-state">
            {`${tempo.position}:${tempo.beatNumerator}/${tempo.beatDenominator}`}
          </output>
          <TempoRow
            key={instanceKey}
            tempo={tempo}
            timing={timingFor([tempo], draft ? { 1: draft } : {})}
            editing={editing}
          />
        </>
      );
    };

    render(<Harness />);

    const denominator = screen.getByLabelText("tempo beat denominator");
    await user.clear(denominator);
    await user.type(denominator, "8");
    await user.click(screen.getByLabelText("commit tempo bar-relative timing"));

    expect(screen.queryByLabelText("commit tempo bar-relative timing")).toBeNull();
    expect(screen.getByTestId("tempo-state").textContent).toBe("2:1/8");
  });
});
