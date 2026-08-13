const express = require('express');
const session = require('express-session');
const Database = require('better-sqlite3');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'creative8&';

const db = new Database(path.join(__dirname, 'salon.db'));
db.exec(`
CREATE TABLE IF NOT EXISTS appointments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  phone TEXT NOT NULL,
  email TEXT,
  service TEXT NOT NULL,
  stylist TEXT NOT NULL,
  date TEXT NOT NULL,
  time TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(date, time)
);
`);

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(session({
  secret: process.env.SESSION_SECRET || 'replace-this-session-secret',
  resave: false,
  saveUninitialized: false,
  cookie: { httpOnly: true, sameSite: 'lax' }
}));
app.use(express.static(path.join(__dirname, 'public')));

function requireAdmin(req, res, next) {
  if (req.session && req.session.isAdmin) return next();
  return res.status(401).json({ error: 'Unauthorized' });
}

app.get('/api/availability', (req, res) => {
  const date = req.query.date;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date || '')) {
    return res.status(400).json({ error: 'Valid date required' });
  }
  const rows = db.prepare('SELECT time FROM appointments WHERE date = ?').all(date);
  res.json({ booked: rows.map(r => r.time) });
});

app.post('/api/appointments', (req, res) => {
  const { name, phone, email = '', service, stylist = 'Any available stylist', date, time } = req.body;
  if (!name || !phone || !service || !date || !time) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  try {
    const stmt = db.prepare(`
      INSERT INTO appointments (name, phone, email, service, stylist, date, time)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    const info = stmt.run(name.trim(), phone.trim(), email.trim(), service, stylist, date, time);
    res.status(201).json({ ok: true, id: info.lastInsertRowid });
  } catch (err) {
    if (String(err.code).includes('SQLITE_CONSTRAINT')) {
      return res.status(409).json({ error: 'That appointment time was just booked. Please choose another time.' });
    }
    console.error(err);
    res.status(500).json({ error: 'Could not save appointment' });
  }
});

app.post('/api/admin/login', (req, res) => {
  if (req.body.password === ADMIN_PASSWORD) {
    req.session.isAdmin = true;
    return res.json({ ok: true });
  }
  res.status(401).json({ error: 'Incorrect password' });
});

app.post('/api/admin/logout', (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

app.get('/api/admin/status', (req, res) => {
  res.json({ loggedIn: !!(req.session && req.session.isAdmin) });
});

function chicagoToday() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Chicago',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(new Date());
  const get = type => parts.find(p => p.type === type)?.value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}

app.get('/api/admin/appointments', requireAdmin, (req, res) => {
  const today = chicagoToday();
  const active = db.prepare(`
    SELECT id, name, phone, email, service, stylist, date, time, created_at
    FROM appointments
    WHERE date >= ?
    ORDER BY date ASC, time ASC
  `).all(today);

  const history = db.prepare(`
    SELECT id, name, phone, email, service, stylist, date, time, created_at
    FROM appointments
    WHERE date < ?
    ORDER BY date DESC, time DESC
  `).all(today);

  res.json({ active, history, today });
});

app.delete('/api/admin/appointments/:id', requireAdmin, (req, res) => {
  const info = db.prepare('DELETE FROM appointments WHERE id = ?').run(req.params.id);
  res.json({ ok: info.changes > 0 });
});

app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

app.listen(PORT, () => {
  console.log(`Salon website running on http://localhost:${PORT}`);
});
