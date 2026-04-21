mod models;
mod objective;
mod protocol;
mod session;
mod state;
mod step;
mod template;

use models::AppState;
use objective::handle_execute_objective;
use protocol::{rpc_error, rpc_result, RpcRequest, RpcResponse};
use serde_json::json;
use session::{handle_pack_load, handle_pack_unload, handle_state_query, handle_status_get};
use std::io::{self, BufRead, Write};
use step::{handle_step_abort, handle_step_commit, handle_step_prepare};

const PROTOCOL_VERSION: &str = "world_engine/v1alpha1";

fn handle_request(state: &mut AppState, request: RpcRequest) -> RpcResponse {
    let params = request.params.clone().unwrap_or_else(|| json!({}));

    match request.method.as_str() {
        "world.protocol.handshake" => rpc_result(
            request.id,
            json!({
                "protocol_version": PROTOCOL_VERSION,
                "accepted": true,
                "transport": "stdio_jsonrpc",
                "engine_instance_id": "world-engine-sidecar",
                "supported_methods": [
                    "world.protocol.handshake",
                    "world.health.get",
                    "world.pack.load",
                    "world.pack.unload",
                    "world.state.query",
                    "world.rule.execute_objective",
                    "world.status.get",
                    "world.step.prepare",
                    "world.step.commit",
                    "world.step.abort"
                ],
                "engine_capabilities": ["stdio_jsonrpc", "objective_rule_execution"]
            }),
        ),
        "world.health.get" => {
            let loaded_pack_ids: Vec<String> = state.sessions.keys().cloned().collect();
            rpc_result(
                request.id,
                json!({
                    "protocol_version": PROTOCOL_VERSION,
                    "transport": "stdio_jsonrpc",
                    "engine_status": "ready",
                    "engine_instance_id": "world-engine-sidecar",
                    "uptime_ms": state.started_at.elapsed().as_millis() as u64,
                    "loaded_pack_ids": loaded_pack_ids,
                    "tainted_pack_ids": [],
                    "last_error_code": null,
                    "message": "World engine sidecar ready"
                }),
            )
        }
        "world.pack.load" => handle_pack_load(state, request.id, &params),
        "world.pack.unload" => handle_pack_unload(state, request.id, &params),
        "world.status.get" => handle_status_get(state, request.id, &params),
        "world.state.query" => handle_state_query(state, request.id, &params),
        "world.rule.execute_objective" => handle_execute_objective(request.id, &params),
        "world.step.prepare" => handle_step_prepare(state, request.id, &params),
        "world.step.commit" => handle_step_commit(state, request.id, &params),
        "world.step.abort" => handle_step_abort(state, request.id, &params),
        _ => rpc_error(
            request.id,
            -32601,
            "method not found",
            Some(json!({ "method": request.method })),
        ),
    }
}

fn main() {
    let stdin = io::stdin();
    let mut stdout = io::stdout();
    let mut state = AppState::new();

    for line in stdin.lock().lines() {
        let line = match line {
            Ok(value) => value,
            Err(_) => break,
        };

        if line.trim().is_empty() {
            continue;
        }

        let response = match serde_json::from_str::<RpcRequest>(&line) {
            Ok(request) => handle_request(&mut state, request),
            Err(error) => rpc_error(
                None,
                -32700,
                "parse error",
                Some(json!({ "message": error.to_string() })),
            ),
        };

        let payload = serde_json::to_string(&response).expect("response serialization");
        writeln!(stdout, "{}", payload).expect("write response");
        stdout.flush().expect("flush response");
    }
}
