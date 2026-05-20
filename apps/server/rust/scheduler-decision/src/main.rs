mod conversion;
mod kernel;
mod models;
mod policy;

use models::{SchedulerHealthSnapshot, SchedulerKernelEvaluateInput};
use serde_json::{json, Value};
use sidecar_common::protocol::{
    rpc_error, rpc_result, RpcRequest, RpcResponse, INTERNAL_ERROR, INVALID_PARAMS,
    METHOD_NOT_FOUND,
};
use sidecar_common::transport::{run_stdio_jsonrpc, JsonRpcHandler, SidecarRuntime};

struct SchedulerDecisionHandler;

impl JsonRpcHandler for SchedulerDecisionHandler {
    fn protocol_version(&self) -> &'static str {
        "scheduler_decision/v1alpha1"
    }

    fn handle_request(&mut self, runtime: &SidecarRuntime, request: RpcRequest) -> RpcResponse {
        let params = request.params.unwrap_or(Value::Null);
        match request.method.as_str() {
            "scheduler.health.get" => rpc_result(
                request.id,
                serde_json::to_value(SchedulerHealthSnapshot {
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
            "scheduler.kernel.evaluate" => {
                let parsed = serde_json::from_value::<SchedulerKernelEvaluateInput>(params);
                match parsed {
                    Ok(input) => match serde_json::to_value(kernel::evaluate(input)) {
                        Ok(result) => rpc_result(request.id, result),
                        Err(error) => rpc_error(
                            request.id,
                            INTERNAL_ERROR,
                            "failed to serialize scheduler kernel result",
                            Some(json!({"cause": error.to_string()})),
                        ),
                    },
                    Err(error) => rpc_error(
                        request.id,
                        INVALID_PARAMS,
                        "invalid scheduler kernel evaluate params",
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
    run_stdio_jsonrpc(&mut SchedulerDecisionHandler);
}
