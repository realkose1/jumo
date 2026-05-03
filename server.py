import http.server, os, urllib.request, urllib.error

API_PROXY = 'http://localhost:8002'

class Handler(http.server.SimpleHTTPRequestHandler):
    def do_GET(self):
        if self.path.startswith('/api/'):
            # Strip /api prefix and forward to api-proxy.js
            target = API_PROXY + self.path[4:]  # /api/naver-news -> /naver-news
            try:
                with urllib.request.urlopen(target, timeout=12) as r:
                    body = r.read()
                    self.send_response(r.status)
                    ct = r.headers.get('Content-Type', 'application/json')
                    self.send_header('Content-Type', ct)
                    self.send_header('Access-Control-Allow-Origin', '*')
                    self.end_headers()
                    self.wfile.write(body)
            except Exception as e:
                self.send_response(502)
                self.send_header('Content-Type', 'application/json')
                self.end_headers()
                self.wfile.write(b'{}')
        else:
            super().do_GET()

    def end_headers(self):
        if not self.path.startswith('/api/'):
            self.send_header('Cache-Control', 'no-store, no-cache, must-revalidate')
            self.send_header('Pragma', 'no-cache')
        super().end_headers()

    def log_message(self, *a): pass

os.chdir(os.path.dirname(os.path.abspath(__file__)))
http.server.test(HandlerClass=Handler, port=3000, bind='')
