import { render, screen, fireEvent } from "@testing-library/preact";
import { useState } from "preact/hooks";
import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("./preset-tunings/index.js", () => ({
  findPresetTuningByName: vi.fn((name) => (
    name === "Built A" || name === "Built B"
      ? { name, scale: ["100.", "1200."] }
      : null
  )),
}));
import TuningLibrary from "./tuning-library.jsx";
import { loadUserTunings, USER_TUNINGS_STORAGE_KEY } from "./user-tunings.js";

const presetGroups = [
  {
    name: "Tests",
    settings: [
      {
        name: "Built A",
        scale: ["100.", "1200."],
      },
      {
        name: "Built B",
        scale: ["200.", "1200."],
      },
    ],
  },
];

function TuningLibraryHarness({
  initialSettings,
  initialSource = "",
  initialPresetName = "",
  initialDirty = false,
  onLoadSpy = vi.fn(),
  onClearSpy = vi.fn(),
}) {
  const [activeSource, setActiveSource] = useState(initialSource);
  const [activePresetName, setActivePresetName] = useState(initialPresetName);

  return (
    <TuningLibrary
      presetGroups={presetGroups}
      settings={initialSettings}
      currentModulationLibrary={[]}
      activeSource={activeSource}
      activePresetName={activePresetName}
      isPresetDirty={initialDirty}
      persistOnReload={false}
      setPersistOnReload={() => {}}
      showActivateAudioContext={false}
      activateAudioContext={null}
      activatePendingPreset={null}
      onLoadBuiltinTuning={(record) => {
        onLoadSpy(record, { source: "builtin" });
        setActiveSource("builtin");
        setActivePresetName(record?.name ?? "");
      }}
      onLoadUserTuning={(record) => {
        onLoadSpy(record, { source: "user" });
        setActiveSource("user");
        setActivePresetName(record?.name ?? "");
      }}
      onClearWorkspace={() => {
        onClearSpy();
        setActiveSource("");
        setActivePresetName("");
      }}
      onRevertBuiltin={() => {}}
      onRevertUser={() => {}}
      canCommitModulation={false}
      onCommitCurrentModulation={() => null}
    />
  );
}

describe("TuningLibrary", () => {
  beforeEach(() => {
    localStorage.removeItem(USER_TUNINGS_STORAGE_KEY);
    vi.restoreAllMocks();
    window.confirm = vi.fn(() => true);
  });

  it("loads a selected built-in tuning", () => {
    const onLoadSpy = vi.fn();

    render(
      <TuningLibraryHarness
        initialSettings={{ name: "", scale: null }}
        onLoadSpy={onLoadSpy}
      />,
    );

    fireEvent.change(screen.getByRole("combobox", { name: "Built-in tunings" }), {
      currentTarget: { value: "Built B" },
      target: { value: "Built B" },
    });

    expect(onLoadSpy).toHaveBeenCalledWith(
      expect.objectContaining({ name: "Built B" }),
      expect.objectContaining({ source: "builtin" }),
    );
  });

  it("does not warn when switching between clean built-in tunings", () => {
    const onLoadSpy = vi.fn();

    render(
      <TuningLibraryHarness
        initialSettings={{
          name: "Built A",
          scale: ["100.", "1200."],
        }}
        initialSource="builtin"
        initialPresetName="Built A"
        onLoadSpy={onLoadSpy}
      />,
    );

    fireEvent.change(screen.getByRole("combobox", { name: "Built-in tunings" }), {
      currentTarget: { value: "Built B" },
      target: { value: "Built B" },
    });

    expect(window.confirm).not.toHaveBeenCalled();
    expect(onLoadSpy).toHaveBeenCalledWith(
      expect.objectContaining({ name: "Built B" }),
      expect.objectContaining({ source: "builtin" }),
    );
  });

  it("saves the current workspace as a user tuning and activates it", () => {
    const onLoadSpy = vi.fn();

    render(
      <TuningLibraryHarness
        initialSettings={{
          name: "Workspace",
          description: "desc",
          scale: ["100.", "1200."],
          fundamental: 440,
        }}
        onLoadSpy={onLoadSpy}
      />,
    );

    fireEvent.click(screen.getByText("Save current settings"));

    expect(loadUserTunings()).toEqual([
      expect.objectContaining({
        name: "Workspace",
        description: "desc",
        scale: ["100.", "1200."],
        fundamental: 440,
      }),
    ]);
    expect(onLoadSpy).toHaveBeenCalledWith(
      expect.objectContaining({ name: "Workspace" }),
      expect.objectContaining({ source: "user" }),
    );
    expect(screen.getByRole("combobox", { name: "User tunings" }).value).toBe("Workspace");
  });

  it("uses the user-library save label for built-in tunings", () => {
    render(
      <TuningLibraryHarness
        initialSettings={{
          name: "Built A",
          scale: ["100.", "1200."],
        }}
        initialSource="builtin"
        initialPresetName="Built A"
      />,
    );

    expect(screen.getByText("Save current settings in user library")).toBeTruthy();
  });

  it("saves a copy with a unique numbered name", () => {
    render(
      <TuningLibraryHarness
        initialSettings={{
          name: "Workspace",
          scale: ["100.", "1200."],
        }}
      />,
    );

    fireEvent.click(screen.getByText("Save current settings"));
    fireEvent.click(screen.getByText("Save as copy"));

    expect(loadUserTunings().map((entry) => entry.name)).toEqual(["Workspace", "Workspace 2"]);
  });

  it("deletes the active user tuning and clears the workspace", () => {
    localStorage.setItem(USER_TUNINGS_STORAGE_KEY, JSON.stringify([
      {
        name: "Alpha",
        scale: ["100.", "1200."],
      },
    ]));
    const onClearSpy = vi.fn();

    render(
      <TuningLibraryHarness
        initialSettings={{
          name: "Alpha",
          scale: ["100.", "1200."],
        }}
        initialSource="user"
        initialPresetName="Alpha"
        onClearSpy={onClearSpy}
      />,
    );

    fireEvent.click(screen.getByText("Delete"));

    expect(loadUserTunings()).toEqual([]);
    expect(onClearSpy).toHaveBeenCalledTimes(1);
  });

  it("does not warn when switching away from a clean recalled user tuning", () => {
    localStorage.setItem(USER_TUNINGS_STORAGE_KEY, JSON.stringify([
      {
        name: "Alpha",
        scale: ["100.", "1200."],
      },
    ]));
    const onLoadSpy = vi.fn();

    render(
      <TuningLibraryHarness
        initialSettings={{
          name: "Alpha",
          scale: ["100.", "1200."],
        }}
        initialSource="user"
        initialPresetName="Alpha"
        onLoadSpy={onLoadSpy}
      />,
    );

    fireEvent.change(screen.getByRole("combobox", { name: "Built-in tunings" }), {
      currentTarget: { value: "Built B" },
      target: { value: "Built B" },
    });

    expect(window.confirm).not.toHaveBeenCalled();
    expect(onLoadSpy).toHaveBeenCalledWith(
      expect.objectContaining({ name: "Built B" }),
      expect.objectContaining({ source: "builtin" }),
    );
  });

  it("clears all user tunings after confirmation", () => {
    localStorage.setItem(USER_TUNINGS_STORAGE_KEY, JSON.stringify([
      { name: "Alpha", scale: ["100.", "1200."] },
      { name: "Beta", scale: ["200.", "1200."] },
    ]));

    render(
      <TuningLibraryHarness
        initialSettings={{
          name: "Alpha",
          scale: ["100.", "1200."],
        }}
      />,
    );

    fireEvent.click(screen.getByText("Clear All"));
    fireEvent.click(screen.getByText("Yes, clear"));

    expect(loadUserTunings()).toEqual([]);
  });

  it("imports tuning json files into the user library and activates the last imported record", async () => {
    const onLoadSpy = vi.fn();

    render(
      <TuningLibraryHarness
        initialSettings={{ name: "", scale: null }}
        onLoadSpy={onLoadSpy}
      />,
    );

    const file = {
      name: "Imported.json",
      text: vi.fn(async () => JSON.stringify({
        name: "Imported",
        scale: ["100.", "1200."],
      })),
    };

    fireEvent.change(document.querySelector('input[type="file"]'), {
      currentTarget: { files: [file] },
      target: { files: [file] },
    });

    await screen.findByRole("combobox", { name: "User tunings" });
    expect(loadUserTunings()).toEqual([
      expect.objectContaining({
        name: "Imported",
        scale: ["100.", "1200."],
      }),
    ]);
    expect(onLoadSpy).toHaveBeenCalledWith(
      expect.objectContaining({ name: "Imported" }),
      expect.objectContaining({ source: "user" }),
    );
  });
});
