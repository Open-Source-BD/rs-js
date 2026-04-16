'use strict';

let processRaw;

try {
    // nodejs target auto-loads the .wasm at require time — no initSync needed
    processRaw = require('../pkg-node/rs_js.js').processRaw;
} catch {
    throw new Error(
        '\n[rs-js] WASM build not found.\n' +
        'Run once to compile:\n\n' +
        '  npm run build\n\n' +
        'Requires wasm-pack (one-time install):\n' +
        '  cargo install wasm-pack\n'
    );
}

/**
 * Process a dataset through a pipeline of operations.
 * @param {Record<string, unknown>[]} data
 * @param {import('./index.d.ts').Operation[]} operations
 * @param {import('./index.d.ts').PipelineOptions} [options]
 * @returns {import('./index.d.ts').PipelineResult}
 */
function process(data, operations, options) {
    return processRaw(data, operations, options ?? undefined);
}

module.exports = { process };
