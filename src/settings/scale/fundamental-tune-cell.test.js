import { render } from "@testing-library/preact";
import FundamentalTuneCell from "./fundamental-tune-cell.js";

describe("FundamentalTuneCell reset behavior", () => {
  it("clears the live preview on unmount", () => {
    const previewFundamental = vi.fn();
    const keysRef = {
      current: {
        previewFundamental,
        setTuneDragging: vi.fn(),
      },
    };

    const { unmount } = render(
      <FundamentalTuneCell
        fundamental={440}
        keysRef={keysRef}
        onChange={() => {}}
        resetToken={0}
      />,
    );

    unmount();

    expect(previewFundamental).toHaveBeenCalledWith(0, true);
  });
});
