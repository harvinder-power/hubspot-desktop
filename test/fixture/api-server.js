// Fake HubSpot REST API for tests. Serves only canned responses; no real data.
// script: { 'METHOD /path': response | [response, ...] }, keyed on the path without its query.
// response: { status = 200, headers = {}, body } where a string body is sent as is and any other body as JSON.
// A queued array is served in order; its last entry repeats.
const http = require('node:http');

const hubspotError = (category, message) => ({ status: 'error', message, correlationId: '00000000-0000-0000-0000-000000000000', category });

function start(port = 0, { script = {} } = {}) {
  const queues = new Map(Object.entries(script).map(([key, value]) => [key, Array.isArray(value) ? [...value] : [value]]));
  const requests = [];

  const send = (res, { status = 200, headers = {}, body }) => {
    const text = typeof body === 'string' ? body : JSON.stringify(body ?? {});
    const type = typeof body === 'string' ? 'text/html' : 'application/json';
    res.writeHead(status, { 'Content-Type': type, ...headers });
    res.end(text);
  };

  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      let body = null;
      try {
        body = raw ? JSON.parse(raw) : null;
      } catch {
        body = raw;
      }
      const auth = req.headers.authorization || '';
      const headers = { ...req.headers };
      if (headers.authorization) headers.authorization = auth.startsWith('Bearer ') ? 'Bearer [redacted]' : '[redacted]';
      requests.push({ method: req.method, path: req.url, headers, body });

      if (!auth.startsWith('Bearer ') || auth.length <= 'Bearer '.length) {
        send(res, { status: 401, body: hubspotError('INVALID_AUTHENTICATION', 'Authentication credentials not found.') });
        return;
      }
      const queue = queues.get(`${req.method} ${new URL(req.url, 'http://api').pathname}`);
      if (!queue) {
        send(res, { status: 404, body: hubspotError('OBJECT_NOT_FOUND', 'No canned response for this request.') });
        return;
      }
      send(res, queue.length > 1 ? queue.shift() : queue[0]);
    });
  });

  return new Promise((resolve) => {
    server.listen(port, '127.0.0.1', () => {
      resolve({
        url: `http://127.0.0.1:${server.address().port}`,
        requests,
        close: () => new Promise((done) => server.close(() => done())),
      });
    });
  });
}

module.exports = { start };
