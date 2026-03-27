# Plainsound Hexatone

[Run the keyboard](https://hexatone.plainsound.org) | 
[Try the dev branch](https://plainsound.github.io/hexatone)

Designed by [Siemen Terpstra](http://siementerpstra.com/) in the late 1980s, based on [Erv Wilson's microtonal keyboard designs](https://www.anaphoria.com/wilsonkeyboard.html) (1967-), inspired by [R.H.M. Bosanquet](https://en.wikipedia.org/wiki/Robert_Holford_Macdowall_Bosanquet)'s [Generalised Keyboard](https://en.wikipedia.org/wiki/Generalized_keyboard) (1873) and Ivo Salzinger's Tastatura Nova Perfecta (1721).

Initial development by James Fenn with additions and modifications from [Brandon Lewis](http://brandlew.com/), [Bo Constantinsen](http://whatmusicreallyis.com/), [Chengu Wang](https://sites.google.com/site/wangchengu/), [Ashton Snelgrove](https://ashton.snelgrove.science).
Sampling credits to Scott Thompson, Tim Kahn, Carlos Vaquero, Dr. Ozan Yarman, Lars Palo, Soni Musicae.

MIDI version designed and programmed by [Marc Sabat](https://www.plainsound.org).
Current version 3dev (2026), released as Free/Libre and Open Source Software under [GPL-3.0](https://www.gnu.org/licenses/gpl-3.0.en.html).
Code on github: https://github.com/PLAINSOUND/hexatone.

## Isomorphic Keyboards
[Wikipedia](https://en.wikipedia.org/wiki/Isomorphic_keyboard)

[The Music Notation Project Wiki](http://musicnotation.org/wiki/instruments/isomorphic-instruments/)

[AltKeyboards](http://www.altkeyboards.com/instruments/isomorphic-keyboards)

## Version history
Version 1 : 2016- [Terpstra Keyboard] (http://terpstrakeyboard.com/) hexagonal keyboard proof of concept  
Version 2 : 2022-26 Marc Sabat: Added MIDI input and output, developed Lumatone plug-and-play compatability and built-in presets, MTS output  
Version 3.0.0 : 2026- Added scala/json IO, user presets, polyphonic aftertouch response with built-in sounds  
Version 3.0.1 : March 2026 Updated UX, added latch sustain, moveable centre scale degree
Version 3.0.2 : Major reactivity fixes, MTS & MPE functionality scaled, scale resizing and Divide Octave/Equave features
Version 3.1.0_beta : (current) refactoring code to automatically map isomorphic controllers, changed octave-to-equave to allow user specified behaviour for other scales; fixes to TuneCell and various bugfixes; option to retain scale on reload, fixed input interoperability logic (mouse, touch, computer keyboard, MIDI)
