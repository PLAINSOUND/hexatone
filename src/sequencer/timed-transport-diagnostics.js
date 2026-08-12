// This file re-exports timed-transport diagnostics from the shared debug layer.
// Keeping the sequencer import path local makes it easier to swap or retire the
// diagnostics plumbing without rewriting the transport controller imports.

export * from "../debug/timed-transport-diagnostics.js";
