# Satellite Communication Management System (SCMS)

A small web app that manages satellites, ground stations and clients, and lets clients book a satellite pass through a ground station for a time slot. The database refuses double bookings.

## Run
```
npm install
mysql -u root < schema.sql      # builds and seeds the database (re-run to reset)
npm start                       # open http://localhost:3000
```
If MySQL has a password, set it in `server.js` (`password: ''`) and use `mysql -u root -p < schema.sql`.

## Stack
MySQL (database) + Node.js with Express (API) + plain HTML/JavaScript (page).

## How it works
```
Browser (public/index.html)  --fetch-->  Express API (server.js)  --SQL-->  MySQL (schema.sql)
```
1. The page calls `/api/...` with `fetch`.
2. `server.js` turns each call into one SQL statement, using `?` placeholders so user input can never change the SQL (prevents SQL injection).
3. MySQL runs it. If a rule is broken (trigger, foreign key, unique, check), MySQL returns an error message, and the page shows it in red.

## Database
| Table | Purpose | Key columns |
|---|---|---|
| `satellites` | the satellites | PK `sat_id`; `name` UNIQUE; ENUM orbit (LEO/MEO/GEO), band, status |
| `ground_stations` | antennas on Earth | PK `station_id`; `name` UNIQUE |
| `clients` | who books | PK `client_id`; `email` UNIQUE |
| `bookings` | one pass: satellite + station + client + time range | PK `booking_id`; 3 FKs; CHECK `end_time > start_time` |

Relationships: one satellite, station or client has many bookings (1:N each). `bookings` is the table that links the other three.
Normalization: every table has a single primary key and no repeated groups or derived data (3NF/BCNF). A booking stores ids, never names.

## What goes beyond CRUD
| Feature | Where | What it does |
|---|---|---|
| Trigger `trg_no_overlap` | `schema.sql` | Before an INSERT into `bookings`, rejects it if that station or that satellite already has a booking overlapping the time range. Overlap test: `new.start < old.end AND new.end > old.start` |
| View `v_booking_details` | `schema.sql` | Joins 4 tables so the page shows names and minutes instead of ids |
| Report query | `server.js` `/api/report` | LEFT JOIN + GROUP BY + COUNT/SUM: bookings and hours per satellite (satellites with no bookings still show 0) |
| Constraints | `schema.sql` | PK, FK, UNIQUE, NOT NULL, ENUM, CHECK |

## Demo order (3 minutes)
1. Satellites tab: add one, delete one. Delete INSAT-4A to show the foreign-key error (it has bookings).
2. Bookings tab: add Hassan Station, 2026-12-01 09:30 to 09:45. The trigger error appears.
3. Same booking on another day: it works.
4. Report tab: hours per satellite have changed.

## Explaining to the teacher
Say, in this order:
1. **Problem:** satellite and ground-station time is scarce. Two clients must never get the same antenna or satellite at the same time.
2. **Solution:** a database that stores satellites, stations, clients and bookings, and enforces that rule itself.
3. **Schema:** show the 4 tables and the ER relationships. Mention PK, FK, UNIQUE, CHECK and why `bookings` is the linking table.
4. **Trigger:** the main idea. The rule lives in the database, not in the app, so no program can bypass it. Show the overlap condition.
5. **View and report:** a view hides the joins. The report shows aggregation with GROUP BY.
6. **App flow:** browser, then API, then SQL. Parameterised queries prevent SQL injection.
7. **Demo**, then the conclusion: data integrity is enforced by the database.

## Likely questions
- **Why a trigger and not an `if` in the app?** The database protects the rule for every client, and the check and insert are atomic. Two users cannot sneak in between check and insert.
- **Why LEFT JOIN in the report?** So satellites with zero bookings still appear.
- **Why is the status an ENUM?** The database accepts only listed values.
- **What does `ON DELETE` do here?** Nothing is set, so the default RESTRICT applies. A satellite with bookings cannot be deleted.
- **What is the overlap condition?** Two ranges overlap when each starts before the other ends.
- **Which normal form?** 3NF/BCNF. Every non-key column depends only on the key.

## Changing code on the spot
| Request | What to edit |
|---|---|
| Add a column to satellites (e.g. `launch_year`) | `schema.sql` CREATE TABLE and INSERTs; `server.js` cols list in `crud('satellites', ...)`; `public/index.html` `pages.satellites` cols and form |
| Add a new band (e.g. `UHF`) | the two ENUM lists in `schema.sql`, plus the list in `pages.satellites.form` |
| Block bookings longer than 2 hours | in the trigger: `IF TIMESTAMPDIFF(MINUTE, NEW.start_time, NEW.end_time) > 120 THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Max 2 hours'; END IF;` |
| Only active satellites in the report | `server.js` report query: add `WHERE s.status = 'active'` before GROUP BY |
| Bookings of one client | `server.js`: `SELECT * FROM v_booking_details WHERE client = ?` |
| Search satellite by name | `server.js`: `SELECT * FROM satellites WHERE name LIKE ?` with `'%' + q + '%'` |
| Add an edit | `server.js`: `app.put('/api/satellites/:id', ...)` with `UPDATE satellites SET status = ? WHERE sat_id = ?` |

After editing `schema.sql`, re-run the `mysql` line. After editing `server.js`, restart `npm start`. `public/index.html` only needs a browser refresh.
