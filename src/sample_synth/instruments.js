export const instruments = [
  {
    name: "Additive Synthesis Timbres",
    instruments: [
      {
        fileName: "WMRI3LST",
        name: "3-Limit (4 Harmonics)",
        gain: 0.77,
        attack: 0.276,
        release: 0.27,
        loop: true,
        velocity: true,
        aftertouch: 0.4
      }, {
        fileName: "WMRI5LST",
        name: "5-Limit (6 Harmonics)",
        gain: 0.65,
        attack: 0.212,
        release: 0.184,
        loop: true,
        velocity: true,
        aftertouch: 0.4
      }, {
        fileName: "WMRI7LST",
        name: "7-Limit (10 Harmonics)",
        gain: 0.59,
        attack: 0.238,
        release: 0.171,
        loop: true,
        velocity: true,
        aftertouch: 0.4
      }, {
        fileName: "WMRI11LST",
        name: "11-Limit (12 Harmonics)",
        gain: 0.58,
        attack: 0.104,
        release: 0.068,
        loop: true,
        velocity: true,
        aftertouch: 0.4
      }, {
        fileName: "WMRI13LST",
        name: "13-Limit (16 Harmonics)",
        gain: 0.55,
        attack: 0.095,
        release: 0.085,
        loop: true,
        velocity: true,
        aftertouch: 0.4
      }, {
        fileName: "WMRIByzantineST",
        name: "Reed (9 Harmonics)",
        gain: 0.6,
        attack: 0.096,
        release: 0.046,
        loop: true,
        velocity: true,
        aftertouch: 0.4
      }, {
        fileName: "hammond",
        name: "Hammond (9 Harmonics)",
        gain: 0.71,
        attack: 0.001,
        release: 0.015,
        loop: true,
        velocity: false,
        aftertouch: 0.4
      }
    ],
  },
  {
    name: "Sampled Instruments",
    instruments: [
      {
        fileName: "wurli",
        name: "Wurlitzer Electric Piano",
        gain: 0.35,
        attack: 0,
        release: 0.008,
        loop: false,
        velocity: true,
        aftertouch: 0.4
      }, {
        fileName: "rhodes",
        name: "Fender Rhodes",
        gain: 0.48,
        attack: 0,
        release: 0.005,
        loop: false,
        velocity: true,
        aftertouch: 0.4
      }, {
        fileName: "HvP8_retuned",
        name: "Baroque Organ",
        gain: 0.55,
        attack: 0,
        release: 0.3,
        loop: true,
        loopPoints: [4.0, 5.2913, 2.287103, 4.1999, 2.287, 4.21495, 0.9711, 3.574],
        velocity: false,
        aftertouch: 0
      }, {
        fileName: "harpsichord",
        name: "Harpsichord",
        gain: 0.28,
        attack: 0,
        release: 1.0,
        loop: false,
        velocity: false,
        aftertouch: 0
      }, {
        fileName: "lute",
        name: "Lute-Stop",
        gain: 0.24,
        attack: 0,
        release: 1.2,
        loop: false,
        velocity: false,
        aftertouch: 0
      }, {
        fileName: "harp",
        name: "Harp",
        gain: 0.6,
        attack: 0,
        release: 4,
        loop: false,
        velocity: true,
        aftertouch: 0
      }, {
        fileName: "qanun",
        name: "Qanun",
        gain: 0.33,
        attack: 0,
        release: 4,
        loop: false,
        velocity: true,
        aftertouch: 0
      }, {
        fileName: "gayageum",
        name: "Gayageum",
        gain: 0.24,
        attack: 0,
        release: 4,
        loop: false,
        velocity: true,
        aftertouch: 0.4
      }, {
        fileName: "vibes",
        name: "Vibraphone",
        gain: 0.6,
        attack: 0,
        release: 4,
        loop: false,
        velocity: true,
        aftertouch: 0
      }, {
        fileName: "sruti",
        name: "Srutibox Harmonium",
        gain: 0.295,
        attack: 0,
        release: 0.25,
        loop: true,
        velocity: true,
        aftertouch: 0.8
      }
    ]
  }
]
