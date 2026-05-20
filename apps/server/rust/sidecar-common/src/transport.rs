use crate::protocol::{rpc_error, RpcRequest, RpcResponse, PARSE_ERROR};
use serde_json::json;
use std::io::{self, BufRead, Write};
use std::time::Instant;

pub struct SidecarRuntime {
    started_at: Instant,
}

impl Default for SidecarRuntime {
    fn default() -> Self {
        Self::new()
    }
}

impl SidecarRuntime {
    pub fn new() -> Self {
        Self { started_at: Instant::now() }
    }

    pub fn uptime_ms(&self) -> u128 {
        self.started_at.elapsed().as_millis()
    }
}

pub trait JsonRpcHandler {
    fn protocol_version(&self) -> &'static str;
    fn handle_request(&mut self, runtime: &SidecarRuntime, request: RpcRequest) -> RpcResponse;
}

pub fn run_stdio_jsonrpc<H: JsonRpcHandler>(handler: &mut H) {
    let runtime = SidecarRuntime::new();
    let stdin = io::stdin();
    let mut stdout = io::stdout();

    for line in stdin.lock().lines() {
        let Ok(line) = line else { break };
        if line.trim().is_empty() {
            continue;
        }

        let response = match serde_json::from_str::<RpcRequest>(&line) {
            Ok(req) => handler.handle_request(&runtime, req),
            Err(e) => {
                rpc_error(None, PARSE_ERROR, "parse error", Some(json!({"message": e.to_string()})))
            }
        };

        let payload = serde_json::to_string(&response).expect("failed to serialize response");
        writeln!(stdout, "{payload}").expect("failed to write response");
        stdout.flush().expect("failed to flush stdout");
    }
}
