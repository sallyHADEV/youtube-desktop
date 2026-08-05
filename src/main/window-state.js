'use strict';

const fs = require('node:fs');
const path = require('node:path');

const { app, screen } = require('electron');

const FILE = () => path.join(app.getPath('userData'), 'window-state.json');
const DEFAULT_STATE = { width: 1280, height: 800, maximized: false };

function read() {
  try {
    const state = JSON.parse(fs.readFileSync(FILE(), 'utf8'));
    return isOnSomeDisplay(state) ? { ...DEFAULT_STATE, ...state } : { ...DEFAULT_STATE };
  } catch {
    return { ...DEFAULT_STATE };
  }
}

/** Drop saved coordinates that belong to a monitor that is no longer attached. */
function isOnSomeDisplay(state) {
  if (!Number.isFinite(state?.x) || !Number.isFinite(state?.y)) return true;
  return screen.getAllDisplays().some(({ bounds }) =>
    state.x >= bounds.x &&
    state.y >= bounds.y &&
    state.x < bounds.x + bounds.width &&
    state.y < bounds.y + bounds.height);
}

/** Persist bounds on every move/resize, debounced so we do not thrash the disk. */
function track(win) {
  let timer = null;
  const save = () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      const state = { ...win.getNormalBounds(), maximized: win.isMaximized() };
      try {
        fs.writeFileSync(FILE(), JSON.stringify(state, null, 2));
      } catch {
        /* a lost window position is not worth surfacing */
      }
    }, 400);
  };
  win.on('resize', save);
  win.on('move', save);
  win.on('close', save);
}

module.exports = { read, track };
