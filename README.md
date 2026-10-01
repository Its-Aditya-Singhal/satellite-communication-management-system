# SCMS – Satellite Communication Management System

A DBMS course project: a web application for scheduling ground-station passes, leasing transponder bandwidth without conflicts, billing clients, and monitoring satellite health in real time.

* **MySQL** is the system of record. It holds the normalized schema, triggers, stored procedures and functions, views, scheduled events and role-based grants.
* **MongoDB** (local or Atlas) holds telemetry: a time-series collection, anomaly detection, alert rules, the event log and hourly roll-ups.
* **Node.js + Express** provides the REST API, with handwritten SQL (no ORM).
* **React + Vite** provides the dashboard, using Recharts for charts.

Design notes: [docs/schema.md](docs/schema.md) · ER diagram: [docs/er-diagram.md](docs/er-diagram.md)

## Prerequisites

* Node.js 20+
* MySQL 8.0+ running locally (`event_scheduler=ON`, which is the default)
* MongoDB 6.0+, either a local server (`brew tap mongodb/brew && brew install mongodb-community`, then `brew services start mongodb-community`) or a MongoDB Atlas cluster (the free M0 tier is fine). Without it, the MySQL features still work and the telemetry pages show "offline".

## Setup

```bash
# 1. install dependencies
npm --prefix server install
npm --prefix client install

# 2. configure
cp server/.env.example server/.env
#    then edit server/.env:
#    - MYSQL_ADMIN_USER / MYSQL_ADMIN_PASSWORD: an account that can create databases and users (e.g. root)
#    - MONGODB_URI: mongodb://127.0.0.1:27017  (local)  or  mongodb+srv://... from Atlas -> Connect -> Drivers

# 3. build both databases (schema, routines, seed data, Mongo collections + 7 days of telemetry)
npm --prefix server run init-db
#    flags: -- --mysql   or   -- --mongo   to rebuild just one side

# 4. run (two terminals)
npm --prefix server run dev        # API on http://localhost:4000
npm --prefix client run dev        # UI  on http://localhost:5173

# 5. optional: stream live telemetry (injects random faults -> anomalies)
npm --prefix server run simulate -- --interval 10 --fault-rate 0.03
```

### Demo accounts (password `Passw0rd!`)

| Role | Email |
|---|---|
| Admin | `admin@scms.local` |
| Operator | `priya@scms.local`, `arjun@scms.local` |
| Client | `noc@skylink.example`, `ops@ndrc.example`, `data@pcri.example`, `uplink@orbitcast.example`, `eo@agrisense.example` |

## Showcase scripts

```bash
# every advanced SQL feature; the 7 "ERROR" lines are intended rejections
mysql -u root --force -t scms < db/mysql/demo_queries.sql

# concurrency control: race with app-side checks vs. row locks in sp_book_window
npm --prefix server run concurrency-demo
```

## Project layout

```
db/mysql/   01_schema … 08_seed.sql, demo_queries.sql
db/mongo/   setup.js (collections, validators, indexes), seed.js
server/     Express API: src/routes, src/services, scripts/ (init-db, simulator, concurrency demo)
client/     React app: src/pages, src/components
docs/       ER diagram, design notes
```

## API overview

All routes are under `/api` and require `Authorization: Bearer <jwt>`, except `/auth/login` and `/health`.

| Area | Endpoints |
|---|---|
| Auth | `POST /auth/login`, `GET /auth/me` |
| Space segment | `GET/POST /satellites`, `GET/PATCH /satellites/:id`, `GET /transponders` |
| Ground segment | `GET/POST /stations`, `GET/PATCH /stations/:id`, `GET /bands` |
| Scheduling | `GET /windows`, `GET/POST /bookings`, `POST /bookings/:id/cancel` |
| Commercial | `GET/POST /contracts`, `PATCH /contracts/:id`, `GET/POST /allocations`, `POST /allocations/:id/release`, `GET /invoices`, `POST /invoices/generate`, `PATCH /invoices/:id` |
| Monitoring (Mongo) | `POST /telemetry`, `GET /telemetry/fleet`, `GET /telemetry/:satId/series`, `GET /telemetry/trend`, `GET/PATCH /anomalies`, `GET /anomalies/stats`, `GET/POST/PATCH /alert-rules`, `GET /events` |
| Reports | `GET /reports/dashboard`, `/revenue`, `/utilization`, `/station-activity`, `/sessions-summary`, `/top-satellites` |
| Admin | `GET/POST /users`, `PATCH /users/:id`, `GET/POST /clients`, `GET /audit` |

Business-rule violations raised by MySQL (`SIGNAL SQLSTATE '45000'`) return as `409`/`422` responses with a code, for example `STATION_CONFLICT` or `CAPACITY_EXCEEDED`.
