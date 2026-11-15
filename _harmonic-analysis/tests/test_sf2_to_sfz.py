"""Run without project dependencies: python3 -m unittest discover ..."""
import importlib.util
import json
from pathlib import Path
import struct
import tempfile
import unittest
import wave

spec = importlib.util.spec_from_file_location(
    "sf2_to_sfz", Path(__file__).parents[1] / "src" / "sf2-to-sfz.py")
converter = importlib.util.module_from_spec(spec)
spec.loader.exec_module(converter)


def chunk(tag, data):
    return tag + struct.pack("<I", len(data)) + data + (b"\0" if len(data) % 2 else b"")


def fixture(path):
    # Positive/negative PCM including low bytes, with an odd-sized INFO chunk.
    info = chunk(b"LIST", b"INFO" + chunk(b"INAM", b"odd"))
    sdta = chunk(b"LIST", b"sdta" + chunk(b"smpl", bytes.fromhex("0100ffff"))
                 + chunk(b"sm24", bytes.fromhex("7f80")))
    tables = [
        (b"phdr", struct.pack("<20sHHHIII", b"test", 0, 0, 0, 0, 0, 0)
         + struct.pack("<20sHHHIII", b"EOP", 0, 0, 1, 0, 0, 0)),
        (b"pbag", struct.pack("<HHHH", 0, 0, 1, 0)),
        (b"pmod", bytes(10)), (b"pgen", struct.pack("<HH", 41, 0)),
        (b"inst", struct.pack("<20sH20sH", b"inst", 0, b"EOI", 1)),
        (b"ibag", struct.pack("<HHHH", 0, 0, 1, 0)),
        (b"imod", bytes(10)), (b"igen", struct.pack("<HH", 53, 0)),
        (b"shdr", struct.pack("<20sIIIIIBbHH", b"sample", 0, 2, 0, 2, 44100, 60, -4, 0, 1)
         + struct.pack("<20sIIIIIBbHH", b"EOS", 0, 0, 0, 0, 0, 0, 0, 0, 1)),
    ]
    pdta = chunk(b"LIST", b"pdta" + b"".join(chunk(tag, data) for tag, data in tables))
    path.write_bytes(chunk(b"RIFF", b"sfbk" + info + sdta + pdta))


class ConverterTests(unittest.TestCase):
    def test_initial_attenuation_matches_fluidsynth_not_envelope_sustain(self):
        sample = (b"test", 0, 100, 0, 100, 48000, 60, 0, 0, 1)
        g = converter.merge({48: 100, 37: 200}, {48: 75})
        result = converter.opcodes(g, sample)
        self.assertEqual(result["volume"], -7)
        self.assertEqual(result["ampeg_sustain"], 10)
        self.assertEqual(converter.opcodes(converter.merge({48: 100}, {}), sample)["volume"], -4)

    def test_preset_offsets_use_instrument_defaults(self):
        self.assertEqual(converter.merge({}, {8: (-1200) & 65535})[8], 12300)
        self.assertEqual(converter.merge({}, {38: 1200})[38], -10800)

    def test_local_generators_override_global(self):
        self.assertEqual(converter.effective({"gens": {8: 9000}}, {"gens": {8: 10000}}), {8: 10000})

    def test_key_and_velocity_intersections(self):
        for op in (43, 44):
            self.assertEqual(converter.intersect({op: 80 << 8 | 20}, {op: 100 << 8 | 50}, op), (50, 80))
            self.assertIsNone(converter.intersect({op: 40 << 8 | 20}, {op: 100 << 8 | 50}, op))
            with self.assertRaises(ValueError):
                converter.intersect({op: 20 << 8 | 40}, {}, op)

    def test_loop_modes_and_absolute_sample_offsets(self):
        sample = (b"test", 1000, 2000, 1100, 1900, 48000, 60, 0, 0, 1)
        for mode, expected in ((1, "loop_continuous"), (3, "loop_sustain")):
            g = converter.merge({54: mode}, {})
            result = converter.playback(g, sample)
            self.assertEqual(result["loop_mode"], expected)
            self.assertEqual((result["loop_start"], result["loop_end"]), (100, 899))
            self.assertEqual(result["end"], 999)
        self.assertEqual(converter.playback(converter.merge({}, {}), sample)["loop_mode"], "no_loop")

    def test_address_offsets_and_invalid_loops(self):
        sample = (b"test", 1000, 2000, 1100, 1900, 48000, 60, 0, 0, 1)
        result = converter.playback(converter.merge({0: 10, 1: 65526, 2: 5, 3: 65531, 54: 3}, {}), sample)
        self.assertEqual((result["offset"], result["end"], result["loop_start"], result["loop_end"]), (10, 989, 105, 894))
        with self.assertRaises(ValueError):
            converter.playback(converter.merge({2: 900, 54: 3}, {}), sample)

    def test_special_zero_time_and_pitch_correction(self):
        self.assertEqual(converter.time_seconds(-32768), 0)
        sample = (b"test", 0, 100, 0, 100, 48000, 60, -4, 0, 1)
        self.assertEqual(converter.opcodes(converter.merge({52: 10}, {}), sample)["tune"], 6)

    def test_24bit_roundtrip_padding_and_no_overwrite(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            source = root / "test.sf2"
            fixture(source)
            sf = converter.SoundFont(source)
            self.assertEqual(sf.pcm(0), (bytes.fromhex("7f010080ffff"), 3))
            report = converter.convert(source, root / "output")
            self.assertEqual(report["bits"], 24)
            wav_path = Path(report["samples"]["exported_wavs"][0])
            with wave.open(str(wav_path)) as wav:
                self.assertEqual(wav.getsampwidth(), 3)
                self.assertEqual(wav.readframes(2), bytes.fromhex("7f010080ffff"))
            text = next((root / "output").glob("*.sfz")).read_text()
            self.assertIn("lokey=0\nhikey=127", text)
            self.assertNotIn("lochan", text)
            with self.assertRaises(FileExistsError):
                converter.convert(source, root / "output")

    def test_existing_stereo_matching_and_exact_mono_fallback(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            source = root / "test.sf2"
            fixture(source)
            sf = converter.SoundFont(source)
            existing = root / "existing"
            existing.mkdir()
            pcm, _ = sf.pcm(0)
            with wave.open(str(existing / "stereo.wav"), "wb") as wav:
                wav.setparams((2, 3, 44100, 0, "NONE", "not compressed"))
                wav.writeframes(pcm[:3] + bytes(3) + pcm[3:] + bytes(3))
            output = root / "output"
            output.mkdir()
            samples = converter.Samples(sf, existing, output)
            self.assertEqual(samples.locate(0), (existing / "stereo.wav", 0, 2))
            with wave.open(str(samples.mono(0))) as wav:
                self.assertEqual(wav.getnchannels(), 1)
                self.assertEqual(wav.readframes(2), pcm)

    def test_linked_stereo_export_is_byte_exact(self):
        class Linked:
            samples = [(b"left", 0, 2, 0, 2, 48000, 60, 0, 1, 4),
                       (b"right", 2, 4, 2, 4, 48000, 60, 0, 0, 2)]

            def pcm(self, index):
                return (bytes.fromhex("010203040506") if index == 0 else
                        bytes.fromhex("0708090a0b0c")), 3

        with tempfile.TemporaryDirectory() as temporary:
            samples = converter.Samples(Linked(), None, Path(temporary))
            lp, lc, ln = samples.locate(0)
            rp, rc, rn = samples.locate(1)
            self.assertEqual((lp, lc, ln), (rp, 0, 2))
            self.assertEqual((rc, rn), (1, 2))
            with wave.open(str(lp)) as wav:
                self.assertEqual(wav.readframes(2), bytes.fromhex("0102030708090405060a0b0c"))

    def test_validation_rejects_bad_generated_loop_and_range(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            source = root / "test.sf2"
            fixture(source)
            converter.convert(source, root / "output")
            path = next((root / "output").glob("*.sfz"))
            original = path.read_text()
            path.write_text(original.replace("hikey=127", "hikey=-1"))
            with self.assertRaises(ValueError):
                converter.validate_sfz_directory(root / "output")
            path.write_text(original + "\nloop_start=1\nloop_end=2\n")
            with self.assertRaises(ValueError):
                converter.validate_sfz_directory(root / "output")

    def test_consolidation_copies_external_samples_and_changes_only_paths(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            source = root / "test.sf2"
            fixture(source)
            converter.convert(source, root / "original")
            converter.convert(source, root / "output", root / "original" / "samples")
            sfz = next((root / "output").glob("*.sfz"))
            before = sfz.read_text().splitlines()
            self.assertIn("sample=../original/samples/0000_sample.wav", before)
            report = converter.consolidate(root / "output")
            after = sfz.read_text().splitlines()
            self.assertEqual([l for l in before if not l.startswith("sample=")],
                             [l for l in after if not l.startswith("sample=")])
            self.assertIn("sample=samples/0000_sample.wav", after)
            self.assertEqual((root / "original/samples/0000_sample.wav").read_bytes(),
                             (root / "output/samples/0000_sample.wav").read_bytes())
            self.assertTrue(report["self_contained"])
            self.assertEqual(report["validation"]["referenced_wavs"], 1)
            converter.consolidate(root / "output")  # safe to repeat

    def test_level_migration_is_idempotent_and_preserves_other_fields_and_pcm(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            source = root / "test.sf2"
            fixture(source)
            output = root / "output"
            converter.convert(source, output)
            sfz = next(output.glob("*.sfz"))
            sfz.write_text(sfz.read_text().replace("volume=0", "volume=-17.5"))
            report_path = output / "report.json"
            report = json.loads(report_path.read_text())
            report.pop("initial_attenuation_factor")  # pre-fix output format
            report_path.write_text(json.dumps(report))
            before = sfz.read_text().splitlines()
            wav = next((output / "samples").glob("*.wav"))
            pcm_before = wav.read_bytes()
            converter.update_levels(output)
            after = sfz.read_text().splitlines()
            self.assertIn("volume=-7", after)
            self.assertEqual([l for l in before if not l.startswith("volume=")],
                             [l for l in after if not l.startswith("volume=")])
            converter.update_levels(output)
            self.assertEqual(sfz.read_text().splitlines(), after)
            self.assertEqual(wav.read_bytes(), pcm_before)


if __name__ == "__main__":
    unittest.main()
