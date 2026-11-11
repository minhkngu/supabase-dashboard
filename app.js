import { initMode } from './src/overview/mode.js';
import { initDeletion } from './src/deletion.js';
import { initMain } from './src/main.js';

// Event wiring runs in the original top-to-bottom order of the former app.js.
initMode();
initDeletion();
await initMain();
