#!/usr/bin/env python3
"""Convert uncompressed SF2 generators to SFZ; preserve PCM and audit omissions.

Usage: sf2-to-sfz.py INPUT.sf2 NEW_OUTPUT_DIRECTORY [--samples EXISTING_WAV_DIR]
Standard library only. Outputs are never overwritten. See ../SF2_TO_SFZ.md.
"""
import argparse
import hashlib
import json
import math
import os
from pathlib import Path
import re
import shutil
import struct
import wave


DEFAULTS = {
    **dict.fromkeys(range(59), 0), 8: 13500,
    21: -12000, 23: -12000,
    25: -12000, 26: -12000, 27: -12000, 28: -12000, 30: -12000,
    33: -12000, 34: -12000, 35: -12000, 36: -12000, 38: -12000,
    46: -1, 47: -1, 56: 100, 58: -1,
}
STRUCTURAL = {41, 43, 44, 53, 54, 57, 58}
PRESET_FORBIDDEN = {0, 1, 2, 3, 4, 12, 45, 46, 47, 50, 53, 54, 57, 58}
SUPPORTED = {0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 15, 16, 17,
             21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 33, 34, 35, 36, 37,
             38, 41, 43, 44, 45, 47, 48, 50, 51, 52, 53, 54, 56, 57, 58}

# FluidSynth's sfloader/fluid_defsfont.c applies EMU_ATTENUATION_FACTOR=0.4
# to INITIAL attenuation generators at both instrument and preset level.
# This is NOT a scaling rule for envelope sustain or modulator amounts.
INITIAL_ATTENUATION_FACTOR = 0.4


def signed(value):
    return value - 65536 if value >= 32768 else value


def time_seconds(value):
    return 0.0 if value <= -32768 else 2 ** (value / 1200)


def name(raw):
    return raw.split(b"\0", 1)[0].decode("latin1")


def safe_name(value):
    return re.sub(r"[^A-Za-z0-9 ._+()-]", "_", value).strip(" .") or "untitled"


class SoundFont:
    """Read validated RIFF tables; keep large sample chunks on disk."""

    def __init__(self, path):
        self.path = Path(path)
        self.chunks = {}
        with self.path.open("rb") as stream:
            header = stream.read(12)
            if len(header) != 12 or header[:4] != b"RIFF" or header[8:] != b"sfbk":
                raise ValueError("Expected RIFF/sfbk SoundFont")
            end = struct.unpack_from("<I", header, 4)[0] + 8
            if end > self.path.stat().st_size:
                raise ValueError("Truncated RIFF file")
            self._chunks(stream, end)
        self.samples = self.records(b"shdr", "<20sIIIIIBbHH")[:-1]
        self.instruments = self._zones(b"inst", "<20sH", b"ibag", b"igen", b"imod", 53)
        self.presets = self._zones(b"phdr", "<20sHHHIII", b"pbag", b"pgen", b"pmod", 41)
        count = self.chunks[b"smpl"][1] // 2
        if b"sm24" in self.chunks and self.chunks[b"sm24"][1] < count:
            raise ValueError("Truncated sm24 precision data")
        for sample in self.samples:
            if sample[9] & 0x10:
                raise ValueError("Compressed SF3 samples are unsupported")
            if not 0 <= sample[1] < sample[2] <= count:
                raise ValueError(f"Invalid bounds: {name(sample[0])}")

    def _chunks(self, stream, end, parent=None):
        while stream.tell() < end:
            if stream.tell() + 8 > end:
                raise ValueError("Incomplete chunk header")
            tag, size = struct.unpack("<4sI", stream.read(8))
            start = stream.tell()
            if start + size > end:
                raise ValueError(f"Chunk {tag!r} exceeds parent")
            if tag == b"LIST":
                if size < 4:
                    raise ValueError("Invalid LIST")
                self._chunks(stream, start + size, stream.read(4))
            elif parent in (b"sdta", b"pdta", b"INFO"):
                if tag in self.chunks:
                    raise ValueError(f"Duplicate {tag!r}")
                self.chunks[tag] = (start, size)
            stream.seek(start + size + size % 2)

    def records(self, tag, fmt):
        start, size = self.chunks[tag]
        if size % struct.calcsize(fmt):
            raise ValueError(f"Invalid record length: {tag!r}")
        with self.path.open("rb") as stream:
            stream.seek(start)
            return list(struct.iter_unpack(fmt, stream.read(size)))

    def _zones(self, htag, fmt, btag, gtag, mtag, terminal):
        headers, bags = self.records(htag, fmt), self.records(btag, "<HH")
        gens, mods = self.records(gtag, "<HH"), self.records(mtag, "<HHhHH")
        result = []
        column = 3 if terminal == 41 else 1
        for i, header in enumerate(headers[:-1]):
            zones = []
            start, end = header[column], headers[i + 1][column]
            if not 0 <= start <= end < len(bags):
                raise ValueError("Invalid bag index")
            for j in range(start, end):
                g0, m0 = bags[j]
                g1, m1 = bags[j + 1]
                if not (0 <= g0 <= g1 <= len(gens) and 0 <= m0 <= m1 <= len(mods)):
                    raise ValueError("Invalid generator/modulator indices")
                zones.append({"gens": dict(gens[g0:g1]), "mods": mods[m0:m1]})
            global_zone = {"gens": {}, "mods": []}
            if zones and terminal not in zones[0]["gens"]:
                global_zone = zones.pop(0)
            result.append({"header": header, "global": global_zone, "zones": zones})
        return result

    def pcm(self, index):
        sample = self.samples[index]
        frames = sample[2] - sample[1]
        if sample[9] & 0x8000:
            raise ValueError("Cannot export ROM PCM")
        with self.path.open("rb") as stream:
            stream.seek(self.chunks[b"smpl"][0] + sample[1] * 2)
            high = stream.read(frames * 2)
            if b"sm24" not in self.chunks:
                return high, 2
            stream.seek(self.chunks[b"sm24"][0] + sample[1])
            low = stream.read(frames)
        result = bytearray(frames * 3)
        result[0::3], result[1::3], result[2::3] = low, high[0::2], high[1::2]
        return bytes(result), 3


def effective(global_zone, local_zone):
    return {**global_zone["gens"], **local_zone["gens"]}


def merge(instrument, preset):
    # Instrument-local replaces global. Preset-local replaces preset-global;
    # the resulting preset generators ADD to instrument values/defaults.
    result = DEFAULTS.copy()
    for op, value in instrument.items():
        result[op] = value if op in STRUCTURAL else signed(value)
    for op, value in preset.items():
        if op not in STRUCTURAL and op not in PRESET_FORBIDDEN:
            result[op] += signed(value)
    return result


def intersect(instrument, preset, operator):
    ranges = []
    for gens in (instrument, preset):
        value = gens.get(operator, 0x7F00)
        low, high = value & 255, value >> 8
        if not 0 <= low <= high <= 127:
            raise ValueError(f"Invalid range {low}..{high}")
        ranges.append((low, high))
    low, high = max(r[0] for r in ranges), min(r[1] for r in ranges)
    return (low, high) if low <= high else None


def opcodes(g, sample):
    root = g[58] if 0 <= g[58] <= 127 else sample[6]
    result = {"pitch_keycenter": root if root <= 127 else 60,
              "pitch_keytrack": g[56], "transpose": g[51],
              "tune": g[52] + sample[7],
              "volume": -max(0, min(1440, g[48] * INITIAL_ATTENUATION_FACTOR)) / 10,
              "amp_veltrack": 0 if g[47] >= 0 else 100,
              "cutoff": 8.175798915643707 * 2 ** (g[8] / 1200),
              "fil_type": "lpf_2p", "resonance": g[9] / 10}
    for prefix, start, sustain in (("ampeg", 33, 37), ("fileg", 25, 29), ("pitcheg", 25, 29)):
        for suffix, op in (("delay", start), ("attack", start + 1), ("hold", start + 2),
                           ("decay", start + 3), ("release", start + 5)):
            result[f"{prefix}_{suffix}"] = time_seconds(g[op])
        result[f"{prefix}_sustain"] = (100 * 10 ** (-max(0, g[sustain]) / 200)
            if prefix == "ampeg" else max(0, min(100, 100 - g[sustain] / 10)))
    result.update(fileg_depth=g[11], pitcheg_depth=g[7])
    pitch_lfo = 21 if g[5] and not g[6] else 23
    for prefix, delay, depth in (("amplfo", 21, g[13] / 10), ("fillfo", 21, g[10]),
                                 ("pitchlfo", pitch_lfo, g[5] if pitch_lfo == 21 else g[6])):
        result[f"{prefix}_delay"] = time_seconds(g[delay])
        result[f"{prefix}_freq"] = 8.175798915643707 * 2 ** (g[delay + 1] / 1200)
        result[f"{prefix}_depth"] = depth
    if g[15]:
        result["effect2"] = g[15] / 10
    if g[16]:
        result["effect1"] = g[16] / 10
    if g[57]:
        result.update(group=g[57], off_by=g[57], off_mode="fast")
    return result


def playback(g, sample):
    frames = sample[2] - sample[1]
    offset, end = g[0] + 32768 * g[4], frames + g[1] + 32768 * g[12]
    if not 0 <= offset < end <= frames:
        raise ValueError(f"Bounds require newly cropped PCM: {name(sample[0])}")
    result = {"offset": offset, "end": end - 1}
    mode = g[54]
    if mode not in (0, 1, 2, 3):
        raise ValueError(f"Unknown sample mode {mode}")
    if mode == 2:  # Polyphone extension; not the reserved SF2 2.04 meaning.
        result.update(trigger="release", loop_mode="one_shot")
    elif mode in (1, 3):
        start = sample[3] - sample[1] + g[2] + 32768 * g[45]
        finish = sample[4] - sample[1] + g[3] + 32768 * g[50]
        if not offset <= start < finish <= end:
            raise ValueError(f"Invalid loop: {name(sample[0])}: {start}..{finish}")
        result.update(loop_mode="loop_continuous" if mode == 1 else "loop_sustain",
                      loop_start=start, loop_end=finish - 1)
    else:
        result["loop_mode"] = "no_loop"
    return result


def fingerprint(pcm, width, rate):
    return (width, rate, len(pcm), hashlib.sha256(pcm).hexdigest())


class Samples:
    """Reuse existing WAV channels only after exact PCM equality verification."""

    def __init__(self, sf, existing, output):
        self.sf, self.output = sf, output
        self.matches, self.cache = {}, {}
        self.stats = {"reused_wavs": set(), "exported_wavs": set()}
        if existing:
            for path in sorted(Path(existing).glob("*.wav")):
                with wave.open(str(path), "rb") as wav:
                    width, channels, rate = wav.getsampwidth(), wav.getnchannels(), wav.getframerate()
                    data = wav.readframes(wav.getnframes())
                for channel in range(channels):
                    mono = bytearray(len(data) // channels)
                    for byte in range(width):
                        mono[byte::width] = data[channel * width + byte::channels * width]
                    self.matches.setdefault(fingerprint(mono, width, rate), []).append((path, channel, channels))

    def locate(self, index):
        if index not in self.cache:
            sample = self.sf.samples[index]
            kind, link = sample[9] & 7, sample[8]
            if kind in (2, 4) and 0 <= link < len(self.sf.samples):
                other = self.sf.samples[link]
                if (other[8] == index and (other[9] & 7) == (4 if kind == 2 else 2)
                        and sample[5] == other[5]
                        and sample[2] - sample[1] == other[2] - other[1]):
                    left, right = (index, link) if kind == 4 else (link, index)
                    self._stereo(left, right)
                    return self.cache[index]
            pcm, width = self.sf.pcm(index)
            hits = self.matches.get(fingerprint(pcm, width, sample[5]), [])
            if hits:
                self.cache[index] = hits[0]
                self.stats["reused_wavs"].add(str(hits[0][0]))
            else:
                folder = self.output / "samples"
                folder.mkdir(exist_ok=True)
                path = folder / f"{index:04}_{safe_name(name(sample[0]))}.wav"
                with wave.open(str(path), "wb") as wav:
                    wav.setnchannels(1)
                    wav.setsampwidth(width)
                    wav.setframerate(sample[5])
                    wav.writeframes(pcm)
                self.cache[index] = (path, 0, 1)
                self.stats["exported_wavs"].add(str(path))
        return self.cache[index]

    def _stereo(self, left, right):
        lp, width = self.sf.pcm(left)
        rp, right_width = self.sf.pcm(right)
        if width != right_width:
            raise ValueError("Linked samples have different bit depths")
        rate = self.sf.samples[left][5]
        lh = self.matches.get(fingerprint(lp, width, rate), [])
        rh = self.matches.get(fingerprint(rp, width, rate), [])
        for path, channel, channels in lh:
            if channel == 0 and channels == 2 and (path, 1, 2) in rh:
                self.cache[left], self.cache[right] = (path, 0, 2), (path, 1, 2)
                self.stats["reused_wavs"].add(str(path))
                return
        folder = self.output / "samples"
        folder.mkdir(exist_ok=True)
        path = folder / f"{min(left, right):04}_{safe_name(name(self.sf.samples[left][0]))}-stereo.wav"
        data = bytearray(len(lp) * 2)
        for byte in range(width):
            data[byte::width * 2] = lp[byte::width]
            data[width + byte::width * 2] = rp[byte::width]
        with wave.open(str(path), "wb") as wav:
            wav.setnchannels(2)
            wav.setsampwidth(width)
            wav.setframerate(rate)
            wav.writeframes(data)
        self.cache[left], self.cache[right] = (path, 0, 2), (path, 1, 2)
        self.stats["exported_wavs"].add(str(path))

    def mono(self, index):
        """Do not approximate an unpaired channel with stereo width/position.

        Those opcodes mix/reposition BOTH channels. Export the exact channel
        instead if different zone settings prevent lossless stereo pairing.
        """
        sample = self.sf.samples[index]
        folder = self.output / "samples"
        folder.mkdir(exist_ok=True)
        path = folder / f"{index:04}_{safe_name(name(sample[0]))}.wav"
        if str(path) not in self.stats["exported_wavs"]:
            pcm, width = self.sf.pcm(index)
            with wave.open(str(path), "wb") as wav:
                wav.setnchannels(1)
                wav.setsampwidth(width)
                wav.setframerate(sample[5])
                wav.writeframes(pcm)
            self.stats["exported_wavs"].add(str(path))
        return path


def regions(sf, preset):
    result = []
    for pzone in preset["zones"]:
        pg = effective(preset["global"], pzone)
        instrument = sf.instruments[pg[41]]
        for izone in instrument["zones"]:
            ig = effective(instrument["global"], izone)
            key, velocity = intersect(ig, pg, 43), intersect(ig, pg, 44)
            if key is None or velocity is None:
                continue
            g, index = merge(ig, pg), ig[53]
            sample = sf.samples[index]
            values = {"lokey": key[0], "hikey": key[1], "lovel": velocity[0], "hivel": velocity[1],
                      **opcodes(g, sample), **playback(g, sample)}
            result.append({"index": index, "pan": g[17] / 5, "values": values,
                           "instrument": name(instrument["header"][0])})
    return result


def fmt(value):
    if isinstance(value, float):
        if not math.isfinite(value):
            raise ValueError("Non-finite SFZ value")
        return format(value, ".12g")
    return str(value)


def validate_sfz_directory(output):
    """Independent text/WAV bounds check; not a replacement for auditioning."""
    headers = {}
    count = 0
    for path in Path(output).glob("*.sfz"):
        text = path.read_text(encoding="utf-8")
        for block in text.split("<region>")[1:]:
            values = dict(line.split("=", 1) for line in block.splitlines()
                          if "=" in line and not line.startswith("//"))
            sample = (path.parent / values["sample"]).resolve()
            if sample not in headers:
                with wave.open(str(sample)) as wav:
                    headers[sample] = (wav.getnframes(), wav.getsampwidth(), wav.getframerate())
            frames = headers[sample][0]
            for low, high in (("lokey", "hikey"), ("lovel", "hivel")):
                if not 0 <= int(values[low]) <= int(values[high]) <= 127:
                    raise ValueError(f"Invalid {low}/{high} in {path}")
            if not 0 <= int(values["offset"]) <= int(values["end"]) < frames:
                raise ValueError(f"Invalid sample bounds in {path}")
            if "loop_start" in values:
                if not int(values["offset"]) <= int(values["loop_start"]) <= int(values["loop_end"]) <= int(values["end"]):
                    raise ValueError(f"Invalid loop in {path}")
            count += 1
    return {"regions": count, "referenced_wavs": len(headers),
            "bit_depths": sorted({h[1] * 8 for h in headers.values()}),
            "sample_rates": sorted({h[2] for h in headers.values()})}


def consolidate(output):
    """Make generated SFZs self-contained; never delete the source WAVs.

    Verify all copies before the mechanical path rewrite. A same-name conflict
    fails explicitly rather than overwriting a different sample.
    """
    output = Path(output).resolve()
    report_path = output / "report.json"
    report = json.loads(report_path.read_text(encoding="utf-8"))
    validate_sfz_directory(output)
    replacements, copies = {}, {}
    folder = output / "samples"
    folder.mkdir(exist_ok=True)
    for sfz in output.glob("*.sfz"):
        for line in sfz.read_text(encoding="utf-8").splitlines():
            if not line.startswith("sample="):
                continue
            old = line[7:]
            source = (output / old).resolve()
            if source.parent == folder:
                continue
            destination = folder / source.name
            if destination in copies and copies[destination] != source:
                raise ValueError(f"Duplicate sample filename: {source.name}")
            copies[destination] = source
            replacements[old] = "samples/" + source.name
    for destination, source in copies.items():
        digest = hashlib.sha256(source.read_bytes()).digest()
        if destination.exists():
            if hashlib.sha256(destination.read_bytes()).digest() != digest:
                raise FileExistsError(f"Different sample already exists: {destination}")
        else:
            shutil.copy2(source, destination)
        if hashlib.sha256(destination.read_bytes()).digest() != digest:
            raise ValueError(f"Copy verification failed: {destination}")
    # Generated-text bulk rewrite: only the sample path changes.
    for sfz in output.glob("*.sfz"):
        text = sfz.read_text(encoding="utf-8")
        rewritten = "\n".join("sample=" + replacements.get(line[7:], line[7:])
            if line.startswith("sample=") else line for line in text.split("\n"))
        if rewritten != text:
            sfz.write_text(rewritten, encoding="utf-8")
    report["self_contained"] = True
    report["consolidated_samples"] = sorted("samples/" + p.name for p in folder.glob("*.wav"))
    report["copied_from"] = {"samples/" + dest.name: str(src) for dest, src in copies.items()}
    report["validation"] = validate_sfz_directory(output)
    report_path.write_text(json.dumps(report, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    return report


def update_levels(output):
    """Migrate our earlier literal-centibel exports without touching WAVs.

    Report the applied scale so repeated runs cannot multiply it twice.
    Only static region volume is changed; modulator/envelope depths are not.
    """
    output = Path(output)
    report_path = output / "report.json"
    report = json.loads(report_path.read_text(encoding="utf-8"))
    previous = report.get("initial_attenuation_factor", 1.0)
    if previous <= 0:
        raise ValueError("Invalid previous attenuation factor")
    ratio = INITIAL_ATTENUATION_FACTOR / previous
    for sfz in output.glob("*.sfz"):
        text = sfz.read_text(encoding="utf-8")
        lines = []
        for line in text.split("\n"):
            if line.startswith("volume="):
                # Match the same 0..1440-centibel clamp used by FluidSynth.
                value = max(-144, min(0, float(line[7:]) * ratio))
                line = "volume=" + fmt(value)
            lines.append(line)
        rewritten = "\n".join(lines)
        if rewritten != text:
            sfz.write_text(rewritten, encoding="utf-8")
    report["initial_attenuation_factor"] = INITIAL_ATTENUATION_FACTOR
    report["validation"] = validate_sfz_directory(output)
    report_path.write_text(json.dumps(report, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    return report


def convert(source, output, existing=None, self_contained=False):
    output = Path(output)
    if output.exists():
        raise FileExistsError(f"Refusing to overwrite {output}; choose a new output directory")
    sf = SoundFont(source)
    # Validate every range/loop before creating any output.
    plans = [(p, regions(sf, p)) for p in sf.presets]
    output.mkdir(parents=True)
    samples = Samples(sf, existing, output)
    report = {"source": str(sf.path), "bits": 24 if b"sm24" in sf.chunks else 16,
              "initial_attenuation_factor": INITIAL_ATTENUATION_FACTOR,
              "presets": [], "explicit_modulators": [], "unsupported_generators": [],
              "limitations": [
                  "Explicit modulators are NOT translated; their complete records are listed below.",
                  "Default SF2 modulators and nonlinear velocity/filter curves are not fully emulated.",
                  "Envelope shapes, attenuation and effects can differ between SF2 and SFZ engines.",
                  "Tiny sustain loops are preserved, not automatically converted to release triggers.",
                  "Two independent pitch LFOs require a target-specific SFZ extension.",
              ]}
    for level, elements in (("preset", sf.presets), ("instrument", sf.instruments)):
        for element in elements:
            for zi, zone in enumerate([element["global"], *element["zones"]]):
                for mod in zone["mods"]:
                    if any(mod):
                        report["explicit_modulators"].append({"level": level,
                            "name": name(element["header"][0]), "zone": zi,
                            "source": mod[0], "destination": mod[1], "amount": mod[2],
                            "amount_source": mod[3], "transform": mod[4]})
                for op, value in zone["gens"].items():
                    if op not in SUPPORTED:
                        report["unsupported_generators"].append({"level": level,
                            "name": name(element["header"][0]), "zone": zi,
                            "operator": op, "amount": signed(value)})
    for pi, (preset, plan) in enumerate(plans):
        header = preset["header"]
        filename = f"{header[2]:03}_{header[1]:03}_{pi:02}_{safe_name(name(header[0]))}.sfz"
        lines = [f"// Source: {sf.path.name}; bank={header[2]} program={header[1]}",
                 "// Generator conversion only: read report.json before musical use.", ""]
        consumed, tiny = set(), 0
        for i, region in enumerate(plan):
            if i in consumed:
                continue
            index, values = region["index"], dict(region["values"])
            sample = sf.samples[index]
            path, channel, channels = samples.locate(index)
            paired = False
            if channels == 2 and (sample[9] & 7) in (2, 4):
                for j in range(i + 1, len(plan)):
                    other = plan[j]
                    if (j not in consumed and other["index"] == sample[8]
                            and other["values"] == region["values"]
                            and region["pan"] == (-100 if channel == 0 else 100)
                            and other["pan"] == -region["pan"]):
                        other_path, other_channel, _ = samples.locate(other["index"])
                        if path == other_path and channel != other_channel:
                            consumed.add(j)
                            paired = True
                            break
            if channels == 2 and not paired:
                path = samples.mono(index)
            if not paired:
                values["pan"] = region["pan"]
            if "loop_start" in values and values["loop_end"] - values["loop_start"] < 2:
                tiny += 1
            relative = os.path.relpath(path, output).replace(os.sep, "/")
            lines.extend([f"// Instrument: {region['instrument']}", "<region>", f"sample={relative}",
                          *[f"{key}={fmt(value)}" for key, value in values.items()], ""])
        with (output / filename).open("x", encoding="utf-8") as stream:
            stream.write("\n".join(lines))
        report["presets"].append({"file": filename, "bank": header[2], "program": header[1],
            "source_regions": len(plan), "sfz_regions": len(plan) - len(consumed), "tiny_sustain_loops": tiny})
    report["samples"] = {key: sorted(value) for key, value in samples.stats.items()}
    report["validation"] = validate_sfz_directory(output)
    with (output / "report.json").open("x", encoding="utf-8") as stream:
        json.dump(report, stream, indent=2, ensure_ascii=False)
        stream.write("\n")
    return consolidate(output) if self_contained else report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("input", type=Path, nargs="?")
    parser.add_argument("output", type=Path, nargs="?", help="New output directory; must not exist")
    parser.add_argument("--samples", type=Path, help="Reuse WAVs with exactly matching PCM")
    parser.add_argument("--self-contained", action="store_true", help="Copy reused WAVs into the output")
    parser.add_argument("--consolidate", type=Path, help="Make an existing generated output self-contained")
    parser.add_argument("--update-levels", type=Path, help="Fix initial attenuation in earlier generated SFZs")
    args = parser.parse_args()
    if args.update_levels:
        if args.input or args.output or args.samples or args.self_contained or args.consolidate:
            parser.error("--update-levels takes only an existing output directory")
        update_levels(args.update_levels)
        print(f"Updated initial attenuation to FluidSynth-compatible levels in {args.update_levels}")
        return
    if args.consolidate:
        if args.input or args.output or args.samples or args.self_contained:
            parser.error("--consolidate takes only an existing output directory")
        report = consolidate(args.consolidate)
        print(f"Consolidated {report['validation']['referenced_wavs']} referenced WAVs in {args.consolidate}")
        return
    if not args.input or not args.output:
        parser.error("input and output are required for conversion")
    report = convert(args.input, args.output, args.samples, args.self_contained)
    print(f"Wrote {len(report['presets'])} presets ({report['bits']}-bit source) to {args.output}")
    print(f"Reused {len(report['samples']['reused_wavs'])} WAVs; exported {len(report['samples']['exported_wavs'])} exact-PCM WAVs.")
    print(f"Read report.json: {len(report['explicit_modulators'])} explicit modulators need review.")


if __name__ == "__main__":
    main()
