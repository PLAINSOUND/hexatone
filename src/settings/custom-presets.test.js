import { h } from "preact";
import { render, fireEvent, waitFor, screen } from "@testing-library/preact";
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

    expect(loadCustomPresets().map((p) => p.name)).toEqual(["Saved Tuning"]);
    expect(onLoad).toHaveBeenCalledWith(expect.objectContaining({ name: "Saved Tuning" }));
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
