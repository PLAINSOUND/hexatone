/**
 * Stable row-edit adapters: edits/commit/revert publish immutable snapshot notes
 * through App. No transport, scrolling or model rebuild occurs here on render.
 * Parsing and rational pitch identity remain in sequence-mutations; pending
 * drafts and blur-before-trigger ordering belong to the existing draft/transport
 * controllers. Presentation-only renders retain callback identity.
 */
import { useCallback } from "preact/hooks";
import { noteMatchesReference } from "./value-runtime.js";
import {
  commitEventPitchLabelInSnapshot,
  restoreEventPitchLabelInSnapshot,
  updateEventFieldInSnapshot,
} from "./sequence-mutations.js";

export default function useEventEditingController(onUpdateSnapshot) {
  const updateEventField = useCallback(
    (snapshot, noteRef, field, rawValue) => {
      const notes = updateEventFieldInSnapshot(snapshot, noteRef, field, rawValue);
      if (!notes) return;
      onUpdateSnapshot(snapshot.id, { notes });
    },
    [onUpdateSnapshot],
  );
  const toggleEventReattack = useCallback(
    (snapshot, noteRef) => {
      const notes = (snapshot?.notes ?? []).map((note) => {
        const matches =
          (noteRef?.noteId != null && note?.id === noteRef.noteId) ||
          (noteRef?.noteId == null && noteMatchesReference(note, noteRef));
        return matches ? { ...note, forceReattack: note.forceReattack !== true } : note;
      });
      onUpdateSnapshot(snapshot.id, { notes });
    },
    [onUpdateSnapshot],
  );
  const restoreEventPitchLabel = useCallback(
    (snapshot, noteRef) => {
      const notes = restoreEventPitchLabelInSnapshot(snapshot, noteRef);
      onUpdateSnapshot(snapshot.id, { notes });
    },
    [onUpdateSnapshot],
  );
  const commitEventPitchLabel = useCallback(
    (snapshot, noteRef) => {
      const notes = commitEventPitchLabelInSnapshot(snapshot, noteRef);
      onUpdateSnapshot(snapshot.id, { notes });
    },
    [onUpdateSnapshot],
  );
  return { updateEventField, toggleEventReattack, restoreEventPitchLabel, commitEventPitchLabel };
}
