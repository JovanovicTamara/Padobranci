#!/usr/bin/env node
/* Tandem NS – mali server bez ikakvih dodatnih paketa (samo Node.js 16+).
   - služi sajt (index.html, magacin.html, ...)
   - čuva magacin u data/db.json, zajednički za sve telefone
   - prijava članova pomoću PIN-a
   Pokretanje:  node server.js     (zatim otvori http://localhost:8080)  */
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const Core = require('./js/core.js');

const PORT = parseInt(process.env.PORT, 10) || 8080;
const HOST = process.env.HOST || '0.0.0.0';
const ROOT = __dirname;
const DATA_DIR = path.join(ROOT, 'data');
const DB_FILE = path.join(DATA_DIR, 'db.json');
const SECRET_FILE = path.join(DATA_DIR, 'secret.key');
const TOKEN_TTL_MS = 30 * 24 * 3600 * 1000;

fs.mkdirSync(DATA_DIR, { recursive: true });

// ---------- PIN (scrypt) ----------
const hooks = {
    hashPin(pin) {
        const salt = crypto.randomBytes(16).toString('hex');
        return { salt, pinHash: crypto.scryptSync(pin, salt, 32).toString('hex') };
    },
    verifyPin(member, pin) {
        if (!member.salt || !member.pinHash) return false;
        const a = Buffer.from(crypto.scryptSync(pin, member.salt, 32).toString('hex'));
        const b = Buffer.from(member.pinHash);
        return a.length === b.length && crypto.timingSafeEqual(a, b);
    },
    allowReset: false
};

// ---------- Baza ----------
let db;
function normalize(d) {
    d.members.forEach(m => { if (m.pin) { Object.assign(m, hooks.hashPin(String(m.pin))); delete m.pin; } });
    d.log = d.log || [];
    return d;
}
function saveDB() {
    const tmp = DB_FILE + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(db, null, 2));
    fs.renameSync(tmp, DB_FILE);
}
if (fs.existsSync(DB_FILE)) {
    db = normalize(JSON.parse(fs.readFileSync(DB_FILE, 'utf8')));
} else {
    db = normalize(Core.defaultDB());
    saveDB();
    console.log('\n  Napravljena nova baza sa probnim članovima (PIN):');
    console.log('    Glavni administrator – 0000');
    console.log('    Marko Marković       – 1111');
    console.log('    Ana Jović            – 2222');
    console.log('  >>> Odmah promeni PIN-ove (Admin → Članovi)! <<<\n');
}

// ---------- Tokeni ----------
let SECRET;
if (fs.existsSync(SECRET_FILE)) SECRET = fs.readFileSync(SECRET_FILE, 'utf8').trim();
else { SECRET = crypto.randomBytes(32).toString('hex'); fs.writeFileSync(SECRET_FILE, SECRET, { mode: 0o600 }); }

const sign = s => crypto.createHmac('sha256', SECRET).update(s).digest('hex');
function makeToken(userId) {
    const payload = Buffer.from(JSON.stringify({ u: userId, e: Date.now() + TOKEN_TTL_MS })).toString('base64url');
    return payload + '.' + sign(payload);
}
function readToken(token) {
    if (!token || typeof token !== 'string') return null;
    const [payload, sig] = token.split('.');
    if (!payload || !sig) return null;
    const exp = sign(payload);
    if (sig.length !== exp.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(exp))) return null;
    try {
        const o = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
        return o.e > Date.now() ? o.u : null;
    } catch (e) { return null; }
}

// ---------- Ograničenje pokušaja prijave ----------
const attempts = new Map();
function tooMany(key) {
    const now = Date.now();
    const a = attempts.get(key);
    if (!a || now - a.first > 10 * 60 * 1000) return false;
    return a.count >= 6;
}
function noteFail(key) {
    const now = Date.now();
    const a = attempts.get(key);
    if (!a || now - a.first > 10 * 60 * 1000) attempts.set(key, { count: 1, first: now });
    else a.count++;
}

// ---------- HTTP ----------
const MIME = {
    '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'application/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml',
    '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.ico': 'image/x-icon',
    '.woff2': 'font/woff2', '.woff': 'font/woff', '.txt': 'text/plain; charset=utf-8'
};
const BLOCKED = /^\/(data|node_modules|\.|server\.js|package(-lock)?\.json|tailwind\.config\.js|README)/i;

function send(res, status, body, headers) {
    res.writeHead(status, Object.assign({ 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'same-origin' }, headers));
    res.end(body);
}
function sendJSON(res, status, obj) {
    send(res, status, JSON.stringify(obj), { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
}
function readBody(req, limit = 100 * 1024) {
    return new Promise((resolve, reject) => {
        let size = 0; const chunks = [];
        req.on('data', c => { size += c.length; if (size > limit) { reject(new Error('too big')); req.destroy(); } else chunks.push(c); });
        req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
        req.on('error', reject);
    });
}

async function handleApi(req, res) {
    if (req.method === 'GET') return sendJSON(res, 200, { ok: true, mode: 'server' });
    if (req.method !== 'POST') return sendJSON(res, 405, { ok: false, error: 'Metoda nije dozvoljena.' });
    let body;
    try { body = JSON.parse((await readBody(req)) || '{}'); } catch (e) { return sendJSON(res, 400, { ok: false, error: 'Neispravan zahtev.' }); }
    const method = String(body.method || '');
    const params = body.params && typeof body.params === 'object' ? body.params : {};
    const auth = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
    const userId = readToken(auth);

    if (method === 'login') {
        const key = (req.socket.remoteAddress || '') + '|' + String(params.memberId);
        if (tooMany(key)) return sendJSON(res, 429, { ok: false, error: 'Previše pokušaja. Probaj ponovo za nekoliko minuta.' });
        const r = Core.dispatch(db, null, 'login', params, hooks);
        if (!r.ok) { noteFail(key); return sendJSON(res, r.status || 401, { ok: false, error: r.error }); }
        attempts.delete(key);
        return sendJSON(res, 200, { ok: true, data: r.data, token: makeToken(r.userId) });
    }

    const r = Core.dispatch(db, { userId }, method, params, hooks);
    if (!r.ok) return sendJSON(res, r.status || 400, { ok: false, error: r.error });
    if (!Core.READ_ONLY[method]) saveDB();
    return sendJSON(res, 200, { ok: true, data: r.data });
}

function serveStatic(req, res, pathname) {
    if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, 'Method Not Allowed');
    let rel = decodeURIComponent(pathname);
    if (rel === '/' || rel === '') rel = '/index.html';
    if (BLOCKED.test(rel)) return send(res, 404, 'Not found');
    const file = path.normalize(path.join(ROOT, rel));
    if (!file.startsWith(ROOT + path.sep)) return send(res, 403, 'Forbidden');
    fs.stat(file, (err, st) => {
        if (err || !st.isFile()) return send(res, 404, 'Not found', { 'Content-Type': 'text/plain; charset=utf-8' });
        const ext = path.extname(file).toLowerCase();
        const type = MIME[ext];
        if (!type) return send(res, 404, 'Not found');
        const heavy = ['.woff2', '.woff', '.png', '.jpg', '.webp', '.svg'].includes(ext) || file.includes(path.join('js', 'vendor'));
        res.writeHead(200, {
            'Content-Type': type,
            'Content-Length': st.size,
            'Cache-Control': heavy ? 'public, max-age=86400' : 'no-cache',
            'X-Content-Type-Options': 'nosniff'
        });
        if (req.method === 'HEAD') return res.end();
        fs.createReadStream(file).pipe(res);
    });
}

const CERT = path.join(DATA_DIR, 'cert.pem'), KEY = path.join(DATA_DIR, 'key.pem');
const useTLS = fs.existsSync(CERT) && fs.existsSync(KEY);
const handler = (req, res) => {
    let pathname;
    try { pathname = new URL(req.url, 'http://x').pathname; } catch (e) { return send(res, 400, 'Bad request'); }
    if (pathname === '/api/rpc' || pathname === '/api/ping') {
        return handleApi(req, res).catch(() => sendJSON(res, 500, { ok: false, error: 'Greška na serveru.' }));
    }
    serveStatic(req, res, pathname);
};
const server = useTLS
    ? require('https').createServer({ cert: fs.readFileSync(CERT), key: fs.readFileSync(KEY) }, handler)
    : http.createServer(handler);

server.listen(PORT, HOST, () => {
    const nets = require('os').networkInterfaces();
    const ips = [];
    Object.values(nets).forEach(list => (list || []).forEach(n => { if (n.family === 'IPv4' && !n.internal) ips.push(n.address); }));
    console.log('Tandem NS server radi.');
    const proto = useTLS ? 'https' : 'http';
    console.log('  Na ovom računaru:   ' + proto + '://localhost:' + PORT);
    ips.forEach(ip => console.log('  Telefon (isti Wi-Fi): ' + proto + '://' + ip + ':' + PORT + '/magacin.html'));
    if (!useTLS) console.log('  NAPOMENA: kamera na telefonu radi samo preko HTTPS – vidi README.md (ručni unos koda radi uvek).');
});
