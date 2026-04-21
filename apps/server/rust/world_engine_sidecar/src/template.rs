use serde_json::Value;

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

pub fn render_string_template(template: &str, context: &Value) -> String {
    let mut output = String::new();
    let mut remainder = template;

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
        remainder = &after_start[end + 2..];
    }

    output
}

pub fn render_template_value(value: &Value, context: &Value) -> Value {
    match value {
        Value::String(inner) => {
            if inner.contains("{{") && inner.contains("}}") {
                Value::String(render_string_template(inner, context))
            } else {
                Value::String(inner.clone())
            }
        }
        Value::Array(items) => Value::Array(
            items
                .iter()
                .map(|item| render_template_value(item, context))
                .collect(),
        ),
        Value::Object(map) => Value::Object(
            map.iter()
                .map(|(key, item)| (key.clone(), render_template_value(item, context)))
                .collect(),
        ),
        _ => value.clone(),
    }
}
