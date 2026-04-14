import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import "./retune.css";
import {
  BASE_SYMBOLS,
  EXTRA_MODIFIERS,
  glyphStringForSelection,
  parseHejiGlyphInput,
} from "./heji-subset.js";
import { parseMidi } from "./midi-parser.js";
import {
  centsFromMonzo,
  fullMonzoForSelection,
  guessSpellingFromMidi,
  ratioFromMonzo,
  staffStepIndex,
} from "./pitch-model.js";

const SAMPLE_MIDI = "/bach-tuning/MIDI/bwv1001/vs1-1ada.mid";
const RETUNE_WORKSPACE_STORAGE_KEY = "hexatone_retune_workspace_v1";

function makeAnnotation(note) {
  const guess = guessSpellingFromMidi(note.midiNote);
  return {
    letter: guess.letter,
    octave: guess.octave,
    baseId: guess.baseId,
    extraIds: [],
    hejiInput: "",
    guess,
  };
}

function annotationFromCorpusNote(corpusNote) {
  const guess = corpusNote.guess
    ? {
        letter: corpusNote.guess.staff_note,
        octave: corpusNote.guess.octave,
        baseId: corpusNote.guess.base_id,
        guessSource: corpusNote.guess.source ?? "imported",
      }
    : guessSpellingFromMidi(corpusNote.midi.note);

  return {
    letter: corpusNote.score?.staff_note ?? guess.letter,
    octave: corpusNote.score?.octave ?? guess.octave,
    baseId: corpusNote.score?.base_id ?? guess.baseId,
    extraIds: corpusNote.score?.heji_ids ?? [],
    hejiInput: corpusNote.score?.heji_text ?? "",
    guess,
  };
}

function accidentalTokenFromBaseId(baseId) {
  const chromatic = (baseId ?? "natural:0").split(":")[0];
  if (chromatic === "flat") return "b";
  if (chromatic === "sharp") return "#";
  return "n";
}

function toggleSelection(currentIds, id, additive) {
  if (!additive) return [id];
  return currentIds.includes(id) ? currentIds.filter((value) => value !== id) : [...currentIds, id];
}

function buildCorpusNote(note, annotation) {
  const computed = fullMonzoForSelection(
    annotation.letter,
    annotation.octave,
    annotation.baseId,
    annotation.extraIds,
  );
  const ratio = ratioFromMonzo(computed.fullMonzo);
  return {
    event_id: note.eventId,
    midi: {
      track: note.track,
      channel: note.channel,
      note: note.midiNote,
      on_tick: note.onTick,
      off_tick: note.offTick,
      on_seconds: note.onSeconds,
      off_seconds: note.offSeconds,
    },
    guess: {
      staff_note: annotation.guess.letter,
      octave: annotation.guess.octave,
      base_id: annotation.guess.baseId,
      source: annotation.guess.guessSource,
    },
    score: {
      staff_note: annotation.letter,
      octave: annotation.octave,
      base_id: annotation.baseId,
      heji_ids: annotation.extraIds,
      heji_glyphs: annotation.extraIds
        .map((id) => EXTRA_MODIFIERS.find((item) => item.id === id)?.glyph)
        .filter(Boolean),
      heji_text: glyphStringForSelection(annotation.baseId, annotation.extraIds),
    },
    computed: {
      pythagorean_monzo: computed.pythagoreanMonzo,
      heji_delta_monzo: computed.hejiDeltaMonzo,
      full_monzo: computed.fullMonzo,
      ratio,
      cents_from_A4: centsFromMonzo(computed.fullMonzo),
    },
  };
}

function midiDocFromCorpusJson(data) {
  const corpusNotes = Array.isArray(data?.notes) ? data.notes : [];
  const notes = corpusNotes
    .map((item, index) => ({
      id: item.event_id ?? `imported_${index + 1}`,
      eventId: item.event_id ?? `n${String(index + 1).padStart(4, "0")}`,
      track: item.midi?.track ?? 0,
      channel: item.midi?.channel ?? 1,
      midiNote: item.midi?.note ?? 60,
      velocity: item.midi?.velocity ?? 96,
      onTick: item.midi?.on_tick ?? 0,
      offTick: item.midi?.off_tick ?? (item.midi?.on_tick ?? 0) + 480,
      onSeconds: item.midi?.on_seconds ?? 0,
      offSeconds: item.midi?.off_seconds ?? 0.5,
    }))
    .sort((a, b) => a.onTick - b.onTick || a.midiNote - b.midiNote);

  const annotations = {};
  corpusNotes.forEach((item, index) => {
    const eventId = item.event_id ?? `n${String(index + 1).padStart(4, "0")}`;
    annotations[eventId] = annotationFromCorpusNote(item);
  });

  return {
    midiDoc: {
      format: data?.midi_meta?.format ?? 1,
      ppq: data?.midi_meta?.ppq ?? 480,
      tempos: data?.midi_meta?.tempos ?? [],
      timeSignatures: data?.midi_meta?.timeSignatures ?? [],
      notes,
      importedFromJson: true,
    },
    annotations,
  };
}

// eslint-disable-next-line no-unused-vars
function sameArray(a, b) {
  if (a.length !== b.length) return false;
  const aSorted = [...a].sort();
  const bSorted = [...b].sort();
  return aSorted.every((value, index) => value === bSorted[index]);
}

function pitchClassKey(annotation) {
  const chromatic = annotation.baseId.split(":")[0];
  return `${annotation.letter}:${chromatic}`;
}

function downloadJson(filename, data) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

function buildCorpusPayload(midiDoc, annotations) {
  return {
    piece_id: "bwv1001_adagio",
    midi_meta: {
      format: midiDoc.format,
      ppq: midiDoc.ppq,
      tempos: midiDoc.tempos,
      timeSignatures: midiDoc.timeSignatures,
    },
    source_files: {
      midi: "bach-tuning/MIDI/bwv1001/vs1-1ada.mid",
    },
    notes: midiDoc.notes.map((note) => buildCorpusNote(note, annotations[note.eventId])),
  };
}

function PianoRoll({ notes, annotations, selectedIds, onSelect, pxPerTick, viewportWidth }) {
  const minNote = Math.min(...notes.map((note) => note.midiNote), 55);
  const maxNote = Math.max(...notes.map((note) => note.midiNote), 80);
  const noteHeight = 14;
  const width = Math.max(
    viewportWidth ?? 0,
    Math.ceil(Math.max(...notes.map((note) => note.offTick)) * pxPerTick) + 60,
  );
  const height = (maxNote - minNote + 1) * noteHeight + 20;

  return (
    <svg className="canvas-wrap" width={width} height={height}>
      {Array.from({ length: maxNote - minNote + 1 }, (_, index) => {
        const midi = maxNote - index;
        const y = index * noteHeight;
        return (
          <g key={`row-${midi}`}>
            <rect
              x="0"
              y={y}
              width={width}
              height={noteHeight}
              fill={
                midi % 12 === 1 ||
                midi % 12 === 3 ||
                midi % 12 === 6 ||
                midi % 12 === 8 ||
                midi % 12 === 10
                  ? "#00000006"
                  : "transparent"
              }
            />
          </g>
        );
      })}
      {notes.map((note) => {
        const annotation = annotations[note.eventId];
        const x = note.onTick * pxPerTick + 40;
        const y = (maxNote - note.midiNote) * noteHeight + 1;
        const w = Math.max(8, (note.offTick - note.onTick) * pxPerTick);
        const selected = selectedIds.includes(note.eventId);
        return (
          <g
            key={note.eventId}
            onClick={(e) => onSelect(note.eventId, e.metaKey || e.ctrlKey)}
            style={{ cursor: "pointer" }}
          >
            <rect
              x={x}
              y={y}
              rx="4"
              ry="4"
              width={w}
              height={noteHeight - 2}
              fill={selected ? "#c94922" : "#6f2717"}
              opacity={selected ? "0.95" : "0.75"}
            />
            {selected ? (
              <text x={x + 4} y={y + 10} fill="#fff" font-size="10">
                {annotation.letter}
                {annotation.octave}
              </text>
            ) : null}
          </g>
        );
      })}
    </svg>
  );
}

function StaffView({ notes, annotations, selectedIds, onSelect, pxPerTick, viewportWidth }) {
  const width = Math.max(
    viewportWidth ?? 0,
    Math.ceil(Math.max(...notes.map((note) => note.offTick)) * pxPerTick) + 80,
  );
  const height = 230;
  const staffTop = 68;
  const lineGap = 14;
  const middleStep = staffStepIndex("B", 4); // middle line in treble clef
  const middleLineY = staffTop + 2 * lineGap;
  const bottomLineStep = staffStepIndex("E", 4);
  const topLineStep = staffStepIndex("F", 5);
  const yForStep = (step) => middleLineY - ((step - middleStep) * lineGap) / 2;
  const noteXOffsets = useMemo(() => {
    const offsets = {};
    const notesByTick = new Map();

    notes.forEach((note) => {
      const annotation = annotations[note.eventId];
      if (!annotation) return;
      const step = staffStepIndex(annotation.letter, annotation.octave);
      const bucket = notesByTick.get(note.onTick) ?? [];
      bucket.push({ eventId: note.eventId, step });
      notesByTick.set(note.onTick, bucket);
    });

    notesByTick.forEach((bucket) => {
      bucket.sort((a, b) => a.step - b.step);
      let lastPlacedStep = null;
      let lastColumn = 0;
      bucket.forEach(({ eventId, step }) => {
        const column =
          lastPlacedStep != null && Math.abs(step - lastPlacedStep) <= 1 ? lastColumn + 1 : 0;
        offsets[eventId] = column * 10;
        lastPlacedStep = step;
        lastColumn = column;
      });
    });

    return offsets;
  }, [notes, annotations]);

  return (
    <svg className="canvas-wrap" width={width} height={height}>
      {[0, 1, 2, 3, 4].map((line) => (
        <line
          key={line}
          x1="20"
          x2={width - 20}
          y1={staffTop + line * lineGap}
          y2={staffTop + line * lineGap}
          stroke="#6f271745"
          stroke-width="1.2"
        />
      ))}
      {notes.map((note) => {
        const annotation = annotations[note.eventId];
        const step = staffStepIndex(annotation.letter, annotation.octave);
        const y = yForStep(step);
        const x = note.onTick * pxPerTick + 40 + (noteXOffsets[note.eventId] ?? 0);
        const selected = selectedIds.includes(note.eventId);
        const glyphs = glyphStringForSelection(annotation.baseId, annotation.extraIds);
        const ledgerSteps = [];
        if (step < bottomLineStep) {
          for (let s = bottomLineStep - 2; s >= step; s -= 2) ledgerSteps.push(s);
        } else if (step > topLineStep) {
          for (let s = topLineStep + 2; s <= step; s += 2) ledgerSteps.push(s);
        }
        return (
          <g
            key={note.eventId}
            onClick={(e) => onSelect(note.eventId, e.metaKey || e.ctrlKey)}
            style={{ cursor: "pointer" }}
          >
            {ledgerSteps.map((ledgerStep) => (
              <line
                key={`${note.eventId}-ledger-${ledgerStep}`}
                x1={x - 11}
                x2={x + 11}
                y1={yForStep(ledgerStep)}
                y2={yForStep(ledgerStep)}
                stroke="#2a1813"
                stroke-width="1.2"
              />
            ))}
            <text x={x - 24} y={y + 5} font-size="20" fill="#5e2314">
              {glyphs}
            </text>
            <ellipse
              cx={x}
              cy={y}
              rx="8"
              ry="5.5"
              fill={selected ? "#c94922" : "#2a1813"}
              transform={`rotate(-18 ${x} ${y})`}
            />
            <line
              x1={x + 7}
              y1={y}
              x2={x + 7}
              y2={y - 32}
              stroke={selected ? "#c94922" : "#2a1813"}
              stroke-width="1.5"
            />
          </g>
        );
      })}
    </svg>
  );
}

function EventList({ notes, annotations, selectedIds, onSelect }) {
  return (
    <div className="event-list">
      {notes.map((note) => {
        const ann = annotations[note.eventId];
        return (
          <div
            key={note.eventId}
            className={`event-row ${selectedIds.includes(note.eventId) ? "selected" : ""}`}
            onClick={(e) => onSelect(note.eventId, e.metaKey || e.ctrlKey)}
          >
            <div className="mono">{note.eventId}</div>
            <div>
              <div>
                {ann.letter}
                {ann.baseId.startsWith("sharp") ? "#" : ann.baseId.startsWith("flat") ? "b" : ""}
                {ann.octave}
              </div>
              <div className="mini">{glyphStringForSelection(ann.baseId, ann.extraIds)}</div>
            </div>
            <div className="mini mono">{note.midiNote}</div>
          </div>
        );
      })}
    </div>
  );
}

function Editor({ note, annotation, selectionCount, onChange }) {
  const computed = useMemo(
    () =>
      fullMonzoForSelection(
        annotation.letter,
        annotation.octave,
        annotation.baseId,
        annotation.extraIds,
      ),
    [annotation],
  );
  const ratio = ratioFromMonzo(computed.fullMonzo);
  const cents = centsFromMonzo(computed.fullMonzo);

  return (
    <div className="editor">
      <h3>{selectionCount > 1 ? `${selectionCount} notes selected` : note.eventId}</h3>
      <div className="editor-section">
        <div className="editor-label">MIDI Event</div>
        <div className="computed-box">
          MIDI {note.midiNote}, ch {note.channel}, ticks {note.onTick} - {note.offTick}
          <br />
          Seconds {note.onSeconds.toFixed(3)} - {note.offSeconds.toFixed(3)}
        </div>
      </div>

      <div className="editor-section">
        <div className="editor-label">Guessed spelling</div>
        <div className="computed-box">
          {annotation.guess.letter}
          {annotation.guess.baseId.startsWith("sharp")
            ? "#"
            : annotation.guess.baseId.startsWith("flat")
              ? "b"
              : ""}
          {annotation.guess.octave}
          <br />
          <span className="mono">{annotation.guess.guessSource}</span>
        </div>
      </div>

      <div className="editor-section">
        <div className="editor-label">Final note spelling</div>
        <div className="editor-grid">
          <select value={annotation.letter} onChange={(e) => onChange({ letter: e.target.value })}>
            {["A", "B", "C", "D", "E", "F", "G"].map((letter) => (
              <option value={letter}>{letter}</option>
            ))}
          </select>
          <input
            defaultValue={accidentalTokenFromBaseId(annotation.baseId)}
            onBlur={(e) => {
              const token = e.target.value.trim();
              const chromatic = token === "b" ? "flat" : token === "#" ? "sharp" : "natural";
              const syntonic = (annotation.baseId ?? "natural:0").split(":")[1] ?? "0";
              onChange({ baseId: `${chromatic}:${syntonic}` });
              e.target.value = accidentalTokenFromBaseId(`${chromatic}:${syntonic}`);
            }}
            placeholder="n / b / #"
          />
          <input
            type="number"
            value={annotation.octave}
            onInput={(e) => onChange({ octave: Number(e.target.value) })}
          />
          <input value={glyphStringForSelection(annotation.baseId, annotation.extraIds)} readOnly />
        </div>
      </div>

      <div className="editor-section">
        <div className="editor-label">Paste HEJI glyphs</div>
        <input
          value={annotation.hejiInput}
          onInput={(e) => {
            const value = e.target.value;
            const parsed = parseHejiGlyphInput(value, annotation.baseId);
            onChange({
              hejiInput: value,
              baseId: parsed.baseId,
              extraIds: parsed.extraIds,
            });
          }}
          placeholder="Paste Unicode HEJI glyphs here"
        />
      </div>

      <div className="editor-section">
        <div className="editor-label">Integrated base accidental</div>
        <div className="glyph-grid">
          {BASE_SYMBOLS.map((symbol) => (
            <button
              type="button"
              key={symbol.id}
              className={`glyph-button ${annotation.baseId === symbol.id ? "selected" : ""}`}
              onClick={() => onChange({ baseId: symbol.id })}
            >
              <span className="glyph">{symbol.glyph}</span>
              <span className="tiny">{symbol.label}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="editor-section">
        <div className="editor-label">Further modifiers</div>
        <div className="glyph-grid extra">
          {EXTRA_MODIFIERS.map((modifier) => {
            const selected = annotation.extraIds.includes(modifier.id);
            return (
              <button
                type="button"
                key={modifier.id}
                className={`glyph-button ${selected ? "selected" : ""}`}
                onClick={() => {
                  onChange({
                    extraIds: selected
                      ? annotation.extraIds.filter((id) => id !== modifier.id)
                      : [...annotation.extraIds, modifier.id],
                  });
                }}
              >
                <span className="glyph">{modifier.glyph}</span>
                <span className="tiny">{modifier.label}</span>
              </button>
            );
          })}
        </div>
      </div>

      <div className="editor-section">
        <div className="editor-label">Computed</div>
        <div className="computed-box">
          Pythagorean monzo:
          <br />
          <code>{JSON.stringify(computed.pythagoreanMonzo)}</code>
          <br />
          <br />
          HEJI delta monzo:
          <br />
          <code>{JSON.stringify(computed.hejiDeltaMonzo)}</code>
          <br />
          <br />
          Full monzo:
          <br />
          <code>{JSON.stringify(computed.fullMonzo)}</code>
          <br />
          <br />
          Ratio:{" "}
          <span className="mono">
            {ratio[0]}/{ratio[1]}
          </span>
          <br />
          Cents from A4: <span className="mono">{cents.toFixed(5)}</span>
        </div>
      </div>
    </div>
  );
}

export default function RetuneApp() {
  const [midiDoc, setMidiDoc] = useState(null);
  const [annotations, setAnnotations] = useState({});
  const [selectedIds, setSelectedIds] = useState([]);
  const [pxPerTick, setPxPerTick] = useState(0.14);
  const [zoomBounds, setZoomBounds] = useState({ min: 0.005, max: 1.2 });
  const [viewerWidth, setViewerWidth] = useState(0);
  const midiInputRef = useRef(null);
  const jsonInputRef = useRef(null);
  const pianoSectionRef = useRef(null);
  const staffSectionRef = useRef(null);
  const syncingScrollRef = useRef(false);

  const loadMidiBuffer = async (buffer) => {
    const parsed = parseMidi(buffer);
    const nextAnnotations = {};
    parsed.notes.forEach((note) => {
      nextAnnotations[note.eventId] = makeAnnotation(note);
    });
    setMidiDoc(parsed);
    setAnnotations(nextAnnotations);
    setSelectedIds(parsed.notes[0]?.eventId ? [parsed.notes[0].eventId] : []);
  };

  const loadCorpusJson = async (text) => {
    const parsed = JSON.parse(text);
    const imported = midiDocFromCorpusJson(parsed);
    setMidiDoc(imported.midiDoc);
    setAnnotations(imported.annotations);
    setSelectedIds(imported.midiDoc.notes[0]?.eventId ? [imported.midiDoc.notes[0].eventId] : []);
  };

  const loadSample = async () => {
    const response = await fetch(SAMPLE_MIDI);
    const buffer = await response.arrayBuffer();
    await loadMidiBuffer(buffer);
  };

  useEffect(() => {
    const restoreWorkspace = async () => {
      const saved = localStorage.getItem(RETUNE_WORKSPACE_STORAGE_KEY);
      if (!saved) {
        await loadSample();
        return;
      }

      const workspace = JSON.parse(saved);
      if (workspace?.corpusJson) {
        await loadCorpusJson(workspace.corpusJson);
        setSelectedIds(Array.isArray(workspace.selectedIds) ? workspace.selectedIds : []);
        if (Number.isFinite(workspace.pxPerTick)) setPxPerTick(workspace.pxPerTick);
        return;
      }

      await loadSample();
    };

    restoreWorkspace().catch((error) =>
      console.error("Failed to restore retune workspace:", error),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount-only: restores persisted workspace on initial load
  }, []);

  const notes = useMemo(() => midiDoc?.notes ?? [], [midiDoc]);
  const selectedNote = notes.find((note) => note.eventId === selectedIds[0]) ?? null;
  const selectedAnnotation = selectedNote ? annotations[selectedNote.eventId] : null;

  useEffect(() => {
    const onKeyDown = (e) => {
      if (e.key === "Escape") {
        setSelectedIds([]);
        return;
      }
      if (!(e.metaKey || e.ctrlKey)) return;
      if (e.key.toLowerCase() !== "a") return;
      if (!notes.length) return;
      e.preventDefault();
      setSelectedIds((currentSelectedIds) => {
        if (!currentSelectedIds.length) {
          return notes.map((note) => note.eventId);
        }
        const selectedSet = new Set(currentSelectedIds);
        const startIndex = Math.max(
          0,
          notes.findIndex((note) => selectedSet.has(note.eventId)),
        );
        const selectedPitchClasses = new Set(
          currentSelectedIds
            .map((id) => annotations[id])
            .filter(Boolean)
            .map((annotation) => pitchClassKey(annotation)),
        );
        return notes
          .filter(
            (note, index) =>
              index >= startIndex &&
              selectedPitchClasses.has(pitchClassKey(annotations[note.eventId])) &&
              annotations[note.eventId],
          )
          .map((note) => note.eventId);
      });
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [notes, annotations]);

  useEffect(() => {
    const updateViewerMetrics = () => {
      const nextViewerWidth = Math.max(
        pianoSectionRef.current?.clientWidth ?? 0,
        staffSectionRef.current?.clientWidth ?? 0,
      );
      setViewerWidth(nextViewerWidth);

      if (!notes.length || nextViewerWidth <= 0) return;

      const maxOffTick = Math.max(...notes.map((note) => note.offTick), 1);
      const shortestNoteTicks = Math.max(
        1,
        Math.min(...notes.map((note) => Math.max(1, note.offTick - note.onTick))),
      );

      const fitPadding = 160;
      const minVisibleShortestWidth = 48;
      const nextMin = Math.max(0.001, (nextViewerWidth - fitPadding) / maxOffTick);
      const nextMax = Math.max(nextMin, minVisibleShortestWidth / shortestNoteTicks);

      setZoomBounds({ min: nextMin, max: nextMax });
      setPxPerTick((current) => Math.min(nextMax, Math.max(nextMin, current)));
    };

    updateViewerMetrics();
    window.addEventListener("resize", updateViewerMetrics);
    return () => window.removeEventListener("resize", updateViewerMetrics);
  }, [notes]);

  useEffect(() => {
    if (!midiDoc) return;
    const payload = buildCorpusPayload(midiDoc, annotations);
    localStorage.setItem(
      RETUNE_WORKSPACE_STORAGE_KEY,
      JSON.stringify({
        corpusJson: JSON.stringify(payload),
        selectedIds,
        pxPerTick,
      }),
    );
  }, [midiDoc, annotations, selectedIds, pxPerTick]);

  const setZoom = (nextValue, anchorRatio = 0.5) => {
    const clamped = Math.max(zoomBounds.min, Math.min(zoomBounds.max, nextValue));
    const sections = [pianoSectionRef.current, staffSectionRef.current].filter(Boolean);
    const snapshots = sections.map((section) => ({
      section,
      scrollLeft: section.scrollLeft,
      clientWidth: section.clientWidth,
      scrollWidth: section.scrollWidth,
    }));
    setPxPerTick(clamped);
    requestAnimationFrame(() => {
      snapshots.forEach(({ section, scrollLeft, clientWidth, scrollWidth }) => {
        const anchorX = scrollLeft + clientWidth * anchorRatio;
        const contentRatio = scrollWidth > 0 ? anchorX / scrollWidth : 0;
        const nextScrollWidth = section.scrollWidth;
        section.scrollLeft = Math.max(
          0,
          contentRatio * nextScrollWidth - clientWidth * anchorRatio,
        );
      });
    });
  };

  const handleViewerWheel = (e) => {
    if (Math.abs(e.deltaY) <= Math.abs(e.deltaX)) return;
    e.preventDefault();
    const rect = e.currentTarget.getBoundingClientRect();
    const anchorRatio = rect.width > 0 ? (e.clientX - rect.left) / rect.width : 0.5;
    const factor = e.deltaY > 0 ? 0.88 : 1.12;
    setZoom(pxPerTick * factor, anchorRatio);
  };

  const syncHorizontalScroll = (source, target) => {
    if (syncingScrollRef.current) return;
    if (!source || !target) return;
    syncingScrollRef.current = true;
    target.scrollLeft = source.scrollLeft;
    requestAnimationFrame(() => {
      syncingScrollRef.current = false;
    });
  };

  const exportCorpus = () => {
    if (!midiDoc) return;
    const payload = buildCorpusPayload(midiDoc, annotations);
    downloadJson("bwv1001_adagio.annotated.json", payload);
  };

  // eslint-disable-next-line no-unused-vars
  const selectByPredicate = (predicate) => {
    const ids = notes.filter(predicate).map((note) => note.eventId);
    setSelectedIds(ids);
  };

  const updateSelectedAnnotations = (patch) => {
    if (!selectedIds.length) return;
    setAnnotations((current) => {
      const next = { ...current };
      selectedIds.forEach((id) => {
        next[id] = {
          ...next[id],
          ...patch,
        };
      });
      return next;
    });
  };

  const handleSelect = (eventId, additive = false) => {
    setSelectedIds((current) => toggleSelection(current, eventId, additive));
  };

  return (
    <div className="retune-shell">
      <div className="retune-toolbar">
        <button type="button" onClick={() => midiInputRef.current?.click()}>
          Open MIDI...
        </button>
        <button type="button" onClick={() => jsonInputRef.current?.click()}>
          Open JSON...
        </button>
        <button type="button" onClick={exportCorpus} disabled={!midiDoc}>
          Export JSON
        </button>
        <button type="button" onClick={() => setSelectedIds([])} disabled={!selectedIds.length}>
          Clear Selection
        </button>
        <input
          ref={midiInputRef}
          type="file"
          accept=".mid,.midi,audio/midi"
          hidden
          onChange={async (e) => {
            const file = e.target.files?.[0];
            if (!file) return;
            await loadMidiBuffer(await file.arrayBuffer());
            e.target.value = "";
          }}
        />
        <input
          ref={jsonInputRef}
          type="file"
          accept=".json,application/json"
          hidden
          onChange={async (e) => {
            const file = e.target.files?.[0];
            if (!file) return;
            await loadCorpusJson(await file.text());
            e.target.value = "";
          }}
        />
        <label className="meta">
          Zoom{" "}
          <input
            type="range"
            min={zoomBounds.min}
            max={zoomBounds.max}
            step="0.0025"
            value={pxPerTick}
            onInput={(e) => setZoom(Number(e.target.value))}
            style={{ verticalAlign: "middle", marginLeft: "0.4rem" }}
          />
        </label>
        <div className="meta retune-shortcuts">
          <span>Cmd/Ctrl-click: add or remove note</span>
          <span>Cmd/Ctrl-A: select subsequent notes with the same pitch class</span>
          <span>Escape: clear selection</span>
          <span>Wheel / two-finger vertical scroll: zoom at pointer</span>
        </div>
      </div>

      {!midiDoc ? (
        <div style={{ padding: "2rem" }}>Loading MIDI...</div>
      ) : (
        <div className="retune-main">
          <div className="retune-panel">
            <EventList
              notes={notes}
              annotations={annotations}
              selectedIds={selectedIds}
              onSelect={handleSelect}
            />
          </div>

          <div className="viewer">
            <div
              className="viewer-section"
              ref={pianoSectionRef}
              onWheel={handleViewerWheel}
              onScroll={() =>
                syncHorizontalScroll(pianoSectionRef.current, staffSectionRef.current)
              }
            >
              <div className="viewer-title">Piano Roll</div>
              <PianoRoll
                notes={notes}
                annotations={annotations}
                selectedIds={selectedIds}
                onSelect={handleSelect}
                pxPerTick={pxPerTick}
                viewportWidth={viewerWidth ? Math.max(0, viewerWidth - 24) : 0}
              />
            </div>
            <div
              className="viewer-section"
              ref={staffSectionRef}
              onWheel={handleViewerWheel}
              onScroll={() =>
                syncHorizontalScroll(staffSectionRef.current, pianoSectionRef.current)
              }
            >
              <div className="viewer-title">Staff View</div>
              <StaffView
                notes={notes}
                annotations={annotations}
                selectedIds={selectedIds}
                onSelect={handleSelect}
                pxPerTick={pxPerTick}
                viewportWidth={viewerWidth ? Math.max(0, viewerWidth - 24) : 0}
              />
            </div>
          </div>

          <div className="retune-panel">
            {selectedNote && selectedAnnotation ? (
              <Editor
                note={selectedNote}
                annotation={selectedAnnotation}
                selectionCount={selectedIds.length}
                onChange={updateSelectedAnnotations}
              />
            ) : (
              <div className="editor">No note selected.</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
