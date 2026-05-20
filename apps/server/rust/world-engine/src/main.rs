use sidecar_common::transport::run_stdio_jsonrpc;
use world_engine::WorldEngineHandler;

fn main() {
    run_stdio_jsonrpc(&mut WorldEngineHandler::new());
}
