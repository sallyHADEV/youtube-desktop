'use strict';

const fs = require('node:fs');
const path = require('node:path');

const { app } = require('electron');

const MAX_BYTES = 512 * 1024;

/**
 * Append-only trace of where the app navigated and what got blocked. Sign-in is
 * a chain of redirects across several Google domains, and when it breaks the
 * only useful question is "which hop died" — that is unanswerable without this.
 *
 * Query strings are dropped: they carry auth tokens and have no diagnostic value.
 */
function createLogger(fileName = 'ytd.log') {
  const file = path.join(app.getPath('userData'), fileName);

  try {
    if (fs.statSync(file).size > MAX_BYTES) fs.rmSync(file);
  } catch {
    /* no log yet */
  }

  const write = (text) => {
    try {
      fs.appendFileSync(file, `${new Date().toISOString()}  ${text}\n`);
    } catch {
      /* logging must never take the app down */
    }
  };

  write(`--- start (electron ${process.versions.electron}) ---`);
  return { file, write };
}

/** `origin + pathname`, with the token-bearing query string removed. */
function safeUrl(url) {
  try {
    const parsed = new URL(url);
    return `${parsed.origin}${parsed.pathname}`;
  } catch {
    return String(url).slice(0, 120);
  }
}

module.exports = { createLogger, safeUrl };
