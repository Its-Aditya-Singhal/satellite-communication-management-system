# SCMS – Database Design Notes

Material for the project report and viva. Every claim here is backed by a file in `db/` or a runnable script.

## 1. Why two databases (polyglot persistence)

| Concern | Store | Reason |
|---|---|---|
| Satellites, stations, transponders, contracts, bookings, allocations, invoices | **MySQL** | Strongly related data, ACID transactions, referential integrity and conflict rules that must never be violated (double-booking, over-leasing) |
| Raw telemetry, hourly roll-ups, anomalies, alert rules, event log | **MongoDB** | High-volume, append-heavy, **schema varies per satellite bus** (a GEO comsat reports TWTA temperatures; an imaging satellite reports recorder fill; the ISS reports cabin CO₂). Time-series collections, TTL expiry and aggregation pipelines suit this data |

The two stores share one key: `satellites.sat_id` = `telemetry.meta.satId` = `anomalies.satId`. The API joins them at the application layer (for example, `GET /api/satellites` returns MySQL metadata merged with the latest Mongo health data).

## 2. Normalization

All tables are in **BCNF**. The non-trivial decisions:

* **`orbits` split from `satellites` (1:1).** Orbital elements change on a different cadence (each new TLE epoch) from registry data, and GEO-only attributes (`geo_longitude`) would otherwise be NULL for most rows.
* **`station_bands` (M:N).** A station supports many bands, and a band is supported by many stations. Storing a comma list in `ground_stations` would violate 1NF.
* **`frequency_bands` as its own relation.** The band limits (`min_mhz`, `max_mhz`) depend only on the band code. Repeating them on every transponder would create a transitive dependency `transponder → band_code → min/max`.
* **`contract_code` is a candidate key** (UNIQUE) beside the surrogate PK. Every determinant is a key, so the table is in BCNF.
* **Controlled denormalization in `bookings`.** `sat_id` and `station_id` can be derived from `window_id`. We keep them so the overlap checks can use the composite index `(station_id, start_ts, end_ts)` directly. `trg_bookings_bi` guarantees they always match the window, so the redundancy cannot drift.

### Functional dependencies (examples)

```
satellites:   sat_id → norad_id, name, model, orbit_type, operator_org, launch_date, mass_kg, status
              norad_id → sat_id            (candidate key)
transponders: transponder_id → sat_id, band_id, label, center_freq_mhz, bandwidth_mhz, polarization, status
              (sat_id, label) → transponder_id                          (candidate key)
              (sat_id, center_freq_mhz, polarization) → transponder_id  (candidate key)
invoices:     invoice_id → contract_id, period_start, period_end, amounts, status
              (contract_id, period_start, period_end) → invoice_id      (candidate key)
```

## 3. Integrity: what is enforced where

| Rule | Mechanism | File |
|---|---|---|
| Valid ranges (lat/lon, inclination, band min<max, start<end) | `CHECK` constraints | `01_schema.sql` |
| Client users must reference a client; staff must not | `CHECK (role/client_id)` | `01_schema.sql` |
| No two transponders on a satellite share frequency + polarization | composite `UNIQUE` | `01_schema.sql` |
| No overlapping sessions on one antenna or one satellite | `BEFORE INSERT/UPDATE` triggers | `04_triggers.sql` |
| Session must be inside AOS–LOS and on a band the station supports | `BEFORE INSERT` trigger | `04_triggers.sql` |
| Leased MHz never exceeds transponder capacity at any instant | trigger + `fn_allocated_mhz_at_peak` | `02_functions.sql`, `04_triggers.sql` |
| Contract active and covering the booking dates; no bookings in the past | `sp_book_window` | `03_procedures.sql` |
| Every change to bookings, allocations and contracts is recorded | `AFTER` triggers → `audit_log` | `04_triggers.sql` |
| Malformed alert rules / anomaly docs rejected | MongoDB `$jsonSchema` validators | `db/mongo/setup.js` |

## 4. Transactions and concurrency

`sp_book_window` and `sp_allocate_bandwidth` run in explicit transactions. Each has an `EXIT HANDLER` that runs `ROLLBACK` and then `RESIGNAL`s the error. Before validating, they take `SELECT … FOR UPDATE` locks on the contended rows: the station and satellite for a booking, the transponder for an allocation. The locks are always taken in the same order to avoid deadlocks.

`npm run concurrency-demo` shows two scenarios:

1. **Check in the application, then insert.** Both sessions' consistent-read `SELECT` calls see the slot as free, which is the race window. The second `INSERT` is still rejected, because the trigger's read inside a DML statement is a *current* (locking) read.
2. **Two simultaneous procedure calls.** T2 blocks on T1's row lock for about 2 s. When T1 commits, T2 resumes and gets `STATION_CONFLICT`. The two transactions run one after the other, as if serialized.

## 5. Other advanced features

* **Stored functions:** `fn_overlap_hours`, `fn_transponder_utilization`, `fn_station_load`, `fn_allocated_mhz_at_peak` (the peak of a step function is evaluated only at interval start points)
* **Views:**
  * `v_booking_details`
  * `v_upcoming_schedule`
  * `v_client_bookings`: a client projection with no staff names
  * `v_transponder_utilization`
  * `v_revenue_by_client`
  * `v_station_overview`
* **Recursive CTEs:** generating 60 days of visibility windows (`08_seed.sql`) and the daily station-load series (`GET /api/stations/:id`)
* **Window functions:**
  * `RANK()` and `SUM() OVER ()` for revenue share
  * `LAG()` for day-over-day and month-over-month change
  * a moving `AVG()` with a `ROWS BETWEEN 6 PRECEDING` frame
  * `ROW_NUMBER() OVER (PARTITION BY orbit_type)`
* **`GROUP BY … WITH ROLLUP`** with `GROUPING()`: subtotals per orbit class plus a grand total
* **Cursor and `CONTINUE HANDLER`:** the seed walks windows with a cursor. About 700 of roughly 2,750 booking attempts are rejected by the triggers and skipped, so the seed data also passes through the integrity rules.
* **Upsert:** `sp_generate_invoice` uses `INSERT … ON DUPLICATE KEY UPDATE` with the `LAST_INSERT_ID(expr)` trick, so regenerating an invoice is idempotent
* **Event scheduler:** `ev_nightly_housekeeping` expires contracts, completes past bookings, releases leases and flags overdue invoices
* **Indexing:** `EXPLAIN ANALYZE` in `demo_queries.sql` compares a full table scan with an index range scan on `idx_bk_station_time`
* **Least privilege:** roles `scms_admin`, `scms_operator` and `scms_readonly`. The API connects as `scms_app`, which has no DDL rights and cannot write to `audit_log`. `scms_analyst` can read only the reporting views.

### MongoDB

* **Time-series collection** `telemetry`: `metaField: meta`, granularity `seconds`, and a 30-day TTL via `expireAfterSeconds`
* **Aggregation pipelines:**
  * `$dateTrunc` bucketing with avg/min/max for charts
  * `$sort` + `$group`/`$first` for the latest packet per satellite
  * `$facet` for anomaly statistics in a single round trip
  * `$merge` to maintain `telemetry_hourly` as an incrementally refreshed materialized view
* **Anomaly episodes:** upserted with `$setOnInsert`, `$inc`, `$max`, and `$push` + `$slice` (keeps the last 20 samples). Status changes use an optimistic-concurrency guard (`{_id, status: current}`).
* **Text index** on `event_logs.message`, used for full-text search
