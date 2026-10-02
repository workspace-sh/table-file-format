"""Measuring large tables (#126): serves big-*.table.zip from a folder to
an app built with EXPO_PUBLIC_TABLE_MEASURE=1 (apps/mobile/measure.ts).
GET /next names the file to open (the contents of <dir>/next); POST
/result appends what the app reports to <dir>/results.ndjson.

    python3 scripts/measure-server.py <dir> [port]
"""
import http.server, json, os, sys, time

root = sys.argv[1]
port = int(sys.argv[2]) if len(sys.argv) > 2 else 5198

class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *a, **k):
        super().__init__(*a, directory=root, **k)

    def end_headers(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        super().end_headers()

    def do_GET(self):
        if self.path == "/next":
            name = open(os.path.join(root, "next")).read().strip() if os.path.exists(os.path.join(root, "next")) else ""
            body = name.encode()
            self.send_response(200)
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return
        super().do_GET()

    def do_POST(self):
        body = self.rfile.read(int(self.headers.get("Content-Length", 0)))
        try:
            entry = json.loads(body)
        except ValueError:
            entry = {"raw": body.decode(errors="replace")}
        entry["at"] = time.time()
        with open(os.path.join(root, "results.ndjson"), "a") as f:
            f.write(json.dumps(entry) + "\n")
        self.send_response(204)
        self.end_headers()

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header("Access-Control-Allow-Methods", "GET, POST")
        self.send_header("Access-Control-Allow-Headers", "content-type")
        self.end_headers()

    def log_message(self, *a):
        pass

http.server.ThreadingHTTPServer(("127.0.0.1", port), Handler).serve_forever()
