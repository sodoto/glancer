"""Round-trip editing of glance.yml with ruamel.yaml.

Everything the user did not touch keeps its comments, key order, quoting, ${ENV} placeholders
and $include lines. Edits are expressed as small operations on a path into the document.
"""
import copy
import hashlib
import io
import re
from collections import Counter, OrderedDict
from datetime import date, datetime

from ruamel.yaml import YAML
from ruamel.yaml.comments import CommentedMap, CommentedSeq, TaggedScalar
from ruamel.yaml.error import CommentMark, YAMLError
from ruamel.yaml.tokens import CommentToken

# Indentation styles (mapping indent, list item indent, dash offset), most common first. The style is
# read from the file; these are only tried when that guess doesn't reproduce it exactly.
STYLES = [(2, 4, 2), (2, 2, 0), (4, 4, 2)]
INCLUDE_KEY = "$include"


class EditError(ValueError):
    """An operation that cannot be applied (bad path, invalid YAML, broken column layout...)."""


def _yaml(style=(2, 4, 2)) -> YAML:
    y = YAML()
    y.preserve_quotes = True
    y.width = 4096  # never re-wrap long lines
    mapping, sequence, offset = style
    y.indent(mapping=mapping, sequence=sequence, offset=offset)
    return y


def _dump(y: YAML, data) -> str:
    out = io.StringIO()
    y.dump(data, out)
    return out.getvalue()


def _parse(y: YAML, text: str):
    try:
        return y.load(text)
    except YAMLError as exc:
        raise EditError(f"YAML error: {exc}") from None


class Document:
    """A parsed glance.yml plus the indentation style that reproduces it."""

    def __init__(self, text: str):
        self.text = text
        # Indentation doesn't change how YAML is read, so one parse serves every style.
        self.data = _parse(_yaml(), text) if text.strip() else CommentedMap()
        if self.data is None:
            self.data = CommentedMap()
        if not isinstance(self.data, CommentedMap):
            raise EditError("The top level of glance.yml must be a mapping (server:, pages:, ...)")
        self.style = _style_for(text, self.data)
        self.yaml = _yaml(self.style)

    def dump(self) -> str:
        out = _dump(self.yaml, self.data)
        _remember_style(out, self.style)  # the next request with this text skips detection
        return out

    def reformats(self) -> int:
        """How many lines would be written differently than they are now (before any edit)."""
        if not self.text.strip():
            return 0
        out = _dump(self.yaml, self.data)
        if out == self.text:
            return 0
        import difflib
        ops = difflib.SequenceMatcher(None, self.text.splitlines(), out.splitlines(), autojunk=False).get_opcodes()
        return sum(max(i2 - i1, j2 - j1) for tag, i1, i2, j1, j2 in ops if tag != "equal")

    # ------------------------------------------------------------ paths

    def get(self, path: list):
        node = self.data
        for key in path:
            node = _child(node, key)
        return node

    def parent(self, path: list):
        if not path:
            raise EditError("Cannot change the whole document this way")
        return self.get(path[:-1]), path[-1]

    # ------------------------------------------------------------ node <-> text

    def node_yaml(self, path: list) -> str:
        """The YAML of one node, dedented to column 0, for the raw editor."""
        node = self.get(path)
        if not isinstance(node, (CommentedMap, CommentedSeq)):
            return _dump(self.yaml, node).removesuffix("...\n")
        clone = copy.deepcopy(node)
        _set_outer_tail(clone, "")
        _shift_comments(clone, -self._depth(path))
        return _dump(self.yaml, clone)

    def parse_node(self, text: str):
        if not text.strip():
            raise EditError("The YAML is empty")
        return _parse(self.yaml, text)

    def _depth(self, path: list) -> int:
        """Column of a node's content when ruamel dumps it (used for nodes without position info)."""
        col, node = 0, self.data
        for key in path:
            child = _child(node, key)
            col += self._step(node, child)
            node = child
        return col

    def _step(self, parent, child) -> int:
        mapping, sequence, offset = self.style
        if isinstance(parent, CommentedMap):
            return offset if isinstance(child, CommentedSeq) else mapping  # a list's column is its dash
        return sequence - offset  # a list item's content, after "- "

    # ------------------------------------------------------------ operations

    def set_yaml(self, path: list, text: str) -> None:
        new = self.parse_node(text)
        if path:
            parent = self.get(path[:-1])
            if isinstance(parent, CommentedMap) and path[-1] not in parent:
                _shift_comments(new, self._depth(path[:-1]) + self._step(parent, new))
                _append_key(parent, path[-1], new)  # a new section such as theme:
                return
            old = self.get(path)
            _shift_comments(new, self._depth(path))
            _set_outer_tail(new, _outer_tail(old))
            parent, key = self.parent(path)
            parent[key] = new
            _sync_leading_comment(parent, key, new)
        else:
            if not isinstance(new, CommentedMap):
                raise EditError("The top level of glance.yml must be a mapping")
            self.data = new

    def set_value(self, path: list, value) -> None:
        """Replace a node with plain JSON data, keeping comments and styles of unchanged parts."""
        if not path:
            raise EditError("Cannot replace the whole document this way")
        parent, key = self.parent(path)
        if isinstance(parent, CommentedMap) and key not in parent:
            parent[key] = from_plain(value)
        else:
            parent[key] = merge(_child(parent, key), value)

    def set_fields(self, path: list, set_: dict, unset: list) -> None:
        node = self.get(path)
        if not isinstance(node, CommentedMap):
            raise EditError("Not a mapping")
        for key in unset:
            if key in node:
                _delete_key(node, key)
        for key, value in set_.items():
            if key in node:
                node[key] = merge(node[key], value)
            else:
                _append_key(node, key, from_plain(value))

    def delete(self, path: list) -> None:
        parent, key = self.parent(path)
        if isinstance(parent, CommentedSeq):
            idx = _index(parent, key)
            with _keep_separators(parent):
                del parent[idx]
        elif isinstance(parent, CommentedMap):
            if key not in parent:
                raise EditError(f"No such key: {key}")
            _delete_key(parent, key)
        else:
            raise EditError("Cannot delete here")

    def insert(self, list_path: list, index: int | None, value=None, text: str | None = None,
               create_key: bool = True) -> list:
        """Insert into the list at list_path (created when missing). Returns the new item's path."""
        node = self.parse_node(text) if text is not None else from_plain(value)
        try:
            seq = self.get(list_path)
        except EditError:
            if not create_key:
                raise
            parent, key = self.parent(list_path)
            if not isinstance(parent, CommentedMap):
                raise
            seq = CommentedSeq()
            seq.append(node)  # add it with its item, so blank lines after the parent land after the item
            _append_key(parent, key, seq)
            return list_path + [0]
        if seq is None:
            parent, key = self.parent(list_path)
            seq = CommentedSeq()
            parent[key] = seq
        if not isinstance(seq, CommentedSeq):
            raise EditError("Not a list")
        if not len(seq):
            seq.fa.set_block_style()  # `widgets: []` becomes a normal list once it has items
        if index is None or index > len(seq):
            index = len(seq)
        index = max(0, index)
        with _keep_separators(seq):
            seq.insert(index, node)
        return list_path + [index]

    def move(self, path: list, to_list: list, to_index: int | None) -> list:
        """Move a list item to position to_index (None = the end) of the list at to_list."""
        parent, key = self.parent(path)
        if not isinstance(parent, CommentedSeq):
            raise EditError("Only list items can be moved")
        idx = _index(parent, key)
        new_list = None  # (mapping, new list, key) when the destination list doesn't exist yet
        try:
            dest = self.get(to_list)
        except EditError:
            owner, list_key = self.parent(to_list)
            if not isinstance(owner, CommentedMap) or list_key in owner:
                raise
            dest = CommentedSeq()
            new_list = (owner, dest, list_key)
        if not isinstance(dest, CommentedSeq):
            raise EditError("Destination is not a list")
        if dest is parent:
            to_index = len(parent) - 1 if to_index is None else max(0, min(to_index, len(parent) - 1))
            if to_index == idx:
                return path
            with _keep_separators(parent):
                item = parent.pop(idx)
                _set_outer_tail(item, "")
                parent.insert(to_index, item)
            return to_list + [to_index]
        item = parent[idx]
        if _contains(item, new_list[0] if new_list else dest):
            raise EditError("Cannot move an item into itself")
        old_depth = self._depth(path)
        with _keep_separators(parent):
            del parent[idx]
        _set_outer_tail(item, "")
        if new_list is not None:  # e.g. the first head widget: the list is created with the item in it
            new_list[1].append(item)
            _append_key(new_list[0], new_list[2], new_list[1])
        else:
            to_index = len(dest) if to_index is None else max(0, min(to_index, len(dest)))
            with _keep_separators(dest):
                dest.insert(to_index, item)
        new_path = _path_to(self.data, item)
        _shift_own_comments(item, self._depth(new_path) - old_depth)  # comments follow the new indentation
        return new_path

    def wrap_in_group(self, path: list, wtype: str = "group") -> list:
        """Replace the widget at path by a group widget that contains it. Returns the group's path."""
        parent, key = self.parent(path)
        if not isinstance(parent, CommentedSeq):
            raise EditError("Only widgets in a list can be put in a group")
        idx = _index(parent, key)
        item = parent[idx]
        old_depth = self._depth(path)
        tail = _outer_tail(item)
        _set_outer_tail(item, "")
        group = CommentedMap()
        group["type"] = wtype
        group["widgets"] = CommentedSeq([item])
        parent[idx] = group
        _set_outer_tail(group, tail)
        _shift_own_comments(item, self._depth(path + ["widgets", 0]) - old_depth)
        return path


# ---------------------------------------------------------------- style detection

_style_cache: "OrderedDict[str, tuple]" = OrderedDict()


def _key(text: str) -> str:
    return hashlib.sha1(text.encode("utf-8", "surrogatepass")).hexdigest()


def _remember_style(text: str, style) -> None:
    _style_cache[_key(text)] = style
    _style_cache.move_to_end(_key(text))
    while len(_style_cache) > 64:
        _style_cache.popitem(last=False)


def _style_for(text: str, data) -> tuple[int, int, int]:
    """The indentation that reproduces this file. Detected once per text, then remembered.

    Dumping is the slow part (tens of ms per try, much more on a small CPU), so the style is read
    from the text first and only a few candidates are ever dumped.
    """
    if not text.strip():
        return STYLES[0]
    key = _key(text)
    if key in _style_cache:
        _style_cache.move_to_end(key)
        return _style_cache[key]
    inferred = _infer_style(text)
    style = inferred
    for candidate in [inferred] + [s for s in STYLES[:3] if s != inferred]:
        if _dump(_yaml(candidate), data) == text:
            style = candidate
            break
    _remember_style(text, style)
    return style


def _infer_style(text: str) -> tuple[int, int, int]:
    """Read (mapping indent, list item indent, dash offset) from the most common patterns in the text."""
    maps, offsets, gaps = Counter(), Counter(), Counter()
    lines = [ln for ln in text.splitlines() if ln.strip() and not ln.lstrip().startswith("#")]
    for line, nxt in zip(lines, lines[1:]):
        ind = len(line) - len(line.lstrip(" "))
        body = line.strip()
        col = ind
        if body.startswith("- "):
            after = body[2:]
            gap = 2 + len(after) - len(after.lstrip(" "))
            gaps[gap] += 1
            col, body = ind + gap, after.strip()
        if not body.endswith(":") or body.startswith(("-", "#", "'", '"')):
            continue  # only "key:" lines with the value on the next lines tell us the indentation
        nind = len(nxt) - len(nxt.lstrip(" "))
        if nxt.strip().startswith("- ") or nxt.strip() == "-":
            if nind >= col:
                offsets[nind - col] += 1
        elif nind > col:
            maps[nind - col] += 1
    mapping = maps.most_common(1)[0][0] if maps else 2
    offset = offsets.most_common(1)[0][0] if offsets else 2
    gap = gaps.most_common(1)[0][0] if gaps else 2
    return mapping, offset + gap, offset


# ---------------------------------------------------------------- paths

def _child(node, key):
    if isinstance(node, CommentedSeq) or isinstance(node, list):
        return node[_index(node, key)]
    if isinstance(node, dict):
        if key not in node:
            raise EditError(f"No such key: {key}")
        return node[key]
    raise EditError(f"Cannot go into {key!r}")


def _index(seq, key) -> int:
    if not isinstance(key, int) or isinstance(key, bool) or not 0 <= key < len(seq):
        raise EditError(f"No item {key!r} in this list")
    return key


def _path_to(node, target, path=()) -> list | None:
    """The path of `target` (by identity) inside node."""
    if node is target:
        return list(path)
    items = node.items() if isinstance(node, dict) else enumerate(node) if isinstance(node, list) else ()
    for k, v in items:
        found = _path_to(v, target, path + (k,))
        if found is not None:
            return found
    return None


def _contains(node, target) -> bool:
    if node is target:
        return True
    if isinstance(node, dict):
        return any(_contains(v, target) for v in node.values())
    if isinstance(node, list):
        return any(_contains(v, target) for v in node)
    return False


# ---------------------------------------------------------------- plain data

class NotPlain(Exception):
    """The node uses YAML features a form can't round-trip (anchors, aliases, merge keys, tags)."""


def to_plain(node, _seen=None):
    """Convert to JSON-able data, or raise NotPlain when a form could lose something."""
    if _seen is None:
        _seen = set()
    if isinstance(node, (CommentedMap, CommentedSeq)):
        if id(node) in _seen or getattr(node, "anchor", None) and node.anchor.value:
            raise NotPlain("anchor or alias")
        _seen.add(id(node))
    if isinstance(node, TaggedScalar):
        raise NotPlain("tag")
    if isinstance(node, CommentedMap):
        if getattr(node, "merge", None):
            raise NotPlain("merge key")
        return {str(k): to_plain(v, _seen) for k, v in node.items()}
    if isinstance(node, (list, CommentedSeq)):
        return [to_plain(v, _seen) for v in node]
    if isinstance(node, dict):
        return {str(k): to_plain(v, _seen) for k, v in node.items()}
    if isinstance(node, bool) or node is None:
        return node
    if isinstance(node, (datetime, date)):
        raise NotPlain("date")
    if isinstance(node, int):
        return int(node)
    if isinstance(node, float):
        return float(node)
    if isinstance(node, str):
        return str(node)
    raise NotPlain(type(node).__name__)


def safe_plain(node):
    try:
        return to_plain(node)
    except NotPlain:
        return None


def from_plain(value):
    if isinstance(value, dict):
        m = CommentedMap()
        for k, v in value.items():
            m[k] = from_plain(v)
        return m
    if isinstance(value, list):
        s = CommentedSeq()
        s.extend(from_plain(v) for v in value)
        return s
    return value


def _same_scalar(old, new) -> bool:
    if isinstance(old, bool) or isinstance(new, bool):
        return isinstance(old, bool) and isinstance(new, bool) and old == new
    if isinstance(old, str) != isinstance(new, str):
        return False
    try:
        return old == new
    except Exception:
        return False


def merge(old, new):
    """Return `new` expressed as an update of `old`: unchanged parts keep their comments and quotes."""
    if isinstance(old, CommentedMap) and isinstance(new, dict) and not getattr(old, "merge", None):
        for key in [k for k in old if k not in new]:
            _delete_key(old, key)
        for key, value in new.items():
            if key in old:
                merged = merge(old[key], value)
                if merged is not old[key]:
                    old[key] = merged
            else:
                _append_key(old, key, from_plain(value))
        return old
    if isinstance(old, CommentedSeq) and isinstance(new, list):
        with _keep_separators(old):
            for i, value in enumerate(new):
                if i < len(old):
                    merged = merge(old[i], value)
                    if merged is not old[i]:
                        old[i] = merged
                else:
                    old.append(from_plain(value))
            del old[len(new):]
        return old
    if not isinstance(old, (dict, list)) and not isinstance(new, (dict, list)) and _same_scalar(old, new):
        return old
    return from_plain(new)


def _append_key(m: CommentedMap, key, value) -> None:
    """Add a key at the end of a mapping; blank lines/comments that followed the mapping stay after it."""
    tail = _outer_tail(m) if len(m) else ""
    if tail:
        _set_outer_tail(m, "")
    m[key] = value
    if tail:
        _set_outer_tail(m, tail)


def _delete_key(m: CommentedMap, key) -> None:
    last = list(m.keys())[-1] == key
    tail = _outer_tail(m) if last else ""
    del m[key]
    if tail and len(m):
        _set_outer_tail(m, tail)


# ---------------------------------------------------------------- comments & blank lines
#
# ruamel stores the blank lines and comments that follow a node in a CommentToken attached to the
# last scalar inside it. When items are inserted, removed or moved, that "tail" would travel with the
# item, so separators and end-of-list comments end up in odd places. These helpers keep them in place.

def _last_slot(node):
    """(container, key, ca_index) of the last scalar written for this node, or None."""
    while True:
        if isinstance(node, CommentedMap) and len(node) and not node.fa.flow_style():
            key = list(node.keys())[-1]
            value = node[key]
            if _is_block_collection(value):
                node = value
                continue
            # After an empty or inline list/map (`widgets: []`), ruamel keeps comments elsewhere;
            # a comment attached to the key there would be written before the `[]` and break the YAML.
            return None if isinstance(value, (CommentedMap, CommentedSeq)) else (node, key, 2)
        if isinstance(node, CommentedSeq) and len(node) and not node.fa.flow_style():
            idx = len(node) - 1
            value = node[idx]
            if _is_block_collection(value):
                node = value
                continue
            return None if isinstance(value, (CommentedMap, CommentedSeq)) else (node, idx, 0)
        return None


def _is_block_collection(v) -> bool:
    return isinstance(v, (CommentedMap, CommentedSeq)) and len(v) > 0 and not v.fa.flow_style()


def _get_token(slot):
    container, key, i = slot
    entry = container.ca.items.get(key)
    return entry[i] if entry and len(entry) > i else None


def _split_tail(value: str) -> tuple[str, str]:
    """Split a trailing comment into (part that belongs to the node, part that follows it).

    The part that follows is the trailing run of blank lines plus comment lines that are not
    indented deeper than... anything: we keep it simple and treat trailing blank lines and the
    comments after the last blank line as "following". Comment lines directly after the node
    (no blank line in between) belong to the node.
    """
    nl = value.find("\n")
    if nl < 0:
        return value, ""
    head, rest = value[: nl + 1], value[nl + 1:]
    lines = rest.splitlines(keepends=True)
    # find the first blank line; everything from there on follows the node
    for i, line in enumerate(lines):
        if not line.strip():
            return head + "".join(lines[:i]), "".join(lines[i:])
    return value, ""


def _slot_tail(slot) -> str:
    tok = _get_token(slot) if slot else None
    return _split_tail(tok.value)[1] if tok else ""


def _set_slot_tail(slot, tail: str) -> None:
    if not slot:
        return
    container, key, i = slot
    tok = _get_token(slot)
    value = (_split_tail(tok.value)[0] if tok else "\n") + tail
    if tok and value == "\n":
        entry = container.ca.items[key]
        entry[i] = None
        if not any(entry):
            del container.ca.items[key]
    elif tok:
        tok.value = value
    elif tail:
        entry = container.ca.items.setdefault(key, [None, None, None, None])
        entry[i] = CommentToken(value, CommentMark(0), None)


def _outer_tail(node) -> str:
    return _slot_tail(_last_slot(node))


def _set_outer_tail(node, tail: str) -> None:
    _set_slot_tail(_last_slot(node), tail)


def _item_slot(seq: CommentedSeq, i: int):
    item = seq[i]
    if _is_block_collection(item):
        return _last_slot(item)
    return None if isinstance(item, (CommentedMap, CommentedSeq)) else (seq, i, 0)


class _keep_separators:
    """Context manager: after changing a list, give items the same blank-line separators as before
    and keep whatever followed the last item (blank lines, end-of-list comments) at the end."""

    def __init__(self, seq: CommentedSeq):
        self.seq = seq

    def _slots(self) -> list:
        """(index, slot) of the items that can carry a trailing comment (not `[]` or inline items)."""
        return [(i, s) for i, s in ((i, _item_slot(self.seq, i)) for i in range(len(self.seq))) if s]

    def __enter__(self):
        slots = self._slots()
        tails = [_slot_tail(s) for _, s in slots]
        inner = tails[:-1]
        self.sep = inner[0] if inner and all(t == inner[0] and not t.strip() for t in inner) else None
        self.end = tails[-1] if tails else ""
        holder = self.seq[slots[-1][0]] if slots else None
        self.last = holder if isinstance(holder, (CommentedMap, CommentedSeq)) else None
        self.blank_lines = any(t.startswith("\n") for t in inner)  # items were separated by blank lines
        return self

    def __exit__(self, exc_type, *_):
        if exc_type or self.seq.fa.flow_style():
            return False
        slots = self._slots()
        for n, (i, slot) in enumerate(slots):
            if n == len(slots) - 1:
                # what followed the list stays at its end (on the last item that can hold it)
                _set_slot_tail(slot, self.end)
            elif self.sep is not None:
                _set_slot_tail(slot, self.sep)
            elif self.last is not None and self.seq[i] is self.last:
                # the old last item is no longer last: separate it like the others were
                _set_slot_tail(slot, "\n" if self.blank_lines else "")
        return False


def _sync_leading_comment(parent, key, new) -> None:
    """ruamel keeps the comment lines at the top of a block mapping twice: on the mapping itself and on
    its parent's key (slot 3), and writes the parent's copy. After replacing the value, point the parent
    at the new value's comment, or the old (possibly already written once) copy is used or skipped."""
    if not isinstance(parent, CommentedMap):
        return
    entry = parent.ca.items.get(key)
    if not entry or len(entry) < 4 or entry[3] is None:
        return
    pre = new.ca.comment[1] if isinstance(new, (CommentedMap, CommentedSeq)) and new.ca.comment and len(new.ca.comment) > 1 else None
    entry[3] = pre or None
    if not any(entry):
        del parent.ca.items[key]


def _shift_own_comments(node, delta: int) -> None:
    """Re-indent a moved node's comments, but not the ones after it (they belong to the outer list)."""
    tail = _outer_tail(node)
    _set_outer_tail(node, "")
    _shift_comments(node, delta)
    _set_outer_tail(node, tail)


def _shift_comments(node, delta: int) -> None:
    """Re-indent full-line comments inside a node (moved to another depth / shown on its own)."""
    if not delta:
        return
    for n in _walk(node):
        ca = getattr(n, "ca", None)
        if ca is None:
            continue
        tokens = []
        for entry in ca.items.values():
            tokens += [t for t in (entry or []) if isinstance(t, CommentToken)]
        if isinstance(ca.comment, list):
            for part in ca.comment:
                if isinstance(part, CommentToken):
                    tokens.append(part)
                elif isinstance(part, list):
                    tokens += [t for t in part if isinstance(t, CommentToken)]
        for t in tokens:
            t.value = _shift_lines(t.value, delta)
            if t.value.startswith("#") and t.start_mark is not None:
                try:
                    t.column = max(0, t.column + delta)
                except AttributeError:
                    pass


def _shift_lines(value: str, delta: int) -> str:
    lines = value.splitlines(keepends=True)
    out = []
    for i, line in enumerate(lines):
        stripped = line.lstrip(" ")
        if i > 0 and stripped.startswith("#"):  # line 0 is the end-of-line comment
            indent = max(0, len(line) - len(stripped) + delta)
            line = " " * indent + stripped
        out.append(line)
    return "".join(out)


def _walk(node):
    yield node
    if isinstance(node, dict):
        for v in node.values():
            yield from _walk(v)
    elif isinstance(node, list):
        for v in node:
            yield from _walk(v)


# ---------------------------------------------------------------- includes

INCLUDE_LINE = re.compile(r"(?m)^([ \t]*)(?:-[ \t]*)?(?:!|\$)include:[ \t]*(.+)$")


def include_target(node) -> str | None:
    """The file named by a `$include: file.yml` (or `!include: file.yml`) node, else None."""
    if isinstance(node, CommentedMap) and len(node) == 1 and INCLUDE_KEY in node:
        return str(node[INCLUDE_KEY])
    if isinstance(node, TaggedScalar) and str(node.tag.value if hasattr(node.tag, "value") else node.tag) == "!include:":
        return str(node.value)
    return None


def is_valid_yaml(text: str) -> str | None:
    try:
        YAML(typ="safe", pure=True).load(text)
    except YAMLError as exc:
        return str(exc)
    return None
