import { render, fireEvent, waitFor, screen } from "@testing-library/preact";
import { vi } from "vitest";

vi.mock("../../hexatone/preset-tunings/index.js", () => ({
  findPresetTuningByName: vi.fn((name) => (
    name === "Preset A" || name === "Preset B" ? { name } : null
  )),
}));

import CustomPresets, { loadCustomPresets } from "./custom-presets.js";

const realFileReader = globalThis.FileReader;

class MockFileReader {
  readAsText(file) {
    this.onload?.({ target: { result: file.__text ?? "" } });
  }
}

const makeFile = (name, text, relativePath = "") => {
  const file = new File(["stub"], name, { type: "text/plain" });
  Object.defineProperty(file, "__text", { value: text, configurable: true });
  Object.defineProperty(file, "webkitRelativePath", { value: relativePath, configurable: true });
  return file;
};

const presetJson = (name, scale = ["100.", "1200."], equivSteps = 2) =>
  JSON.stringify({
    name,
    scale,
    equivSteps,
  });

const baseProps = {
  settings: {},
  onLoad: () => {},
  onClear: () => {},
  isActive: false,
  activeSource: "",
  activePresetName: "",
  isPresetDirty: false,
  onRevert: () => {},
  currentModulationLibrary: [],
  canCommitModulation: false,
  onCommitCurrentModulation: () => null,
};

describe("CustomPresets import actions", () => {
  beforeEach(() => {
    localStorage.clear();
    globalThis.FileReader = MockFileReader;
    vi.spyOn(window, "confirm").mockReturnValue(true);
  });

  afterEach(() => {
    globalThis.FileReader = realFileReader;
    vi.restoreAllMocks();
  });

  it("imports selected files and merges them into saved user tunings", async () => {
    const existing = [{ name: "Existing", scale: ["2/1"], equivSteps: 1 }];
    localStorage.setItem("hexatone_custom_presets", JSON.stringify(existing));

    const { container } = render(<CustomPresets {...baseProps} />);
    const [fileInput] = container.querySelectorAll('input[type="file"]');

    fireEvent.change(fileInput, {
      target: {
        files: [
          makeFile("alpha.json", presetJson("Alpha tuning")),
          makeFile("beta.json", presetJson("Beta tuning")),
        ],
      },
    });

    await waitFor(() => {
      const presets = loadCustomPresets();
      expect(presets.map((p) => p.name)).toEqual(["Existing", "Alpha tuning", "Beta tuning"]);
    });
  });

  it("activates the first imported tuning after opening a file", async () => {
    const onLoad = vi.fn();
    const { container } = render(<CustomPresets {...baseProps} onLoad={onLoad} />);
    const [fileInput] = container.querySelectorAll('input[type="file"]');

    fireEvent.change(fileInput, {
      target: {
        files: [makeFile("alpha.json", presetJson("Alpha tuning"))],
      },
    });

    await waitFor(() => {
      expect(onLoad).toHaveBeenCalledWith(expect.objectContaining({ name: "Alpha tuning" }));
    });
  });

  it("warns before replacing an unsaved working tuning during file open", async () => {
    const onLoad = vi.fn();
    const { container } = render(
      <CustomPresets
        {...baseProps}
        activeSource="builtin"
        settings={{
          name: "Unsaved 36edo",
          scale: ["33.333333", "66.666667", "1200."],
          equivSteps: 36,
          fundamental: 440,
        }}
        onLoad={onLoad}
      />,
    );
    const [fileInput] = container.querySelectorAll('input[type="file"]');
    window.confirm.mockReturnValueOnce(false);

    fireEvent.change(fileInput, {
      target: {
        files: [makeFile("alpha.json", presetJson("Alpha tuning"))],
      },
    });

    await waitFor(() => {
      expect(window.confirm).toHaveBeenCalledWith("Discard current unsaved tuning?");
    });
    expect(onLoad).not.toHaveBeenCalled();
    expect(loadCustomPresets()).toEqual([]);
  });

  it("ignores subfolder files during folder import unless Include subfolders is checked", async () => {
    const { container, rerender } = render(<CustomPresets {...baseProps} />);
    const [, folderInput] = container.querySelectorAll('input[type="file"]');

    fireEvent.change(folderInput, {
      target: {
        files: [
          makeFile("root.json", presetJson("Root tuning"), "my-folder/root.json"),
          makeFile("nested.json", presetJson("Nested tuning"), "my-folder/sub/nested.json"),
        ],
      },
    });

    await waitFor(() => {
      const presets = loadCustomPresets();
      expect(presets.map((p) => p.name)).toEqual(["Root tuning"]);
    });

    localStorage.clear();
    rerender(<CustomPresets {...baseProps} />);
    const includeSubfoldersLabel = screen.getByText(/Include subfolders/i).closest("label");
    fireEvent.click(includeSubfoldersLabel.querySelector("input"));

    const [, nextFolderInput] = container.querySelectorAll('input[type="file"]');
    fireEvent.change(nextFolderInput, {
      target: {
        files: [
          makeFile("root.json", presetJson("Root tuning"), "my-folder/root.json"),
          makeFile("nested.json", presetJson("Nested tuning"), "my-folder/sub/nested.json"),
        ],
      },
    });

    await waitFor(() => {
      const presets = loadCustomPresets();
      expect(presets.map((p) => p.name)).toEqual(["Root tuning", "Nested tuning"]);
    });
  });

  it("keeps new files and skips clashes when overwrite is declined", async () => {
    localStorage.setItem(
      "hexatone_custom_presets",
      JSON.stringify([{ name: "Existing clash", scale: ["2/1"], equivSteps: 1 }]),
    );
    window.confirm.mockReturnValue(false);

    const { container } = render(<CustomPresets {...baseProps} />);
    const [fileInput] = container.querySelectorAll('input[type="file"]');

    fireEvent.change(fileInput, {
      target: {
        files: [
          makeFile("clash.json", presetJson("Existing clash")),
          makeFile("fresh.json", presetJson("Fresh tuning")),
        ],
      },
    });

    await waitFor(() => {
      const presets = loadCustomPresets();
      expect(presets.map((p) => p.name)).toEqual(["Existing clash", "Fresh tuning"]);
    });
  });
});

describe("CustomPresets save, export and delete", () => {
  beforeEach(() => {
    localStorage.clear();
    globalThis.FileReader = MockFileReader;
    vi.spyOn(window, "confirm").mockReturnValue(true);
  });

  afterEach(() => {
    globalThis.FileReader = realFileReader;
    vi.restoreAllMocks();
  });

  it("saves current settings as a user preset and calls onLoad", () => {
    const onLoad = vi.fn();
    render(
      <CustomPresets
        {...baseProps}
        activeSource="builtin"
        currentModulationLibrary={[
          {
            sourceDegree: 7,
            targetDegree: 11,
            strategy: "retune_surface_to_source",
            count: 3,
          },
        ]}
        settings={{
          name: "Saved Tuning",
          scale: ["100.", "1200."],
          equivSteps: 2,
          fundamental: 440,
        }}
        onLoad={onLoad}
      />,
    );

    fireEvent.click(screen.getByText("Save current settings").closest("button"));

    expect(loadCustomPresets()).toEqual([
      expect.objectContaining({
        name: "Saved Tuning",
        modulation_library: [
          {
            sourceDegree: 7,
            targetDegree: 11,
            strategy: "retune_surface_to_source",
            count: 0,
          },
        ],
      }),
    ]);
    expect(onLoad).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "Saved Tuning",
        modulation_library: [
          {
            sourceDegree: 7,
            targetDegree: 11,
            strategy: "retune_surface_to_source",
            count: 0,
          },
        ],
      }),
    );
  });

  it("shows Save current settings for a restored non-built-in workspace even when activeSource is empty", () => {
    render(
      <CustomPresets
        {...baseProps}
        settings={{
          name: "36ed2",
          scale: ["33.333333", "66.666667", "1200."],
          equivSteps: 36,
          fundamental: 440,
        }}
      />,
    );

    expect(screen.getByText("Save current settings")).toBeTruthy();
  });

  it("exports the current tuning as json", () => {
    const realCreateElement = document.createElement.bind(document);
    URL.createObjectURL = vi.fn(() => "blob:test");
    URL.revokeObjectURL = vi.fn();
    const click = vi.fn();
    const createElement = vi.spyOn(document, "createElement").mockImplementation((tag) => {
      if (tag === "a") return { click, href: "", download: "" };
      return realCreateElement(tag);
    });

    render(
      <CustomPresets
        {...baseProps}
        activeSource="builtin"
        settings={{
          name: "Export Tuning",
          scale: ["100.", "1200."],
          equivSteps: 2,
          fundamental: 440,
        }}
      />,
    );

    fireEvent.click(screen.getByText("Export .json").closest("button"));

    expect(URL.createObjectURL).toHaveBeenCalledTimes(1);
    expect(click).toHaveBeenCalledTimes(1);
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:test");
    createElement.mockRestore();
  });

  it("keeps the plain save label for a freshly loaded user preset, then shows overwrite once it becomes dirty", () => {
    localStorage.setItem(
      "hexatone_custom_presets",
      JSON.stringify([{ name: "Existing Name", scale: ["2/1"], equivSteps: 1 }]),
    );

    const { rerender } = render(
      <CustomPresets
        {...baseProps}
        isActive
        activeSource="user"
        activePresetName="Existing Name"
        settings={{
          name: "Existing Name",
          scale: ["100.", "1200."],
          equivSteps: 2,
          fundamental: 440,
        }}
      />,
    );

    expect(screen.getByText("Save current settings")).toBeTruthy();

    rerender(
      <CustomPresets
        {...baseProps}
        isActive
        activeSource="user"
        activePresetName="Existing Name"
        isPresetDirty
        settings={{
          name: "Existing Name",
          scale: ["100.", "1200."],
          equivSteps: 2,
          fundamental: 440,
        }}
      />,
    );

    expect(screen.getByText("Save current settings and overwrite user preset")).toBeTruthy();
  });

  it("appends a dirty marker to the active user tuning in the menu", () => {
    localStorage.setItem(
      "hexatone_custom_presets",
      JSON.stringify([{ name: "Dirty Tuning", scale: ["2/1"], equivSteps: 1 }]),
    );

    const { container } = render(
      <CustomPresets
        {...baseProps}
        isActive
        activeSource="user"
        activePresetName="Dirty Tuning"
        isPresetDirty
        settings={{
          name: "Dirty Tuning",
          scale: ["100.", "1200."],
          equivSteps: 2,
          fundamental: 440,
        }}
      />,
    );

    const select = container.querySelector("select");
    const option = Array.from(select.options).find((entry) => entry.value === "Dirty Tuning");
    expect(option.textContent).toBe("Dirty Tuning *");
  });

  it("deletes the selected preset and calls onClear", () => {
    localStorage.setItem(
      "hexatone_custom_presets",
      JSON.stringify([{ name: "Delete Me", scale: ["2/1"], equivSteps: 1 }]),
    );
    const onClear = vi.fn();

    render(<CustomPresets {...baseProps} onClear={onClear} />);
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "Delete Me" } });
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));

    expect(loadCustomPresets()).toEqual([]);
    expect(onClear).toHaveBeenCalledTimes(1);
  });
});
