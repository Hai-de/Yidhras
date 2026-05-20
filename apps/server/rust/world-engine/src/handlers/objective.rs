use crate::engine::objective::{self, ExecuteObjectiveInput};
use serde_json::{json, Value};
use sidecar_common::protocol::{rpc_error, rpc_result, RpcResponse, INVALID_PARAMS};

fn get_required_string<'a>(params: &'a Value, key: &str) -> Result<&'a str, String> {
    params
        .get(key)
        .and_then(Value::as_str)
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| format!("missing required string field: {key}"))
}

pub fn handle_execute_objective(request_id: Option<Value>, params: &Value) -> RpcResponse {
    let pack_id = match get_required_string(params, "pack_id") {
        Ok(v) => v.to_string(),
        Err(msg) => return rpc_error(request_id, INVALID_PARAMS, &msg, None),
    };

    let input = ExecuteObjectiveInput {
        pack_id,
        invocation: params.get("invocation").cloned().unwrap_or_else(|| json!({})),
        effective_mediator_id: params
            .get("effective_mediator_id")
            .and_then(Value::as_str)
            .map(|v| v.to_string()),
        objective_rules: params
            .get("objective_rules")
            .and_then(Value::as_array)
            .cloned()
            .unwrap_or_default(),
        world_entities: params
            .get("world_entities")
            .and_then(Value::as_array)
            .cloned()
            .unwrap_or_default(),
        pack_variables: params.get("pack_variables").cloned(),
    };

    match objective::execute(input) {
        Ok(result) => rpc_result(request_id, serde_json::to_value(result).unwrap()),
        Err(diag) => rpc_error(
            request_id,
            50001,
            "OBJECTIVE_RULE_NOT_FOUND",
            Some(serde_json::to_value(diag).unwrap()),
        ),
    }
}
