"""Load ratio-only Hexatone tuning preset JSON for exact analysis."""

from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from monzo import Monzo, ratio_to_monzo


@dataclass(frozen=True)
class TuningPreset:
    """Scale ratios and their exact monzos, retaining source metadata."""

    name: str
    ratios: tuple[str, ...]
    monzos: tuple[Monzo, ...]
    metadata: dict[str, Any]
    zero_monzo: Monzo

    @property
    def degree_count(self) -> int:
        return len(self.ratios)


def load_tuning_preset(path: str | Path, *, zero_monzo: Monzo | None = None) -> TuningPreset:
    """Load a preset whose ``scale`` contains only rational ratio strings.

    Degree numbering is zero-based and follows the JSON list exactly.  The
    optional assigned zero monzo is retained separately; it does not rewrite
    source ratios or their monzos.
    """
    source_path = Path(path)
    with source_path.open(encoding="utf-8") as source_file:
        data = json.load(source_file)

    scale = data.get("scale")
    if not isinstance(scale, list) or not scale:
        raise ValueError(f"{source_path}: expected a non-empty 'scale' array")

    ratios: list[str] = []
    monzos: list[Monzo] = []
    for degree, entry in enumerate(scale):
        if not isinstance(entry, str):
            raise ValueError(
                f"{source_path}: scale degree {degree} is not a ratio string: {entry!r}"
            )
        try:
            monzo = ratio_to_monzo(entry)
        except (ValueError, ZeroDivisionError) as error:
            raise ValueError(
                f"{source_path}: invalid ratio at scale degree {degree}: {entry!r}"
            ) from error
        ratios.append(entry)
        monzos.append(monzo)

    reserved = {"scale", "name"}
    metadata = {key: value for key, value in data.items() if key not in reserved}
    return TuningPreset(
        name=str(data.get("name", source_path.stem)),
        ratios=tuple(ratios),
        monzos=tuple(monzos),
        metadata=metadata,
        zero_monzo=dict(sorted((zero_monzo or {}).items())),
    )
