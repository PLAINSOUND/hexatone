// BarlineRow renders the implicit final double barline inside the event flow.
// It has no editable time signature payload; it simply gives the user a visual
// end-of-sequence barline anchor consistent with transport timing math.

const BarlineRow = () => (
  <div class="sequencer-barline-row" aria-hidden="true">
    <div class="sequencer-barline-row__line sequencer-barline-row__line--upper" />
    <div class="sequencer-barline-row__line sequencer-barline-row__line--lower" />
  </div>
);

export default BarlineRow;
