mod kernel;
mod models;
mod policy;
mod protocol;

use models::{SchedulerHealthSnapshot, SchedulerKernelEvaluateInput};
use protocol::{rpc_error, rpc_result, RpcRequest, RpcResponse};
use serde_json::{json, Value};
use std::io::{self, BufRead, Write};
use std::time::Instant;

const PROTOCOL_VERSION: &str = "scheduler_decision/v1alpha1";

struct AppState {
    started_at: Instant,
}

impl AppState {
    fn new() -> Self {
        Self {
            started_at: Instant::now(),
        }
    }
}

fn handle_request(state: &AppState, request: RpcRequest) -> RpcResponse {
    let params = request.params.unwrap_or(Value::Null);
    match request.method.as_str() {
        "scheduler.health.get" => rpc_result(
            request.id,
            serde_json::to_value(SchedulerHealthSnapshot {
                protocol_version: PROTOCOL_VERSION,
                status: "ready",
                transport: "stdio_jsonrpc",
                uptime_ms: state.started_at.elapsed().as_millis(),
            })
            .unwrap_or_else(|_| json!({
                "protocol_version": PROTOCOL_VERSION,
                "status": "ready",
                "transport": "stdio_jsonrpc",
                "uptime_ms": state.started_at.elapsed().as_millis(),
            })),
        ),
        "scheduler.kernel.evaluate" => {
            let parsed = serde_json::from_value::<SchedulerKernelEvaluateInput>(params);
            match parsed {
                Ok(input) => match serde_json::to_value(kernel::evaluate(input)) {
                    Ok(result) => rpc_result(request.id, result),
                    Err(error) => rpc_error(
                        request.id,
                        -32603,
                        "failed to serialize scheduler kernel result",
                        Some(json!({ "cause": error.to_string() })),
                    ),
                },
                Err(error) => rpc_error(
                    request.id,
                    -32602,
                    "invalid scheduler kernel evaluate params",
                    Some(json!({ "cause": error.to_string() })),
                ),
            }
        }
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
        let Ok(line) = line else {
            break;
        };
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }

        let response = match serde_json::from_str::<RpcRequest>(trimmed) {
            Ok(request) => handle_request(&state, request),
            Err(error) => rpc_error(
                None,
                -32700,
                "parse error",
                Some(json!({ "cause": error.to_string() })),
            ),
        };

        if let Ok(encoded) = serde_json::to_string(&response) {
            let _ = writeln!(stdout, "{}", encoded);
            let _ = stdout.flush();
        }
    }

    let _ = &mut state;
}
