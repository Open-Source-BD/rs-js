let _initPromise = null;

function getWasm() {
    if (!_initPromise) {
        _initPromise = import('../pkg/rs_js.js').then(async (mod) => {
            await mod.default();
            return mod;
        });
    }
    return _initPromise;
}

/**
 * Process a dataset through a pipeline of operations.
 *
 * @param {Record<string, unknown>[]} data
 * @param {import('./index.d.ts').Operation[]} operations
 * @param {import('./index.d.ts').PipelineOptions} [options]
 * @returns {Promise<import('./index.d.ts').PipelineResult>}
 */
export async function process(data, operations, options) {
    const wasm = await getWasm();
    return wasm.processRaw(data, operations, options ?? undefined);
}
