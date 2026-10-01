-- =====================================================================
-- 08_seed.sql  —  realistic demo data, generated relative to today so
-- the system always has past history and upcoming sessions.
-- Demo login password for every user:  Passw0rd!
-- =====================================================================
USE scms;
SET @app_user_id = 1;

-- ---------------------------------------------------------------------
-- Reference data
-- ---------------------------------------------------------------------
INSERT INTO frequency_bands (code, min_mhz, max_mhz, typical_use) VALUES
 ('L',   1000,  2000, 'Navigation, mobile satellite services'),
 ('S',   2000,  4000, 'TT&C, weather radar, ISS comms'),
 ('C',   4000,  8000, 'TV distribution, rain-resilient trunking'),
 ('X',   8000, 12000, 'Earth-observation downlink, defence'),
 ('Ku', 12000, 18000, 'DTH broadcast, VSAT, broadband'),
 ('Ka', 26500, 40000, 'High-throughput broadband');

INSERT INTO clients (name, org_type, country, contact_email) VALUES
 ('SkyLink Broadband Pvt Ltd',        'commercial', 'India',     'noc@skylink.example'),
 ('National Disaster Response Cell',  'government', 'India',     'ops@ndrc.example'),
 ('Polar Climate Research Institute', 'research',   'Norway',    'data@pcri.example'),
 ('OrbitCast Media Networks',         'commercial', 'Singapore', 'uplink@orbitcast.example'),
 ('AgriSense Analytics',              'commercial', 'India',     'eo@agrisense.example');

INSERT INTO users (full_name, email, password_hash, role, client_id) VALUES
 ('System Administrator', 'admin@scms.local',     '$2b$10$M0mH/irmvqNA5xdvh/9LNe2BLnLBpB.Cl51KI.cjAgH1xN6BpQYpK', 'admin',    NULL),
 ('Priya Raman',          'priya@scms.local',     '$2b$10$M0mH/irmvqNA5xdvh/9LNe2BLnLBpB.Cl51KI.cjAgH1xN6BpQYpK', 'operator', NULL),
 ('Arjun Mehta',          'arjun@scms.local',     '$2b$10$M0mH/irmvqNA5xdvh/9LNe2BLnLBpB.Cl51KI.cjAgH1xN6BpQYpK', 'operator', NULL),
 ('SkyLink NOC',          'noc@skylink.example',  '$2b$10$M0mH/irmvqNA5xdvh/9LNe2BLnLBpB.Cl51KI.cjAgH1xN6BpQYpK', 'client',   1),
 ('NDRC Operations',      'ops@ndrc.example',     '$2b$10$M0mH/irmvqNA5xdvh/9LNe2BLnLBpB.Cl51KI.cjAgH1xN6BpQYpK', 'client',   2),
 ('PCRI Data Desk',       'data@pcri.example',    '$2b$10$M0mH/irmvqNA5xdvh/9LNe2BLnLBpB.Cl51KI.cjAgH1xN6BpQYpK', 'client',   3),
 ('OrbitCast Uplink',     'uplink@orbitcast.example', '$2b$10$M0mH/irmvqNA5xdvh/9LNe2BLnLBpB.Cl51KI.cjAgH1xN6BpQYpK', 'client', 4),
 ('AgriSense EO Team',    'eo@agrisense.example', '$2b$10$M0mH/irmvqNA5xdvh/9LNe2BLnLBpB.Cl51KI.cjAgH1xN6BpQYpK', 'client',   5);

-- ---------------------------------------------------------------------
-- Space segment
-- ---------------------------------------------------------------------
INSERT INTO satellites (norad_id, name, model, orbit_type, operator_org, launch_date, mass_kg, status) VALUES
 (45026,  'GSAT-30',        'I-3K',          'GEO', 'ISRO',             '2020-01-17',   3357, 'active'),
 (44035,  'GSAT-31',        'I-2K',          'GEO', 'ISRO',             '2019-02-06',   2536, 'active'),
 (41752,  'INSAT-3DR',      'I-2K',          'GEO', 'ISRO',             '2016-09-08',   2211, 'active'),
 (44476,  'Intelsat 39',    'SSL-1300',      'GEO', 'Intelsat',         '2019-08-06',   6600, 'active'),
 (43488,  'SES-12',         'Eurostar-3000', 'GEO', 'SES',              '2018-06-04',   5383, 'active'),
 (44804,  'Cartosat-3',     'IRS-1',         'LEO', 'ISRO',             '2019-11-27',   1625, 'active'),
 (44233,  'RISAT-2B',       'IRS-1',         'LEO', 'ISRO',             '2019-05-22',    615, 'active'),
 (40697,  'Sentinel-2A',    'AstroBus-L',    'LEO', 'ESA',              '2015-06-23',   1130, 'active'),
 (49260,  'Landsat 9',      'LEOStar-3',     'LEO', 'NASA/USGS',        '2021-09-27',   2711, 'active'),
 (25544,  'ISS (ZARYA)',    'ISS',           'LEO', 'NASA/Roscosmos',   '1998-11-20', 420000, 'active'),
 (48859,  'GPS III SV05',   'GPS-III',       'MEO', 'US Space Force',   '2021-06-17',   4311, 'active'),
 (49809,  'Galileo FOC FM23','Galileo-FOC',  'MEO', 'ESA/EUSPA',        '2021-12-05',    715, 'active'),
 (44453,  'Meridian 8',     'Meridian',      'HEO', 'Roscosmos',        '2019-07-30',   2000, 'standby');

INSERT INTO orbits (sat_id, altitude_km, inclination_deg, period_min, geo_longitude, epoch)
SELECT s.sat_id, o.alt, o.inc, o.per, o.lon, NOW() - INTERVAL 1 DAY
  FROM satellites s JOIN (
        SELECT 45026 n, 35786 alt, 0.05 inc, 1436.07 per, 83.0  lon UNION ALL
        SELECT 44035,  35786, 0.04, 1436.07, 48.0  UNION ALL
        SELECT 41752,  35786, 0.10, 1436.07, 74.0  UNION ALL
        SELECT 44476,  35786, 0.02, 1436.07, 62.0  UNION ALL
        SELECT 43488,  35786, 0.03, 1436.07, 95.0  UNION ALL
        SELECT 44804,    509, 97.50,  94.70, NULL  UNION ALL
        SELECT 44233,    557, 37.00,  95.70, NULL  UNION ALL
        SELECT 40697,    786, 98.57, 100.60, NULL  UNION ALL
        SELECT 49260,    705, 98.20,  98.90, NULL  UNION ALL
        SELECT 25544,    420, 51.64,  92.90, NULL  UNION ALL
        SELECT 48859,  20200, 55.00, 717.97, NULL  UNION ALL
        SELECT 49809,  23222, 56.00, 844.76, NULL  UNION ALL
        SELECT 44453,  20000, 62.80, 718.00, NULL
  ) o ON o.n = s.norad_id;

-- Transponders: GEO comsats carry C/Ku/Ka payloads; EO satellites an X-band
-- data downlink plus S-band TT&C; navigation satellites L-band + S-band.
INSERT INTO transponders (sat_id, band_id, label, center_freq_mhz, bandwidth_mhz, polarization)
SELECT s.sat_id, b.band_id, t.label, t.freq, t.bw, t.pol
  FROM (
    SELECT 'GSAT-30' sat,'C' band,'C-01' label, 3720 freq, 36 bw,'H' pol UNION ALL
    SELECT 'GSAT-30','C' ,'C-02', 3760, 36,'V'   UNION ALL
    SELECT 'GSAT-30','Ku','Ku-01',11010, 54,'H'  UNION ALL
    SELECT 'GSAT-30','Ku','Ku-02',11090, 54,'V'  UNION ALL
    SELECT 'GSAT-30','S' ,'TTC',   2245,  2,'RHCP' UNION ALL
    SELECT 'GSAT-31','Ku','Ku-01',10990, 54,'H'  UNION ALL
    SELECT 'GSAT-31','Ku','Ku-02',11070, 54,'V'  UNION ALL
    SELECT 'GSAT-31','S' ,'TTC',   2250,  2,'RHCP' UNION ALL
    SELECT 'INSAT-3DR','C','C-01', 4000, 36,'H'  UNION ALL
    SELECT 'INSAT-3DR','S','TTC',  2255,  2,'RHCP' UNION ALL
    SELECT 'Intelsat 39','C' ,'C-01', 3800, 72,'H' UNION ALL
    SELECT 'Intelsat 39','Ku','Ku-01',11450, 72,'V' UNION ALL
    SELECT 'Intelsat 39','Ka','Ka-01',19950,250,'LHCP' UNION ALL
    SELECT 'Intelsat 39','S' ,'TTC',  2260,  2,'RHCP' UNION ALL
    SELECT 'SES-12','Ku','Ku-01',11700, 54,'H'   UNION ALL
    SELECT 'SES-12','Ka','Ka-01',20200,250,'RHCP' UNION ALL
    SELECT 'SES-12','S' ,'TTC',  2265,  2,'RHCP' UNION ALL
    SELECT 'Cartosat-3','X','X-DL', 8200,150,'RHCP' UNION ALL
    SELECT 'Cartosat-3','S','TTC',  2210,  2,'RHCP' UNION ALL
    SELECT 'RISAT-2B','X','X-DL', 8250,150,'RHCP' UNION ALL
    SELECT 'RISAT-2B','S','TTC',  2215,  2,'RHCP' UNION ALL
    SELECT 'Sentinel-2A','X','X-DL', 8100,280,'RHCP' UNION ALL
    SELECT 'Sentinel-2A','S','TTC',  2220,  2,'RHCP' UNION ALL
    SELECT 'Landsat 9','X','X-DL', 8212,384,'RHCP' UNION ALL
    SELECT 'Landsat 9','S','TTC',  2287,  2,'RHCP' UNION ALL
    SELECT 'ISS (ZARYA)','S','S-01', 2265,  5,'RHCP' UNION ALL
    SELECT 'ISS (ZARYA)','Ku','Ku-01',13800, 50,'LHCP' UNION ALL
    SELECT 'GPS III SV05','L','L1', 1575.42, 24,'RHCP' UNION ALL
    SELECT 'GPS III SV05','S','TTC',  2227,  2,'RHCP' UNION ALL
    SELECT 'Galileo FOC FM23','L','E1', 1575.42, 24,'RHCP' UNION ALL
    SELECT 'Galileo FOC FM23','S','TTC',  2202,  2,'RHCP' UNION ALL
    SELECT 'Meridian 8','S','TTC',  2240,  2,'RHCP'
  ) t
  JOIN satellites s      ON s.name = t.sat
  JOIN frequency_bands b ON b.code = t.band;

-- ---------------------------------------------------------------------
-- Ground segment
-- ---------------------------------------------------------------------
INSERT INTO ground_stations (code, name, city, country, latitude, longitude, antenna_diameter_m, status) VALUES
 ('BLR', 'Bengaluru TT&C Station',        'Bengaluru', 'India',     12.95100,  77.51200, 11.0, 'online'),
 ('HSN', 'Hassan Master Control Facility','Hassan',    'India',     13.00700,  76.09700, 32.0, 'online'),
 ('LKO', 'Lucknow Ground Station',        'Lucknow',   'India',     26.91200,  80.95600, 10.0, 'online'),
 ('SVB', 'Svalbard Polar Station',        'Longyearbyen','Norway',  78.22980,  15.40780, 13.0, 'online'),
 ('MRU', 'Mauritius Tracking Station',    'Port Louis','Mauritius',-20.16090,  57.50120,  9.0, 'online'),
 ('KIR', 'Kiruna Ground Station',         'Kiruna',    'Sweden',    67.85700,  20.96400, 15.0, 'maintenance');

INSERT INTO station_bands (station_id, band_id)
SELECT g.station_id, b.band_id
  FROM (
    SELECT 'BLR' st, 'S' band UNION ALL SELECT 'BLR','X'  UNION ALL SELECT 'BLR','C'  UNION ALL
    SELECT 'HSN','S'  UNION ALL SELECT 'HSN','C'  UNION ALL SELECT 'HSN','Ku' UNION ALL SELECT 'HSN','Ka' UNION ALL
    SELECT 'LKO','S'  UNION ALL SELECT 'LKO','X'  UNION ALL SELECT 'LKO','L'  UNION ALL
    SELECT 'SVB','S'  UNION ALL SELECT 'SVB','X'  UNION ALL SELECT 'SVB','Ka' UNION ALL
    SELECT 'MRU','S'  UNION ALL SELECT 'MRU','X'  UNION ALL SELECT 'MRU','L'  UNION ALL SELECT 'MRU','Ku' UNION ALL
    SELECT 'KIR','S'  UNION ALL SELECT 'KIR','X'  UNION ALL SELECT 'KIR','L'
  ) x
  JOIN ground_stations g ON g.code = x.st
  JOIN frequency_bands b ON b.code = x.band;

-- ---------------------------------------------------------------------
-- Visibility windows for the past 30 and next 30 days (recursive CTE).
--  * GEO : visible only if |station latitude| < 70 and the longitude gap is
--          < 70 deg; modelled as two 4-hour service windows per day.
--  * LEO : three short passes (8-14 min) per day.
--  * MEO/HEO : one long pass (2-4 h) per day.
-- Pass times are pseudo-random but deterministic (hash of ids and day).
-- Only satellite/station pairs sharing at least one band get windows.
-- ---------------------------------------------------------------------
INSERT INTO comm_windows (sat_id, station_id, aos_ts, los_ts, max_elevation_deg)
WITH RECURSIVE days(d) AS (
        SELECT -30 UNION ALL SELECT d + 1 FROM days WHERE d < 30
     ),
     slots(k) AS (SELECT 0 UNION ALL SELECT 1 UNION ALL SELECT 2),
     pairs AS (
        SELECT DISTINCT s.sat_id, s.orbit_type, g.station_id, g.latitude, g.longitude, o.geo_longitude
          FROM satellites s
          JOIN orbits o        ON o.sat_id = s.sat_id
          JOIN transponders t  ON t.sat_id = s.sat_id
          JOIN station_bands sb ON sb.band_id = t.band_id
          JOIN ground_stations g ON g.station_id = sb.station_id
     ),
     raw AS (
        SELECT p.sat_id, p.station_id, p.orbit_type, dy.d, sl.k,
               CAST(CURDATE() AS DATETIME) + INTERVAL dy.d DAY
                 + INTERVAL CASE p.orbit_type
                     WHEN 'GEO' THEN (sl.k * 720 + 60 + MOD(p.station_id * 40, 300))
                     ELSE MOD(p.sat_id * 97 + p.station_id * 53 + sl.k * 480 + (dy.d + 30) * 37, 1380)
                   END MINUTE AS aos,
               CASE p.orbit_type
                   WHEN 'GEO' THEN 240
                   WHEN 'LEO' THEN 8 + MOD(p.sat_id + p.station_id + sl.k + dy.d + 30, 7)
                   ELSE 120 + MOD(p.sat_id * 13 + dy.d + 30, 120)
               END AS dur_min,
               CASE p.orbit_type
                   WHEN 'GEO' THEN ROUND(90 - ABS(p.latitude) - ABS(p.longitude - p.geo_longitude) * 0.5, 2)
                   ELSE 10 + MOD(p.sat_id * 31 + p.station_id * 17 + sl.k * 11 + dy.d + 30, 76)
               END AS elev
          FROM pairs p CROSS JOIN days dy CROSS JOIN slots sl
         WHERE (p.orbit_type = 'GEO' AND sl.k < 2
                AND ABS(p.latitude) < 70 AND ABS(p.longitude - p.geo_longitude) < 70)
            OR (p.orbit_type = 'LEO')
            OR (p.orbit_type IN ('MEO','HEO') AND sl.k = 0)
     )
SELECT sat_id, station_id, aos, aos + INTERVAL dur_min MINUTE, GREATEST(LEAST(elev, 90), 5)
  FROM raw;

-- ---------------------------------------------------------------------
-- Commercial data
-- ---------------------------------------------------------------------
INSERT INTO contracts (client_id, contract_code, start_date, end_date, rate_per_mhz_hour, rate_per_pass_min, status) VALUES
 (1, 'SKY-2026-01', CURDATE() - INTERVAL 120 DAY, CURDATE() + INTERVAL 245 DAY, 3.20, 15.00, 'active'),
 (2, 'NDR-2026-01', CURDATE() - INTERVAL  90 DAY, CURDATE() + INTERVAL 275 DAY, 1.50,  8.00, 'active'),
 (3, 'PCR-2026-01', CURDATE() - INTERVAL  60 DAY, CURDATE() + INTERVAL 120 DAY, 1.20, 10.00, 'active'),
 (4, 'ORB-2026-01', CURDATE() - INTERVAL 150 DAY, CURDATE() + INTERVAL 215 DAY, 3.80, 16.00, 'active'),
 (5, 'AGR-2026-01', CURDATE() - INTERVAL  45 DAY, CURDATE() + INTERVAL 320 DAY, 2.10, 18.00, 'active'),
 (4, 'ORB-2025-07', CURDATE() - INTERVAL 400 DAY, CURDATE() - INTERVAL 151 DAY, 3.50, 15.00, 'active');

-- Which clients use which satellite platforms (seed-only helper table)
CREATE TEMPORARY TABLE seed_affinity (model VARCHAR(40), client_id INT);
INSERT INTO seed_affinity VALUES
 ('I-3K',1),('I-3K',4),('I-3K',2), ('I-2K',1),('I-2K',4),('I-2K',2),
 ('SSL-1300',1),('SSL-1300',4),('SSL-1300',2), ('Eurostar-3000',1),('Eurostar-3000',4),
 ('IRS-1',5),('IRS-1',2),('IRS-1',3), ('AstroBus-L',5),('AstroBus-L',3), ('LEOStar-3',5),('LEOStar-3',3),
 ('ISS',3), ('GPS-III',2),('GPS-III',3), ('Galileo-FOC',2),('Galileo-FOC',3), ('Meridian',2);

DROP PROCEDURE IF EXISTS sp_seed_activity;
DELIMITER $$
-- Walks the windows with a cursor and attempts bookings / allocations.
-- Conflicting attempts are rejected by the triggers and simply skipped
-- (CONTINUE HANDLER), which exercises the integrity rules on seed data too.
CREATE PROCEDURE sp_seed_activity()
BEGIN
    DECLARE done INT DEFAULT 0;
    DECLARE v_window INT; DECLARE v_sat INT; DECLARE v_station INT;
    DECLARE v_aos DATETIME; DECLARE v_los DATETIME; DECLARE v_orbit VARCHAR(5);
    DECLARE v_tp INT; DECLARE v_contract INT; DECLARE v_len INT;
    DECLARE v_purpose VARCHAR(20);
    DECLARE v_inserted INT DEFAULT 0; DECLARE v_skipped INT DEFAULT 0;
    DECLARE v_skip_flag INT DEFAULT 0;
    DECLARE v_bw DECIMAL(7,2); DECLARE v_i INT;

    DECLARE cur CURSOR FOR
        SELECT w.window_id, w.sat_id, w.station_id, w.aos_ts, w.los_ts, s.orbit_type
          FROM comm_windows w JOIN satellites s ON s.sat_id = w.sat_id
         WHERE w.aos_ts BETWEEN NOW() - INTERVAL 30 DAY AND NOW() + INTERVAL 14 DAY
           AND MOD(w.window_id * 7, 5) < 2          -- book roughly 40% of windows
         ORDER BY w.aos_ts;
    DECLARE tcur CURSOR FOR
        SELECT t.transponder_id, t.bandwidth_mhz FROM transponders t
          JOIN satellites s ON s.sat_id = t.sat_id
         WHERE s.orbit_type = 'GEO' AND t.label <> 'TTC';
    DECLARE CONTINUE HANDLER FOR NOT FOUND SET done = 1;
    DECLARE CONTINUE HANDLER FOR SQLSTATE '45000' SET v_skip_flag = 1;

    OPEN cur;
    booking_loop: LOOP
        FETCH cur INTO v_window, v_sat, v_station, v_aos, v_los, v_orbit;
        IF done = 1 THEN LEAVE booking_loop; END IF;

        SET v_tp = NULL, v_contract = NULL;
        SELECT MIN(t.transponder_id) INTO v_tp
          FROM transponders t JOIN station_bands sb ON sb.band_id = t.band_id
         WHERE t.sat_id = v_sat AND sb.station_id = v_station
           AND t.label <> CASE WHEN MOD(v_window, 4) = 0 THEN '' ELSE 'TTC' END;
        IF v_tp IS NULL THEN
            SELECT MIN(t.transponder_id) INTO v_tp
              FROM transponders t JOIN station_bands sb ON sb.band_id = t.band_id
             WHERE t.sat_id = v_sat AND sb.station_id = v_station;
        END IF;

        SELECT c.contract_id INTO v_contract
          FROM contracts c
          JOIN seed_affinity sa ON sa.client_id = c.client_id
          JOIN satellites s     ON s.model = sa.model AND s.sat_id = v_sat
         WHERE c.start_date <= DATE(v_aos) AND c.end_date >= DATE(v_los)
         ORDER BY MOD(c.contract_id * 31 + v_window, 7) LIMIT 1;
        SET done = 0;     -- a SELECT INTO with no row would have set it

        IF v_tp IS NOT NULL AND v_contract IS NOT NULL THEN
            SET v_len = CASE v_orbit WHEN 'LEO' THEN TIMESTAMPDIFF(MINUTE, v_aos, v_los) - 2
                                     WHEN 'GEO' THEN 30 + MOD(v_window, 4) * 15
                                     ELSE 45 END;
            SET v_purpose = ELT(1 + MOD(v_window, 5), 'telemetry', 'command', 'data_downlink', 'broadcast', 'ranging');
            SET v_skip_flag = 0;
            INSERT INTO bookings (window_id, sat_id, station_id, transponder_id, contract_id, booked_by,
                                  start_ts, end_ts, purpose, status)
            VALUES (v_window, v_sat, v_station, v_tp, v_contract, 2 + MOD(v_window, 2),
                    v_aos + INTERVAL 1 MINUTE, v_aos + INTERVAL (1 + v_len) MINUTE, v_purpose,
                    IF(v_aos + INTERVAL (1 + v_len) MINUTE < NOW(), 'completed', 'confirmed'));
            IF v_skip_flag = 1 THEN SET v_skipped = v_skipped + 1;
            ELSE SET v_inserted = v_inserted + 1; END IF;
        END IF;
    END LOOP;
    CLOSE cur;

    -- Bandwidth leases on GEO payload transponders: several clients try to
    -- lease overlapping slices; requests that would overbook are skipped.
    SET done = 0;
    OPEN tcur;
    alloc_loop: LOOP
        FETCH tcur INTO v_tp, v_bw;
        IF done = 1 THEN LEAVE alloc_loop; END IF;
        SET v_i = 0;
        WHILE v_i < 5 DO
            SET v_skip_flag = 0;
            INSERT INTO bandwidth_allocations (contract_id, transponder_id, allocated_mhz, start_ts, end_ts)
            VALUES (ELT(1 + MOD(v_tp + v_i, 3), 1, 4, 2), v_tp,      -- broadcasters + NDRC lease GEO capacity
                    ROUND(v_bw * (0.18 + MOD(v_tp * 7 + v_i * 3, 5) * 0.05)),
                    CAST(CURDATE() AS DATETIME) - INTERVAL (40 - v_i * 9) DAY,
                    CAST(CURDATE() AS DATETIME) + INTERVAL (30 + v_i * 12) DAY);
            SET v_i = v_i + 1;
        END WHILE;
    END LOOP;
    CLOSE tcur;

    SELECT v_inserted AS bookings_created, v_skipped AS bookings_rejected_by_triggers,
           (SELECT COUNT(*) FROM bandwidth_allocations) AS allocations_created;
END$$
DELIMITER ;

CALL sp_seed_activity();
DROP PROCEDURE sp_seed_activity;
DROP TEMPORARY TABLE seed_affinity;

-- Invoices for the last two calendar months, via the billing procedure
CALL sp_generate_invoice(1, DATE_FORMAT(CURDATE() - INTERVAL 2 MONTH, '%Y-%m-01'), DATE_FORMAT(CURDATE() - INTERVAL 1 MONTH, '%Y-%m-01'), @inv);
CALL sp_generate_invoice(2, DATE_FORMAT(CURDATE() - INTERVAL 2 MONTH, '%Y-%m-01'), DATE_FORMAT(CURDATE() - INTERVAL 1 MONTH, '%Y-%m-01'), @inv);
CALL sp_generate_invoice(4, DATE_FORMAT(CURDATE() - INTERVAL 2 MONTH, '%Y-%m-01'), DATE_FORMAT(CURDATE() - INTERVAL 1 MONTH, '%Y-%m-01'), @inv);
CALL sp_generate_invoice(1, DATE_FORMAT(CURDATE() - INTERVAL 1 MONTH, '%Y-%m-01'), DATE_FORMAT(CURDATE(), '%Y-%m-01'), @inv);
CALL sp_generate_invoice(2, DATE_FORMAT(CURDATE() - INTERVAL 1 MONTH, '%Y-%m-01'), DATE_FORMAT(CURDATE(), '%Y-%m-01'), @inv);
CALL sp_generate_invoice(3, DATE_FORMAT(CURDATE() - INTERVAL 1 MONTH, '%Y-%m-01'), DATE_FORMAT(CURDATE(), '%Y-%m-01'), @inv);
CALL sp_generate_invoice(4, DATE_FORMAT(CURDATE() - INTERVAL 1 MONTH, '%Y-%m-01'), DATE_FORMAT(CURDATE(), '%Y-%m-01'), @inv);
CALL sp_generate_invoice(5, DATE_FORMAT(CURDATE() - INTERVAL 1 MONTH, '%Y-%m-01'), DATE_FORMAT(CURDATE(), '%Y-%m-01'), @inv);
UPDATE invoices SET status = 'paid' WHERE period_end < DATE_FORMAT(CURDATE() - INTERVAL 1 MONTH, '%Y-%m-01') + INTERVAL 1 DAY;

-- Kiruna is down for maintenance: its future sessions were cancelled
UPDATE bookings b JOIN ground_stations g ON g.station_id = b.station_id
   SET b.status = 'cancelled'
 WHERE g.code = 'KIR' AND b.start_ts > NOW();

-- Expire the old contract (same routine the nightly event runs)
CALL sp_housekeeping();

-- Start the audit trail clean; seed activity is not user activity
TRUNCATE TABLE audit_log;
SET @app_user_id = NULL;
