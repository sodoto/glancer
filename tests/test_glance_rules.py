"""The structure check mirrors what Glance itself accepts (docs/configuration.md and config.go)."""
from pathlib import Path

import pytest

from app.glance import check, layout_error, list_includes, tree
from app.yamldoc import Document

EXAMPLE = (Path(__file__).parent / "fixtures" / "glance-example.yml").read_text(encoding="utf-8")


@pytest.mark.parametrize("sizes,width", [
    (["full"], None), (["small", "full"], None), (["full", "small"], None), (["full", "full"], None),
    (["small", "full", "small"], None), (["small", "full"], "slim"), (["full", "full"], "slim"),
    (["small", "small", "full"], None),  # unusual, but Glance accepts it
])
def test_layouts_glance_accepts(sizes, width):
    assert layout_error(sizes, width) is None


@pytest.mark.parametrize("sizes,width", [
    ([], None), (["small"], None), (["small", "small"], None), (["full", "full", "full"], None),
    (["small", "full", "small", "full"], None), (["small", "full", "small"], "slim"), (["huge"], None),
])
def test_layouts_glance_refuses(sizes, width):
    assert layout_error(sizes, width)


def test_official_example_is_valid(tmp_path):
    assert check(EXAMPLE, tmp_path / "glance.yml") == ([], [])


def test_errors_are_reported(tmp_path):
    text = """
auth:
  users:
    admin:
      password: abc
pages:
  - name: Home
    width: huge
    columns:
      - size: small
        widgets:
          - type: group
            widgets:
              - type: group
          - type: weather
          - title: no type
          - type: something-new
"""
    errors, warnings = check(text, tmp_path / "glance.yml")
    joined = "\n".join(errors)
    assert "secret-key must be set" in joined
    assert "at least 6 characters" in joined
    assert "width must be default, slim or wide" in joined
    assert "1 or 2 full columns" in joined
    assert "cannot be placed inside a group" in joined
    assert "'location' is required" in joined
    assert "missing type" in joined
    assert any("something-new" in w for w in warnings)


def test_yaml_errors(tmp_path):
    errors, _ = check("pages: [\n", tmp_path / "glance.yml")
    assert errors and errors[0].startswith("YAML error")
    assert check("", tmp_path / "glance.yml")[0] == ["The file is empty"]


def test_includes_are_resolved_like_glance(tmp_path):
    (tmp_path / "home.yml").write_text("- name: Home\n  columns:\n    - size: full\n      widgets:\n        - $include: w.yml\n")
    (tmp_path / "w.yml").write_text("- type: clock\n")
    main = tmp_path / "glance.yml"
    text = "pages:\n  - $include: home.yml\n"
    main.write_text(text)
    assert check(text, main) == ([], [])
    assert [f["name"] for f in list_includes(main)] == ["home.yml", "w.yml"]


def test_include_without_dash_is_refused_like_glance(tmp_path):
    # Glance drops the "- " when it inlines a file, so an included page must start with "- name:"
    (tmp_path / "page.yml").write_text("name: Home\ncolumns:\n  - size: full\n")
    errors, _ = check("pages:\n  - name: A\n    columns:\n      - size: full\n  - $include: page.yml\n", tmp_path / "glance.yml")
    assert errors and "YAML error" in errors[0]


def test_missing_include(tmp_path):
    errors, _ = check("pages:\n  - $include: nope.yml\n", tmp_path / "glance.yml")
    assert errors == ["Included file not found: nope.yml"]


def test_tree_marks_includes_and_groups():
    doc = Document("pages:\n  - $include: home.yml\n  - name: Lab\n    columns:\n      - size: full\n        widgets:\n"
                   "          - $include: rss.yml\n          - type: group\n            widgets:\n              - type: clock\n")
    t = tree(doc)
    assert t["pages"][0]["include"] == "home.yml"
    widgets = t["pages"][1]["columns"][0]["widgets"]
    assert widgets[0] == {"path": ["pages", 1, "columns", 0, "widgets", 0], "include": "rss.yml"}
    assert widgets[1]["children"][0]["type"] == "clock"
    assert widgets[1]["children"][0]["path"] == ["pages", 1, "columns", 0, "widgets", 1, "widgets", 0]
