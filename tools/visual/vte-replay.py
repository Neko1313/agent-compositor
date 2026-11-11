"""Replay captured real PTY output/resizes in an offscreen GTK3/VTE widget.

Requires system PyGObject, GTK3, VTE 2.91 and a working display. This verifies
VTE parsing/geometry and saves native pixels; it is not a live input latency test.
"""
import json
import sys
from pathlib import Path

import gi
gi.require_version("Gtk", "3.0")
gi.require_version("Vte", "2.91")
from gi.repository import Gtk, Vte, Pango, GLib

root = Path(sys.argv[1]).resolve()
if not Gtk.init_check()[0]:
    raise SystemExit("GTK display is unavailable; native VTE verification did not run")
window = Gtk.OffscreenWindow()
terminal = Vte.Terminal()
terminal.set_font(Pango.FontDescription("Monospace 10"))
terminal.set_scrollback_lines(0)
window.add(terminal)
window.show_all()


def drain():
    while Gtk.events_pending():
        Gtk.main_iteration_do(False)


drain()
events = [json.loads(line) for line in (root / "terminal.events.jsonl").read_text().splitlines()]
for event in events:
    if event["type"] in ("start", "resize"):
        cols, rows = event["cols"], event["rows"]
        terminal.set_size(cols, rows)
        padding = terminal.get_style_context().get_padding(Gtk.StateFlags.NORMAL)
        width = cols * terminal.get_char_width() + padding.left + padding.right
        height = rows * terminal.get_char_height() + padding.top + padding.bottom
        terminal.set_size_request(width, height)
        window.resize(width, height)
        window.check_resize()
        if terminal.get_column_count() != cols or terminal.get_row_count() != rows:
            allocated = [False]

            def sized():
                allocated[0] = terminal.get_column_count() == cols and terminal.get_row_count() == rows
                if allocated[0]:
                    Gtk.main_quit()
                return not allocated[0]

            poll = GLib.timeout_add(1, sized)
            deadline = GLib.timeout_add(2000, lambda: (Gtk.main_quit(), False)[1])
            Gtk.main()
            if not allocated[0]:
                GLib.source_remove(poll)
                raise SystemExit("VTE did not allocate the requested terminal geometry")
            GLib.source_remove(deadline)
    elif event["type"] == "data":
        terminal.feed(event["data"].encode())
    drain()

report = {"vte": f"{Vte.get_major_version()}.{Vte.get_minor_version()}.{Vte.get_micro_version()}",
          "features": Vte.get_features(), "events": len(events), "ok": False}
last, stable = "", 0


def inspect():
    global last, stable
    text = terminal.get_text_format(Vte.Format.TEXT) or ""
    stable = stable + 1 if text == last else 0
    last = text
    if stable < 3:
        return True
    report.update(columns=terminal.get_column_count(), rows=terminal.get_row_count())
    report["ok"] = (report["columns"] == cols and report["rows"] == rows
                    and text.startswith("┌") and "Conversation" in text
                    and "history_latency" in text and "PERFORMANCE_STREAM_FINISHED" in text)
    (root / "vte-screen.txt").write_text(text)
    window.get_pixbuf().savev(str(root / "vte-screen.png"), "png", [], [])
    Gtk.main_quit()
    return False


GLib.timeout_add(30, inspect)
GLib.timeout_add_seconds(10, lambda: (Gtk.main_quit(), False)[1])
Gtk.main()
window.destroy()
(root / "vte-report.json").write_text(json.dumps(report, indent=2))
print(json.dumps(report, indent=2))
raise SystemExit(0 if report["ok"] else 1)
