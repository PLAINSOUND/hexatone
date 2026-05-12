import { render, screen, fireEvent } from "@testing-library/preact";
import { useEffect, useState } from "preact/hooks";
import ScaleTable from "./index.js";
import {
  clearAllTuningPreviews,
  createTuningPreviewState,
  setDegreePreview,
} from "../../../tuning/tuning-preview-runtime.js";

vi.mock("./tune-cell.js", () => ({
  default: ({ degree, onPreviewChange }) => (
    <div class="tune-cell">
      <button
        type="button"
        title={`preview degree ${degree}`}
        onClick={() =>
          onPreviewChange?.((prevState) => setDegreePreview(prevState, degree, 150))
        }
      >
        preview
      </button>
    </div>
  ),
}));

const settings = {
  scale: ["100.", "200.", "1200."],
  note_names: ["root", "second", "equave"],
  note_colors: ["#ffffff", "#ffffff", "#ffffff"],
  spectrum_colors: false,
  key_labels: "note_names",
  fundamental: 440,
  reference_degree: 0,
  center_degree: 0,
};

describe("ScaleTable preview reset", () => {
  it("clears scale-degree preview state when the scale reset token changes", () => {
    const PreviewHarness = ({ importCount }) => {
      const [previewState, setPreviewState] = useState(() => createTuningPreviewState());
      useEffect(() => {
        setPreviewState((prev) => clearAllTuningPreviews(prev));
      }, [importCount]);
      return (
        <ScaleTable
          settings={settings}
          onChange={() => {}}
          onAtomicChange={() => {}}
          importCount={importCount}
          previewState={previewState}
          onPreviewChange={setPreviewState}
        />
      );
    };

    const { rerender } = render(<PreviewHarness importCount={0} />);

    fireEvent.click(screen.getByTitle("preview degree 1"));

    let degreeFrequency = screen.getByLabelText("pitch frequency 1");
    expect(degreeFrequency.style.color).toBe("rgb(153, 0, 0)");

    rerender(
      <PreviewHarness importCount={1} />,
    );

    degreeFrequency = screen.getByLabelText("pitch frequency 1");
    expect(degreeFrequency.style.color).toBe("");
    expect(degreeFrequency.style.fontStyle).toBe("");
  });
});
