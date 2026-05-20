use crate::engine::query::{
    get_limit, get_selector_string, query_authority_grants, query_entity_state,
    query_mediator_bindings, query_pack_summary, query_rule_execution_summary,
    query_world_entities,
};
use crate::models::state::AppState;
use serde_json::{json, Value};
use sidecar_common::protocol::{rpc_error, rpc_result, RpcResponse, INVALID_PARAMS};

const PROTOCOL_VERSION: &str = "world_engine/v1alpha1";

fn get_required_string<'a>(params: &'a Value, key: &str) -> Result<&'a str, String> {
    params
        .get(key)
        .and_then(Value::as_str)
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| format!("missing required string field: {key}"))
}

pub fn handle_state_query(
    state: &AppState,
    request_id: Option<Value>,
    params: &Value,
) -> RpcResponse {
    let pack_id = match get_required_string(params, "pack_id") {
        Ok(v) => v.to_string(),
        Err(msg) => return rpc_error(request_id, INVALID_PARAMS, &msg, None),
    };
    let query_name = match get_required_string(params, "query_name") {
        Ok(v) => v.to_string(),
        Err(msg) => return rpc_error(request_id, INVALID_PARAMS, &msg, None),
    };
    let session = match state.sessions.get(&pack_id) {
        Some(s) => s,
        None => {
            return rpc_error(
                request_id,
                40401,
                "PACK_NOT_LOADED",
                Some(json!({"pack_id": pack_id})),
            )
        }
    };

    let selector = params.get("selector").unwrap_or(&Value::Null);
    let limit = get_limit(params);

    let data = match query_name.as_str() {
        "pack_summary" => query_pack_summary(session, &pack_id),
        "world_entities" => query_world_entities(session, selector, limit),
        "entity_state" => {
            let entity_id = match get_selector_string(params, "entity_id") {
                Some(v) => v,
                None => {
                    return rpc_error(
                        request_id,
                        INVALID_PARAMS,
                        "INVALID_QUERY",
                        Some(json!({"pack_id": pack_id, "reason": "entity_id is required"})),
                    )
                }
            };
            let state_namespace = match get_selector_string(params, "state_namespace") {
                Some(v) => v,
                None => {
                    return rpc_error(
                        request_id,
                        INVALID_PARAMS,
                        "INVALID_QUERY",
                        Some(json!({"pack_id": pack_id, "reason": "state_namespace is required"})),
                    )
                }
            };
            query_entity_state(session, &entity_id, &state_namespace)
        }
        "authority_grants" => query_authority_grants(session, selector, limit),
        "mediator_bindings" => query_mediator_bindings(session, selector, limit),
        "rule_execution_summary" => query_rule_execution_summary(session, selector, limit),
        _ => {
            return rpc_error(
                request_id,
                INVALID_PARAMS,
                "INVALID_QUERY",
                Some(json!({"pack_id": pack_id, "query_name": query_name})),
            )
        }
    };

    rpc_result(
        request_id,
        json!({
            "protocol_version": PROTOCOL_VERSION,
            "pack_id": pack_id,
            "query_name": query_name,
            "current_tick": session.current_tick,
            "current_revision": session.current_revision,
            "data": data,
            "next_cursor": null,
            "warnings": []
        }),
    )
}
