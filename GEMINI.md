# GEMINI.md

This file provides context and instructions for the `rs-js` project, a high-performance data processing library powered by Rust and WebAssembly.

## Project Overview

`rs-js` brings Rust's performance to JavaScript data processing. It allows filtering, mapping, reducing, grouping, and finding across large datasets (100k–1M+ records) with minimal overhead.

- **Main Technologies:** Rust (2024 edition), WebAssembly, `wasm-bindgen`, `serde-wasm-bindgen`.
- **Architecture:**
    - **Rust Core (`src/`):** Implements the processing engine.
        - `lib.rs`: WASM entry point and stateful `DataEngine`.
        - `engine.rs`: Pipeline execution logic (folding operations over data).
        - `column_store.rs`: Columnar data representation for fast-path operations (e.g., numeric aggregates).
        - `operations/`: Modular implementations for `filter`, `map`, `reduce`, `groupBy`, `count`, and `find`.
    - **JS Wrapper (`js/`):** Thin ESM/CJS wrappers that handle WASM initialization and provide TypeScript types.
- **Data Model:**
    - **Intermediate Operations:** `filter`, `map` (return rows to the next step).
    - **Terminal Operations:** `reduce`, `groupBy`, `count`, `find` (consume data and return a result).

## Building and Running

### Development Commands
```bash
# Build for Node.js (outputs to pkg-node/)
npm run build

# Build for Web (outputs to pkg-web/)
npm run build:web

# Build for Bundlers (outputs to pkg/)
npm run build:bundler

# Build all targets
npm run build:all

# Run Rust unit tests
cargo test

# WASM integration tests
wasm-pack test --headless --chrome
```

### Examples
The `examples/` directory contains usage scripts. Run them with Node.js:
```bash
node examples/01_filter.js
node examples/07_pipeline.js
```

## Development Conventions

### Rust
- **Serialization:** Always use `Serializer::json_compatible()` in `src/lib.rs` when returning `JsValue` to prevent `BigInt` conversion issues with `serde-wasm-bindgen`.
- **Performance:** Prefer the `ColumnStore` fast paths for numeric aggregations. If an operation can be performed on columns rather than rows, implement a fast path in `column_store.rs` and `lib.rs`.
- **Error Handling:** Use `thiserror` for internal errors and convert to `JsValue`/`JsError` at the WASM boundary.
- **Code Style:** Follow `cargo fmt` and `cargo clippy` recommendations.

### JavaScript/TypeScript
- **Type Safety:** Maintain `js/index.d.ts` to ensure the `PipelineResult` discriminated union accurately reflects the Rust enum variants.
- **WASM Init:** In the browser (`js/index.js`), WASM is lazy-loaded on the first call. In Node.js (`js/index.node.cjs`), it is initialized synchronously.

## Key Files
- `src/lib.rs`: The main WASM bridge.
- `src/engine.rs`: The heart of the processing pipeline.
- `src/types.rs`: Shared types (Operation, PipelineResult, Row).
- `js/index.d.ts`: Public TypeScript API definitions.
- `Cargo.toml`: Rust dependencies and build profiles.
- `package.json`: NPM scripts and package configuration.
