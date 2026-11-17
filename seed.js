// Fills BOTH databases with sample data.  Run after schema.sql:  npm run setup
const { sql, mongo, mongoClient, connectMongo, hashPassword } = require('./db');

const at = (s) => new Date(s);

async function main() {
  await connectMongo();
  for (const c of ['profiles', 'details', 'requests', 'sessions', 'activity']) await mongo.collection(c).deleteMany({});

  // ---------------- MySQL: users ----------------
  const users = [
    ['Admin', 'admin@scms.in', 'admin123', 'admin'],
    ['ISRO', 'isro@scms.in', 'org123', 'organisation'],
    ['SpaceTech Pvt Ltd', 'spacetech@scms.in', 'org123', 'organisation'],
    ['SkyLink Telecom', 'client@scms.in', 'client123', 'client'],
    ['AgriSense', 'agrisense@scms.in', 'client123', 'client'],
  ];
  for (const [name, email, pw, role] of users) {
    await sql.query('INSERT INTO users (name, email, password_hash, role) VALUES (?, ?, ?, ?)', [name, email, hashPassword(pw), role]);
  }
  // ids: 1 admin, 2 ISRO, 3 SpaceTech, 4 SkyLink, 5 AgriSense

  // ---------------- MySQL: satellites, stations, bookings ----------------
  await sql.query(`INSERT INTO satellites (org_id, name, orbit_type, frequency_band, status) VALUES
    (2,'INSAT-4A','GEO','Ku','approved'), (2,'GSAT-30','GEO','C','approved'),
    (2,'NavIC-1','MEO','L','approved'),  (2,'Cartosat-3','LEO','X','approved'),
    (3,'Pixel-1','LEO','S','pending')`);
  await sql.query(`INSERT INTO ground_stations (org_id, name, location, status) VALUES
    (2,'Hassan Station','Karnataka','approved'), (2,'Bhopal Station','Madhya Pradesh','approved'),
    (2,'Lucknow Station','Uttar Pradesh','approved'), (3,'Ahmedabad Station','Gujarat','pending')`);
  await sql.query(`INSERT INTO bookings (sat_id, station_id, client_id, start_time, end_time) VALUES
    (1,1,4,'2026-12-01 09:00','2026-12-01 10:00'), (2,2,5,'2026-12-01 09:30','2026-12-01 11:00'),
    (1,3,4,'2026-12-02 14:00','2026-12-02 15:30'), (3,1,5,'2026-12-03 06:00','2026-12-03 07:00')`);

  // ---------------- MongoDB: profiles (different fields per role) ----------------
  await mongo.collection('profiles').insertMany([
    { user_id: 1, role: 'admin', designation: 'System administrator' },
    { user_id: 2, role: 'organisation', org_type: 'Government', registration_no: 'GOV-ISRO-1969', country: 'India', website: 'isro.gov.in', phone: '080-22172333' },
    { user_id: 3, role: 'organisation', org_type: 'Private', registration_no: 'U74999KA2021', country: 'India', website: 'spacetech.example', phone: '080-40001234' },
    { user_id: 4, role: 'client', company: 'SkyLink Telecom', industry: 'Telecom', phone: '98450 11111' },
    { user_id: 5, role: 'client', company: 'AgriSense', industry: 'Agriculture', phone: '98450 22222' },
  ].map((p) => ({ ...p, joined: at('2026-11-01') })));

  // ---------------- MongoDB: details (satellites and stations in ONE collection) ----------------
  const week = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'];
  await mongo.collection('details').insertMany([
    { kind: 'satellite', ref_id: 1, launch_date: '2005-12-22', launch_vehicle: 'Ariane 5', mass_kg: 3080, purpose: 'DTH television', availability: { days: week, from: '06:00', to: '22:00' } },
    { kind: 'satellite', ref_id: 2, launch_date: '2020-01-17', launch_vehicle: 'Ariane 5', mass_kg: 3357, purpose: 'Telecom and VSAT', availability: { days: [...week, 'Sat'], from: '00:00', to: '23:59' } },
    { kind: 'satellite', ref_id: 3, launch_date: '2013-07-01', launch_vehicle: 'PSLV-C22', mass_kg: 1425, purpose: 'Navigation', availability: { days: ['Mon', 'Wed', 'Fri'], from: '05:00', to: '12:00' } },
    { kind: 'satellite', ref_id: 4, launch_date: '2019-11-27', launch_vehicle: 'PSLV-C47', mass_kg: 1625, purpose: 'Earth imaging', availability: { days: ['Tue', 'Thu', 'Sat'], from: '10:00', to: '16:00' } },
    { kind: 'satellite', ref_id: 5, launch_date: '2026-06-15', launch_vehicle: 'Falcon 9 rideshare', mass_kg: 15, purpose: 'Hyperspectral imaging', availability: { days: week, from: '08:00', to: '18:00' } },
    { kind: 'station', ref_id: 1, latitude: 13.03, longitude: 76.1, antenna_m: 32, bands: ['C', 'Ku', 'S'] },
    { kind: 'station', ref_id: 2, latitude: 23.26, longitude: 77.41, antenna_m: 18, bands: ['C', 'Ku'] },
    { kind: 'station', ref_id: 3, latitude: 26.85, longitude: 80.95, antenna_m: 11, bands: ['L', 'S', 'X'] },
    { kind: 'station', ref_id: 4, latitude: 23.02, longitude: 72.57, antenna_m: 7.5, bands: ['S', 'X'] },
  ]);

  // ---------------- MongoDB: requests (workflow with a history array) ----------------
  const isro = { user_id: 2, name: 'ISRO', role: 'organisation' };
  const done = (title, type, ref_id, details) => ({
    type, ref_id, title, details, status: 'approved', admin_note: 'Verified', from: isro, created_at: at('2026-11-02'),
    history: [
      { status: 'pending', by: 'ISRO', note: 'Request submitted', at: at('2026-11-02') },
      { status: 'approved', by: 'Admin', note: 'Verified', at: at('2026-11-03') },
    ],
  });
  const pending = (from, data, when) => ({
    ...data, status: 'pending', from, created_at: at(when),
    history: [{ status: 'pending', by: from.name, note: 'Request submitted', at: at(when) }],
  });
  await mongo.collection('requests').insertMany([
    done('Register satellite INSAT-4A', 'satellite', 1, { name: 'INSAT-4A', orbit_type: 'GEO', frequency_band: 'Ku' }),
    done('Register satellite GSAT-30', 'satellite', 2, { name: 'GSAT-30', orbit_type: 'GEO', frequency_band: 'C' }),
    done('Register station Hassan Station', 'station', 1, { name: 'Hassan Station', location: 'Karnataka' }),
    pending({ user_id: 3, name: 'SpaceTech Pvt Ltd', role: 'organisation' }, {
      type: 'satellite', ref_id: 5, title: 'Register satellite Pixel-1',
      details: { name: 'Pixel-1', orbit_type: 'LEO', frequency_band: 'S', launch_date: '2026-06-15', launch_vehicle: 'Falcon 9 rideshare', mass_kg: 15, purpose: 'Hyperspectral imaging', available: 'Mon, Tue, Wed, Thu, Fri  08:00 to 18:00' },
    }, '2026-11-15T10:00'),
    pending({ user_id: 3, name: 'SpaceTech Pvt Ltd', role: 'organisation' }, {
      type: 'station', ref_id: 4, title: 'Register station Ahmedabad Station',
      details: { name: 'Ahmedabad Station', location: 'Gujarat', latitude: 23.02, longitude: 72.57, antenna_m: 7.5, bands: 'S, X' },
    }, '2026-11-15T10:05'),
    pending({ user_id: 4, name: 'SkyLink Telecom', role: 'client' }, {
      type: 'access', sat_id: 1, station_id: 1, start_time: '2026-12-01T09:30', end_time: '2026-12-01T10:30',
      title: 'Access to INSAT-4A',
      details: { satellite: 'INSAT-4A', station: 'Hassan Station', start_time: '2026-12-01 09:30', end_time: '2026-12-01 10:30', purpose: 'Live broadcast uplink', data_type: 'Video' },
    }, '2026-11-16T09:00'),
  ]);

  await mongo.collection('activity').insertMany([
    { user_id: 3, name: 'SpaceTech Pvt Ltd', role: 'organisation', action: 'requested satellite Pixel-1', at: at('2026-11-15T10:00') },
    { user_id: 3, name: 'SpaceTech Pvt Ltd', role: 'organisation', action: 'requested station Ahmedabad Station', at: at('2026-11-15T10:05') },
    { user_id: 4, name: 'SkyLink Telecom', role: 'client', action: 'requested access to INSAT-4A', at: at('2026-11-16T09:00') },
  ]);

  console.log('Sample data loaded into MySQL and MongoDB');
  await sql.end();
  await mongoClient.close();
}

main().catch((e) => { console.error(e.message); process.exit(1); });
