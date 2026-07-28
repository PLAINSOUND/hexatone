import { useEffect, useState } from "preact/hooks";

const SidebarTopAction = ({
  scrollTargetRef,
  threshold = 0,
  thresholdRootRef,
}) => {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const scrollTarget =
      scrollTargetRef?.current ?? document.getElementById("sidebar");
    if (!scrollTarget) return undefined;

    const updateVisibility = () => {
      const thresholdElement = thresholdRootRef?.current?.querySelector("fieldset");
      const resolvedThreshold = thresholdElement
        ? thresholdElement.offsetTop + thresholdElement.offsetHeight
        : threshold;
      setVisible(scrollTarget.scrollTop > resolvedThreshold);
    };

    updateVisibility();
    scrollTarget.addEventListener("scroll", updateVisibility, { passive: true });
    window.addEventListener("resize", updateVisibility);

    return () => {
      scrollTarget.removeEventListener("scroll", updateVisibility);
      window.removeEventListener("resize", updateVisibility);
    };
  }, [scrollTargetRef, threshold, thresholdRootRef]);

  if (!visible) return null;

  return (
    <div class="settings-form__action-row sidebar-top-action">
      <span class="settings-form__action-group">
        <button
          type="button"
          class="preset-action-btn"
          onClick={() => {
            const scrollTarget =
              scrollTargetRef?.current ?? document.getElementById("sidebar");
            scrollTarget?.scrollTo({ top: 0, behavior: "smooth" });
          }}
        >
          Top
        </button>
      </span>
    </div>
  );
};

export default SidebarTopAction;
