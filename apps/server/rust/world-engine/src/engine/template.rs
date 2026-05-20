use serde_json::Value;

pub struct RenderStats {
    pub substitutions: usize,
}

pub fn primitive_to_string(value: &Value) -> Option<String> {
    match value {
        Value::String(inner) => Some(inner.clone()),
        Value::Number(inner) => Some(inner.to_string()),
        Value::Bool(inner) => Some(inner.to_string()),
        _ => None,
    }
}

pub fn resolve_template_path_value(context: &Value, path: &str) -> Option<Value> {
    let mut current = context;

    for part in path.split('.') {
        let object = current.as_object()?;
        current = object.get(part)?;
    }

    Some(current.clone())
}

pub fn render_string_template(template: &str, context: &Value) -> (String, usize) {
    let mut output = String::new();
    let mut remainder = template;
    let mut substitution_count: usize = 0;

    loop {
        let Some(start) = remainder.find("{{") else {
            output.push_str(remainder);
            break;
        };

        output.push_str(&remainder[..start]);
        let after_start = &remainder[start + 2..];
        let Some(end) = after_start.find("}}") else {
            output.push_str(&remainder[start..]);
            break;
        };

        let path = after_start[..end].trim();
        let rendered = resolve_template_path_value(context, path)
            .and_then(|value| primitive_to_string(&value))
            .unwrap_or_default();
        output.push_str(&rendered);
        substitution_count += 1;
        remainder = &after_start[end + 2..];
    }

    (output, substitution_count)
}

fn needs_template(value: &Value) -> bool {
    match value {
        Value::String(s) => s.contains("{{") && s.contains("}}"),
        Value::Array(_) | Value::Object(_) => true,
        _ => false,
    }
}

pub fn render_template_value(value: &Value, context: &Value) -> (Value, RenderStats) {
    if !needs_template(value) {
        return (value.clone(), RenderStats { substitutions: 0 });
    }
    render_template_value_impl(value, context)
}

fn render_template_value_impl(value: &Value, context: &Value) -> (Value, RenderStats) {
    match value {
        Value::String(inner) => {
            if inner.contains("{{") && inner.contains("}}") {
                let (rendered, count) = render_string_template(inner, context);
                (Value::String(rendered), RenderStats { substitutions: count })
            } else {
                (Value::String(inner.clone()), RenderStats { substitutions: 0 })
            }
        }
        Value::Array(items) => {
            let mut total_stats = RenderStats { substitutions: 0 };
            let rendered: Vec<Value> = items
                .iter()
                .map(|item| {
                    let (val, stats) = render_template_value_impl(item, context);
                    total_stats.substitutions += stats.substitutions;
                    val
                })
                .collect();
            (Value::Array(rendered), total_stats)
        }
        Value::Object(map) => {
            let mut total_stats = RenderStats { substitutions: 0 };
            let rendered: serde_json::Map<String, Value> = map
                .iter()
                .map(|(key, val)| {
                    let (val, stats) = render_template_value_impl(val, context);
                    total_stats.substitutions += stats.substitutions;
                    (key.clone(), val)
                })
                .collect();
            (Value::Object(rendered), total_stats)
        }
        _ => (value.clone(), RenderStats { substitutions: 0 }),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn renders_simple_template() {
        let ctx = json!({"name": "World"});
        let (result, stats) = render_template_value(&json!("Hello {{name}}!"), &ctx);
        assert_eq!(result, json!("Hello World!"));
        assert_eq!(stats.substitutions, 1);
    }

    #[test]
    fn renders_nested_path() {
        let ctx = json!({"actor": {"name": "Alice"}});
        let (result, stats) = render_template_value(&json!("{{actor.name}}"), &ctx);
        assert_eq!(result, json!("Alice"));
        assert_eq!(stats.substitutions, 1);
    }

    #[test]
    fn missing_path_becomes_empty() {
        let ctx = json!({});
        let (result, stats) = render_template_value(&json!("Hello {{missing}}!"), &ctx);
        assert_eq!(result, json!("Hello !"));
        assert_eq!(stats.substitutions, 1);
    }

    #[test]
    fn no_template_returns_unchanged() {
        let ctx = json!({"name": "World"});
        let (result, stats) = render_template_value(&json!("No template here"), &ctx);
        assert_eq!(result, json!("No template here"));
        assert_eq!(stats.substitutions, 0);
    }

    #[test]
    fn renders_multiple_substitutions() {
        let ctx = json!({"a": "1", "b": "2"});
        let (result, stats) = render_template_value(&json!("{{a}} and {{b}}"), &ctx);
        assert_eq!(result, json!("1 and 2"));
        assert_eq!(stats.substitutions, 2);
    }

    #[test]
    fn renders_nested_objects() {
        let ctx = json!({"v": "x"});
        let (result, stats) =
            render_template_value(&json!({"key": "{{v}}", "nested": {"inner": "{{v}}"}}), &ctx);
        assert_eq!(result, json!({"key": "x", "nested": {"inner": "x"}}));
        assert_eq!(stats.substitutions, 2);
    }

    #[test]
    fn renders_nested_arrays() {
        let ctx = json!({"v": "x"});
        let (result, stats) = render_template_value(&json!(["{{v}}", "{{v}}"]), &ctx);
        assert_eq!(result, json!(["x", "x"]));
        assert_eq!(stats.substitutions, 2);
    }

    #[test]
    fn fast_path_skips_non_template_values() {
        let ctx = json!({"v": "x"});
        let (result, stats) = render_template_value(&json!(42), &ctx);
        assert_eq!(result, json!(42));
        assert_eq!(stats.substitutions, 0);
    }
}
