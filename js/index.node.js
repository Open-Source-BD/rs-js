'use strict';
const { processRaw, initSync } = require('../pkg-node/rs_js.js');
const fs = require('fs');
const path = require('path');

const wasmPath = path.join(__dirname, '../pkg-node/rs_js_bg.wasm');
initSync({ module: fs.readFileSync(wasmPath) });

/**
 * @param {Record<string, unknown>[]} data
 * @param {object[]} operations
 * @param {object} [options]
 */
function process(data, operations, options) {
    return processRaw(data, operations, options ?? undefined);
}

module.exports = { process };
