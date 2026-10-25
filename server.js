// Grappenscore – server
// Start: PIN=1234 node server.js   (standaard-PIN: 1234, poort 3000)
const express = require('express');
const http = require('http');
const fs = require('fs');
const path = require('path');
const { Server } = require('socket.io');

const PORT = process.env.PORT || 3000;
const PIN = process.env.PIN || '1234';
const DATA_FILE = process.env.DATA_FILE || path.join(__dirname, 'data.json');

// ---------- opslag (één JSON-bestand) ----------
// sessions: [{ id, naam, datum, gestart, gestopt, jokes: { [jokeId]: { nummer, titel } } }]
// votes:    { [sessionId]: { [jokeId]: { [voterId]: 'goed' | 'slecht' } } }
let db = { jokes: [], votes: {}, sessions: [], activeSessionId: null, activeId: null, open: false, nextId: 1, nextSessionId: 1 };
try { db = { ...db, ...JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')) }; } catch {}

const vandaag = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Amsterdam' }); // YYYY-MM-DD
const snapshot = j => ({ nummer: j.nummer, titel: j.titel });

// oud formaat (stemmen zonder sessie) → één afgesloten sessie
if (!db.sessions.length && Object.keys(db.votes).length && !Object.values(db.votes).some(v => typeof Object.values(v)[0] === 'object')) {
  const id = db.nextSessionId++;
  const jokes = {};
  for (const jid of Object.keys(db.votes)) { const j = db.jokes.find(x => x.id === Number(jid)); if (j) jokes[jid] = snapshot(j); }
  db.sessions.push({ id, naam: 'Voor sessies', datum: vandaag(), gestart: new Date().toISOString(), gestopt: new Date().toISOString(), jokes });
  db.votes = { [id]: db.votes };
  db.activeId = null; db.open = false;
}
let saveTimer;
function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => fs.writeFile(DATA_FILE, JSON.stringify(db, null, 2), () => {}), 200);
}
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => {
  clearTimeout(saveTimer);
  fs.writeFileSync(DATA_FILE, JSON.stringify(db, null, 2));
  process.exit(0);
});

const activeSession = () => db.sessions.find(s => s.id === db.activeSessionId) || null;
function tally(jokeId, sessionId = db.activeSessionId) {
  const v = Object.values((db.votes[sessionId] || {})[jokeId] || {});
  const goed = v.filter(x => x === 'goed').length;
  return { goed, slecht: v.length - goed, totaal: v.length };
}
const activeJoke = () => db.jokes.find(j => j.id === db.activeId) || null;
const publicState = () => {
  const j = activeJoke();
  return { nummer: j ? j.nummer : null, jokeId: j ? j.id : null, open: db.open };
};
// uitslag van één sessie, best scorende grap eerst
const sessionResult = s => ({
  id: s.id, naam: s.naam, datum: s.datum, gestart: s.gestart, gestopt: s.gestopt,
  grappen: Object.entries(s.jokes)
    .map(([jid, info]) => ({ jokeId: Number(jid), ...info, score: tally(jid, s.id) }))
    .filter(g => g.score.totaal > 0)
    .sort((a, b) => (b.score.goed - b.score.slecht) - (a.score.goed - a.score.slecht) || a.nummer - b.nummer),
});
const adminState = () => ({
  ...publicState(),
  sessie: activeSession() && { id: db.activeSessionId, naam: activeSession().naam, datum: activeSession().datum },
  sessies: db.sessions.slice().reverse().map(sessionResult),
  jokes: db.jokes
    .slice()
    .sort((a, b) => a.nummer - b.nummer)
    .map(j => ({ ...j, score: tally(j.id) })),
});

// ---------- http ----------
const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.get('/health', (_, res) => res.send('ok'));
app.get('/regie',(_, res) => res.sendFile(path.join(__dirname, 'public', 'regie.html')));

const auth = (req, res, next) =>
  req.get('x-pin') === PIN ? next() : res.status(401).json({ error: 'Onjuiste pincode' });

app.post('/api/login', (req, res) => res.json({ ok: req.body.pin === PIN }));
app.get('/api/jokes', auth, (_, res) => res.json(adminState()));

app.post('/api/jokes', auth, (req, res) => {
  const { titel = '', omschrijving = '' } = req.body;
  const nummer = Number(req.body.nummer) || Math.max(0, ...db.jokes.map(j => j.nummer)) + 1;
  const joke = { id: db.nextId++, nummer, titel: String(titel), omschrijving: String(omschrijving) };
  db.jokes.push(joke);
  save(); broadcastAdmin();
  res.json(joke);
});

app.put('/api/jokes/:id', auth, (req, res) => {
  const j = db.jokes.find(x => x.id === Number(req.params.id));
  if (!j) return res.status(404).end();
  if (req.body.nummer !== undefined) j.nummer = Number(req.body.nummer) || j.nummer;
  if (req.body.titel !== undefined) j.titel = String(req.body.titel);
  if (req.body.omschrijving !== undefined) j.omschrijving = String(req.body.omschrijving);
  const sess = activeSession();
  if (sess && sess.jokes[j.id]) sess.jokes[j.id] = snapshot(j);
  save(); broadcastAll();
  res.json(j);
});

app.delete('/api/jokes/:id', auth, (req, res) => {
  const id = Number(req.params.id);
  db.jokes = db.jokes.filter(j => j.id !== id); // stemmen in sessies blijven bewaard
  if (db.activeId === id) { db.activeId = null; db.open = false; }
  save(); broadcastAll();
  res.json({ ok: true });
});

app.post('/api/jokes/:id/reset', auth, (req, res) => {
  if (db.votes[db.activeSessionId]) delete db.votes[db.activeSessionId][Number(req.params.id)];
  save(); broadcastAll();
  res.json({ ok: true });
});

// ---------- sessies ----------
app.get('/api/sessions', auth, (_, res) => res.json(db.sessions.map(sessionResult)));
app.get('/api/sessions/:id', auth, (req, res) => {
  const s = db.sessions.find(x => x.id === Number(req.params.id));
  s ? res.json(sessionResult(s)) : res.status(404).end();
});

function stopSession() {
  const s = activeSession();
  if (s) s.gestopt = new Date().toISOString();
  db.activeSessionId = null; db.activeId = null; db.open = false;
}

app.post('/api/sessions', auth, (req, res) => {
  const naam = String(req.body.naam || '').trim().slice(0, 100);
  if (!naam) return res.status(400).json({ error: 'Geef de sessie een naam' });
  stopSession();
  const s = { id: db.nextSessionId++, naam, datum: vandaag(), gestart: new Date().toISOString(), gestopt: null, jokes: {} };
  db.sessions.push(s);
  db.activeSessionId = s.id;
  save(); broadcastAll();
  res.json(sessionResult(s));
});

app.post('/api/sessions/stop', auth, (_, res) => {
  stopSession();
  save(); broadcastAll();
  res.json({ ok: true });
});

app.delete('/api/sessions/:id', auth, (req, res) => {
  const id = Number(req.params.id);
  if (id === db.activeSessionId) stopSession();
  db.sessions = db.sessions.filter(s => s.id !== id);
  delete db.votes[id];
  save(); broadcastAll();
  res.json({ ok: true });
});

// ---------- realtime ----------
const server = http.createServer(app);
const io = new Server(server);

function broadcastAdmin() { io.to('regie').emit('admin', adminState()); }
function broadcastAll() {
  io.emit('state', publicState());
  broadcastAdmin();
}

io.on('connection', socket => {
  socket.emit('state', publicState());

  socket.on('join-regie', (pin, cb) => {
    if (pin !== PIN) return cb && cb(false);
    socket.join('regie');
    socket.data.regie = true;
    cb && cb(true);
    socket.emit('admin', adminState());
  });

  // presentator activeert een grap → stemmen gaat open
  socket.on('activate', id => {
    if (!socket.data.regie || !activeSession()) return;
    const j = db.jokes.find(x => x.id === id);
    if (!j) return;
    activeSession().jokes[id] = snapshot(j); // nummer + titel bewaren bij de sessie
    db.activeId = id; db.open = true;
    save(); broadcastAll();
  });

  socket.on('set-open', open => {
    if (!socket.data.regie || !db.activeId) return;
    db.open = !!open;
    save(); broadcastAll();
  });

  socket.on('deactivate', () => {
    if (!socket.data.regie) return;
    db.activeId = null; db.open = false;
    save(); broadcastAll();
  });

  // luisteraar stemt; alleen geldig voor de grap die nú actief is
  socket.on('vote', ({ voterId, jokeId, keuze } = {}, cb) => {
    const ok = db.activeSessionId && db.open && jokeId === db.activeId && voterId &&
      (keuze === 'goed' || keuze === 'slecht');
    if (!ok) return cb && cb({ ok: false, reden: 'Stemmen is gesloten of de grap is gewisseld' });
    ((db.votes[db.activeSessionId] ||= {})[jokeId] ||= {})[String(voterId).slice(0, 64)] = keuze;
    save(); broadcastAdmin();
    cb && cb({ ok: true });
  });

  socket.on('my-vote', ({ voterId, jokeId } = {}, cb) => {
    cb && cb(((db.votes[db.activeSessionId] || {})[jokeId] || {})[voterId] || null);
  });
});

server.listen(PORT, () => {
  console.log(`Grappenscore draait op http://localhost:${PORT}`);
  console.log(`  luisteraars: /        presentator: /regie  (PIN ${PIN === '1234' ? '1234 – wijzig met PIN=...' : 'ingesteld'})`);
});
