// EventsGridHeader renders the responsive column headings for snapshot events.
// It switches between timing and expression panes while keeping the mobile and
// desktop label variants in one small, reusable header component.

const renderResponsiveHeading = (full, short = full) => (
  <>
    <span class="sequencer-events-grid__heading-label sequencer-events-grid__heading-label--full">{full}</span>
    <span class="sequencer-events-grid__heading-label sequencer-events-grid__heading-label--short">{short}</span>
  </>
);

const EventsGridHeader = ({
  eventPane,
  onTogglePane,
}) => {
  const currentEventPane = eventPane === "expression" ? "expression" : "timing";
  const eventPaneToggleMeta = {
    timing: {
      next: "expression",
      label: "show expression controls",
      title: "Show expression controls",
    },
    expression: {
      next: "timing",
      label: "show bar-relative timing",
      title: "Show bar-relative timing",
    },
  };

  return (
    <div class="sequencer-events-grid__header" role="row">
      <div class="sequencer-events-grid__heading sequencer-events-grid__heading--delete" />
      <div class="sequencer-events-grid__heading sequencer-events-grid__heading--cue" />
      <div class="sequencer-event__cell sequencer-events-grid__heading sequencer-events-grid__heading-cell sequencer-events-grid__heading-cell--snapshot">
        <span class="sequencer-event__content sequencer-events-grid__heading-content">{renderResponsiveHeading("Snap", "Snap")}</span>
      </div>
      <div class="sequencer-event__cell sequencer-events-grid__heading sequencer-events-grid__heading-cell sequencer-events-grid__heading-cell--offset-position">
        <span class="sequencer-event__content sequencer-events-grid__heading-content">{renderResponsiveHeading("Offset", "Offs")}</span>
      </div>
      <div class="sequencer-events-grid__heading sequencer-events-grid__heading-cell sequencer-events-grid__heading-cell--offset sequencer-events-grid__heading-cell--kind-spacer" />
      <div class="sequencer-event__cell sequencer-events-grid__heading sequencer-events-grid__heading-cell sequencer-events-grid__heading-cell--offset sequencer-events-grid__heading-cell--midicents">
        <span class="sequencer-event__content sequencer-events-grid__heading-content">{renderResponsiveHeading("MIDI¢", "MIDI¢")}</span>
      </div>
      <div class="sequencer-event__cell sequencer-events-grid__heading sequencer-events-grid__heading-cell sequencer-events-grid__heading-cell--offset sequencer-events-grid__heading-cell--hz">
        <span class="sequencer-event__content sequencer-events-grid__heading-content">{renderResponsiveHeading("Hz", "Hz")}</span>
      </div>
      <div class="sequencer-event__cell sequencer-events-grid__heading sequencer-events-grid__heading-cell sequencer-events-grid__heading-cell--offset sequencer-events-grid__heading-cell--heji">
        <span class="sequencer-event__content sequencer-events-grid__heading-content">{renderResponsiveHeading("Name", "Name")}</span>
      </div>
      {eventPane === "timing" ? (
        <>
          <div class="sequencer-event__cell sequencer-events-grid__heading sequencer-events-grid__heading-cell sequencer-events-grid__heading-cell--offset sequencer-events-grid__heading-cell--bar">
            <span class="sequencer-event__content sequencer-events-grid__heading-content">{renderResponsiveHeading("Bar", "Bar")}</span>
          </div>
          <div class="sequencer-event__cell sequencer-events-grid__heading sequencer-events-grid__heading-cell sequencer-events-grid__heading-cell--offset sequencer-events-grid__heading-cell--beat">
            <span class="sequencer-event__content sequencer-events-grid__heading-content">{renderResponsiveHeading("Beat", "Beat")}</span>
          </div>
          <div class="sequencer-event__cell sequencer-events-grid__heading sequencer-events-grid__heading-cell sequencer-events-grid__heading-cell--offset sequencer-events-grid__heading-cell--num">
            <span class="sequencer-event__content sequencer-events-grid__heading-content">{renderResponsiveHeading("Num", "Num")}</span>
          </div>
          <div class="sequencer-event__cell sequencer-events-grid__heading sequencer-events-grid__heading-cell sequencer-events-grid__heading-cell--offset sequencer-events-grid__heading-cell--den">
            <span class="sequencer-event__content sequencer-events-grid__heading-content">{renderResponsiveHeading("Den", "Den")}</span>
          </div>
        </>
      ) : (
        <>
          <div class="sequencer-event__cell sequencer-events-grid__heading sequencer-events-grid__heading-cell sequencer-events-grid__heading-cell--offset">
            <span class="sequencer-event__content sequencer-events-grid__heading-content">{renderResponsiveHeading("on-vel", "v-on")}</span>
          </div>
          <div class="sequencer-event__cell sequencer-events-grid__heading sequencer-events-grid__heading-cell sequencer-events-grid__heading-cell--offset">
            <span class="sequencer-event__content sequencer-events-grid__heading-content">{renderResponsiveHeading("off-vel", "v-off")}</span>
          </div>
          <div class="sequencer-event__cell sequencer-events-grid__heading sequencer-events-grid__heading-cell sequencer-events-grid__heading-cell--offset">
            <span class="sequencer-event__content sequencer-events-grid__heading-content">{renderResponsiveHeading("press", "prs")}</span>
          </div>
          <div class="sequencer-event__cell sequencer-events-grid__heading sequencer-events-grid__heading-cell sequencer-events-grid__heading-cell--offset">
            <span class="sequencer-event__content sequencer-events-grid__heading-content">{renderResponsiveHeading("timbre", "tim")}</span>
          </div>
        </>
      )}
      <div class="sequencer-events-grid__heading sequencer-events-grid__heading--actions">
        <button
          type="button"
          class="sequencer-events-grid__pane-toggle"
          aria-label={eventPaneToggleMeta[currentEventPane].label}
          title={eventPaneToggleMeta[currentEventPane].title}
          onClick={() => onTogglePane(eventPaneToggleMeta[currentEventPane].next)}
        >
          <span aria-hidden="true">
            {currentEventPane === "expression" ? "←" : "→"}
          </span>
        </button>
      </div>
    </div>
  );
};

export default EventsGridHeader;
