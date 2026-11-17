const express = require('express');
const mysql = require('mysql2/promise');

// 1. connect to MySQL
const db = mysql.createPool({
  host: 'localhost',
  user: 'root',
  password: '',          // put your MySQL password here if you have one
  database: 'scms',
  dateStrings: true,
});

const app = express();
app.use(express.json());
app.use(express.static('public'));

// 2. list / add / delete for a simple table
function crud(route, table, idCol, cols) {
  app.get('/api/' + route, async (req, res) => {
    const [rows] = await db.query('SELECT * FROM ' + table);
    res.json(rows);
  });

  app.post('/api/' + route, async (req, res) => {
    const values = cols.map((c) => req.body[c]);
    const marks = cols.map(() => '?').join(', ');
    await db.query(`INSERT INTO ${table} (${cols.join(', ')}) VALUES (${marks})`, values);
    res.json({ ok: true });
  });

  app.delete('/api/' + route + '/:id', async (req, res) => {
    await db.query(`DELETE FROM ${table} WHERE ${idCol} = ?`, [req.params.id]);
    res.json({ ok: true });
  });
}

crud('satellites', 'satellites', 'sat_id', ['name', 'orbit_type', 'frequency_band', 'status']);
crud('stations', 'ground_stations', 'station_id', ['name', 'location']);
crud('clients', 'clients', 'client_id', ['name', 'email']);

// 3. bookings: read from the VIEW, write to the table (the TRIGGER checks overlaps)
app.get('/api/bookings', async (req, res) => {
  const [rows] = await db.query('SELECT * FROM v_booking_details ORDER BY start_time');
  res.json(rows);
});

app.post('/api/bookings', async (req, res) => {
  const { sat_id, station_id, client_id, start_time, end_time } = req.body;
  await db.query(
    'INSERT INTO bookings (sat_id, station_id, client_id, start_time, end_time) VALUES (?, ?, ?, ?, ?)',
    [sat_id, station_id, client_id, start_time, end_time]
  );
  res.json({ ok: true });
});

app.delete('/api/bookings/:id', async (req, res) => {
  await db.query('DELETE FROM bookings WHERE booking_id = ?', [req.params.id]);
  res.json({ ok: true });
});

// 4. report: JOIN + GROUP BY + aggregate functions
app.get('/api/report', async (req, res) => {
  const [rows] = await db.query(`
    SELECT s.name AS satellite,
           COUNT(b.booking_id) AS total_bookings,
           ROUND(COALESCE(SUM(TIMESTAMPDIFF(MINUTE, b.start_time, b.end_time)), 0) / 60, 2) AS total_hours
    FROM satellites s
    LEFT JOIN bookings b ON b.sat_id = s.sat_id
    GROUP BY s.sat_id, s.name
    ORDER BY total_hours DESC`);
  res.json(rows);
});

// 5. errors from MySQL (trigger message, FK, duplicate...) go back to the page
app.use((err, req, res, next) => {
  res.status(400).json({ error: err.sqlMessage || err.message });
});

app.listen(3000, () => console.log('Open http://localhost:3000'));
