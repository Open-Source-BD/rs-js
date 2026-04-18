# Repository Guidelines

## Project Structure & Module Organization
`src/` contains the Rust core and operation engine. Key modules include `engine.rs`, `column_store.rs`, `eval.rs`, and `src/operations/` for pipeline steps such as `filter`, `map`, `reduce`, and `group_by`. `js/` contains the JavaScript entry points, Node/browser wrappers, TypeScript declarations, and Jest tests in `js/__tests__/`. `examples/` holds runnable usage samples, while `benchmark.js` measures performance. Generated WASM outputs land in `pkg-node/`, `pkg/`, and `pkg-web/`.

## Build, Test, and Development Commands
Use `npm run build` to build the Node-targeted WASM package into `pkg-node/`. Use `npm run build:web` or `npm run build:bundler` for browser or bundler artifacts, or `npm run build:all` to generate all outputs. Run `npm test` for the Jest suite and `npm run test:rust` for Rust tests via `cargo test`. Use `npm run benchmark` to compare runtime performance on larger datasets.

## Coding Style & Naming Conventions
Follow standard Rust formatting with 4-space indentation and run `cargo fmt` before submitting Rust changes. Keep Rust modules snake_case (`group_by.rs`) and Rust types PascalCase (`DataEngine`, `PreparedQuery`). In JavaScript, match the existing 4-space indentation, use camelCase for methods and variables, and keep public API names aligned with the package surface in `js/index.js` and `js/index.d.ts`. Prefer small, focused modules over adding logic directly to entry files.

## Testing Guidelines
Add JS behavior tests under `js/__tests__/` using `*.test.js` naming; mirror the existing `DataEngine` scenarios with explicit operation names like `test('filter')`. Add Rust unit tests alongside the relevant module or in `tests/` if coverage expands. Cover both happy paths and edge cases around pipeline options, typed outputs, and small-vs-large dataset behavior.

## Commit & Pull Request Guidelines
Recent history follows Conventional Commit style: `feat: ...`, `refactor: ...`, `chore: ...`. Keep commit subjects imperative and scoped to one change. Pull requests should describe the user-visible impact, list commands run for verification, and link related issues. Include benchmarks or example output when changing query performance or API behavior.

## Build Artifacts & Configuration
Do not hand-edit generated `pkg-*` output unless the change specifically targets packaging. Rust build settings live in `Cargo.toml`; JS package metadata lives in the root `package.json` and `js/package.json`. If you change exported APIs, update the implementation, typings, README examples, and tests together.
