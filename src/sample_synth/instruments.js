export const instruments = [
  {
    name: "Additive Synthesis Timbres",
    instruments: [
      {
        fileName: "WMRI3LST",
        name: "3-Limit (4 Harmonics)",
        gain: 0.72,
        attack: 0.216,
        release: 0.227,
        loop: true,
        velocity: true,
        aftertouch: 0.4
      }, {
        fileName: "WMRI5LST",
        name: "5-Limit (6 Harmonics)",
        gain: 0.68,
        attack: 0.182,
        release: 0.184,
        loop: true,
        velocity: true,
        aftertouch: 0.4
      }, {
        fileName: "WMRI7LST",
        name: "7-Limit (10 Harmonics)",
        gain: 0.65,
        attack: 0.168,
        release: 0.22,
        loop: true,
        velocity: true,
        aftertouch: 0.4
      }, {
        fileName: "WMRI11LST",
        name: "11-Limit (12 Harmonics)",
        gain: 0.6,
        attack: 0.144,
        release: 0.18,
        loop: true,
        velocity: true,
        aftertouch: 0.4
      }, {
        fileName: "WMRI13LST",
        name: "13-Limit (16 Harmonics)",
        gain: 0.565,
        attack: 0.1,
        release: 0.1,
        loop: true,
        velocity: true,
        aftertouch: 0.4
      }, {
        fileName: "WMRIByzantineST",
        name: "Reed (9 Harmonics)",
        gain: 0.58,
        attack: 0.12,
        release: 0.15,
        loop: true,
        velocity: true,
        aftertouch: 0.4
      }, {
        fileName: "hammond",
        name: "Hammond (9 Harmonics)",
        gain: 0.66,
        attack: 0.001,
        release: 0.001,
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
        gain: 0.29,
        attack: 0,
        release: 0.05,
        loop: false,
        velocity: true,
        aftertouch: 0.4
      }, {
        fileName: "rhodes",
        name: "Fender Rhodes",
        gain: 0.42,
        attack: 0,
        release: 0.001,
        loop: false,
        velocity: true,
        aftertouch: 0.4
      }, {
        fileName: "HvP8_retuned",
        name: "Baroque Organ",
        gain: 0.5,
        attack: 0,
        release: 0.265,
        loop: true,
        loopPoints: [4.0, 5.2913, 2.287103, 4.1999, 2.287, 4.21495, 0.9711, 3.574],
        velocity: false,
        aftertouch: 0
      }, {
        fileName: "harpsichord",
        name: "Harpsichord",
        gain: 0.26,
        attack: 0,
        release: 0.18,
        loop: false,
        velocity: false,
        aftertouch: 0
      }, {
        fileName: "lute",
        name: "Lute-Stop",
        gain: 0.22,
        attack: 0,
        release: 2,
        loop: false,
        velocity: false,
        aftertouch: 0
      }, {
        fileName: "harp",
        name: "Harp",
        gain: 0.36,
        attack: 0,
        release: 8,
        loop: false,
        velocity: true,
        aftertouch: 0
      }, {
        fileName: "qanun",
        name: "Qanun",
        gain: 0.25,
        attack: 0,
        release: 6,
        loop: false,
        velocity: true,
        aftertouch: 0
      }, {
        fileName: "gayageum",
        name: "Gayageum",
        gain: 0.25,
        attack: 0,
        release: 6,
        loop: false,
        velocity: true,
        aftertouch: 0.4
      }, {
        fileName: "vibes",
        name: "Vibraphone",
        gain: 0.6,
        attack: 0,
        release: 2,
        loop: false,
        velocity: true,
        aftertouch: 0
      }, {
        fileName: "sruti",
        name: "Srutibox Harmonium",
        gain: 0.285,
        attack: 0,
        release: 0.6,
        loop: true,
        velocity: true,
        aftertouch: 0.8
      }
    ]
  }
]
