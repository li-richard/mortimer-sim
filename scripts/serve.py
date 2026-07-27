#!/usr/bin/env python3
"""Static file server for local development.

Identical to `python3 -m http.server` except it sends `Cache-Control:
no-store`. Without that, browsers heuristically cache style.css and app.js
off the Last-Modified header and keep serving stale copies after an edit —
which looks exactly like a broken layout.

Usage:  python3 scripts/serve.py [port]
"""
import sys
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


class NoCacheHandler(SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store, must-revalidate")
        self.send_header("Expires", "0")
        super().end_headers()

    def log_message(self, fmt, *args):  # quieter output
        if "GET" in (args[0] if args else ""):
            return
        super().log_message(fmt, *args)


def main():
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8742
    handler = partial(NoCacheHandler, directory=str(ROOT))
    print(f"serving {ROOT} at http://localhost:{port} (no-store)")
    ThreadingHTTPServer(("", port), handler).serve_forever()


if __name__ == "__main__":
    main()
