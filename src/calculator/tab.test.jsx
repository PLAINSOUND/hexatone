import { fireEvent, render, screen, waitFor, within } from "@testing-library/preact";
import { beforeEach, describe, expect, it } from "vitest";
import CalculatorTab from "./tab.jsx";
import { CALCULATOR_WORKSPACE_STORAGE_KEY } from "./session-persistence.js";

const SETTINGS = {
  fundamental: 440,
  reference_degree: 1,
  scale: ["27/16", "2/1"],
  heji_anchor_ratio: "27/16",
  heji_anchor_label: "*nA",
  heji_anchor_frequency: "",
  heji_palette_structure: "",
  heji_palette_deviation: "",
  heji_palette_decimals: 3,
};

describe("CalculatorTab", () => {
  beforeEach(() => {
    localStorage.removeItem("hexatone_search_prefs");
    sessionStorage.removeItem(CALCULATOR_WORKSPACE_STORAGE_KEY);
  });

  it("starts at A 440 and 1/1 before a Hexatone scale is loaded", () => {
    render(<CalculatorTab settings={{ scale: null }} />);

    expect(
      screen
        .getByLabelText("Calculator reference frequency")
        .closest(".calculator-tab")
        .classList.contains("calculator-tab--blank-hints"),
    ).toBe(true);
    expect(screen.getByLabelText("Calculator reference frequency").value).toBe("440.0");
    expect(screen.getByLabelText("Calculator reference ratio or cents").value).toBe("1/1");
    expect(screen.getByLabelText("Calculator frequency of 1/1").value).toBe("440.0");
    expect(screen.getByLabelText("Calculator HEJI anchor ratio or cents").value).toBe("1/1");
    expect(
      screen.getByLabelText("Calculator HEJI anchor ratio or cents from reference").value,
    ).toBe("1/1");
    expect(screen.getByLabelText("Calculator HEJI anchor spelling").value).toBe("*nA");
    expect(screen.getByLabelText("Calculator spelling frequency").value).toBe("440.0");
    expect(screen.getByLabelText("Calculator decimal places").value).toBe("0");

    fireEvent.input(screen.getByLabelText("Calculator reference ratio or cents"), {
      target: { value: "3/2" },
    });
    expect(
      screen
        .getByLabelText("Calculator reference frequency")
        .closest(".calculator-tab")
        .classList.contains("calculator-tab--blank-hints"),
    ).toBe(false);
  });

  it("seeds its independent reference and HEJI fields from Hexatone", () => {
    render(<CalculatorTab settings={SETTINGS} />);

    expect(
      screen
        .getByLabelText("Calculator reference frequency")
        .closest(".calculator-tab")
        .classList.contains("calculator-tab--blank-hints"),
    ).toBe(false);
    expect(screen.getByLabelText("Calculator reference frequency").value).toBe("440.0");
    expect(screen.getByLabelText("Calculator reference ratio or cents").value).toBe("27/16");
    expect(screen.getByLabelText("Calculator HEJI anchor ratio or cents").value).toBe("27/16");
    expect(
      screen.getByLabelText("Calculator HEJI anchor ratio or cents from reference").value,
    ).toBe("1/1");
    expect(screen.getByLabelText("Calculator spelling frequency").value).toBe("440.0");
    expect(screen.getByLabelText("Calculator palette output").value).toContain("A");
    expect(screen.getByLabelText("Calculator lookup offset ratio or cents").value).toBe("1/1");
    expect(screen.getByLabelText("Calculator lookup ratio or cents").value).toBe("1/1");
    expect(screen.getByLabelText("Calculator interval from offset").textContent).toBe(
      "1/1 | 0.000",
    );
    expect(screen.getByLabelText("Calculator interval from HEJI anchor").textContent).toBe(
      "1/1 | 0.000",
    );
    expect(screen.getByLabelText("Calculator interval from reference").textContent).toBe(
      "1/1 | 0.000",
    );
    expect(screen.getByLabelText("Calculator interval from 1/1").textContent).toBe(
      "27/16 | 905.865",
    );
  });

  it("keeps calculator edits local and updates derived output", () => {
    const settings = { ...SETTINGS };
    render(<CalculatorTab settings={settings} />);
    const reference = screen.getByLabelText("Calculator reference frequency");

    fireEvent.input(reference, { target: { value: "442" } });
    fireEvent.blur(reference);

    expect(settings.fundamental).toBe(440);
    expect(screen.getByLabelText("Calculator frequency of 1/1").value).toBe("261.9");
  });

  it("normalises Scala entry forms across Calculator interval fields", () => {
    render(<CalculatorTab settings={{ scale: null }} />);

    const reference = screen.getByLabelText("Calculator reference ratio or cents");
    fireEvent.input(reference, { target: { value: "2" } });
    fireEvent.blur(reference);
    expect(screen.getByLabelText("Calculator reference ratio or cents").value).toBe("2/1");

    const anchor = screen.getByLabelText("Calculator HEJI anchor ratio or cents");
    fireEvent.input(anchor, { target: { value: "400." } });
    fireEvent.blur(anchor);
    expect(screen.getByLabelText("Calculator HEJI anchor ratio or cents").value).toBe("400.0");

    const offset = screen.getByLabelText("Calculator lookup offset ratio or cents");
    fireEvent.input(offset, { target: { value: "7\\12" } });
    fireEvent.blur(offset);
    expect(screen.getByLabelText("Calculator lookup offset ratio or cents").value).toBe("7\\12");

    const pitch = screen.getByLabelText("Calculator lookup ratio or cents");
    fireEvent.input(pitch, { target: { value: "3" } });
    fireEvent.blur(pitch);
    expect(screen.getByLabelText("Calculator lookup ratio or cents").value).toBe("3/1");
  });

  it("restores Calculator user data for the same persisted tuning workspace", () => {
    const first = render(<CalculatorTab settings={SETTINGS} workspaceKey="same-tuning" />);
    const pitch = screen.getByLabelText("Calculator lookup ratio or cents");
    fireEvent.input(pitch, { target: { value: "5/4" } });
    fireEvent.blur(pitch);
    fireEvent.click(screen.getByLabelText("Calculator use traditional accidentals"));
    first.unmount();

    const restored = render(<CalculatorTab settings={SETTINGS} workspaceKey="same-tuning" />);

    expect(screen.getByLabelText("Calculator lookup ratio or cents").value).toBe("5/4");
    expect(screen.getByLabelText("Calculator use traditional accidentals").checked).toBe(true);

    restored.unmount();
    render(<CalculatorTab settings={SETTINGS} workspaceKey="different-tuning" />);
    expect(screen.getByLabelText("Calculator lookup ratio or cents").value).toBe("1/1");
    expect(screen.getByLabelText("Calculator use traditional accidentals").checked).toBe(false);
  });

  it("interlocks reference, 1/1, and spelling frequencies", () => {
    render(<CalculatorTab settings={SETTINGS} />);
    const degree0 = screen.getByLabelText("Calculator frequency of 1/1");

    fireEvent.focus(degree0);
    fireEvent.input(degree0, { target: { value: "264" } });
    fireEvent.blur(degree0);

    expect(screen.getByLabelText("Calculator reference frequency").value).toBe("445.5");
    expect(screen.getByLabelText("Calculator spelling frequency").value).toBe("445.5");

    const spelling = screen.getByLabelText("Calculator spelling frequency");
    fireEvent.focus(spelling);
    fireEvent.input(spelling, { target: { value: "432" } });
    fireEvent.blur(spelling);

    expect(screen.getByLabelText("Calculator reference frequency").value).toBe("432.0");
    expect(screen.getByLabelText("Calculator frequency of 1/1").value).toBe("256.0");
  });

  it("interlocks the HEJI anchor intervals from 1/1 and from Reference", () => {
    render(<CalculatorTab settings={SETTINGS} />);
    const fromReference = screen.getByLabelText(
      "Calculator HEJI anchor ratio or cents from reference",
    );

    fireEvent.input(fromReference, { target: { value: "4/3" } });
    fireEvent.blur(fromReference);

    expect(screen.getByLabelText("Calculator HEJI anchor ratio or cents").value).toBe("9/4");
    expect(screen.getByLabelText("Calculator lookup offset ratio or cents").value).toBe("1/1");

    const fromDegreeZero = screen.getByLabelText("Calculator HEJI anchor ratio or cents");
    fireEvent.input(fromDegreeZero, { target: { value: "5/2" } });
    fireEvent.blur(fromDegreeZero);

    expect(
      screen.getByLabelText("Calculator HEJI anchor ratio or cents from reference").value,
    ).toBe("40/27");
  });

  it("keeps the reference-relative HEJI interval canonical when Reference Offset changes", () => {
    render(<CalculatorTab settings={SETTINGS} />);
    const fromReference = screen.getByLabelText(
      "Calculator HEJI anchor ratio or cents from reference",
    );
    fireEvent.input(fromReference, { target: { value: "4/3" } });
    fireEvent.blur(fromReference);

    const referenceOffset = screen.getByLabelText("Calculator reference ratio or cents");
    fireEvent.input(referenceOffset, { target: { value: "3/2" } });
    fireEvent.blur(referenceOffset);

    expect(
      screen.getByLabelText("Calculator HEJI anchor ratio or cents from reference").value,
    ).toBe("4/3");
    expect(screen.getByLabelText("Calculator HEJI anchor ratio or cents").value).toBe("2/1");
    expect(screen.getByLabelText("Calculator lookup offset ratio or cents").value).toBe("1/1");
  });

  it("retains rational Palette Input intervals above an irrational notation anchor", () => {
    render(<CalculatorTab settings={{ scale: null }} />);
    const fromReference = screen.getByLabelText(
      "Calculator HEJI anchor ratio or cents from reference",
    );
    fireEvent.input(fromReference, { target: { value: "400." } });
    fireEvent.blur(fromReference);

    const referenceOffset = screen.getByLabelText("Calculator reference ratio or cents");
    fireEvent.input(referenceOffset, { target: { value: "100." } });
    fireEvent.blur(referenceOffset);
    fireEvent.click(screen.getByRole("button", { name: "E" }));

    expect(
      screen.getByLabelText("Calculator HEJI anchor ratio or cents from reference").value,
    ).toBe("400.0");
    expect(screen.getByLabelText("Calculator HEJI anchor ratio or cents").value).toBe("500.000000");
    expect(screen.getByLabelText("Calculator lookup ratio or cents").value).toMatch(/^\d+\/\d+$/);
  });

  it("normalises trailing cents from the HEJI spelling field", () => {
    render(<CalculatorTab settings={{ scale: null }} />);
    const spelling = screen.getByLabelText("Calculator HEJI anchor spelling");

    fireEvent.input(spelling, { target: { value: "*nA−33" } });
    fireEvent.blur(spelling);

    expect(screen.getByLabelText("Calculator HEJI anchor spelling").value).not.toContain("33");
  });

  it("accepts signed cents and presents spelling, MIDI, and nearby ratios", () => {
    render(<CalculatorTab settings={SETTINGS} />);
    const lookup = screen.getByLabelText("Calculator lookup ratio or cents");

    fireEvent.input(lookup, { target: { value: "-240.0" } });
    fireEvent.blur(lookup);

    expect(screen.getByLabelText("Calculator interval from reference").textContent).toBe(
      "— | -240.000",
    );
    expect(screen.getByLabelText("Calculator interval from 1/1").textContent).toBe("— | 665.865");
    expect(screen.getByLabelText("Calculator nearest MIDI note").textContent).toMatch(
      /^[A-G][b#]?\d(?: \| [A-G][b#]?\d)? \| \d+$/,
    );
    expect(screen.getByLabelText("Calculator nearby rational values").textContent).toContain("/");
  });

  it("selects nearest-MIDI spellings and number as individual tokens", () => {
    render(<CalculatorTab settings={SETTINGS} />);
    const output = screen.getByLabelText("Calculator nearest MIDI note");
    const tokens = [...output.querySelectorAll(".calculator-output__token")];

    expect(tokens.length).toBeGreaterThanOrEqual(2);
    fireEvent.click(tokens[0]);
    expect(globalThis.getSelection().toString()).toBe(tokens[0].textContent);
    fireEvent.click(tokens.at(-1));
    expect(globalThis.getSelection().toString()).toBe(tokens.at(-1).textContent);

    tokens[0].getBoundingClientRect = () => ({ left: 0, right: 40 });
    tokens.at(-1).getBoundingClientRect = () => ({ left: 60, right: 100 });
    globalThis.getSelection().removeAllRanges();
    fireEvent.click(output.querySelector("[aria-hidden='true']"), { clientX: 55 });
    expect(globalThis.getSelection().toString()).toBe(tokens.at(-1).textContent);
  });

  it("uses Plainsound tempered spellings and can include them in Deviation", () => {
    render(<CalculatorTab settings={SETTINGS} />);
    const lookup = screen.getByLabelText("Calculator lookup ratio or cents");

    fireEvent.input(lookup, { target: { value: "1100." } });
    fireEvent.blur(lookup);

    expect(screen.getByLabelText("Calculator nearest MIDI note").textContent).toBe(
      "A5 | G5 | 80",
    );
    expect(screen.getByLabelText("Calculator MIDI deviation").textContent).toBe("+0.000");

    fireEvent.click(screen.getByLabelText("Calculator include tempered accidentals in deviation"));
    const deviation = screen.getByLabelText("Calculator MIDI deviation");
    expect(deviation.textContent).toBe("A+0.000 | G+0.000");
    const tokens = [...deviation.querySelectorAll(".calculator-output__token")];
    expect(tokens).toHaveLength(2);
    fireEvent.click(tokens[0]);
    expect(globalThis.getSelection().toString()).toBe("A+0.000");
    fireEvent.click(tokens[1]);
    expect(globalThis.getSelection().toString()).toBe("G+0.000");

    tokens[0].getBoundingClientRect = () => ({ left: 0, right: 50 });
    tokens[1].getBoundingClientRect = () => ({ left: 70, right: 130 });
    globalThis.getSelection().removeAllRanges();
    fireEvent.click(deviation.querySelector("[aria-hidden='true']"), { clientX: 52 });
    expect(globalThis.getSelection().toString()).toBe("A+0.000");

    fireEvent.click(screen.getByLabelText("Calculator use traditional accidentals"));
    expect(screen.getByLabelText("Calculator nearest MIDI note").textContent).toBe(
      "*fA5 | *sG5 | 80",
    );
    expect(screen.getByLabelText("Calculator MIDI deviation").textContent).toBe(
      "*fA+0.000 | *sG+0.000",
    );
  });

  it("uses a tempered natural in the combined Deviation string", () => {
    render(<CalculatorTab settings={SETTINGS} />);

    expect(screen.getByLabelText("Calculator nearest MIDI note").textContent).toBe("A4 | 69");
    fireEvent.click(screen.getByLabelText("Calculator include tempered accidentals in deviation"));
    expect(screen.getByLabelText("Calculator MIDI deviation").textContent).toBe("A+0.000");
    fireEvent.click(screen.getByLabelText("Calculator use traditional accidentals"));
    expect(screen.getByLabelText("Calculator MIDI deviation").textContent).toBe("*nA+0.000");
  });

  it("shows zero Deviation when the input equals a cents-based notation anchor", () => {
    render(
      <CalculatorTab
        settings={{
          ...SETTINGS,
          fundamental: 442,
          reference_degree: 0,
          scale: ["400.", "1200."],
          heji_anchor_ratio: "400.",
          heji_anchor_label: "*nE",
          heji_palette_decimals: 0,
        }}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "E" }));
    expect(screen.getByLabelText("Calculator MIDI deviation").textContent).toBe("+0");
    fireEvent.click(screen.getByLabelText("Calculator include tempered accidentals in deviation"));
    expect(screen.getByLabelText("Calculator MIDI deviation").textContent).toBe("E+0");
  });

  it("uses a palette spelling as an alternative pitch-query input", () => {
    render(<CalculatorTab settings={SETTINGS} />);

    fireEvent.click(screen.getByRole("button", { name: "A" }));

    expect(screen.getByLabelText("Calculator interval from 1/1").textContent).toBe(
      "27/16 | 905.865",
    );
    expect(screen.getByLabelText("Calculator spelling output").textContent).toContain("A");
    expect(screen.getByLabelText("Calculator lookup ratio or cents").value).toBe("1/1");
  });

  it("calculates cents and frequency from tempered palette input", () => {
    render(<CalculatorTab settings={{ scale: null }} />);

    fireEvent.click(screen.getByRole("button", { name: "C" }));
    fireEvent.click(
      within(screen.getByRole("group", { name: "Calculator 12edo accidentals" })).getByRole(
        "button",
        { name: "" },
      ),
    );
    const deviation = screen.getByLabelText("Calculator palette cents deviation");
    fireEvent.input(deviation, { target: { value: "+12" } });

    expect(screen.getByLabelText("Calculator lookup ratio or cents").value).toBe("-788.000000");
    expect(screen.getByLabelText("Calculator interval from 1/1").textContent).toBe("— | -788");
    expect(screen.getByLabelText("Calculator spelling output").textContent).toBe("C+12");
    expect(Number(screen.getByLabelText("Calculator frequency output").textContent)).toBeCloseTo(
      279.1,
      1,
    );
  });

  it("resets tempered accidental cents to positive zero", () => {
    render(<CalculatorTab settings={{ scale: null }} />);
    const accidentals = screen.getByRole("group", { name: "Calculator 12edo accidentals" });

    fireEvent.click(within(accidentals).getByRole("button", { name: "" }));
    let deviation = screen.getByLabelText("Calculator palette cents deviation");
    expect(deviation.value).toBe("+0");

    fireEvent.input(deviation, { target: { value: "+12" } });
    expect(screen.getByLabelText("Calculator palette cents deviation").value).toBe("+12");

    fireEvent.click(within(accidentals).getByRole("button", { name: "" }));
    deviation = screen.getByLabelText("Calculator palette cents deviation");
    expect(deviation.value).toBe("+0");

    fireEvent.input(deviation, { target: { value: "−0" } });
    expect(screen.getByLabelText("Calculator palette cents deviation").value).toBe("+0");
  });

  it("does not fabricate ratios for palette pitches above a cents HEJI anchor", () => {
    render(
      <CalculatorTab
        settings={{
          ...SETTINGS,
          reference_degree: 0,
          scale: Array.from({ length: 36 }, (_, index) => `${((index + 1) * 1200) / 36}.`),
          heji_anchor_ratio: "400.",
          heji_anchor_label: "*nE",
        }}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "A" }));

    expect(screen.getByLabelText("Calculator interval from HEJI anchor").textContent).toMatch(
      /^4\/3 \| /,
    );
    expect(screen.getByLabelText("Calculator interval from 1/1").textContent).toMatch(/^— \| /);
    expect(screen.getByLabelText("Calculator spelling output").textContent).toContain("A");
    expect(screen.getByLabelText("Calculator lookup ratio or cents").value).toBe("4/3");
  });

  it("keeps Pitch from Offset unchanged when Offset changes", () => {
    render(
      <CalculatorTab
        settings={{
          ...SETTINGS,
          reference_degree: 0,
          scale: ["400.", "1200."],
          heji_anchor_ratio: "400.",
          heji_anchor_label: "*nE",
        }}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "A" }));
    expect(screen.getByLabelText("Calculator lookup ratio or cents").value).toBe("4/3");
    const offset = screen.getByLabelText("Calculator lookup offset ratio or cents");

    fireEvent.input(offset, { target: { value: "300." } });
    fireEvent.blur(offset);
    expect(screen.getByLabelText("Calculator lookup ratio or cents").value).toBe("4/3");
    expect(screen.getByLabelText("Calculator interval from HEJI anchor").textContent).toMatch(
      /^— \| /,
    );

    const updatedOffset = screen.getByLabelText("Calculator lookup offset ratio or cents");
    fireEvent.input(updatedOffset, { target: { value: "400.000000" } });
    fireEvent.blur(updatedOffset);
    expect(screen.getByLabelText("Calculator lookup ratio or cents").value).toBe("4/3");
    expect(screen.getByLabelText("Calculator interval from offset").textContent).toMatch(
      /^4\/3 \| /,
    );
  });

  it("places palette spellings in octave 4 by default and permits register changes", () => {
    render(<CalculatorTab settings={SETTINGS} />);

    expect(screen.getByLabelText("Calculator palette octave value").textContent).toBe("4");
    fireEvent.click(screen.getByLabelText("Lower calculator palette octave"));

    expect(screen.getByLabelText("Calculator palette octave value").textContent).toBe("3");
    expect(screen.getByLabelText("Calculator interval from 1/1").textContent).toBe(
      "27/32 | -294.135",
    );
    expect(screen.getByLabelText("Calculator lookup ratio or cents").value).toBe("1/2");
  });

  it("normalises calculated results only when the results checkbox is selected", () => {
    render(<CalculatorTab settings={{ scale: null }} />);
    const lookup = screen.getByLabelText("Calculator lookup ratio or cents");

    fireEvent.input(lookup, { target: { value: "4/1" } });
    fireEvent.blur(lookup);
    expect(screen.getByLabelText("Calculator interval from 1/1").textContent).toBe("4/1 | 2400");

    fireEvent.click(screen.getByLabelText("Calculator normalise results"));
    expect(screen.getByLabelText("Calculator interval from 1/1").textContent).toBe("2/1 | 1200");
  });

  it("loads Palette Input into Pitch while preserving an editable Offset", () => {
    render(<CalculatorTab settings={SETTINGS} />);
    const offset = screen.getByLabelText("Calculator lookup offset ratio or cents");

    fireEvent.input(offset, { target: { value: "3/2" } });
    fireEvent.blur(offset);
    fireEvent.click(screen.getByRole("button", { name: "A" }));

    expect(screen.getByLabelText("Calculator lookup offset ratio or cents").value).toBe("3/2");
    expect(screen.getByLabelText("Calculator lookup ratio or cents").value).toBe("4/3");
    expect(screen.getByLabelText("Calculator interval from HEJI anchor").textContent).toBe(
      "2/1 | 1200.000",
    );
  });

  it("updates Palette Input from an edited Pitch and from later Offset changes", () => {
    render(<CalculatorTab settings={SETTINGS} />);
    const pitch = screen.getByLabelText("Calculator lookup ratio or cents");

    fireEvent.input(pitch, { target: { value: "3/2" } });
    fireEvent.blur(pitch);

    expect(screen.getByLabelText("Calculator palette output").value).toContain("E");
    expect(screen.getByLabelText("Calculator palette octave value").textContent).toBe("5");

    const offset = screen.getByLabelText("Calculator lookup offset ratio or cents");
    fireEvent.input(offset, { target: { value: "2/1" } });
    fireEvent.blur(offset);

    expect(screen.getByLabelText("Calculator lookup ratio or cents").value).toBe("3/2");
    expect(screen.getByLabelText("Calculator palette output").value).toContain("E");
    expect(screen.getByLabelText("Calculator palette octave value").textContent).toBe("6");
    expect(screen.getByLabelText("Calculator interval from HEJI anchor").textContent).toBe(
      "3/1 | 1901.955",
    );
  });

  it("offers the same palette option groups and local output controls", () => {
    render(<CalculatorTab settings={SETTINGS} />);

    expect(screen.getByLabelText("Calculator Double Flat/Sharp")).toBeTruthy();
    expect(screen.getByLabelText("Calculator Double Flat/Sharp").checked).toBe(true);
    expect(screen.getByLabelText("Calculator Double Septimals").checked).toBe(true);
    expect(screen.getByRole("group", { name: "Calculator HEJI letters" })).toBeTruthy();
    expect(screen.getByRole("group", { name: "Calculator 3-Limit" })).toBeTruthy();
    expect(screen.getByLabelText("Calculator palette output")).toBeTruthy();
  });

  it("keeps stacked HEJI commas responsive after their exact fraction exceeds 2^53", async () => {
    render(<CalculatorTab settings={SETTINGS} />);
    fireEvent.click(screen.getByRole("button", { name: "A" }));
    const lowerSeven = within(
      screen.getByRole("group", { name: "Calculator 7-Limit" }),
    ).getByTitle("7-limit lower");

    for (let index = 0; index < 10; index += 1) fireEvent.click(lowerSeven);

    await waitFor(() =>
      expect(screen.getByLabelText("Calculator palette output").value).toBe("A"),
    );
    expect(screen.getByLabelText("Calculator palette cents deviation").value).toBe("−272.641");
    expect(screen.getByLabelText("Calculator interval from offset").textContent).toMatch(
      /^— \| -?\d/u,
    );
    expect(screen.getByLabelText("Calculator frequency output").textContent).not.toBe("—");
  });

  it("keeps all stacked syntonic commas in the logarithmic palette fallback", async () => {
    render(<CalculatorTab settings={SETTINGS} />);
    fireEvent.click(screen.getByRole("button", { name: "A" }));
    const syntonicUp = within(
      screen.getByRole("group", { name: "Calculator 5-Limit" }),
    ).getByRole("button", { name: "up" });

    for (let index = 0; index < 10; index += 1) fireEvent.click(syntonicUp);

    await waitFor(() =>
      expect(screen.getByLabelText("Calculator palette output").value).toBe(
        `${"".repeat(7)}A`,
      ),
    );
    expect(screen.getByLabelText("Calculator palette cents deviation").value).toBe("+215.063");
    expect(screen.getByLabelText("Calculator interval from offset").textContent).toBe(
      "— | 215.063",
    );
  });

  it("resets Palette Input to the chosen HEJI notation anchor", () => {
    render(<CalculatorTab settings={SETTINGS} />);

    fireEvent.click(screen.getByRole("button", { name: "E" }));
    expect(screen.getByLabelText("Calculator palette output").value).toContain("E");

    fireEvent.click(screen.getByRole("button", { name: "Clear" }));

    expect(screen.getByLabelText("Calculator palette output").value).toContain("A");
    expect(screen.getByLabelText("Calculator palette octave value").textContent).toBe("4");
    expect(screen.getByLabelText("Calculator lookup ratio or cents").value).toBe("1/1");
  });

  it("selects Ratio or Cents independently and the complete row on triple-click", () => {
    render(<CalculatorTab settings={SETTINGS} />);
    const results = screen.getByRole("group", { name: "Calculated Data" });
    const ratio = within(results).getByLabelText("Calculator interval from 1/1");
    const tokens = [...ratio.querySelectorAll(".calculator-output__token")];

    expect(within(results).queryByRole("button", { name: "Copy" })).toBeNull();
    expect(within(results).queryByRole("button", { name: "Clear" })).toBeNull();
    expect(tokens).toHaveLength(2);
    fireEvent.focus(ratio);
    fireEvent.click(tokens[0]);
    expect(globalThis.getSelection().toString()).toBe("27/16");
    fireEvent.click(tokens[1]);
    expect(globalThis.getSelection().toString()).toBe("905.865");
    fireEvent.click(tokens[0], { detail: 3 });
    expect(globalThis.getSelection().toString()).toBe("27/16 | 905.865");
  });

  it("selects the nearer interval token when the gap is clicked", () => {
    render(<CalculatorTab settings={SETTINGS} />);
    const output = screen.getByLabelText("Calculator interval from 1/1");
    const tokens = [...output.querySelectorAll(".calculator-output__token")];
    const separator = output.querySelector("[aria-hidden='true']");
    tokens[0].getBoundingClientRect = () => ({ left: 0, right: 40 });
    tokens[1].getBoundingClientRect = () => ({ left: 60, right: 120 });

    globalThis.getSelection().removeAllRanges();
    fireEvent.click(separator, { clientX: 45 });
    expect(globalThis.getSelection().toString()).toBe("27/16");
    globalThis.getSelection().removeAllRanges();
    fireEvent.click(separator, { clientX: 58 });
    expect(globalThis.getSelection().toString()).toBe("905.865");
    fireEvent.click(separator, { clientX: 58, detail: 3 });
    expect(globalThis.getSelection().toString()).toBe("27/16 | 905.865");
  });

  it("preserves a user drag selection across an interval separator", () => {
    render(<CalculatorTab settings={SETTINGS} />);
    const output = screen.getByLabelText("Calculator interval from 1/1");
    const firstToken = output.querySelector(".calculator-output__token");
    const separator = output.querySelector("[aria-hidden='true']");
    const range = document.createRange();
    range.setStart(firstToken.firstChild, 1);
    range.setEnd(separator.firstChild, 2);
    const selection = globalThis.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
    const selectedText = selection.toString();

    fireEvent.click(separator, { clientX: 50, detail: 1 });

    expect(globalThis.getSelection().toString()).toBe(selectedText);
  });

  it("toggles a zero cents suffix for rational HEJI spelling", () => {
    render(<CalculatorTab settings={SETTINGS} />);
    const spelling = screen.getByLabelText("Calculator spelling output");

    expect(spelling.textContent).not.toMatch(/\+0$/u);
    fireEvent.click(screen.getByLabelText("Calculator always include cents in spelling"));
    expect(spelling.textContent).toMatch(/\+0$/u);
  });

  it("keeps sort visible while disclosing Hexatone-style rationalisation controls", () => {
    render(<CalculatorTab settings={SETTINGS} />);
    const toggle = screen.getByRole("button", { name: "Show Rationalisation Search options" });

    expect(screen.getByLabelText("Calculator rationalisation sort")).toBeTruthy();
    expect(screen.getByLabelText("Calculator rationalisation sort").value).toBe("harmonicRadius");
    expect(
      within(screen.getByLabelText("Calculator rationalisation sort")).getByRole("option", {
        name: "Harmonic radius from 1/1",
      }),
    ).toBeTruthy();
    expect(
      within(screen.getByLabelText("Calculator rationalisation sort")).getByRole("option", {
        name: "Odd radius from 1/1",
      }),
    ).toBeTruthy();
    expect(screen.queryByLabelText("Calculator rationalisation region")).toBeNull();
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(toggle.querySelector(".disclosure-toggle-glyph--collapsed")).toBeTruthy();

    fireEvent.click(toggle);

    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(toggle.querySelector(".disclosure-toggle-glyph--expanded")).toBeTruthy();
    expect(screen.getByLabelText("Calculator rationalisation region")).toBeTruthy();
    expect(
      screen.getByLabelText("Calculator rationalisation prime 3 overtonal steps"),
    ).toBeTruthy();
  });
});
