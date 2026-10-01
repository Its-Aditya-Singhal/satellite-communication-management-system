-- =====================================================================
-- 05_views.sql  —  reporting / access views
-- =====================================================================
USE scms;

-- Every booking with the names an operator needs to read it.
CREATE OR REPLACE VIEW v_booking_details AS
SELECT b.booking_id, b.status, b.purpose, b.start_ts, b.end_ts,
       TIMESTAMPDIFF(MINUTE, b.start_ts, b.end_ts) AS duration_min,
       b.window_id,
       s.sat_id, s.name AS satellite,
       g.station_id, g.code AS station_code, g.name AS station,
       t.transponder_id, t.label AS transponder, fb.code AS band,
       c.contract_id, c.contract_code,
       cl.client_id, cl.name AS client,
       u.full_name AS booked_by, b.created_at
  FROM bookings b
  JOIN satellites s       ON s.sat_id = b.sat_id
  JOIN ground_stations g  ON g.station_id = b.station_id
  JOIN transponders t     ON t.transponder_id = b.transponder_id
  JOIN frequency_bands fb ON fb.band_id = t.band_id
  JOIN contracts c        ON c.contract_id = b.contract_id
  JOIN clients cl         ON cl.client_id = c.client_id
  JOIN users u            ON u.user_id = b.booked_by;

-- Confirmed sessions that have not finished yet (operations board).
CREATE OR REPLACE VIEW v_upcoming_schedule AS
SELECT booking_id, satellite, station_code, station, transponder, band,
       client, purpose, start_ts, end_ts, duration_min
  FROM v_booking_details
 WHERE status = 'confirmed' AND end_ts >= NOW();

-- Client-facing projection: no internal staff names; filtered by client_id in the API.
CREATE OR REPLACE VIEW v_client_bookings AS
SELECT client_id, booking_id, contract_code, satellite, station, band,
       purpose, start_ts, end_ts, duration_min, status
  FROM v_booking_details;

-- Transponder lease utilisation over the next 30 days.
CREATE OR REPLACE VIEW v_transponder_utilization AS
SELECT t.transponder_id, s.sat_id, s.name AS satellite, t.label, fb.code AS band,
       t.bandwidth_mhz, t.status,
       fn_allocated_mhz_at_peak(t.transponder_id, NOW(), NOW() + INTERVAL 30 DAY, NULL) AS peak_allocated_mhz,
       fn_transponder_utilization(t.transponder_id, NOW(), NOW() + INTERVAL 30 DAY) AS utilization_pct
  FROM transponders t
  JOIN satellites s       ON s.sat_id = t.sat_id
  JOIN frequency_bands fb ON fb.band_id = t.band_id;

-- Revenue per client from issued invoices.
CREATE OR REPLACE VIEW v_revenue_by_client AS
SELECT cl.client_id, cl.name AS client, cl.org_type, cl.country,
       COUNT(DISTINCT c.contract_id)                         AS contracts,
       COUNT(i.invoice_id)                                   AS invoices,
       COALESCE(SUM(i.amount), 0)                            AS total_billed,
       COALESCE(SUM(CASE WHEN i.status = 'paid' THEN i.amount END), 0) AS total_paid,
       COALESCE(SUM(CASE WHEN i.status <> 'paid' THEN i.amount END), 0) AS outstanding
  FROM clients cl
  LEFT JOIN contracts c ON c.client_id = cl.client_id
  LEFT JOIN invoices i  ON i.contract_id = c.contract_id
 GROUP BY cl.client_id, cl.name, cl.org_type, cl.country;

-- Ground-station overview: supported bands, today's load, upcoming sessions.
CREATE OR REPLACE VIEW v_station_overview AS
SELECT g.station_id, g.code, g.name, g.city, g.country, g.latitude, g.longitude,
       g.antenna_diameter_m, g.status,
       (SELECT GROUP_CONCAT(fb.code ORDER BY fb.min_mhz SEPARATOR ', ')
          FROM station_bands sb JOIN frequency_bands fb ON fb.band_id = sb.band_id
         WHERE sb.station_id = g.station_id)                     AS bands,
       fn_station_load(g.station_id, CURDATE())                  AS load_today_pct,
       (SELECT COUNT(*) FROM bookings b
         WHERE b.station_id = g.station_id AND b.status = 'confirmed'
           AND b.start_ts >= NOW())                              AS upcoming_sessions
  FROM ground_stations g;
