pub mod engine;
pub mod handlers;
pub mod models;

use handlers::{meta, objective, pack, query, step};
use models::state::AppState;
use serde_json::json;
use sidecar_common::protocol::{rpc_error, RpcRequest, RpcResponse, METHOD_NOT_FOUND};
use sidecar_common::transport::{JsonRpcHandler, SidecarRuntime};

pub struct WorldEngineHandler {
    state: AppState,
}

impl WorldEngineHandler {
    pub fn new() -> Self {
        Self { state: AppState::new() }
    }
}

impl JsonRpcHandler for WorldEngineHandler {
    fn protocol_version(&self) -> &'static str {
        "world_engine/v1alpha1"
    }

    fn handle_request(&mut self, runtime: &SidecarRuntime, request: RpcRequest) -> RpcResponse {
        let params = request.params.clone().unwrap_or_else(|| json!({}));

        match request.method.as_str() {
            "world.protocol.handshake" => meta::handle_handshake(request.id),
            "world.health.get" => meta::handle_health(&self.state, runtime, request.id),
            "world.pack.load" => pack::handle_pack_load(&mut self.state, request.id, &params),
            "world.pack.unload" => pack::handle_pack_unload(&mut self.state, request.id, &params),
            "world.status.get" => pack::handle_status_get(&self.state, request.id, &params),
            "world.state.query" => query::handle_state_query(&self.state, request.id, &params),
            "world.rule.execute_objective" => {
                objective::handle_execute_objective(request.id, &params)
            }
            "world.step.prepare" => step::handle_step_prepare(&mut self.state, request.id, &params),
            "world.step.commit" => step::handle_step_commit(&mut self.state, request.id, &params),
            "world.step.abort" => step::handle_step_abort(&mut self.state, request.id, &params),
            _ => rpc_error(
                request.id,
                METHOD_NOT_FOUND,
                "method not found",
                Some(json!({"method": request.method})),
            ),
        }
    }
}

impl Drop for WorldEngineHandler {
    fn drop(&mut self) {
        for (pack_id, session) in self.state.sessions.iter() {
            if session.pending_prepared_token.is_some() {
                eprintln!(
                    "WARNING: pending prepared state for pack {pack_id} will be discarded on shutdown"
                );
            }
        }
    }
}
