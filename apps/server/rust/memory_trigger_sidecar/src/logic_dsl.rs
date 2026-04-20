use crate::models::MemoryLogicExprDto;
use serde_json::Value;

fn is_record(value: &Value) -> bool {
    value.is_object()
}

fn get_path_values(root: &Value, path: &str) -> Vec<Value> {
    if path.trim().is_empty() {
        return Vec::new();
    }

    let segments = path
        .split('.')
        .map(|segment| segment.trim())
        .filter(|segment| !segment.is_empty())
        .collect::<Vec<_>>();

    if segments.is_empty() {
        return Vec::new();
    }

    let mut current = vec![root.clone()];
    for segment in segments {
        let mut next = Vec::new();

        for value in &current {
            if segment == "*" {
                if let Some(array) = value.as_array() {
                    next.extend(array.iter().cloned());
                } else if let Some(object) = value.as_object() {
                    next.extend(object.values().cloned());
                }
                continue;
            }

            if let Some(array) = value.as_array() {
                if segment.chars().all(|char| char.is_ascii_digit()) {
                    if let Ok(index) = segment.parse::<usize>() {
                        if let Some(item) = array.get(index) {
                            next.push(item.clone());
                        }
                    }
                } else {
                    for item in array {
                        if let Some(object) = item.as_object() {
                            if let Some(field) = object.get(segment) {
                                next.push(field.clone());
                            }
                        }
                    }
                }
                continue;
            }

            if is_record(value) {
                if let Some(field) = value.as_object().and_then(|object| object.get(segment)) {
                    next.push(field.clone());
                }
            }
        }

        current = next;
        if current.is_empty() {
            return Vec::new();
        }
    }

    current
}

fn to_comparable_string(value: &Value) -> String {
    match value {
        Value::String(inner) => inner.clone(),
        Value::Number(inner) => inner.to_string(),
        Value::Bool(inner) => inner.to_string(),
        Value::Null => "null".to_string(),
        _ => value.to_string(),
    }
}

fn matches_eq(actual: &Value, expected: &Value) -> bool {
    to_comparable_string(actual) == to_comparable_string(expected)
}

fn matches_in(actual: &Value, values: &[Value]) -> bool {
    values.iter().any(|candidate| matches_eq(actual, candidate))
}

fn to_number(value: &Value) -> Option<f64> {
    match value {
        Value::Number(inner) => inner.as_f64(),
        Value::String(inner) => inner.trim().parse::<f64>().ok(),
        _ => None,
    }
}

fn evaluate_leaf(expr: &MemoryLogicExprDto, root: &Value) -> bool {
    match expr {
        MemoryLogicExprDto::Eq { path, value } => get_path_values(root, path)
            .iter()
            .any(|actual| matches_eq(actual, value)),
        MemoryLogicExprDto::In { path, values } => get_path_values(root, path)
            .iter()
            .any(|actual| matches_in(actual, values)),
        MemoryLogicExprDto::Gt { path, value } => get_path_values(root, path).iter().any(|actual| {
            to_number(actual)
                .map(|candidate| candidate > *value)
                .unwrap_or(false)
        }),
        MemoryLogicExprDto::Lt { path, value } => get_path_values(root, path).iter().any(|actual| {
            to_number(actual)
                .map(|candidate| candidate < *value)
                .unwrap_or(false)
        }),
        MemoryLogicExprDto::Contains { path, value } => get_path_values(root, path).iter().any(|actual| {
            if let Some(inner) = actual.as_str() {
                return inner.contains(value);
            }

            if let Some(array) = actual.as_array() {
                return array
                    .iter()
                    .any(|item| to_comparable_string(item).contains(value));
            }

            false
        }),
        MemoryLogicExprDto::Exists { path } => !get_path_values(root, path).is_empty(),
        MemoryLogicExprDto::And { .. } | MemoryLogicExprDto::Or { .. } | MemoryLogicExprDto::Not { .. } => false,
    }
}

pub fn evaluate_memory_logic_expr(expr: &MemoryLogicExprDto, root: &Value) -> bool {
    match expr {
        MemoryLogicExprDto::And { items } => items.iter().all(|item| evaluate_memory_logic_expr(item, root)),
        MemoryLogicExprDto::Or { items } => items.iter().any(|item| evaluate_memory_logic_expr(item, root)),
        MemoryLogicExprDto::Not { item } => !evaluate_memory_logic_expr(item, root),
        _ => evaluate_leaf(expr, root),
    }
}

#[allow(dead_code)]
pub fn debug_resolve_memory_logic_path(root: &Value, path: &str) -> Vec<Value> {
    get_path_values(root, path)
}

#[cfg(test)]
mod tests {
    use super::{debug_resolve_memory_logic_path, evaluate_memory_logic_expr};
    use crate::models::MemoryLogicExprDto;
    use serde_json::json;

    #[test]
    fn resolves_wildcard_paths() {
        let root = json!({
            "recent": {
                "trace": [
                    { "payload": { "reasoning": "first" } },
                    { "payload": { "reasoning": "second" } }
                ]
            }
        });

        let values = debug_resolve_memory_logic_path(&root, "recent.trace.*.payload.reasoning");
        assert_eq!(values, vec![json!("first"), json!("second")]);
    }

    #[test]
    fn evaluates_and_or_not() {
        let root = json!({
            "pack_state": {
                "world_state": {
                    "investigation_heat": 2
                },
                "actor_state": {
                    "murderous_intent": true
                }
            }
        });

        let expr = MemoryLogicExprDto::And {
            items: vec![
                MemoryLogicExprDto::Gt {
                    path: "pack_state.world_state.investigation_heat".to_string(),
                    value: 1.0,
                },
                MemoryLogicExprDto::Not {
                    item: Box::new(MemoryLogicExprDto::Eq {
                        path: "pack_state.actor_state.murderous_intent".to_string(),
                        value: json!(false),
                    }),
                },
            ],
        };

        assert!(evaluate_memory_logic_expr(&expr, &root));
    }

    #[test]
    fn evaluates_contains_and_exists() {
        let root = json!({
            "recent": {
                "event": [
                    { "payload": { "title": "suspicious death" } }
                ]
            }
        });

        let contains_expr = MemoryLogicExprDto::Contains {
            path: "recent.event.0.payload.title".to_string(),
            value: "death".to_string(),
        };
        let exists_expr = MemoryLogicExprDto::Exists {
            path: "recent.event.0.payload.title".to_string(),
        };

        assert!(evaluate_memory_logic_expr(&contains_expr, &root));
        assert!(evaluate_memory_logic_expr(&exists_expr, &root));
    }
}
