-- =====================================================================
-- demo_queries.sql  —  walkthrough of the advanced DB features.
-- Run with:  mysql -u root --force -t scms < db/mysql/demo_queries.sql
-- (--force continues past the statements that are SUPPOSED to fail)
-- =====================================================================
USE scms;
SET @app_user_id = 2;   -- acting as operator "Priya Raman" (shows up in audit_log)

-- ---------------------------------------------------------------------
-- 1. A valid booking through the transactional procedure
-- ---------------------------------------------------------------------
-- pick a future window whose station and satellite are both free
SELECT w.window_id, w.sat_id, w.station_id, w.aos_ts, w.los_ts,
       (SELECT MIN(t.transponder_id) FROM transponders t
          JOIN station_bands sb ON sb.band_id = t.band_id
         WHERE t.sat_id = w.sat_id AND sb.station_id = w.station_id AND t.status = 'active') AS tp
  INTO @w, @w_sat, @w_station, @w_aos, @w_los, @w_tp
  FROM comm_windows w
  JOIN satellites s      ON s.sat_id = w.sat_id AND s.status = 'active'
  JOIN ground_stations g ON g.station_id = w.station_id AND g.status = 'online'
 WHERE w.aos_ts > NOW() + INTERVAL 1 DAY
   AND NOT EXISTS (SELECT 1 FROM bookings b WHERE b.status <> 'cancelled'
                     AND (b.station_id = w.station_id OR b.sat_id = w.sat_id)
                     AND b.start_ts < w.los_ts AND b.end_ts > w.aos_ts)
 ORDER BY w.aos_ts LIMIT 1;

SELECT @w AS window_id, @w_aos AS aos, @w_los AS los, @w_tp AS transponder;

CALL sp_book_window(@w, @w_tp, 1, 2, @w_aos, LEAST(@w_los, @w_aos + INTERVAL 5 MINUTE), 'telemetry', @new_booking);
SELECT @new_booking AS created_booking_id;
SELECT * FROM v_booking_details WHERE booking_id = @new_booking;

-- ---------------------------------------------------------------------
-- 2. Integrity rules enforced by triggers (each CALL below MUST fail)
-- ---------------------------------------------------------------------
-- 2a. Same station, overlapping time  -> STATION_CONFLICT
CALL sp_book_window(@w, @w_tp, 2, 2, @w_aos + INTERVAL 1 MINUTE, LEAST(@w_los, @w_aos + INTERVAL 4 MINUTE), 'command', @x);

-- 2b. Booking extends past loss-of-signal -> OUTSIDE_WINDOW
CALL sp_book_window(@w, @w_tp, 2, 2, @w_los - INTERVAL 1 MINUTE, @w_los + INTERVAL 10 MINUTE, 'command', @x);

-- 2c. Transponder band not supported by the station -> BAND_MISMATCH
--     (Ka transponder on Intelsat 39, Bengaluru has no Ka feed)
SELECT w.window_id, w.aos_ts INTO @w_blr, @w_blr_aos
  FROM comm_windows w
  JOIN ground_stations g ON g.station_id = w.station_id AND g.code = 'BLR'
  JOIN satellites s      ON s.sat_id = w.sat_id AND s.name = 'Intelsat 39'
 WHERE w.aos_ts > NOW() ORDER BY w.aos_ts LIMIT 1;
SELECT transponder_id INTO @ka_tp FROM transponders t JOIN satellites s USING (sat_id)
 WHERE s.name = 'Intelsat 39' AND t.label = 'Ka-01';
CALL sp_book_window(@w_blr, @ka_tp, 1, 2, @w_blr_aos, @w_blr_aos + INTERVAL 10 MINUTE, 'broadcast', @x);

-- 2d. Over-leasing a transponder -> CAPACITY_EXCEEDED
SELECT transponder_id, satellite, label, bandwidth_mhz, peak_allocated_mhz
  FROM v_transponder_utilization WHERE transponder_id = 1;
CALL sp_allocate_bandwidth(3, 1, 20, NOW(), NOW() + INTERVAL 7 DAY, @x);

-- 2e. ...but a request that fits is accepted (Ka transponder has headroom)
CALL sp_allocate_bandwidth(3, @ka_tp, 10, NOW() + INTERVAL 1 DAY, NOW() + INTERVAL 8 DAY, @new_alloc);
SELECT @new_alloc AS created_allocation_id;

-- 2f. Declarative constraints: CHECK and UNIQUE
INSERT INTO frequency_bands (code, min_mhz, max_mhz) VALUES ('Q', 50000, 40000);       -- chk_band_range
INSERT INTO satellites (norad_id, name, model, orbit_type, operator_org, launch_date, mass_kg)
VALUES (25544, 'Duplicate ISS', 'ISS', 'LEO', 'X', '2020-01-01', 10);                     -- UNIQUE norad_id

-- ---------------------------------------------------------------------
-- 3. Cancel + audit trail (trigger-written, includes JSON old/new values)
-- ---------------------------------------------------------------------
CALL sp_cancel_booking(@new_booking);
CALL sp_cancel_booking(@new_booking);      -- second time fails: INVALID_STATE
SELECT a.audit_id, a.table_name, a.action, a.record_id, u.full_name AS changed_by,
       a.old_values, a.new_values, a.changed_at
  FROM audit_log a LEFT JOIN users u ON u.user_id = a.changed_by
 ORDER BY a.audit_id;

-- ---------------------------------------------------------------------
-- 4. Billing procedure (idempotent: re-running recomputes the same invoice)
-- ---------------------------------------------------------------------
CALL sp_generate_invoice(3, CURDATE() - INTERVAL 30 DAY, CURDATE(), @inv);
CALL sp_generate_invoice(3, CURDATE() - INTERVAL 30 DAY, CURDATE(), @inv2);
SELECT @inv AS first_call, @inv2 AS second_call;
SELECT * FROM invoices WHERE invoice_id = @inv;

-- ---------------------------------------------------------------------
-- 5. Stored functions
-- ---------------------------------------------------------------------
SELECT g.code, fn_station_load(g.station_id, CURDATE())                     AS today_pct,
               fn_station_load(g.station_id, CURDATE() - INTERVAL 1 DAY)    AS yesterday_pct
  FROM ground_stations g;

-- ---------------------------------------------------------------------
-- 6. Analytical SQL: CTEs + window functions
-- ---------------------------------------------------------------------
-- 6a. Clients ranked by billed revenue, with share of total
SELECT client, total_billed,
       RANK() OVER (ORDER BY total_billed DESC)                         AS revenue_rank,
       ROUND(100 * total_billed / SUM(total_billed) OVER (), 1)         AS share_pct
  FROM v_revenue_by_client;

-- 6b. Daily booked minutes per station with day-over-day change (LAG)
--     and a 7-day moving average
WITH daily AS (
    SELECT station_code, DATE(start_ts) AS day, SUM(duration_min) AS minutes
      FROM v_booking_details
     WHERE status <> 'cancelled' AND start_ts >= CURDATE() - INTERVAL 14 DAY AND start_ts < CURDATE()
     GROUP BY station_code, DATE(start_ts)
)
SELECT station_code, day, minutes,
       minutes - LAG(minutes) OVER w                                    AS change_vs_prev_day,
       ROUND(AVG(minutes) OVER (w ROWS BETWEEN 6 PRECEDING AND CURRENT ROW), 1) AS moving_avg_7d
  FROM daily
WINDOW w AS (PARTITION BY station_code ORDER BY day)
 ORDER BY station_code, day
 LIMIT 20;

-- 6c. Busiest satellite per orbit class (ROW_NUMBER inside a CTE)
WITH usage_per_sat AS (
    SELECT s.orbit_type, s.name, COUNT(*) AS sessions, SUM(TIMESTAMPDIFF(MINUTE, b.start_ts, b.end_ts)) AS minutes
      FROM bookings b JOIN satellites s ON s.sat_id = b.sat_id
     WHERE b.status <> 'cancelled'
     GROUP BY s.orbit_type, s.name
)
SELECT orbit_type, name, sessions, minutes
  FROM (SELECT u.*, ROW_NUMBER() OVER (PARTITION BY orbit_type ORDER BY minutes DESC) AS rn
          FROM usage_per_sat u) ranked
 WHERE rn = 1;

-- ---------------------------------------------------------------------
-- 7. Indexing: the overlap check with and without the composite index
-- ---------------------------------------------------------------------
EXPLAIN ANALYZE
SELECT 1 FROM bookings IGNORE INDEX (idx_bk_station_time)
 WHERE station_id = 1 AND status <> 'cancelled'
   AND start_ts < NOW() + INTERVAL 1 HOUR AND end_ts > NOW();

EXPLAIN ANALYZE
SELECT 1 FROM bookings
 WHERE station_id = 1 AND status <> 'cancelled'
   AND start_ts < NOW() + INTERVAL 1 HOUR AND end_ts > NOW();

-- ---------------------------------------------------------------------
-- 8. Clean up the demo rows so the script can be re-run
-- ---------------------------------------------------------------------
DELETE FROM bookings WHERE booking_id = @new_booking;
DELETE FROM bandwidth_allocations WHERE allocation_id = @new_alloc;
SET @app_user_id = NULL;
