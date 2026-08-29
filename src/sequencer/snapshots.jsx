/**
 * Snapshots — sidebar panel for capturing and replaying note snapshots.
 *
 * Each snapshot stores an array of {
 *   midicents, attackVelocity, releaseVelocity, pressure?, pressure14?, timbre?, timbre14?
 * } — a scale-agnostic frozen chord. Snapshots play back at the correct absolute
 * pitches regardless of the current scale or fundamental. Capturing while a
 * snapshot is playing includes that playing snapshot material, so users can
 * build larger snapshots by layering new notes on top.
 *
 * Props:
 *   snapshots         – Array<{ id, notes: [{midicents, attackVelocity, releaseVelocity, pressure?, pressure14?, timbre?, timbre14?}] }>
 *   playingId         – id of the currently playing snapshot, or null
 *   onPlay(id)        – start playback of snapshot `id`; stops it if already playing
 *   onDelete(id)      – remove snapshot `id` from the list
 */
const Snapshots = ({ snapshots, playingId, onPlay, onDelete }) => {
  if (snapshots.length === 0) return null;

  return (
    <fieldset>
      <legend>
        <b>Snapshots</b>
      </legend>
      {snapshots.map((snap, index) => {
        const isPlaying = snap.id === playingId;
        return (
          <label
            key={snap.id}
            class={`sequencer-snapshots__row${isPlaying ? " sequencer-snapshots__row--playing" : ""}`}
          >
            <span class="sequencer-snapshots__label">
              {index + 1}. {snap.notes.length} note{snap.notes.length !== 1 ? "s" : ""}
            </span>
            <span class="sequencer-snapshots__actions">
              <button
                type="button"
                title={isPlaying ? "Stop" : "Play"}
                class="sequencer-snapshots__action-btn sequencer-snapshots__action-btn--play"
                onClick={() => onPlay(snap.id)}
              >
                {isPlaying ? (
                  <span class="snapshot-stop-glyph" aria-hidden="true" />
                ) : (
                  <span class="snapshot-play-glyph snapshot-play-glyph--play" aria-hidden="true" />
                )}
              </button>
              <button
                type="button"
                title="Delete snapshot"
                class="sequencer-snapshots__action-btn sequencer-snapshots__action-btn--delete"
                onClick={() => onDelete(snap.id)}
              >
                ✕
              </button>
            </span>
          </label>
        );
      })}
    </fieldset>
  );
};

export default Snapshots;
