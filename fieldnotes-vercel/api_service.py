"""API-only adapter shared by Vercel and deployment smoke tests."""
from http.server import BaseHTTPRequestHandler
from urllib.parse import parse_qs, unquote, urlsplit
import json
import logging
import os
import numpy as np
import server
from data_access import mode

def route_request(method, path, body=b''):
    parts = urlsplit(path)
    # Vercel rewrites /api/* into this one function while preserving a route query.
    endpoint = parse_qs(parts.query).get('route', [parts.path.removeprefix('/api/')])[0]
    endpoint = unquote(endpoint).strip('/')
    if method == 'GET' and endpoint == 'health':
        selected = mode()
        configured = selected != 'supabase' or bool(os.environ.get('SUPABASE_URL') and os.environ.get('SUPABASE_SERVICE_ROLE_KEY'))
        return (200 if configured else 503), {'status':'ready' if configured else 'configuration_required', 'dataset_mode':selected}
    with server.LOCK:
        if method == 'GET' and endpoint == 'meta':
            return 200, server.metadata()
        if method == 'GET' and endpoint.startswith('profile/'):
            name = endpoint.removeprefix('profile/')
            if name not in server.column_names():
                raise ValueError('Unknown variable.')
            return 200, server.profile(name)
        if method == 'POST' and endpoint == 'analyze':
            return 200, server.analyze(json.loads(body))
    return 404, {'error':'Unknown API endpoint.'}

class ApiHandler(BaseHTTPRequestHandler):
    def respond(self, status, data):
        payload = json.dumps(data, allow_nan=False).encode('utf-8')
        self.send_response(status)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Cache-Control', 'no-store')
        self.send_header('Content-Length', str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

    def dispatch(self):
        try:
            length = int(self.headers.get('Content-Length', '0'))
            if length < 0 or length > 100000:
                return self.respond(413, {'error':'Model settings are too large.'})
            body = self.rfile.read(length) if self.command == 'POST' else b''
            status, data = route_request(self.command, self.path, body)
            self.respond(status, data)
        except (ValueError, KeyError, TypeError, AttributeError, np.linalg.LinAlgError):
            # Never return raw request bodies, keys, network URLs, or tracebacks.
            self.respond(400, {'error':'Invalid model settings. Check that the variables are different, both moderator groups have rows, and cleaning rules leave a valid model.'})
        except RuntimeError as error:
            self.respond(503, {'error':str(error)})
        except Exception as error:
            logging.error('Analysis request failed: %s', type(error).__name__)
            self.respond(500, {'error':'The analysis could not be completed. Please retry or review the deployment logs.'})

    do_GET = dispatch
    do_POST = dispatch
