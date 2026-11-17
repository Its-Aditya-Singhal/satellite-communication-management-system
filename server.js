const express = require('express');
const crypto = require('crypto');
const { ObjectId } = require('mongodb');
const { sql, mongo, connectMongo, hashPassword, checkPassword, log } = require('./db');

const app = express();
app.use(express.json());
app.use(express.static('public'));

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const fail = (msg) => { throw Object.assign(new Error(msg), { status: 400 }); };

// =====================================================================
// 1. LOGIN SYSTEM
//    users + password hash  -> MySQL  (users table)
//    extra profile details  -> MongoDB (profiles)
//    login token / session  -> MongoDB (sessions, expires by TTL index)
// =====================================================================
app.post('/api/register', async (req, res) => {
  const { role, name, email, password, profile = {} } = req.body;
  if (!['client', 'organisation'].includes(role)) fail('You can only register as a client or an organisation');
  if (!name || !email || !password) fail('Name, email and password are required');
  if (password.length < 6) fail('Password must be at least 6 characters');

  const [r] = await sql.query('INSERT INTO users (name, email, password_hash, role) VALUES (?, ?, ?, ?)',
    [name, email, hashPassword(password), role]);
  await mongo.collection('profiles').insertOne({ user_id: r.insertId, role, ...profile, joined: new Date() });
  await log({ user_id: r.insertId, name, role }, 'registered');
  res.json({ ok: true });
});

app.post('/api/login', async (req, res) => {
  const { email, password, role } = req.body;
  const [[user]] = await sql.query('SELECT * FROM users WHERE email = ?', [email]);
  if (!user || !checkPassword(password, user.password_hash)) fail('Wrong email or password');
  if (user.role !== role) fail(`This account is a ${user.role} account. Use the ${user.role} login.`);

  const token = crypto.randomBytes(24).toString('hex');
  await mongo.collection('sessions').insertOne({
    token, user_id: user.user_id, name: user.name, role: user.role, created_at: new Date(),
  });
  await log(user, 'logged in');
  res.json({ token, user: { user_id: user.user_id, name: user.name, role: user.role } });
});

// middleware: find the session in MongoDB and check the role
function auth(...roles) {
  return async (req, res, next) => {
    const token = (req.headers.authorization || '').replace('Bearer ', '');
    const session = token && await mongo.collection('sessions').findOne({ token });
    if (!session) return res.status(401).json({ error: 'Please log in again' });
    if (roles.length && !roles.includes(session.role)) return res.status(403).json({ error: 'Not allowed for your role' });
    req.user = session;
    next();
  };
}

app.post('/api/logout', auth(), async (req, res) => {
  await mongo.collection('sessions').deleteOne({ token: req.user.token });
  res.json({ ok: true });
});

app.get('/api/me', auth(), async (req, res) => {
  const profile = await mongo.collection('profiles').findOne({ user_id: req.user.user_id }, { projection: { _id: 0 } });
  res.json({ ...req.user, profile });
});

// requests sent by the logged-in user (client or organisation)
app.get('/api/my/requests', auth('client', 'organisation'), async (req, res) => {
  res.json(await mongo.collection('requests').find({ 'from.user_id': req.user.user_id }).sort({ created_at: -1 }).toArray());
});

// =====================================================================
// 2. ORGANISATION: register satellites and stations -> request to admin
//    core row (name, orbit, band, status) -> MySQL
//    technical details (any fields)        -> MongoDB details
//    the request itself                    -> MongoDB requests
// =====================================================================
function newRequest(type, user, data) {
  return mongo.collection('requests').insertOne({
    type, status: 'pending', from: { user_id: user.user_id, name: user.name, role: user.role },
    ...data, created_at: new Date(),
    history: [{ status: 'pending', by: user.name, note: 'Request submitted', at: new Date() }],
  });
}

app.get('/api/org/assets', auth('organisation'), async (req, res) => {
  const [satellites] = await sql.query('SELECT * FROM satellites WHERE org_id = ?', [req.user.user_id]);
  const [stations] = await sql.query('SELECT * FROM ground_stations WHERE org_id = ?', [req.user.user_id]);
  res.json({ satellites, stations });
});

app.post('/api/org/satellites', auth('organisation'), async (req, res) => {
  const { name, orbit_type, frequency_band, launch_date, launch_vehicle, mass_kg, purpose, days, from_time, to_time } = req.body;
  if (!days || !days.length) fail('Pick at least one available day');
  if (!(from_time < to_time)) fail('Available "to" time must be after the "from" time');

  const [r] = await sql.query('INSERT INTO satellites (org_id, name, orbit_type, frequency_band) VALUES (?, ?, ?, ?)',
    [req.user.user_id, name, orbit_type, frequency_band]);
  await mongo.collection('details').insertOne({
    kind: 'satellite', ref_id: r.insertId, launch_date, launch_vehicle, mass_kg: Number(mass_kg), purpose,
    availability: { days, from: from_time, to: to_time },
  });
  await newRequest('satellite', req.user, { ref_id: r.insertId, title: `Register satellite ${name}`,
    details: { name, orbit_type, frequency_band, launch_date, launch_vehicle, mass_kg, purpose,
               available: `${days.join(', ')}  ${from_time} to ${to_time}` } });
  await log(req.user, `requested satellite ${name}`);
  res.json({ ok: true });
});

app.post('/api/org/stations', auth('organisation'), async (req, res) => {
  const { name, location, latitude, longitude, antenna_m, bands = [] } = req.body;
  const [r] = await sql.query('INSERT INTO ground_stations (org_id, name, location) VALUES (?, ?, ?)',
    [req.user.user_id, name, location]);
  await mongo.collection('details').insertOne({
    kind: 'station', ref_id: r.insertId, latitude: Number(latitude), longitude: Number(longitude),
    antenna_m: Number(antenna_m), bands,
  });
  await newRequest('station', req.user, { ref_id: r.insertId, title: `Register station ${name}`,
    details: { name, location, latitude, longitude, antenna_m, bands: bands.join(', ') } });
  await log(req.user, `requested station ${name}`);
  res.json({ ok: true });
});

// =====================================================================
// 3. CLIENT: see available satellites, request access -> request to admin
// =====================================================================
// approved satellites (MySQL view) + availability (MongoDB) + booked slots (MySQL)
app.get('/api/catalog', auth(), async (req, res) => {
  const [sats] = await sql.query("SELECT * FROM v_satellites WHERE status = 'approved' ORDER BY name");
  const [stations] = await sql.query("SELECT station_id, name, location FROM ground_stations WHERE status = 'approved'");
  const [booked] = await sql.query('SELECT sat_id, start_time, end_time FROM bookings WHERE end_time > NOW() ORDER BY start_time');
  const details = await mongo.collection('details').find({ kind: 'satellite' }).toArray();

  res.json({
    stations,
    satellites: sats.map((s) => ({
      ...s,
      details: details.find((d) => d.ref_id === s.sat_id) || {},
      booked: booked.filter((b) => b.sat_id === s.sat_id),
    })),
  });
});

app.post('/api/client/requests', auth('client'), async (req, res) => {
  const { sat_id, station_id, start_time, end_time, purpose, data_type } = req.body;
  const [[sat]] = await sql.query("SELECT * FROM satellites WHERE sat_id = ? AND status = 'approved'", [sat_id]);
  const [[st]] = await sql.query("SELECT * FROM ground_stations WHERE station_id = ? AND status = 'approved'", [station_id]);
  if (!sat || !st) fail('Choose an approved satellite and station');

  // is the requested time inside the satellite's available days and hours? (stored in MongoDB)
  const { availability: a } = await mongo.collection('details').findOne({ kind: 'satellite', ref_id: sat.sat_id });
  const start = new Date(start_time), end = new Date(end_time);
  if (!(end > start)) fail('End time must be after start time');
  if (start_time.slice(0, 10) !== end_time.slice(0, 10)) fail('Start and end must be on the same day');
  if (!a.days.includes(DAYS[start.getDay()])) fail(`${sat.name} is only available on ${a.days.join(', ')}`);
  if (start_time.slice(11, 16) < a.from || end_time.slice(11, 16) > a.to) fail(`${sat.name} is only available ${a.from} to ${a.to}`);

  await newRequest('access', req.user, {
    sat_id: sat.sat_id, station_id: st.station_id, start_time, end_time,
    title: `Access to ${sat.name}`,
    details: { satellite: sat.name, station: st.name, start_time: start_time.replace('T', ' '),
               end_time: end_time.replace('T', ' '), purpose, data_type },
  });
  await log(req.user, `requested access to ${sat.name}`);
  res.json({ ok: true });
});

app.get('/api/my/bookings', auth('client'), async (req, res) => {
  const [rows] = await sql.query('SELECT * FROM v_booking_details WHERE client_id = ? ORDER BY start_time', [req.user.user_id]);
  res.json(rows);
});

// =====================================================================
// 4. ADMIN: approve / reject requests, see everything
// =====================================================================
app.get('/api/admin/requests', auth('admin'), async (req, res) => {
  const filter = req.query.status ? { status: req.query.status } : {};
  res.json(await mongo.collection('requests').find(filter).sort({ created_at: -1 }).toArray());
});

app.post('/api/admin/requests/:id/:decision', auth('admin'), async (req, res) => {
  const { id, decision } = req.params;
  if (!['approve', 'reject'].includes(decision)) fail('Unknown decision');
  const request = await mongo.collection('requests').findOne({ _id: new ObjectId(id) });
  if (!request) fail('Request not found');
  if (request.status !== 'pending') fail('This request was already ' + request.status);

  const status = decision === 'approve' ? 'approved' : 'rejected';
  const update = { status, admin_note: req.body.note || '' };

  // the SQL side of the decision
  if (request.type === 'satellite') await sql.query('UPDATE satellites SET status = ? WHERE sat_id = ?', [status, request.ref_id]);
  if (request.type === 'station') await sql.query('UPDATE ground_stations SET status = ? WHERE station_id = ?', [status, request.ref_id]);
  if (request.type === 'access' && status === 'approved') {
    // the TRIGGER rejects it here if the slot overlaps an existing booking
    const [r] = await sql.query('INSERT INTO bookings (sat_id, station_id, client_id, start_time, end_time) VALUES (?, ?, ?, ?, ?)',
      [request.sat_id, request.station_id, request.from.user_id, request.start_time, request.end_time]);
    update.booking_id = r.insertId;
  }

  // the NoSQL side: update the request document and push to its history array
  await mongo.collection('requests').updateOne({ _id: request._id }, {
    $set: update,
    $push: { history: { status, by: req.user.name, note: req.body.note || '', at: new Date() } },
  });
  await log(req.user, `${status} "${request.title}"`);
  res.json({ ok: true });
});

// dashboard numbers: SQL COUNTs + a MongoDB aggregation pipeline
app.get('/api/admin/overview', auth('admin'), async (req, res) => {
  const [[counts]] = await sql.query(`SELECT
      (SELECT COUNT(*) FROM users WHERE role = 'client') AS clients,
      (SELECT COUNT(*) FROM users WHERE role = 'organisation') AS organisations,
      (SELECT COUNT(*) FROM satellites WHERE status = 'approved') AS satellites,
      (SELECT COUNT(*) FROM ground_stations WHERE status = 'approved') AS stations,
      (SELECT COUNT(*) FROM bookings) AS bookings`);
  const requests = await mongo.collection('requests').aggregate([
    { $group: { _id: { type: '$type', status: '$status' }, count: { $sum: 1 } } },
    { $project: { _id: 0, type: '$_id.type', status: '$_id.status', count: 1 } },
    { $sort: { type: 1, status: 1 } },
  ]).toArray();
  res.json({ counts, requests });
});

app.get('/api/admin/satellites', auth('admin'), async (req, res) => {
  const [rows] = await sql.query('SELECT * FROM v_satellites ORDER BY sat_id');
  res.json(rows);
});

app.get('/api/admin/stations', auth('admin'), async (req, res) => {
  const [rows] = await sql.query(`SELECT g.station_id, g.name, g.location, g.status, u.name AS organisation
    FROM ground_stations g JOIN users u ON u.user_id = g.org_id ORDER BY g.station_id`);
  res.json(rows);
});

app.get('/api/admin/bookings', auth('admin'), async (req, res) => {
  const [rows] = await sql.query('SELECT * FROM v_booking_details ORDER BY start_time');
  res.json(rows);
});

app.get('/api/admin/users', auth('admin'), async (req, res) => {
  const [rows] = await sql.query('SELECT user_id, name, email, role, created_at FROM users ORDER BY user_id');
  res.json(rows);
});

// report: LEFT JOIN + GROUP BY + aggregate functions
app.get('/api/admin/report', auth('admin'), async (req, res) => {
  const [rows] = await sql.query(`
    SELECT s.name AS satellite,
           COUNT(b.booking_id) AS total_bookings,
           ROUND(COALESCE(SUM(TIMESTAMPDIFF(MINUTE, b.start_time, b.end_time)), 0) / 60, 2) AS total_hours
    FROM satellites s
    LEFT JOIN bookings b ON b.sat_id = s.sat_id
    WHERE s.status = 'approved'
    GROUP BY s.sat_id, s.name
    ORDER BY total_hours DESC`);
  res.json(rows);
});

app.get('/api/admin/activity', auth('admin'), async (req, res) => {
  res.json(await mongo.collection('activity').find().sort({ at: -1 }).limit(50).toArray());
});

app.delete('/api/admin/:what/:id', auth('admin'), async (req, res) => {
  const tables = { satellites: ['satellites', 'sat_id'], stations: ['ground_stations', 'station_id'], bookings: ['bookings', 'booking_id'] };
  const t = tables[req.params.what];
  if (!t) fail('Unknown item');
  await sql.query(`DELETE FROM ${t[0]} WHERE ${t[1]} = ?`, [req.params.id]);   // FOREIGN KEY may stop this
  if (req.params.what !== 'bookings') {
    await mongo.collection('details').deleteOne({ kind: req.params.what === 'satellites' ? 'satellite' : 'station', ref_id: Number(req.params.id) });
  }
  await log(req.user, `deleted ${req.params.what} #${req.params.id}`);
  res.json({ ok: true });
});

// =====================================================================
// 5. errors from MySQL (trigger, FK, duplicate) and MongoDB go back to the page
// =====================================================================
app.use((err, req, res, next) => {
  let msg = err.sqlMessage || err.message;
  if (err.code === 'ER_DUP_ENTRY') msg = 'Already exists: ' + msg.split("'")[1];
  if (err.code === 'ER_ROW_IS_REFERENCED_2') msg = 'Cannot delete: it is used by other records (foreign key)';
  res.status(err.status || 400).json({ error: msg });
});

connectMongo().then(() => {
  app.listen(3000, () => console.log('Open http://localhost:3000'));
}).catch((e) => {
  console.error('Could not connect to MongoDB. Is it running?  brew services start mongodb-community\n', e.message);
  process.exit(1);
});
