import http.server
import socketserver
import urllib.request
import json
import sys
import os
import configparser

PORT = 8085

# Potential locations for odoo.conf
CONF_PATHS = [
    r'C:\odoo\odoo\debian\odoo.conf',
    r'C:\odoo\debian\odoo.conf',
    r'C:\odoo\odoo.conf',
    os.path.join(os.path.dirname(__file__), 'odoo.conf'),
]

def get_odoo_port():
    """Dynamically detect and read Odoo HTTP port from odoo.conf file."""
    for conf_path in CONF_PATHS:
        if os.path.exists(conf_path):
            try:
                config = configparser.ConfigParser()
                config.read(conf_path)
                if config.has_section('options'):
                    if config.has_option('options', 'http_port'):
                        port = config.get('options', 'http_port').strip()
                        if port.isdigit():
                            return int(port)
                    if config.has_option('options', 'xmlrpc_port'):
                        port = config.get('options', 'xmlrpc_port').strip()
                        if port.isdigit():
                            return int(port)
            except Exception as e:
                print(f"[Config Parser Warning] Could not parse {conf_path}: {e}")

    # Default fallback port if config is unreadable
    return 8068

class ProxyHTTPRequestHandler(http.server.SimpleHTTPRequestHandler):
    def do_OPTIONS(self):
        self.send_response(200)
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Headers', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS')
        self.end_headers()

    def _handle_proxy(self, method):
        if self.path.startswith('/proxy'):
            raw = self.path[len('/proxy'):]
            if raw.startswith('/http://') or raw.startswith('/https://'):
                target_url = raw[1:]
            else:
                # Dynamically fetch current Odoo port from odoo.conf on each request
                odoo_port = get_odoo_port()
                target_url = f'http://localhost:{odoo_port}' + raw

            post_data = None
            if method in ['POST', 'PUT']:
                content_length = int(self.headers.get('Content-Length', 0))
                if content_length > 0:
                    post_data = self.rfile.read(content_length)

            req = urllib.request.Request(
                target_url,
                data=post_data,
                headers={
                    'Content-Type': 'application/json',
                    'Accept': 'application/json',
                    'User-Agent': 'Mozilla/5.0 (Mobile App Proxy)'
                },
                method=method
            )

            # Pass custom session and API Key headers if present
            sid = self.headers.get('X-Openerp-Session-Id')
            if sid:
                req.add_header('X-Openerp-Session-Id', sid)

            key = self.headers.get('X-API-Key') or self.headers.get('X-Api-Key')
            if key:
                req.add_header('X-API-Key', key)

            cookie = self.headers.get('Cookie')
            if cookie:
                req.add_header('Cookie', cookie)

            try:
                with urllib.request.urlopen(req) as response:
                    res_body = response.read()
                    self.send_response(response.status)
                    self.send_header('Content-Type', 'application/json')
                    self.send_header('Access-Control-Allow-Origin', '*')
                    self.send_header('Access-Control-Allow-Headers', '*')
                    self.send_header('Access-Control-Allow-Methods', '*')
                    self.end_headers()
                    self.wfile.write(res_body)
            except Exception as e:
                print(f"[Proxy Error] {method} {target_url} failed: {e}")
                sys.stdout.flush()
                self.send_response(500)
                self.send_header('Content-Type', 'application/json')
                self.send_header('Access-Control-Allow-Origin', '*')
                self.end_headers()
                err_payload = json.dumps({
                    "success": False,
                    "error": f"Proxy Error ({method} {target_url}): {str(e)}",
                    "code": 500
                }).encode('utf-8')
                self.wfile.write(err_payload)
            return True
        return False

    def do_GET(self):
        if not self._handle_proxy('GET'):
            super().do_GET()

    def do_POST(self):
        if not self._handle_proxy('POST'):
            super().do_POST()

    def do_PUT(self):
        if not self._handle_proxy('PUT'):
            super().do_PUT()

if __name__ == '__main__':
    current_port = get_odoo_port()
    socketserver.TCPServer.allow_reuse_address = True
    with socketserver.TCPServer(("", PORT), ProxyHTTPRequestHandler) as httpd:
        print(f"Mobile App Proxy running at http://localhost:{PORT}")
        print(f"Detected Odoo Port dynamically from odoo.conf: {current_port}")
        sys.stdout.flush()
        httpd.serve_forever()
