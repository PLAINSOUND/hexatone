/**
 * Browser entry point for retune.html, registered separately in vite.config.js.
 * Mounts the research editor without constructing the main Hexatone App.
 */

import { render } from "preact";
import RetuneApp from "./app.jsx";

render(<RetuneApp />, document.getElementById("application"));
