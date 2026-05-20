mod engine;
mod logic_dsl;
mod models;
mod sampling;
mod source;
mod trigger;

use models::{MemoryTriggerHealthSnapshot, MemoryTriggerSourceEvaluateInput};
use serde_json::{json, Value};
use sidecar_common::protocol::{
    rpc_error, rpc_result, RpcRequest, RpcResponse, INTERNAL_ERROR, INVALID_PARAMS,
    METHOD_NOT_FOUND,
};
use sidecar_common::transport::{run_stdio_jsonrpc, JsonRpcHandler, SidecarRuntime};

struct MemoryTriggerHandler;

impl JsonRpcHandler for MemoryTriggerHandler {
    fn protocol_version(&self) -> &'static str {
        "memory_trigger/v1alpha1"
    }

    fn handle_request(&mut self, runtime: &SidecarRuntime, request: RpcRequest) -> RpcResponse {
        let params = request.params.unwrap_or(Value::Null);
        match request.method.as_str() {
            "memory_trigger.protocol.handshake" => rpc_result(
                request.id,
                json!({
                    "protocol_version": self.protocol_version(),
                    "accepted": true,
                    "transport": "stdio_jsonrpc",
                    "engine_instance_id": "memory-trigger-sidecar",
                    "supported_methods": [
                        "memory_trigger.protocol.handshake",
                        "memory_trigger.health.get",
                        "memory_trigger.source.evaluate"
                    ],
                    "engine_capabilities": [
                        "stdio_jsonrpc",
                        "source_evaluate",
                        "memory_trigger_source_evaluate"
                    ]
                }),
            ),
            "memory_trigger.health.get" => rpc_result(
                request.id,
                serde_json::to_value(MemoryTriggerHealthSnapshot {
                    protocol_version: self.protocol_version(),
                    status: "ready",
                    transport: "stdio_jsonrpc",
                    uptime_ms: runtime.uptime_ms(),
                })
                .unwrap_or_else(|_| {
                    json!({
                        "protocol_version": self.protocol_version(),
                        "status": "ready",
                        "transport": "stdio_jsonrpc",
                        "uptime_ms": runtime.uptime_ms(),
                    })
                }),
            ),
            "memory_trigger.source.evaluate" => {
                let parsed = serde_json::from_value::<MemoryTriggerSourceEvaluateInput>(params);
                match parsed {
                    Ok(input) => match serde_json::to_value(source::evaluate(input)) {
                        Ok(result) => rpc_result(request.id, result),
                        Err(error) => rpc_error(
                            request.id,
                            INTERNAL_ERROR,
                            "failed to serialize memory trigger source result",
                            Some(json!({"cause": error.to_string()})),
                        ),
                    },
                    Err(error) => rpc_error(
                        request.id,
                        INVALID_PARAMS,
                        "invalid memory trigger source evaluate params",
                        Some(json!({"cause": error.to_string()})),
                    ),
                }
            }
            _ => rpc_error(
                request.id,
                METHOD_NOT_FOUND,
                "method not found",
                Some(json!({"method": request.method})),
            ),
        }
    }
}

fn main() {
    run_stdio_jsonrpc(&mut MemoryTriggerHandler);
}
