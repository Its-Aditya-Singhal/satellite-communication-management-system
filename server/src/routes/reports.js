// Analytical endpoints: views, stored functions, CTEs, window functions, ROLLUP
// on MySQL, combined with MongoDB aggregations for the dashboard.
import { Router } from 'express';
import { query } from '../db/mysql.js';
import { getMongo } from '../db/mongo.js';
import { requireRole, isClient } from '../middleware/auth.js';
import { visibleSatelliteIds } from '../services/scope.js';
import { anomalyStats } from '../services/anomalyService.js';

const router = Router();
const staff = requireRole('admin', 'operator');

router.get('/dashboard', async (req, res) => {
  const client = isClient(req);
  const cid = req.user.clientId;

  const [[kpi], upcoming, byDay] = await Promise.all([
    client
      ? query(
          `SELECT (SELECT COUNT(*) FROM contracts WHERE client_id = ? AND status = 'active') AS active_contracts,
                  (SELECT COUNT(*) FROM v_client_bookings WHERE client_id = ? AND status = 'confirmed' AND start_ts < NOW() + INTERVAL 1 DAY AND end_ts >= NOW()) AS sessions_next_24h,
                  (SELECT COUNT(*) FROM v_client_bookings WHERE client_id = ? AND status <> 'cancelled' AND start_ts >= DATE_FORMAT(CURDATE(), '%Y-%m-01')) AS sessions_this_month,
                  (SELECT COALESCE(SUM(a.allocated_mhz), 0) FROM bandwidth_allocations a JOIN contracts c USING (contract_id)
                    WHERE c.client_id = ? AND a.status = 'active' AND a.start_ts <= NOW() AND a.end_ts > NOW()) AS leased_mhz_now,
                  (SELECT outstanding FROM v_revenue_by_client WHERE client_id = ?) AS outstanding`,
          [cid, cid, cid, cid, cid],
        )
      : query(
          `SELECT (SELECT COUNT(*) FROM satellites WHERE status = 'active')                 AS active_satellites,
                  (SELECT COUNT(*) FROM satellites)                                         AS total_satellites,
                  (SELECT COUNT(*) FROM ground_stations WHERE status = 'online')            AS stations_online,
                  (SELECT COUNT(*) FROM ground_stations)                                    AS total_stations,
                  (SELECT COUNT(*) FROM bookings WHERE status = 'confirmed'
                      AND start_ts < NOW() + INTERVAL 1 DAY AND end_ts >= NOW())            AS sessions_next_24h,
                  (SELECT COUNT(*) FROM contracts WHERE status = 'active')                  AS active_contracts,
                  (SELECT COALESCE(SUM(amount), 0) FROM invoices
                    WHERE period_start >= DATE_FORMAT(CURDATE() - INTERVAL 1 MONTH, '%Y-%m-01')) AS billed_last_month,
                  (SELECT COALESCE(SUM(outstanding), 0) FROM v_revenue_by_client)           AS outstanding,
                  (SELECT ROUND(AVG(utilization_pct), 1) FROM v_transponder_utilization
                    WHERE label <> 'TTC')                                                   AS avg_payload_utilization`,
        ),
    query(
      `SELECT booking_id, satellite, station_code, band, client, purpose, start_ts, end_ts, duration_min
         FROM v_booking_details
        WHERE status = 'confirmed' AND end_ts >= NOW() ${client ? 'AND client_id = ?' : ''}
        ORDER BY start_ts LIMIT 8`,
      client ? [cid] : [],
    ),
    // sessions per day: last 14 days and next 7, split by orbit class
    query(
      `SELECT DATE(b.start_ts) AS day,
              SUM(s.orbit_type = 'LEO') AS LEO, SUM(s.orbit_type = 'GEO') AS GEO,
              SUM(s.orbit_type IN ('MEO','HEO')) AS MEO_HEO, COUNT(*) AS total
         FROM bookings b JOIN satellites s ON s.sat_id = b.sat_id
         ${client ? 'JOIN contracts c ON c.contract_id = b.contract_id' : ''}
        WHERE b.status <> 'cancelled'
          AND b.start_ts >= CURDATE() - INTERVAL 14 DAY AND b.start_ts < CURDATE() + INTERVAL 7 DAY
          ${client ? 'AND c.client_id = ?' : ''}
        GROUP BY DATE(b.start_ts) ORDER BY day`,
      client ? [cid] : [],
    ),
  ]);

  let anomalies = null;
  try {
    anomalies = await anomalyStats(await getMongo(), await visibleSatelliteIds(req));
  } catch { /* MongoDB unavailable: dashboard still renders MySQL data */ }

  res.json({ kpi, upcoming, sessionsByDay: byDay, anomalies });
});

router.get('/revenue', staff, async (req, res) => {
  const [ranking, monthly] = await Promise.all([
    query(
      `SELECT client, org_type, country, contracts, total_billed, total_paid, outstanding,
              RANK() OVER (ORDER BY total_billed DESC)                                 AS revenue_rank,
              ROUND(100 * total_billed / NULLIF(SUM(total_billed) OVER (), 0), 1)      AS share_pct
         FROM v_revenue_by_client ORDER BY revenue_rank`,
    ),
    query(
      `WITH m AS (
           SELECT DATE_FORMAT(i.period_start, '%Y-%m') AS month, SUM(i.amount) AS billed
             FROM invoices i GROUP BY DATE_FORMAT(i.period_start, '%Y-%m'))
       SELECT month, billed,
              SUM(billed) OVER (ORDER BY month)                                         AS cumulative,
              ROUND(100 * (billed - LAG(billed) OVER (ORDER BY month))
                    / NULLIF(LAG(billed) OVER (ORDER BY month), 0), 1)                  AS growth_pct
         FROM m ORDER BY month`,
    ),
  ]);
  res.json({ ranking, monthly });
});

router.get('/utilization', staff, async (req, res) => {
  const [transponders, byBand] = await Promise.all([
    query(`SELECT * FROM v_transponder_utilization WHERE label <> 'TTC' ORDER BY utilization_pct DESC`),
    query(
      `SELECT band, COUNT(*) AS transponders, SUM(bandwidth_mhz) AS capacity_mhz,
              SUM(peak_allocated_mhz) AS peak_allocated_mhz, ROUND(AVG(utilization_pct), 1) AS avg_utilization_pct
         FROM v_transponder_utilization WHERE label <> 'TTC' GROUP BY band ORDER BY capacity_mhz DESC`,
    ),
  ]);
  res.json({ transponders, byBand });
});

router.get('/station-activity', staff, async (req, res) => {
  const days = Math.min(Number(req.query.days) || 14, 60);
  res.json(await query(
    `WITH daily AS (
         SELECT station_code, DATE(start_ts) AS day, COUNT(*) AS sessions, SUM(duration_min) AS minutes
           FROM v_booking_details
          WHERE status <> 'cancelled' AND start_ts >= CURDATE() - INTERVAL ? DAY AND start_ts < CURDATE()
          GROUP BY station_code, DATE(start_ts))
     SELECT station_code, day, sessions, minutes,
            minutes - LAG(minutes) OVER w                                             AS change_vs_prev_day,
            ROUND(AVG(minutes) OVER (w ROWS BETWEEN 6 PRECEDING AND CURRENT ROW), 1)  AS moving_avg_7d
       FROM daily
     WINDOW w AS (PARTITION BY station_code ORDER BY day)
      ORDER BY station_code, day`,
    [days],
  ));
});

// Sub-totals per orbit class and grand total in one pass: GROUP BY ... WITH ROLLUP
router.get('/sessions-summary', staff, async (req, res) => {
  res.json(await query(
    `SELECT IF(GROUPING(s.orbit_type), 'ALL ORBITS', s.orbit_type) AS orbit_type,
            IF(GROUPING(b.purpose), 'All purposes', b.purpose)     AS purpose,
            COUNT(*)                                                AS sessions,
            SUM(TIMESTAMPDIFF(MINUTE, b.start_ts, b.end_ts))        AS minutes
       FROM bookings b JOIN satellites s ON s.sat_id = b.sat_id
      WHERE b.status <> 'cancelled' AND b.start_ts >= CURDATE() - INTERVAL 30 DAY
      GROUP BY s.orbit_type, b.purpose WITH ROLLUP`,
  ));
});

router.get('/top-satellites', staff, async (req, res) => {
  res.json(await query(
    `WITH usage_per_sat AS (
         SELECT s.orbit_type, s.name, COUNT(*) AS sessions,
                SUM(TIMESTAMPDIFF(MINUTE, b.start_ts, b.end_ts)) AS minutes
           FROM bookings b JOIN satellites s ON s.sat_id = b.sat_id
          WHERE b.status <> 'cancelled'
          GROUP BY s.orbit_type, s.name)
     SELECT orbit_type, name, sessions, minutes, rn AS rank_in_orbit
       FROM (SELECT u.*, ROW_NUMBER() OVER (PARTITION BY orbit_type ORDER BY minutes DESC) AS rn
               FROM usage_per_sat u) ranked
      WHERE rn <= 3
      ORDER BY orbit_type, rn`,
  ));
});

export default router;
