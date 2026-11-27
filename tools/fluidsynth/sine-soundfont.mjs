/** A tiny deterministic SF2 fixture, so pitch tests need no downloaded banks. */
export function sineSoundfont() {
  const word = value => { const b = Buffer.alloc(2); b.writeUInt16LE(value); return b; };
  const dword = value => { const b = Buffer.alloc(4); b.writeUInt32LE(value); return b; };
  const name = value => { const b = Buffer.alloc(20); b.write(value); return b; };
  const chunk = (tag, ...parts) => {
    const data = Buffer.concat(parts);
    return Buffer.concat([Buffer.from(tag), dword(data.length), data, Buffer.alloc(data.length % 2)]);
  };
  const list = (tag, ...parts) => chunk("LIST", Buffer.from(tag), ...parts);
  const generator = (op, value) => Buffer.concat([word(op), word(value)]);
  const samples = Buffer.alloc((4400 + 46) * 2);
  for (let i = 0; i < 4400; i++) samples.writeInt16LE(Math.round(16000 * Math.sin(2 * Math.PI * i / 100)), i * 2);
  const preset = (label, bag) => Buffer.concat([name(label), word(0), word(0), word(bag), Buffer.alloc(12)]);
  const instrument = (label, bag) => Buffer.concat([name(label), word(bag)]);
  const bag = index => Buffer.concat([word(index), word(0)]);
  const sample = Buffer.concat([name("Sine"), dword(0), dword(4400), dword(0), dword(4400),
    dword(44000), Buffer.from([69, 0]), word(0), word(1)]);
  return chunk("RIFF", Buffer.from("sfbk"),
    list("INFO", chunk("ifil", word(2), word(1)), chunk("isng", Buffer.from("EMU8000\0")),
      chunk("INAM", Buffer.from("Hexatone pitch test\0"))),
    list("sdta", chunk("smpl", samples)),
    list("pdta",
      chunk("phdr", preset("Sine", 0), preset("EOP", 1)),
      chunk("pbag", bag(0), bag(1)), chunk("pmod", Buffer.alloc(10)),
      chunk("pgen", generator(41, 0), generator(0, 0)),
      chunk("inst", instrument("Sine", 0), instrument("EOI", 1)),
      chunk("ibag", bag(0), bag(2)), chunk("imod", Buffer.alloc(10)),
      chunk("igen", generator(54, 1), generator(53, 0), generator(0, 0)),
      chunk("shdr", sample, Buffer.concat([name("EOS"), Buffer.alloc(26)]))));
}
