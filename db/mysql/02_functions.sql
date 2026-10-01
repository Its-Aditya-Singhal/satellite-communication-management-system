-- =====================================================================
-- 02_functions.sql  —  stored functions
-- =====================================================================
USE scms;

DROP FUNCTION IF EXISTS fn_overlap_hours;
DROP FUNCTION IF EXISTS fn_transponder_utilization;
DROP FUNCTION IF EXISTS fn_station_load;
DROP FUNCTION IF EXISTS fn_allocated_mhz_at_peak;

DELIMITER $$

-- Hours of overlap between [a_start,a_end) and [b_start,b_end); 0 if disjoint.
CREATE FUNCTION fn_overlap_hours(a_start DATETIME, a_end DATETIME,
                                 b_start DATETIME, b_end DATETIME)
RETURNS DECIMAL(12,4)
DETERMINISTIC NO SQL
BEGIN
    DECLARE s DATETIME DEFAULT GREATEST(a_start, b_start);
    DECLARE e DATETIME DEFAULT LEAST(a_end, b_end);
    IF e <= s THEN RETURN 0; END IF;
    RETURN TIMESTAMPDIFF(SECOND, s, e) / 3600;
END$$

-- Percentage of a transponder's MHz-hour capacity leased in [p_from, p_to).
CREATE FUNCTION fn_transponder_utilization(p_tp INT, p_from DATETIME, p_to DATETIME)
RETURNS DECIMAL(6,2)
READS SQL DATA
BEGIN
    DECLARE v_capacity DECIMAL(14,4);
    DECLARE v_used     DECIMAL(14,4);

    SELECT bandwidth_mhz * TIMESTAMPDIFF(SECOND, p_from, p_to) / 3600
      INTO v_capacity
      FROM transponders WHERE transponder_id = p_tp;

    IF v_capacity IS NULL OR v_capacity = 0 THEN RETURN 0; END IF;

    SELECT COALESCE(SUM(allocated_mhz * fn_overlap_hours(start_ts, end_ts, p_from, p_to)), 0)
      INTO v_used
      FROM bandwidth_allocations
     WHERE transponder_id = p_tp AND status = 'active'
       AND start_ts < p_to AND end_ts > p_from;

    RETURN ROUND(100 * v_used / v_capacity, 2);
END$$

-- Percentage of a day (24h) that a ground station is busy with confirmed/completed bookings.
CREATE FUNCTION fn_station_load(p_station INT, p_day DATE)
RETURNS DECIMAL(6,2)
READS SQL DATA
BEGIN
    DECLARE v_from DATETIME DEFAULT CAST(p_day AS DATETIME);
    DECLARE v_to   DATETIME DEFAULT v_from + INTERVAL 1 DAY;
    DECLARE v_busy DECIMAL(12,4);

    SELECT COALESCE(SUM(fn_overlap_hours(start_ts, end_ts, v_from, v_to)), 0)
      INTO v_busy
      FROM bookings
     WHERE station_id = p_station AND status <> 'cancelled'
       AND start_ts < v_to AND end_ts > v_from;

    RETURN ROUND(100 * v_busy / 24, 2);
END$$

-- Maximum MHz simultaneously allocated on a transponder at any instant inside
-- [p_from, p_to), optionally ignoring one allocation (used for updates).
-- Peak of a step function is reached at some allocation's start time, so we
-- only need to evaluate those instants.
CREATE FUNCTION fn_allocated_mhz_at_peak(p_tp INT, p_from DATETIME, p_to DATETIME, p_ignore INT)
RETURNS DECIMAL(10,2)
READS SQL DATA
BEGIN
    DECLARE v_peak DECIMAL(10,2);

    SELECT COALESCE(MAX(load_mhz), 0) INTO v_peak
      FROM (
            SELECT pt.t, SUM(a.allocated_mhz) AS load_mhz
              FROM (SELECT p_from AS t
                    UNION
                    SELECT start_ts FROM bandwidth_allocations
                     WHERE transponder_id = p_tp AND status = 'active'
                       AND start_ts >= p_from AND start_ts < p_to) pt
              JOIN bandwidth_allocations a
                ON a.transponder_id = p_tp AND a.status = 'active'
               AND a.allocation_id <> COALESCE(p_ignore, -1)
               AND a.start_ts <= pt.t AND a.end_ts > pt.t
             GROUP BY pt.t
           ) loads;

    RETURN v_peak;
END$$

DELIMITER ;
