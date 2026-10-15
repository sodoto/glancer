"""Round-trip guarantees: loading and saving changes nothing, and an edit changes only what it edits."""
import difflib
from pathlib import Path

import pytest

from app.yamldoc import Document, EditError, safe_plain

FIXTURES = Path(__file__).parent / "fixtures"
EXAMPLE = (FIXTURES / "glance-example.yml").read_text(encoding="utf-8")  # Glance's official docs/glance.yml
HOMELAB = (FIXTURES / "homelab.yml").read_text(encoding="utf-8")  # comments, ${ENV}, $include, anchors...


def changed(before: str, after: str) -> list[str]:
    """The removed (-) and added (+) lines between two texts."""
    return [line for line in difflib.ndiff(before.splitlines(), after.splitlines()) if line[:1] in "+-"]


def edited(text: str, *ops) -> str:
    doc = Document(text)
    for op in ops:
        op(doc)
    return doc.dump()


# ---------------------------------------------------------------- untouched files

@pytest.mark.parametrize("text", [EXAMPLE, HOMELAB], ids=["glance-example", "homelab"])
def test_load_and_dump_is_byte_identical(text):
    doc = Document(text)
    assert doc.reformats() == 0
    assert doc.dump() == text


@pytest.mark.parametrize("text", [
    "pages:\n- name: Home\n  columns:\n  - size: full\n    widgets:\n    - type: clock\n",  # no dash indent
    "pages:\n    -   name: Home\n        columns:\n            -   size: full\n",  # 4 spaces everywhere
    "server:\n    port: 8080\npages:\n  - name: Home\n    columns:\n      - size: full\n",  # 4-space maps
])
def test_other_indentation_styles_survive(text):
    assert Document(text).dump() == text


def test_hand_edited_file_is_fast_and_only_its_odd_lines_change(monkeypatch):
    # A real glance.yml often has a few lines Glancer would write differently. That must not make
    # every request slow (it used to dump the file in 30 styles each time) or change other lines.
    import app.yamldoc as yd
    odd = EXAMPLE.replace("  - name: Home\n", "  - name:   Home\n")
    yd._style_cache.clear()
    dumps = []
    real = yd._dump
    monkeypatch.setattr(yd, "_dump", lambda y, data: dumps.append(1) or real(y, data))
    doc = Document(odd)
    assert doc.style == (2, 4, 2) and len(dumps) <= 4
    assert changed(odd, doc.dump()) == ["-   - name:   Home", "+   - name: Home"]
    draft = doc.dump()
    dumps.clear()
    Document(draft)  # the next request, on the draft: no detection at all
    assert dumps == []


# ---------------------------------------------------------------- the official example

def test_edit_one_value_changes_one_line():
    path = ["pages", 0, "columns", 0, "widgets", 0]
    out = edited(EXAMPLE, lambda d: d.set_value(path, {"type": "calendar", "first-day-of-week": "sunday"}))
    assert out == EXAMPLE.replace("first-day-of-week: monday", "first-day-of-week: sunday")


def test_form_edit_keeps_comments_inside_the_widget():
    path = ["pages", 0, "columns", 2, "widgets", 0]  # weather, with end-of-line and commented-out lines
    doc = Document(EXAMPLE)
    data = safe_plain(doc.get(path))
    data["location"] = "Paris, France"
    doc.set_value(path, data)
    assert changed(EXAMPLE, doc.dump()) == ["-             location: London, United Kingdom",
                                             "+             location: Paris, France"]
    assert '# alternatively "imperial"' in doc.dump()
    assert "# hide-location: true" in doc.dump()


def test_adding_a_key_goes_before_the_blank_line():
    path = ["pages", 0, "columns", 0, "widgets", 0]
    out = edited(EXAMPLE, lambda d: d.set_fields(path, {"title": "Calendar"}, []))
    assert "first-day-of-week: monday\n            title: Calendar\n\n          - type: rss" in out
    assert changed(EXAMPLE, out) == ["+             title: Calendar"]


def test_delete_a_list_item_removes_only_that_item_and_its_comment():
    out = edited(EXAMPLE, lambda d: d.delete(["pages", 0, "columns", 1, "widgets", 1, "channels", 1]))
    assert changed(EXAMPLE, out) == ["-               - UCR-DXc1voovS8nhAvccRZhg # Jeff Geerling"]


def test_delete_a_widget():
    out = edited(EXAMPLE, lambda d: d.delete(["pages", 0, "columns", 0, "widgets", 2]))  # twitch-channels
    removed = changed(EXAMPLE, out)
    assert all(line.startswith("-") for line in removed)
    assert "- type: twitch-channels" in "\n".join(removed)
    assert "twitch" not in out
    assert out.count("\n\n") == EXAMPLE.count("\n\n") - 1  # its blank separator went with it, nothing else


def test_move_widget_to_top_keeps_separators_and_end_comments():
    widgets = ["pages", 0, "columns", 2, "widgets"]
    out = edited(EXAMPLE, lambda d: d.move(widgets + [2], widgets, 0))  # releases to the top
    assert out.index("- type: releases") < out.index("- type: weather")
    # the "# Add more pages here" block stays at the end of the pages list, after the last widget
    assert out.index("name: Microsoft") < out.index("# Add more pages here")
    assert "- syncthing/syncthing\n\n          - type: weather" in out
    assert sorted(EXAMPLE.splitlines()) == sorted(out.splitlines())  # same lines, new order


def test_move_widget_between_columns():
    page = ["pages", 0, "columns"]
    out = edited(EXAMPLE, lambda d: d.move(page + [0, "widgets", 0], page + [2, "widgets"], 3))
    assert out.index("- type: calendar") > out.index("- type: releases")
    assert out.index("- type: calendar") < out.index("# Add more pages here")
    assert sorted(EXAMPLE.splitlines()) == sorted(out.splitlines())


def test_append_widget_at_end_of_column():
    out = edited(EXAMPLE, lambda d: d.insert(["pages", 0, "columns", 2, "widgets"], None, {"type": "clock", "hour-format": "24h"}))
    assert changed(EXAMPLE, out) == ["+           - type: clock", "+             hour-format: 24h", "+ "]
    assert out.index("- type: clock") < out.index("# Add more pages here")


def test_add_page():
    out = edited(EXAMPLE, lambda d: d.insert(["pages"], None, {"name": "Lab", "columns": [{"size": "full"}]}))
    assert out.startswith(EXAMPLE[:EXAMPLE.index("  # Add more pages here")].rstrip("\n"))
    assert "  - name: Lab\n    columns:\n      - size: full\n" in out
    assert out.index("- name: Lab") < out.index("# Add more pages here")


def test_add_page_ending_in_empty_list_keeps_comments():
    # A page ending in `widgets: []` can't carry the comments that followed the list; they stay before it.
    out = edited(EXAMPLE, lambda d: d.insert(["pages"], None, {"name": "Lab", "columns": [{"size": "full", "widgets": []}]}))
    assert out.count("#") == EXAMPLE.count("#")
    assert out.endswith("  - name: Lab\n    columns:\n      - size: full\n        widgets: []\n")
    Document(out)


def test_raw_yaml_round_trip_of_a_widget():
    path = ["pages", 0, "columns", 2, "widgets", 0]
    doc = Document(EXAMPLE)
    raw = doc.node_yaml(path)
    assert raw.startswith("type: weather\nlocation: London, United Kingdom\n")
    assert "\n# Optionally hide the location" in raw  # comments shown at the widget's own indentation
    doc.set_yaml(path, raw)  # applying it unchanged changes nothing
    assert doc.dump() == EXAMPLE
    doc.set_yaml(path, raw.replace("London, United Kingdom", "Oslo, Norway"))
    assert changed(EXAMPLE, doc.dump()) == ["-             location: London, United Kingdom",
                                             "+             location: Oslo, Norway"]


def test_invalid_raw_yaml_is_refused():
    doc = Document(EXAMPLE)
    with pytest.raises(EditError):
        doc.set_yaml(["pages", 0, "columns", 0, "widgets", 0], "type: [unclosed")
    assert doc.dump() == EXAMPLE


# ---------------------------------------------------------------- comments, ${ENV}, $include, anchors

def test_edit_keeps_env_includes_anchors_and_quotes():
    path = ["pages", 2, "columns", 0, "widgets", 2]  # bookmarks
    doc = Document(HOMELAB)
    data = safe_plain(doc.get(path))
    data["groups"][0]["links"].append({"title": "Immich", "url": "https://photos.${DOMAIN}"})
    doc.set_value(path, data)
    out = doc.dump()
    assert changed(HOMELAB, out) == ["+                   - title: Immich", "+                     url: https://photos.${DOMAIN}"]
    for keep in ["port: ${PORT}   # env port", 'host: "0.0.0.0"', "- $include: home.yml", "- !include: other.yml",
                 "- $include: rss.yml", "define: &shared", "<<: *shared", "url: https://jf.${DOMAIN}/   # comment",
                 "icon: 'si:jellyfin'", 'title: "Media"', "gruvbox: {background-color: 0 0 16, primary-color: '43 59 81'}",
                 "url: \\${NOT_AN_ENV}", "alt-status-codes: [401, 403]", "# end of file", "# Top comment"]:
        assert keep in out


def test_anchored_widgets_are_not_offered_as_forms():
    doc = Document(HOMELAB)
    assert safe_plain(doc.get(["pages", 2, "columns", 0, "widgets", 1])) is None  # group with &shared / <<: *shared
    assert safe_plain(doc.get(["pages", 2, "columns", 0, "widgets", 2])) is not None


def test_moving_an_include_line():
    out = edited(HOMELAB, lambda d: d.move(["pages", 0], ["pages"], 2))
    assert out.index("- !include: other.yml") < out.index("- name: Homelab") < out.index("- $include: home.yml")
    assert out.index("- $include: home.yml") < out.index("# end of file")
    nonblank = lambda t: sorted(line for line in t.splitlines() if line.strip())  # noqa: E731
    assert nonblank(HOMELAB) == nonblank(out)


def test_editing_theme_section_raw():
    doc = Document(HOMELAB)
    raw = doc.node_yaml(["theme"])
    assert raw.startswith("# Catppuccin-ish\nbackground-color: 240 8 9\n") or raw.startswith("background-color")
    doc.set_yaml(["theme"], raw.replace("240 8 9", "220 10 10"))
    assert changed(HOMELAB, doc.dump()) == ["-   background-color: 240 8 9", "+   background-color: 220 10 10"]


def test_add_new_top_level_section():
    doc = Document(HOMELAB)
    doc.set_yaml(["branding"], "hide-footer: true\n# my logo\nlogo-text: G\n")
    out = doc.dump()
    assert "branding:\n  hide-footer: true\n  # my logo\n  logo-text: G\n" in out
    assert out.startswith(HOMELAB.rstrip("\n").rsplit("\n", 1)[0][:200])


def test_empty_flow_list_becomes_block_list_when_filled():
    text = "pages:\n  - name: A\n    columns:\n      - size: full\n        widgets: []\n"
    out = edited(text, lambda d: d.insert(["pages", 0, "columns", 0, "widgets"], None, {"type": "clock"}))
    assert out == "pages:\n  - name: A\n    columns:\n      - size: full\n        widgets:\n          - type: clock\n"


def test_head_widgets_added_then_removed():
    # Regression: "+ Head widget" then deleting it left `head-widgets:` + a stray `[]` and broke the YAML.
    src = "pages:\n  - name: Home\n    columns:\n      - size: full\n        widgets:\n          - type: clock\n\n  - name: B\n    columns:\n      - size: full\n"
    doc = Document(src)
    path = doc.insert(["pages", 0, "head-widgets"], None, {"type": "search"})
    added = doc.dump()
    assert added == src.replace("          - type: clock\n\n", "          - type: clock\n    head-widgets:\n      - type: search\n\n")
    doc = Document(added)
    doc.delete(path)
    Document(doc.dump())  # still valid YAML
    doc.delete(["pages", 0, "head-widgets"])
    # back to the original, except the blank line between the pages that went with the deleted widget
    assert doc.dump() == src.replace("          - type: clock\n\n", "          - type: clock\n")


def test_put_widgets_in_a_new_group():
    col = ["pages", 0, "columns", 2, "widgets"]
    doc = Document(EXAMPLE)
    group = doc.wrap_in_group(col + [0])  # weather
    assert doc.move(col + [1], group + ["widgets"], None) == group + ["widgets", 1]  # markets as a second tab
    out = doc.dump()
    # the widgets moved two levels deeper, comments included; everything outside them is unchanged
    assert ("          - type: group\n            widgets:\n              - type: weather\n"
            "                location: London, United Kingdom\n                units: metric # alternatively \"imperial\"\n"
            "                hour-format: 12h # alternatively \"24h\"\n"
            "                # Optionally hide the location from being displayed in the widget\n") in out
    assert "              - type: markets\n                markets:\n                  - symbol: SPY\n" in out
    assert out.endswith(EXAMPLE[EXAMPLE.index("          - type: releases"):])
    assert out.startswith(EXAMPLE[:EXAMPLE.index("          - type: weather")])
    Document(out)


def test_move_to_new_head_widgets_keeps_end_comments():
    col = ["pages", 0, "columns", 2, "widgets"]
    doc = Document(EXAMPLE)
    assert doc.move(col + [2], ["pages", 0, "head-widgets"], None) == ["pages", 0, "head-widgets", 0]
    out = doc.dump()
    assert "    head-widgets:\n      - type: releases\n        cache: 1d\n        # Without authentication" in out
    assert out.endswith(EXAMPLE[EXAMPLE.index("\n  # Add more pages here"):])  # still indented as before
    Document(out)


def test_move_out_of_a_group():
    col = ["pages", 0, "columns", 1, "widgets"]
    doc = Document(EXAMPLE)
    assert doc.move(col + [0, "widgets", 1], col, None) == col + [3]  # lobsters out of the first group
    out = doc.dump()
    assert "              - type: hacker-news\n\n" in out
    assert out.index("- type: lobsters") > out.index("subreddit: selfhosted")
    Document(out)


def _lists(node, path=()):
    """Every block list of mappings in the document (where widgets, columns and pages live)."""
    from ruamel.yaml.comments import CommentedMap, CommentedSeq
    if isinstance(node, CommentedSeq) and node and all(isinstance(x, CommentedMap) for x in node):
        yield list(path)
    items = node.items() if isinstance(node, CommentedMap) else enumerate(node) if isinstance(node, CommentedSeq) else []
    for k, v in items:
        yield from _lists(v, path + (k,))


@pytest.mark.parametrize("text", [EXAMPLE, HOMELAB], ids=["glance-example", "homelab"])
def test_every_list_survives_add_delete_and_move(text):
    """Add, delete and move items in every list and check the result always parses and round-trips."""
    def valid(out):
        again = Document(out)
        assert again.dump() == out
        return out
    for lst in _lists(Document(text).data):
        n = len(Document(text).get(lst))
        for index in (0, None):
            doc = Document(text)
            p = doc.insert(lst, index, {"type": "group", "widgets": []})
            doc = Document(valid(doc.dump()))
            doc.insert(p + ["widgets"], None, {"type": "clock"})
            doc = Document(valid(doc.dump()))
            doc.delete(p + ["widgets", 0])
            doc = Document(valid(doc.dump()))
            doc.delete(p)
            valid(doc.dump())
        for i in range(n):
            doc = Document(text)
            doc.delete(lst + [i])
            valid(doc.dump())
            for to in (0, n - 1):
                doc = Document(text)
                doc.move(lst + [i], lst, to)
                valid(doc.dump())
        doc = Document(text)
        for _ in range(n):
            doc.delete(lst + [0])
        valid(doc.dump())


def test_bad_paths_raise():
    doc = Document(EXAMPLE)
    with pytest.raises(EditError):
        doc.delete(["pages", 7])
    with pytest.raises(EditError):
        doc.move(["pages", 0, "columns", 0], ["pages", 0, "columns", 0, "widgets"], 0)  # into itself
