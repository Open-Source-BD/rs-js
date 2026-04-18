/* @ts-self-types="./rs_js.d.ts" */
import * as wasm from "./rs_js_bg.wasm";
import { __wbg_set_wasm } from "./rs_js_bg.js";

__wbg_set_wasm(wasm);
wasm.__wbindgen_start();
export {
    DataEngine, PreparedQuery, _init
} from "./rs_js_bg.js";
