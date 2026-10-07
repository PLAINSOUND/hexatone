// Download names only: keep the original title inside the exported record.
export function exportFilename(name, fallback = "preset") {
  const letters = {
    ß: "ss", ẞ: "SS", æ: "ae", Æ: "AE", œ: "oe", Œ: "OE",
    ø: "o", Ø: "O", ł: "l", Ł: "L", đ: "d", Đ: "D",
    ð: "d", Ð: "D", þ: "th", Þ: "TH",
  };
  const simplify = (value) => String(value ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[ßẞæÆœŒøØłŁđĐðÐþÞ]/g, (letter) => letters[letter])
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return simplify(name) || simplify(fallback) || "preset";
}
