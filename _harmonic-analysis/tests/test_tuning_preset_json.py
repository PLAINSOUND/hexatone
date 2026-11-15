from pathlib import Path

import pytest

from tuning_preset_json import load_tuning_preset


ROOT = Path(__file__).resolve().parents[1]


def test_loads_tree_modulations_scale_as_exact_monzo_data():
    preset = load_tuning_preset(ROOT / "data" / "sabat-the-tree-modulations.json")
    assert preset.name == "Sabat: The Tree + Modulations"
    assert preset.degree_count == 81
    assert preset.ratios[0] == "129/128"
    assert preset.monzos[0] == {2: -7, 3: 1, 43: 1}
    assert preset.metadata["reference_degree"] == 56
    assert preset.zero_monzo == {}


def test_assigned_zero_monzo_is_preserved_separately():
    zero = {2: 1, 3: -1}
    preset = load_tuning_preset(ROOT / "data" / "sabat-the-tree-modulations.json", zero_monzo=zero)
    assert preset.zero_monzo == zero
    assert preset.monzos[0] == {2: -7, 3: 1, 43: 1}
