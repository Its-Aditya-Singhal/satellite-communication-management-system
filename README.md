# Satellite Communication Management System (SCMS)

A web app with three roles: **Organisations** register satellites and ground/launch stations, **Clients** request time on a satellite, and the **Admin** approves or rejects every request. The data is split between **MySQL (SQL)** and **MongoDB (NoSQL)**.

## Run
```
npm install
npm run setup      # builds MySQL tables (schema.sql) and loads sample data into both databases (seed.js)
npm start          # open http://localhost:3000
```
Needs MySQL and MongoDB running locally. On a Mac:
```
brew services start mysql
docker start scms-mongo        # MongoDB runs in Docker (first time: docker run -d --name scms-mongo -p 27017:27017 mongo:7)
```
If MySQL has a password, put it in `db.js` (`password: ''`) and run `mysql -u root -p < schema.sql && node seed.js`.

## Demo accounts
| Role | Email | Password |
|---|---|---|
| Admin | admin@scms.in | admin123 |
| Organisation | isro@scms.in | org123 |
| Organisation | spacetech@scms.in | org123 |
| Client | client@scms.in | client123 |
| Client | agrisense@scms.in | client123 |

## Stack and flow
```
Browser (public/*.html)  --fetch + token-->  Express API (server.js)  --> MySQL   (structured, relational data)
                                                                      --> MongoDB (flexible documents)
```
Pages: `index.html` (pick a role, Admin login on top) → `login.html?role=...` → `client.html` / `org.html` / `admin.html`.

## What is stored where (50 / 50)
| MySQL (SQL) | MongoDB (NoSQL) |
|---|---|
| `users`: id, name, email, password hash, role | `profiles`: extra fields, different per role (org: registration no, website… / client: company, industry…) |
| `satellites`: name, orbit, band, owner, status | `details`: technical details of satellites **and** stations in one collection (two document shapes), satellite availability `{days: [...], from, to}` |
| `ground_stations`: name, location, owner, status | `requests`: approval workflow; each document has a `history` array updated with `$push` |
| `bookings`: satellite + station + client + time | `sessions`: login tokens, deleted automatically after 8 h by a **TTL index** |
| Trigger, views, report query | `activity`: log of every action; admin overview uses an **aggregation pipeline** |

**Why this split:** things that must be consistent and related (who owns what, who booked what, no double bookings) need keys, foreign keys and a trigger, so they are in MySQL. Things whose shape changes or that grow like logs (profiles with different fields, technical details, request history, sessions) fit documents better, so they are in MongoDB. The two are linked by id: `profiles.user_id = users.user_id`, `details.ref_id = satellites.sat_id`.

## Workflows
1. **Organisation registers a satellite/station** → row in MySQL with `status = 'pending'`, details in MongoDB `details`, a request document in `requests`.
2. **Admin approves** → MySQL `UPDATE ... SET status = 'approved'`, MongoDB `$set` status + `$push` to history. The satellite now appears in the client catalogue.
3. **Client requests access** → server checks the satellite's available days/hours (from MongoDB), then saves an `access` request.
4. **Admin approves access** → `INSERT INTO bookings`. The **trigger** rejects it if the slot overlaps; the request stays pending and the admin sees the error.

## Login
- Passwords are hashed with Node's built-in `crypto.scrypt` (salt + hash), never stored as plain text.
- Login creates a random token stored in MongoDB `sessions`; the page sends it as `Authorization: Bearer <token>`.
- `auth('admin')` style middleware in `server.js` checks the token and the role on every API call.
- A client account cannot log in through the organisation portal and vice versa. Admin accounts cannot be registered from the site.

## SQL features
| Feature | Where | What it does |
|---|---|---|
| PK, FK, UNIQUE, ENUM, CHECK | `schema.sql` | integrity rules; `CHECK (end_time > start_time)` |
| Trigger `trg_no_overlap` | `schema.sql` | before a booking is inserted: satellite and station must be approved, and no overlapping booking on either. Overlap test: `new.start < old.end AND new.end > old.start` |
| Views `v_booking_details`, `v_satellites` | `schema.sql` | joins so pages show names instead of ids |
| Report | `/api/admin/report` | LEFT JOIN + GROUP BY + COUNT/SUM: bookings and hours per satellite |
| Foreign key on delete | admin delete | deleting a satellite/station that has bookings is refused |

## NoSQL features
| Feature | Where |
|---|---|
| Flexible schema (different fields per document) | `profiles`, `details` |
| Embedded array + `$push` | `requests.history` |
| TTL index (auto-expiry) | `sessions` (db.js) |
| Unique and compound indexes | `db.js` `connectMongo()` |
| Aggregation pipeline `$group / $project / $sort` | `/api/admin/overview` |

## Demo script
1. Home → **Login as Organisation** → `spacetech@scms.in`. Show *My requests* (Pixel-1 pending). Register a new satellite.
2. Top **Admin login** → *Requests*: approve the new satellite and Pixel-1.
3. Home → **Login as Client** → *Available satellites* shows days, hours and booked slots. Request access on an allowed day/time. (A wrong day is refused.)
4. Admin → approve it → appears in *Bookings*.
5. **Trigger:** approve the seeded SkyLink request for INSAT-4A (1 Dec 09:30–10:30) → error "Ground station is already booked in this time range".
6. **Foreign key:** Admin → *Satellites* → delete INSAT-4A → refused because it has bookings.
7. *Overview* (SQL counts + Mongo aggregation), *Report*, *Activity log*.

Useful shell checks:
```
mysql -u root scms -e "SELECT * FROM v_booking_details;"
mongosh scms --eval "db.requests.find({status:'pending'})"
```
