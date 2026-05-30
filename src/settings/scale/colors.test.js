/**
 * Tests for src/settings/scale/colors.js
 *
 * The Colors component renders:
 *   - a "Use Spectrum Colors" checkbox (always visible)
 *   - a ColorCell for "Choose Central Hue" (only when spectrum_colors is true)
 *
 * The ColorCell hex text input commits on blur (not change).
 */

import { render, screen, fireEvent, waitFor } from "@testing-library/preact";
import Colors from "./colors";

const baseSettings = { spectrum_colors: false, auto_colors: false, fundamental_color: "#abcdef" };

describe("Colors — spectrum colors off", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("renders the spectrum colors checkbox unchecked", () => {
    render(<Colors settings={baseSettings} onChange={() => {}} onAtomicChange={() => {}} />);
    const checkbox = screen.getByRole("checkbox", { name: /spectrum colors/i });
    expect(checkbox.checked).toBe(false);
  });

  it("does not render the hue picker when spectrum is off", () => {
    render(<Colors settings={baseSettings} onChange={() => {}} onAtomicChange={() => {}} />);
    expect(screen.queryByLabelText(/central hue/i)).toBeNull();
  });

  it("renders the auto colours checkbox unchecked", () => {
    render(<Colors settings={baseSettings} onChange={() => {}} onAtomicChange={() => {}} />);
    const checkbox = screen.getByRole("checkbox", { name: /auto colours/i });
    expect(checkbox.checked).toBe(false);
  });

  it("renders prime-family colour editors below auto colours", () => {
    render(<Colors settings={baseSettings} onChange={() => {}} onAtomicChange={() => {}} />);
    expect(screen.getByText("Auto Colour Palette")).not.toBeNull();
    expect(screen.getByLabelText("hex colour for prime-family-colour-1")).not.toBeNull();
    expect(screen.getByLabelText("hex colour for prime-family-colour-47")).not.toBeNull();
  });

  it("disables Load Palette when no palette is saved", () => {
    render(<Colors settings={baseSettings} onChange={() => {}} onAtomicChange={() => {}} />);
    expect(screen.getByRole("button", { name: /load user palette/i }).disabled).toBe(true);
  });

  it("disables Commit when auto-generated colours already match stored note colors", () => {
    render(
      <Colors
        settings={{
          ...baseSettings,
          note_colors: ["#ff9696", "#95c69b"],
          scale: ["23/16", "2/1"],
          equivSteps: 2,
          note_names: ["1/1", "23"],
          key_labels: "note_names",
        }}
        onChange={() => {}}
        onAtomicChange={() => {}}
      />,
    );
    expect(screen.getByRole("button", { name: /commit/i }).disabled).toBe(true);
  });
});

describe("Colors — spectrum colors on", () => {
  const settings = { spectrum_colors: true, auto_colors: false, fundamental_color: "#abcdef", equivSteps: 12 };

  it("renders the hue picker when spectrum is on", () => {
    render(<Colors settings={settings} onChange={() => {}} onAtomicChange={() => {}} />);
    expect(screen.getByLabelText("hex colour for central hue")).not.toBeNull();
  });

  it("hue picker has the correct value", () => {
    render(<Colors settings={settings} onChange={() => {}} onAtomicChange={() => {}} />);
    expect(screen.getByLabelText("hex colour for central hue").value).toBe("#abcdef");
  });

  it("renders the load spectrum colors action", () => {
    render(<Colors settings={settings} onChange={() => {}} onAtomicChange={() => {}} />);
    expect(screen.getByRole("button", { name: /load spectrum colors/i })).not.toBeNull();
  });

  it("keeps the auto colours checkbox enabled when spectrum is on", () => {
    render(<Colors settings={settings} onChange={() => {}} onAtomicChange={() => {}} />);
    expect(screen.getByRole("checkbox", { name: /auto colours/i }).disabled).toBe(false);
  });

  it("keeps spectrum controls visible when both spectrum and auto colours are enabled", () => {
    render(
      <Colors
        settings={{ ...settings, auto_colors: true }}
        onChange={() => {}}
        onAtomicChange={() => {}}
      />,
    );

    expect(screen.getByRole("checkbox", { name: /spectrum colors/i }).disabled).toBe(true);
    expect(screen.getByRole("button", { name: /open colour picker for central hue/i })).not.toBeNull();
    expect(screen.getByLabelText(/hex colour for central hue/i).disabled).toBe(true);
    expect(screen.getByRole("button", { name: /load spectrum colors/i }).disabled).toBe(true);
  });
});

describe("Colors — interactions", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("calls onChange with spectrum_colors=true when checkbox is ticked", () => {
    const onChange = vi.fn();
    render(<Colors settings={baseSettings} onChange={onChange} onAtomicChange={() => {}} />);
    const checkbox = screen.getByRole("checkbox", { name: /spectrum colors/i });
    fireEvent.click(checkbox);
    expect(onChange).toHaveBeenCalledWith("spectrum_colors", true);
  });

  it("calls onChange with auto_colors=true when checkbox is ticked", () => {
    const onChange = vi.fn();
    render(<Colors settings={baseSettings} onChange={onChange} onAtomicChange={() => {}} />);
    const checkbox = screen.getByRole("checkbox", { name: /auto colours/i });
    fireEvent.click(checkbox);
    expect(onChange).toHaveBeenCalledWith("auto_colors", true);
  });

  it("calls onChange with updated prime family colors when a prime shade is saved", () => {
    const onChange = vi.fn();
    render(<Colors settings={baseSettings} onChange={onChange} onAtomicChange={() => {}} />);
    const input = screen.getByLabelText("hex colour for prime-family-colour-5");
    fireEvent.input(input, { target: { value: "#aaccee" } });
    fireEvent.click(screen.getByLabelText("save colour for prime-family-colour-5"));
    expect(onChange).toHaveBeenCalledWith(
      "prime_family_colors",
      expect.arrayContaining(["#aaccee"]),
    );
  });

  it("calls onChange with new color when the color picker value is committed", () => {
    const onChange = vi.fn();
    const settings = { spectrum_colors: true, fundamental_color: "#abcdef" };
    render(<Colors settings={settings} onChange={onChange} onAtomicChange={() => {}} />);
    const input = screen.getByLabelText("hex colour for central hue");
    fireEvent.input(input, { target: { value: "#ff0000" } });
    fireEvent.blur(input);
    expect(onChange).toHaveBeenCalledWith("fundamental_color", "#ff0000");
  });

  it("loads the derived spectrum palette into note_colors when requested", () => {
    const onChange = vi.fn();
    const settings = { spectrum_colors: true, fundamental_color: "#abcdef", equivSteps: 12 };
    render(<Colors settings={settings} onChange={onChange} onAtomicChange={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: /load spectrum colors/i }));
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange.mock.calls[0][0]).toBe("note_colors");
    expect(onChange.mock.calls[0][1]).toHaveLength(12);
    expect(onChange.mock.calls[0][1][0]).toMatch(/^#[0-9a-f]{6}$/i);
  });

  it("saves the current prime palette to localStorage", () => {
    render(<Colors settings={baseSettings} onChange={() => {}} onAtomicChange={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: /save user palette/i }));
    expect(JSON.parse(localStorage.getItem("hexatone_prime_family_palette"))).toBeTruthy();
  });

  it("loads a saved prime palette from localStorage", () => {
    localStorage.setItem("hexatone_prime_family_palette", JSON.stringify([
      "#111111", "#222222", "#333333", "#444444", "#555555",
      "#666666", "#777777", "#888888", "#999999", "#aaaaaa",
      "#bbbbbb", "#cccccc", "#dddddd", "#eeeeee", "#fafafa",
    ]));
    const onChange = vi.fn();
    render(<Colors settings={baseSettings} onChange={onChange} onAtomicChange={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: /load user palette/i }));
    expect(onChange).toHaveBeenCalledWith(
      "prime_family_colors",
      expect.arrayContaining(["#111111", "#333333", "#fafafa"]),
    );
  });

  it("restores the default prime palette", () => {
    const onChange = vi.fn();
    render(
      <Colors
        settings={{
          ...baseSettings,
          prime_family_colors: ["#111111"],
        }}
        onChange={onChange}
        onAtomicChange={() => {}}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /reset defaults/i }));
    expect(onChange).toHaveBeenCalledWith(
      "prime_family_colors",
      expect.arrayContaining(["#ff7a7a", "#ffffff", "#fffae5"]),
    );
  });

  it("commits the current auto-generated colours and turns auto colours off", () => {
    const onAtomicChange = vi.fn();
    render(
      <Colors
        settings={{
          ...baseSettings,
          note_colors: ["#ffffff", "#ffffff"],
          scale: ["23/16", "2/1"],
          equivSteps: 2,
          note_names: ["1/1", "23"],
          key_labels: "note_names",
        }}
        onChange={() => {}}
        onAtomicChange={onAtomicChange}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /commit/i }));
    expect(onAtomicChange).toHaveBeenCalledWith({
      note_colors: ["#ff9696", "#95c69b"],
      auto_colors: false,
    });
  });

  it("previews prime-family palette edits live on the canvas and compare restores the original preview", async () => {
    const updateColors = vi.fn();
    render(
      <Colors
        settings={{
          ...baseSettings,
          auto_colors: true,
          note_colors: ["#ffffff", "#ffffff"],
          scale: ["23/16", "2/1"],
          equivSteps: 2,
          note_names: ["1/1", "23"],
          key_labels: "note_names",
        }}
        rawSettings={{
          ...baseSettings,
          auto_colors: true,
          note_colors: ["#ffffff", "#ffffff"],
          scale: ["23/16", "2/1"],
          equivSteps: 2,
          note_names: ["1/1", "23"],
          key_labels: "note_names",
        }}
        keysRef={{ current: { updateColors } }}
        onChange={() => {}}
        onAtomicChange={() => {}}
      />,
    );

    const input = screen.getByLabelText("hex colour for prime-family-colour-23");
    fireEvent.input(input, { target: { value: "#112233" } });
    await waitFor(() => {
      expect(updateColors).toHaveBeenCalled();
    });
    expect(updateColors.mock.calls.at(-1)[0].note_colors[1]).toBe("112233");

    fireEvent.click(screen.getByLabelText("compare original colour for prime-family-colour-23"));
    await waitFor(() => {
      expect(updateColors.mock.calls.at(-1)[0].note_colors[1]).toBe("95c69b");
    });
  });
});
