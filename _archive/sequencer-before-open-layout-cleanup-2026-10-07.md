# Sequencer before always-open scrolling cleanup

`sequencer-before-open-layout-cleanup-2026-10-07.tar.gz` preserves the working
tree versions of `src/sequencer/`, `src/app.jsx`, `src/app.test.js`, and
`docs/app-context.md` immediately before the cleanup. It includes uncommitted
changes, rather than only the last Git revision.

The archive retains the old compact-view branches and expansion timers, with
the playback rows already configured to stay open. Active code removes those
branches and commits manual-trigger feedback on the next animation frame.

Extract into a separate directory for comparison; do not extract over the
active working tree.
