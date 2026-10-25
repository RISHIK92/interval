import pytest

from interval_db.codegen import (
    Column,
    InvalidNameError,
    UnknownTypeError,
    python_type,
    render,
)


def col(
    name: str,
    udt: str,
    *,
    nullable: bool = False,
    data_type: str = "USER-DEFINED",
    position: int = 1,
    table: str = "t",
) -> Column:
    return Column(
        table=table,
        name=name,
        position=position,
        data_type=data_type,
        udt_name=udt,
        nullable=nullable,
    )


@pytest.mark.parametrize(
    ("udt", "expected"),
    [
        ("text", "str"),
        ("varchar", "str"),
        ("int2", "int"),
        ("int4", "int"),
        ("int8", "int"),
        ("bool", "bool"),
        ("float4", "float"),
        ("float8", "float"),
        ("numeric", "Decimal"),
        ("timestamptz", "datetime"),
        ("timestamp", "datetime"),
        ("date", "date"),
        ("uuid", "UUID"),
        ("json", "JsonValue"),
        ("jsonb", "JsonValue"),
        ("bytea", "bytes"),
    ],
)
def test_maps_postgres_types(udt: str, expected: str) -> None:
    assert python_type(col("c", udt), enums={}) == expected


def test_nullable_column_allows_none() -> None:
    assert python_type(col("c", "text", nullable=True), enums={}) == "str | None"


def test_array_column_maps_to_list_of_element_type() -> None:
    assert python_type(col("c", "_int4", data_type="ARRAY"), enums={}) == "list[int]"


def test_enum_column_maps_to_its_named_alias() -> None:
    assert python_type(col("c", "rights_profile"), enums={"rights_profile": ["a"]}) == (
        "RightsProfile"
    )


def test_render_defines_enum_alias_with_labels_in_order() -> None:
    out = render([col("c", "level")], enums={"level": ["beginner", "advanced"]})
    assert 'type Level = Literal["beginner", "advanced"]' in out
    assert "    c: Level" in out


def test_unknown_type_fails_with_its_name() -> None:
    with pytest.raises(UnknownTypeError, match="tsvector"):
        python_type(col("c", "tsvector"), enums={})


def test_render_sorts_tables_and_keeps_column_order() -> None:
    columns = [
        col("b", "text", data_type="text", position=2, table="zeta"),
        col("a", "text", data_type="text", position=1, table="zeta"),
        col("id", "int4", data_type="integer", position=1, table="alpha"),
    ]
    out = render(columns, enums={})
    assert out.index("class Alpha(TypedDict):") < out.index("class Zeta(TypedDict):")
    assert out.index("    a: str") < out.index("    b: str")
    assert render(list(reversed(columns)), enums={}) == out


def test_render_imports_only_the_names_it_uses() -> None:
    out = render([col("id", "uuid", data_type="uuid")], enums={})
    assert "from uuid import UUID" in out
    assert "Decimal" not in out
    assert "JsonValue" not in out


def test_render_defines_json_alias_when_a_json_column_exists() -> None:
    out = render([col("data", "jsonb", data_type="jsonb")], enums={})
    assert "type JsonValue =" in out


def test_vector_has_no_mapping_until_an_adapter_exists() -> None:
    with pytest.raises(UnknownTypeError, match="vector"):
        python_type(col("embedding", "vector"), enums={})


def test_enum_labels_are_escaped() -> None:
    out = render([col("c", "tone")], enums={"tone": ['say "hi"']})
    assert 'type Tone = Literal["say \\"hi\\""]' in out


def test_array_of_enum_maps_to_list_of_literal() -> None:
    enums = {"level": ["beginner"]}
    column = col("c", "_level", data_type="ARRAY")
    assert python_type(column, enums=enums) == "list[Level]"


def test_enum_label_that_matches_an_import_name_does_not_import_it() -> None:
    out = render([col("c", "kind")], enums={"kind": ["date"]})
    assert "from datetime import date" not in out


@pytest.mark.parametrize("name", ["from", "class", "a-b"])
def test_column_name_that_is_not_an_identifier_fails(name: str) -> None:
    with pytest.raises(InvalidNameError, match=name):
        render([col(name, "text", data_type="text")], enums={})


def test_table_whose_class_name_shadows_a_generated_name_fails() -> None:
    with pytest.raises(InvalidNameError, match="JsonValue"):
        render([col("c", "text", data_type="text", table="json_value")], enums={})


def test_tables_with_colliding_class_names_fail() -> None:
    columns = [
        col("c", "text", data_type="text", table="a_b"),
        col("c", "text", data_type="text", table="a__b"),
    ]
    with pytest.raises(InvalidNameError, match="collides"):
        render(columns, enums={})


def test_empty_schema_renders_no_imports() -> None:
    assert "import" not in render([], enums={})


def test_enum_alias_that_collides_with_a_table_class_fails() -> None:
    columns = [
        col("c", "level", table="t"),
        col("c", "text", data_type="text", table="level"),
    ]
    with pytest.raises(InvalidNameError, match="collides"):
        render(columns, enums={"level": ["a"]})
