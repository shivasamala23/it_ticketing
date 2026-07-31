"""
Zunax IT Support — Odoo CORS Proxy Server (Multi-Threaded Python 3)
Runs on http://localhost:8085
Forwards /proxy/* -> ODOO_URL/* with full CORS headers
"""

import sys
import os
import urllib.request
import urllib.error
from http.server import ThreadingHTTPServer, BaseHTTPRequestHandler

PORT = 8085
ODOO_BASE = sys.argv[1] if len(sys.argv) > 1 else os.environ.get("ODOO_URL", "http://localhost:8067")


class ProxyHandler(BaseHTTPRequestHandler):
    def log_message(self, format, *args):
        try:
            msg = format % args
            clean_msg = msg.encode('ascii', 'replace').decode('ascii')
            sys.stdout.write(f"  [PROXY] {clean_msg}\n")
            sys.stdout.flush()
        except Exception:
            pass

    def _get_cors_headers(self):
        req_origin = self.headers.get("Origin") or self.headers.get("origin") or "*"
        req_headers = self.headers.get("Access-Control-Request-Headers") or "*"
        return {
            "Access-Control-Allow-Origin": req_origin if req_origin != "*" else "*",
            "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
            "Access-Control-Allow-Headers": "Content-Type, Accept, Authorization, X-Openerp-Session-Id, X-API-Key, X-Odoo-Db, X-Database-Name, Cookie, " + req_headers,
            "Access-Control-Allow-Credentials": "true" if req_origin != "*" else "false",
            "Access-Control-Expose-Headers": "Set-Cookie",
        }

    def _send_cors(self, status=200, content_type="application/json", body_len=0):
        self.send_response(status)
        cors = self._get_cors_headers()
        for k, v in cors.items():
            self.send_header(k, v)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(body_len))
        self.end_headers()

    def do_OPTIONS(self):
        self.send_response(204)
        cors = self._get_cors_headers()
        for k, v in cors.items():
            self.send_header(k, v)
        self.end_headers()

    def _proxy(self, method):
        if self.path in ("/", "/health"):
            body = f'{{"status":"ok","odoo":"{ODOO_BASE}","proxy":"http://localhost:{PORT}"}}'.encode()
            self._send_cors(200, body_len=len(body))
            self.wfile.write(body)
            return

        if not self.path.startswith("/proxy"):
            body = b'{"error":"Not Found. Use /proxy/<odoo-path>"}'
            self._send_cors(404, body_len=len(body))
            self.wfile.write(body)
            return

        odoo_path = self.path[6:] or "/"  # strip /proxy prefix
        target_url = f"{ODOO_BASE}{odoo_path}"

        # Read request body
        body = None
        if method in ("POST", "PUT", "PATCH"):
            length = int(self.headers.get("Content-Length", 0))
            if length:
                body = self.rfile.read(length)

        # Build forwarded headers (drop hop-by-hop + origin to avoid CORS conflicts)
        skip = {"host", "origin", "referer", "connection", "content-length", "accept-encoding"}
        forward_headers = {
            k: v for k, v in self.headers.items() if k.lower() not in skip
        }
        forward_headers["Host"] = ODOO_BASE.split("//", 1)[-1].split("/")[0]

        cors = self._get_cors_headers()

        try:
            req = urllib.request.Request(
                target_url, data=body, headers=forward_headers, method=method
            )
            with urllib.request.urlopen(req, timeout=15) as resp:
                raw = resp.read()
                self.send_response(resp.status)
                for k, v in cors.items():
                    self.send_header(k, v)
                ct = resp.headers.get("Content-Type", "application/json")
                self.send_header("Content-Type", ct)
                self.send_header("Content-Length", str(len(raw)))
                self.end_headers()
                self.wfile.write(raw)
        except urllib.error.HTTPError as e:
            raw = e.read()
            self.send_response(e.code)
            for k, v in cors.items():
                self.send_header(k, v)
            ct = e.headers.get("Content-Type", "application/json")
            self.send_header("Content-Type", ct)
            self.send_header("Content-Length", str(len(raw)))
            self.end_headers()
            self.wfile.write(raw)
        except Exception as e:
            msg = f'{{"error":"Cannot reach Odoo at {ODOO_BASE}: {str(e)}"}}'.encode()
            self.send_response(502)
            for k, v in cors.items():
                self.send_header(k, v)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(msg)))
            self.end_headers()
            self.wfile.write(msg)

    def do_GET(self):
        self._proxy("GET")

    def do_POST(self):
        self._proxy("POST")

    def do_PUT(self):
        self._proxy("PUT")

    def do_PATCH(self):
        self._proxy("PATCH")

    def do_DELETE(self):
        self._proxy("DELETE")


if __name__ == "__main__":
    print(f"\nZunax IT CORS Proxy (Multi-Threaded Python)")
    print(f"   Proxy : http://localhost:{PORT}/proxy/*")
    print(f"   -> Odoo: {ODOO_BASE}\n")
    server = ThreadingHTTPServer(("", PORT), ProxyHandler)
    print(f"[OK] Proxy ready at http://localhost:{PORT}")
    print(f"   Health: http://localhost:{PORT}/health\n")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\n[STOPPED] Proxy stopped.")
