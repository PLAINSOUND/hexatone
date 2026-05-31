/**
 * Tests for src/settings/scale/colors.js
 *
 * The Colors component renders:
 *   - a "Key Colours" mode selector with Manual / Auto / Spectrum
 *   - a ColorCell for "Choose Central Hue" only in Spectrum mode
 *
 * The ColorCell hex text input commits on blur (not change).
 */

import { render, screen, fireEvent, waitFor } from "@testing-library/preact";
import { useState } from "preact/hooks";
import Colors from "./colors";
import useSettingsChange from "../../use-settings-change.js";

const baseSettings = { spectrum_colors: false, auto_colors: false, fundamental_color: "#abcdef" };

describe("Colors — spectrum colors off", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("defaults Key Colours to Manual", () => {
    render(<Colors settings={baseSettings} onChange={() => {}} onAtomicChange={() => {}} />);
    expect(screen.getByLabelText("Key Colours").value).toBe("manual");
  });

  it("does not render the hue picker in Manual mode", () => {
    render(<Colors settings={baseSettings} onChange={() => {}} onAtomicChange={() => {}} />);
    expect(screen.queryByLabelText(/central hue/i)).toBeNull();
  });

  it("does not render the auto palette in Manual mode", () => {
    render(<Colors settings={baseSettings} onChange={() => {}} onAtomicChange={() => {}} />);
    expect(screen.queryByText("Auto Colour Palette")).toBeNull();
  });

  it("disables Load Palette when no palette is saved", () => {
    render(
      <Colors
        settings={{ ...baseSettings, auto_colors: true }}
        rawSettings={{ ...baseSettings, auto_colors: true }}
        onChange={() => {}}
        onAtomicChange={() => {}}
      />,
    );
    expect(screen.getByRole("button", { name: /load user palette/i }).disabled).toBe(true);
  });

  it("disables Commit when auto-generated colours already match stored note colors", () => {
    render(
      <Colors
        settings={{
          ...baseSettings,
          auto_colors: true,
          note_colors: ["#ffa5a5", "#95c69b"],
          scale: ["23/16", "2/1"],
          equivSteps: 2,
          note_names: ["1/1", "23"],
          key_labels: "note_names",
        }}
        rawSettings={{
          ...baseSettings,
          auto_colors: true,
          note_colors: ["#ffa5a5", "#95c69b"],
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

describe("Colors — spectrum mode", () => {
  const settings = { spectrum_colors: true, auto_colors: false, fundamental_color: "#abcdef", equivSteps: 12 };

  it("renders the hue picker when spectrum is on", () => {
    render(<Colors settings={settings} onChange={() => {}} onAtomicChange={() => {}} />);
    expect(screen.getByLabelText("hex colour for central hue")).not.toBeNull();
  });

  it("hue picker has the correct value", () => {
    render(<Colors settings={settings} onChange={() => {}} onAtomicChange={() => {}} />);
    expect(screen.getByLabelText("hex colour for central hue").value).toBe("#abcdef");
  });

  it("renders the commit spectrum colours action", () => {
    render(<Colors settings={settings} onChange={() => {}} onAtomicChange={() => {}} />);
    expect(screen.getByRole("button", { name: /commit spectrum colours/i })).not.toBeNull();
  });

  it("shows spectrum mode in the selector", () => {
    render(<Colors settings={settings} onChange={() => {}} onAtomicChange={() => {}} />);
    expect(screen.getByLabelText("Key Colours").value).toBe("spectrum");
  });

  it("shows auto mode in the selector when auto overrides spectrum", () => {
    render(
      <Colors
        settings={{ ...settings, auto_colors: true }}
        onChange={() => {}}
        onAtomicChange={() => {}}
      />,
    );

    expect(screen.getByLabelText("Key Colours").value).toBe("auto");
    expect(screen.queryByRole("button", { name: /commit spectrum colours/i })).toBeNull();
  });

  it("renders spectrum toggle state from raw settings when auto colours normalize spectrum off", () => {
    render(
      <Colors
        settings={{ ...settings, auto_colors: true, spectrum_colors: false }}
        rawSettings={{ ...settings, auto_colors: true, spectrum_colors: true }}
        onChange={() => {}}
        onAtomicChange={() => {}}
      />,
    );

    expect(screen.getByLabelText("Key Colours").value).toBe("auto");
    expect(screen.queryByRole("button", { name: /commit spectrum colours/i })).toBeNull();
  });
});

describe("Colors — interactions", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.useRealTimers();
  });

  it("activates spectrum mode directly from the Key Colours selector", () => {
    const onAtomicChange = vi.fn();
    const onChange = vi.fn();
    render(<Colors settings={baseSettings} rawSettings={baseSettings} onChange={onChange} onAtomicChange={onAtomicChange} />);
    fireEvent.change(screen.getByLabelText("Key Colours"), { target: { value: "spectrum" } });
    expect(onAtomicChange).not.toHaveBeenCalled();
    expect(onChange).toHaveBeenCalledWith("spectrum_colors", true);
  });

  it("calls onChange with updated prime family colors when a prime shade is saved", () => {
    const onChange = vi.fn();
    render(
      <Colors
        settings={{ ...baseSettings, auto_colors: true }}
        rawSettings={{ ...baseSettings, auto_colors: true }}
        onChange={onChange}
        onAtomicChange={() => {}}
      />,
    );
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

  it("commits the derived spectrum palette and turns spectrum colours off", () => {
    const onAtomicChange = vi.fn();
    const settings = { spectrum_colors: true, auto_colors: false, fundamental_color: "#abcdef", equivSteps: 12 };
    render(<Colors settings={settings} rawSettings={settings} onChange={() => {}} onAtomicChange={onAtomicChange} />);
    fireEvent.click(screen.getByRole("button", { name: /commit spectrum colours/i }));
    expect(onAtomicChange).toHaveBeenCalledTimes(1);
    expect(onAtomicChange.mock.calls[0][0].spectrum_colors).toBe(false);
    expect(onAtomicChange.mock.calls[0][0].note_colors).toHaveLength(12);
    expect(onAtomicChange.mock.calls[0][0].note_colors[0]).toMatch(/^#[0-9a-f]{6}$/i);
  });

  it("saves the current prime palette to localStorage", () => {
    render(
      <Colors
        settings={{ ...baseSettings, auto_colors: true }}
        rawSettings={{ ...baseSettings, auto_colors: true }}
        onChange={() => {}}
        onAtomicChange={() => {}}
      />,
    );
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
    render(
      <Colors
        settings={{ ...baseSettings, auto_colors: true }}
        rawSettings={{ ...baseSettings, auto_colors: true }}
        onChange={onChange}
        onAtomicChange={() => {}}
      />,
    );
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
          auto_colors: true,
          prime_family_colors: ["#111111"],
        }}
        rawSettings={{
          ...baseSettings,
          auto_colors: true,
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

  it("commits the current auto-generated colours and turns auto and spectrum colours off", () => {
    const onAtomicChange = vi.fn();
    render(
      <Colors
        settings={{
          ...baseSettings,
          spectrum_colors: true,
          note_colors: ["#ffffff", "#ffffff"],
          scale: ["23/16", "2/1"],
          equivSteps: 2,
          note_names: ["1/1", "23"],
          key_labels: "note_names",
        }}
        rawSettings={{
          ...baseSettings,
          auto_colors: true,
          spectrum_colors: true,
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
    fireEvent.click(screen.getByRole("button", { name: /commit auto colours/i }));
    expect(onAtomicChange).toHaveBeenCalledWith({
      note_colors: ["#ffa5a5", "#95c69b"],
      auto_colors: false,
      spectrum_colors: false,
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

  it("cancels a pending auto preview when auto colours is turned off", async () => {
    vi.useFakeTimers();
    const updateColors = vi.fn();

    const Wrapper = () => {
      const [rawSettings, setRawSettings] = useState({
        ...baseSettings,
        auto_colors: true,
        spectrum_colors: false,
        note_colors: ["#ffffff", "#ffffff"],
        scale: ["23/16", "2/1"],
        equivSteps: 2,
        note_names: ["1/1", "23"],
        key_labels: "note_names",
      });
      const effectiveSettings = {
        ...rawSettings,
        auto_colors: rawSettings.auto_colors,
        spectrum_colors: false,
      };
      return (
        <Colors
          settings={effectiveSettings}
          rawSettings={rawSettings}
          keysRef={{ current: { updateColors } }}
          onChange={(key, value) => setRawSettings((prev) => ({ ...prev, [key]: value }))}
          onAtomicChange={() => {}}
        />
      );
    };

    render(<Wrapper />);
    fireEvent.input(screen.getByLabelText("hex colour for prime-family-colour-23"), {
      target: { value: "#112233" },
    });
    fireEvent.change(screen.getByLabelText("Key Colours"), { target: { value: "manual" } });
    const callCountBeforeFrame = updateColors.mock.calls.length;

    vi.advanceTimersByTime(20);

    expect(updateColors.mock.calls.length).toBe(callCountBeforeFrame);
  });

  it("allows spectrum colours to reactivate after committing auto colours", async () => {
    const updateColors = vi.fn();

    const Wrapper = () => {
      const [settings, setSettings] = useState({
        ...baseSettings,
        auto_colors: false,
        spectrum_colors: true,
        note_colors: ["#ffffff", "#ffffff"],
        scale: ["23/16", "2/1"],
        equivSteps: 2,
        note_names: ["1/1", "23"],
        key_labels: "note_names",
      });
      const keysRef = { current: { updateColors } };
      const { onChange, onAtomicChange } = useSettingsChange(settings, setSettings, {
        midi: null,
        setMidiLearnActive: vi.fn(),
        setHakenPedalLearnActive: vi.fn(),
        keysRef,
        setLatch: vi.fn(),
        bumpImportCount: vi.fn(),
        onUserScaleEdit: vi.fn(),
      });
      return (
        <Colors
          settings={settings}
          rawSettings={settings}
          keysRef={keysRef}
          onChange={onChange}
          onAtomicChange={onAtomicChange}
        />
      );
    };

    render(<Wrapper />);

    fireEvent.change(screen.getByLabelText("Key Colours"), { target: { value: "auto" } });
    fireEvent.click(screen.getByRole("button", { name: /commit auto colours/i }));
    fireEvent.change(screen.getByLabelText("Key Colours"), { target: { value: "spectrum" } });

    await waitFor(() => {
      expect(updateColors.mock.calls.at(-1)[0]).toMatchObject({
        spectrum_colors: true,
      });
    });
  });

  it("allows spectrum colours to activate after committing auto colours from a non-spectrum state", async () => {
    const updateColors = vi.fn();

    const Wrapper = () => {
      const [settings, setSettings] = useState({
        ...baseSettings,
        auto_colors: false,
        spectrum_colors: false,
        note_colors: ["#ffffff", "#ffffff"],
        scale: ["23/16", "2/1"],
        equivSteps: 2,
        note_names: ["1/1", "23"],
        key_labels: "note_names",
      });
      const keysRef = { current: { updateColors } };
      const { onChange, onAtomicChange } = useSettingsChange(settings, setSettings, {
        midi: null,
        setMidiLearnActive: vi.fn(),
        setHakenPedalLearnActive: vi.fn(),
        keysRef,
        setLatch: vi.fn(),
        bumpImportCount: vi.fn(),
        onUserScaleEdit: vi.fn(),
      });
      return (
        <Colors
          settings={settings}
          rawSettings={settings}
          keysRef={keysRef}
          onChange={onChange}
          onAtomicChange={onAtomicChange}
        />
      );
    };

    render(<Wrapper />);

    fireEvent.change(screen.getByLabelText("Key Colours"), { target: { value: "auto" } });
    fireEvent.click(screen.getByRole("button", { name: /commit auto colours/i }));
    fireEvent.change(screen.getByLabelText("Key Colours"), { target: { value: "spectrum" } });

    await waitFor(() => {
      expect(updateColors.mock.calls.at(-1)[0]).toMatchObject({
        spectrum_colors: true,
      });
    });
  });

  it("returns to Manual after committing spectrum colours", () => {
    const onAtomicChange = vi.fn();
    const settings = { spectrum_colors: true, auto_colors: false, fundamental_color: "#abcdef", equivSteps: 12 };
    render(<Colors settings={settings} rawSettings={settings} onChange={() => {}} onAtomicChange={onAtomicChange} />);
    fireEvent.click(screen.getByRole("button", { name: /commit spectrum colours/i }));
    expect(onAtomicChange).toHaveBeenCalledWith(expect.objectContaining({
      spectrum_colors: false,
    }));
  });
});
