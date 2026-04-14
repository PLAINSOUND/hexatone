
/**
 * Snapshots — sidebar panel for capturing and replaying note snapshots.
 *
 * Each snapshot stores an array of { midicents, velocity } — a scale-agnostic
 * frozen chord. Snapshots play back at the correct absolute pitches regardless
 * of the current scale or fundamental.
 *
 * Props:
 *   snapshots         – Array<{ id, notes: [{midicents, velocity}] }>
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
          <label key={snap.id} style={{ alignItems: "center" }}>
            <span
              style={{
                color: isPlaying ? "#990000" : "inherit",
                fontWeight: isPlaying ? "bold" : "normal",
              }}
            >
              {index + 1}. {snap.notes.length} note{snap.notes.length !== 1 ? "s" : ""}
            </span>
            <span style={{ display: "flex", gap: "4px", alignItems: "center", marginLeft: "auto" }}>
              <button
                type="button"
                title={isPlaying ? "Stop" : "Play"}
                style={{ fontSize: "0.85em", minWidth: "2em", cursor: "pointer" }}
                onClick={() => onPlay(snap.id)}
              >
                {isPlaying ? "■" : "▶"}
              </button>
              <button
                type="button"
                title="Delete snapshot"
                style={{ fontSize: "0.85em", cursor: "pointer", color: "#996666" }}
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
