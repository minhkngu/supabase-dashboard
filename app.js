import { initMode } from './src/overview/mode.js';
import { initDeletion } from './src/deletion.js';
import { initSidebar, initSidebar2 } from './src/sidebar.js';
import { initCellEdit } from './src/grid/cell-edit.js';
import { initHistory } from './src/history.js';
import { initLookup } from './src/lookup.js';
import { initRelationDisplay } from './src/relation-display.js';
import { initColumnDialog } from './src/column-dialog.js';
import { initViewMenus, initViewMenus2 } from './src/view-menus.js';
import { initCustomSelect } from './src/custom-select.js';
import { initMain, initMain2 } from './src/main.js';

// Event wiring runs in the original top-to-bottom order of the former app.js.
initMode();
initDeletion();
initSidebar();
initCellEdit();
initHistory();
initLookup();
initRelationDisplay();
initColumnDialog();
initViewMenus();
initCustomSelect();
initViewMenus2();
initMain();
initSidebar2();
await initMain2();
