/**
 * Canonical credits content shared by the in-app Credits panel and README.md.
 *
 * Keep presentation out of this file: credits.js renders these nodes as JSX,
 * while scripts/sync-readme-credits.mjs renders the same nodes as Markdown.
 */

const link = (text, href, options = {}) => ({ type: "link", text, href, ...options });
const emphasis = (...children) => ({ type: "emphasis", children });
const strong = (...children) => ({ type: "strong", children });

export function createCreditsContent(version) {
  return [
    {
      children: [
        "Design by ",
        link("Siemen Terpstra", "http://siementerpstra.com/"),
        " based on ",
        link(
          "Erv Wilson's microtonal keyboard designs",
          "https://www.anaphoria.com/wilsonkeyboard.html",
        ),
        " (1967-), inspired by ",
        link(
          "R.H.M. Bosanquet",
          "https://en.wikipedia.org/wiki/Robert_Holford_Macdowall_Bosanquet",
        ),
        "'s ",
        link("Generalised Keyboard", "https://en.wikipedia.org/wiki/Generalized_keyboard"),
        " (1873) and Ivo Salzinger's ",
        emphasis("Tastatura Nova Perfecta"),
        " (1721).",
      ],
    },
    {
      children: [
        "Initial development by James Fenn with additions and modifications from ",
        link("Brandon Lewis", "http://brandlew.com/"),
        ", ",
        link("Bo Constantinsen", "http://whatmusicreallyis.com/", {
          title: "What Music Really İs",
        }),
        ", ",
        link("Chengu Wang", "https://sites.google.com/site/wangchengu/"),
        ", ",
        link("Ashton Snelgrove", "https://ashton.snelgrove.science"),
        ". Sampling credits to Scott Thompson, Tim Kahn, Carlos Vaquero, Dr. Ozan Yarman, Lars Palo, and Soni Musicae.",
      ],
    },
    {
      children: [
        `Current version ${version} (August 2026) made by `,
        link("Marc Sabat", "https://www.plainsound.org"),
        ", released under ",
        link("GPL-3.0", "https://www.gnu.org/licenses/gpl-3.0.en.html"),
        ". Open source code at ",
        link("github.com/PLAINSOUND/hexatone", "https://github.com/PLAINSOUND/hexatone"),
        ". Join the community on ",
        link("discord", "https://discord.gg/NGVTmDFPtf"),
        ".",
      ],
    },
    {
      children: [
        emphasis(
          "The text font with embedded HEJI accidentals (Plainsound Sans) is designed by Thomas Nicholson. Unicode data for copying/pasting may be found at ",
          link(
            "w3c-cg.github.io/smufl/latest/tables",
            "https://w3c-cg.github.io/smufl/latest/tables/extended-helmholtz-ellis-accidentals-just-intonation.html",
          ),
          ".",
        ),
      ],
    },
    {
      id: "donation-link",
      children: [
        strong(
          "Support our open access content with a ",
          link("donation", "https://ko-fi.com/plainsound"),
          ".",
        ),
        { type: "break" },
        "cc 2026 ",
        link("PLAINSOUND MUSIC EDITION", "https://www.plainsound.org"),
      ],
    },
  ];
}
