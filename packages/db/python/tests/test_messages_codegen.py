"""Queue message contracts (ADR-0010 item 1): JSON Schema in, pydantic and zod out."""

import json
from pathlib import Path
from typing import Any

import pytest
from pydantic import BaseModel, ValidationError

from interval_db.messages_codegen import UnsupportedSchemaError, load, render

MESSAGES_DIR = Path(__file__).resolve().parents[2] / "messages"

SCHEMA: dict[str, Any] = {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "description": "Poll one source for new items.",
    "type": "object",
    "additionalProperties": False,
    "required": ["source_id", "url", "mode"],
    "properties": {
        "source_id": {"type": "integer", "minimum": 1},
        "url": {"type": "string", "format": "uri"},
        "mode": {"enum": ["full", "quick"]},
        "note": {"type": "string", "minLength": 1},
        "force": {"type": "boolean"},
    },
}


def models(schemas: dict[str, dict[str, Any]]) -> dict[str, type[BaseModel]]:
    _, python = render(schemas)
    namespace: dict[str, Any] = {}
    exec(compile(python, "<generated>", "exec"), namespace)
    messages: dict[str, type[BaseModel]] = namespace["MESSAGES"]
    return messages


def test_the_generated_model_accepts_valid_messages_and_rejects_the_rest() -> None:
    model = models({"poll_source": SCHEMA})["poll_source"]
    good = {"source_id": 3, "url": "https://example.test/feed", "mode": "full"}
    assert (
        model.model_validate_json(json.dumps(good)).model_dump(exclude_none=True)
        == good
    )
    for bad in (
        {**good, "source_id": 0},
        {**good, "mode": "slow"},
        {**good, "extra": 1},
        {**good, "note": ""},
        {**good, "source_id": "3"},
        {k: v for k, v in good.items() if k != "url"},
    ):
        with pytest.raises(ValidationError):
            model.model_validate_json(json.dumps(bad))


def test_typescript_gets_a_zod_schema_per_message() -> None:
    typescript, _ = render({"poll_source": SCHEMA})
    assert "poll_source: z.strictObject({" in typescript
    assert "source_id: z.number().int().min(1)" in typescript
    assert 'mode: z.enum(["full", "quick"])' in typescript
    assert "note: z.string().min(1).optional()" in typescript
    assert "export type MessageName = keyof typeof messageSchemas;" in typescript


@pytest.mark.parametrize(
    ("change", "fragment"),
    [
        ({"additionalProperties": True}, "additionalProperties"),
        ({"type": "array"}, "type"),
        ({"properties": {"x": {"type": "number"}}, "required": []}, "x"),
        (
            {
                "properties": {"x": {"type": "string", "format": "email"}},
                "required": [],
            },
            "x",
        ),
        ({"required": ["missing"]}, "missing"),
        ({"oneOf": [{"required": ["url"]}]}, "oneOf"),
        (
            {"properties": {"model_config": {"type": "boolean"}}, "required": []},
            "model_config",
        ),
        (
            {"properties": {"source-id": {"type": "boolean"}}, "required": []},
            "source-id",
        ),
        ({"properties": {"x": {"type": ["string", "null"]}}, "required": []}, "x"),
        ({"properties": {"x": {"enum": []}}, "required": []}, "x"),
        ({"description": "two\nlines"}, "description"),
    ],
)
def test_a_schema_outside_the_supported_subset_is_refused(
    change: dict[str, Any], fragment: str
) -> None:
    with pytest.raises(UnsupportedSchemaError, match=fragment):
        render({"poll_source": {**SCHEMA, **change}})


def test_message_names_are_snake_case() -> None:
    with pytest.raises(UnsupportedSchemaError, match="snake_case"):
        render({"Poll-Source": SCHEMA})


def test_the_repo_messages_load_and_render() -> None:
    schemas = load(MESSAGES_DIR)
    assert "discover_source" in schemas
    assert "discover_source" in models(schemas)


def test_uri_fields_accept_only_http_and_https() -> None:
    model = models({"poll_source": SCHEMA})["poll_source"]
    base = {"source_id": 3, "mode": "full"}
    for bad in ("javascript:alert(1)", "file:///etc/passwd", "foo:bar"):
        with pytest.raises(ValidationError):
            model.model_validate_json(json.dumps({**base, "url": bad}))
    typescript, _ = render({"poll_source": SCHEMA})
    assert "url: z.url({ protocol: /^https?$/ })" in typescript
