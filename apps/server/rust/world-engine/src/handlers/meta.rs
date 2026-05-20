use crate::models::state::AppState;
use serde_json::{json, Value};
use sidecar_common::protocol::{rpc_result, RpcResponse};
use sidecar_common::transport::SidecarRuntime;

const PROTOCOL_VERSION: &str = "world_engine/v1alpha1";

pub fn handle_handshake(request_id: Option<Value>) -> RpcResponse {
    rpc_result(
        request_id,
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
    )
}

pub fn handle_health(
    state: &AppState,
    runtime: &SidecarRuntime,
    request_id: Option<Value>,
) -> RpcResponse {
    let loaded_pack_ids: Vec<String> = state.sessions.keys().cloned().collect();
    rpc_result(
        request_id,
        json!({
            "protocol_version": PROTOCOL_VERSION,
            "transport": "stdio_jsonrpc",
            "engine_status": "ready",
            "engine_instance_id": "world-engine-sidecar",
            "uptime_ms": runtime.uptime_ms(),
            "loaded_pack_ids": loaded_pack_ids,
            "tainted_pack_ids": [],
            "last_error_code": null,
            "message": "World engine sidecar ready"
        }),
    )
}
