-- =====================================================================
-- 03_procedures.sql  —  transactional stored procedures
--
-- Error convention: business-rule violations raise SQLSTATE '45000' with
-- MESSAGE_TEXT  "<CODE>: human readable message". The API maps these to
-- HTTP 409/422 responses.
-- =====================================================================
USE scms;

DROP PROCEDURE IF EXISTS sp_book_window;
DROP PROCEDURE IF EXISTS sp_cancel_booking;
DROP PROCEDURE IF EXISTS sp_allocate_bandwidth;
DROP PROCEDURE IF EXISTS sp_generate_invoice;

DELIMITER $$

-- ---------------------------------------------------------------------
-- Book a session inside a visibility window.
-- Locks the ground-station and satellite rows (SELECT ... FOR UPDATE) so that
-- two concurrent bookings for the same resources are serialised at one
-- well-defined point, always in the same order (station, then satellite),
-- which avoids deadlocks. The second transaction waits, then sees the first
-- booking and is rejected by the overlap trigger. The procedure's own
-- validation SELECTs run after the lock, so they read a stable state.
-- (See server/scripts/concurrency-demo.js for a live demonstration.)
-- ---------------------------------------------------------------------
CREATE PROCEDURE sp_book_window(
    IN  p_window_id      INT,
    IN  p_transponder_id INT,
    IN  p_contract_id    INT,
    IN  p_user_id        INT,
    IN  p_start          DATETIME,
    IN  p_end            DATETIME,
    IN  p_purpose        VARCHAR(20),
    OUT p_booking_id     INT)
BEGIN
    DECLARE v_sat INT;
    DECLARE v_station INT;
    DECLARE v_sat_status VARCHAR(20);
    DECLARE v_station_status VARCHAR(20);
    DECLARE v_tp_sat INT;
    DECLARE v_tp_status VARCHAR(20);
    DECLARE v_c_status VARCHAR(20);
    DECLARE v_c_start DATE;
    DECLARE v_c_end DATE;

    DECLARE EXIT HANDLER FOR SQLEXCEPTION
    BEGIN
        ROLLBACK;
        RESIGNAL;
    END;

    IF p_start >= p_end THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'INVALID_TIME: session must end after it starts';
    END IF;
    IF p_start < NOW() THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'INVALID_TIME: sessions cannot be booked in the past';
    END IF;

    START TRANSACTION;

    SELECT sat_id, station_id INTO v_sat, v_station
      FROM comm_windows WHERE window_id = p_window_id;
    IF v_sat IS NULL THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'NOT_FOUND: communication window does not exist';
    END IF;

    -- pessimistic locks on the two contended resources (fixed order avoids deadlock)
    SELECT status INTO v_station_status FROM ground_stations WHERE station_id = v_station FOR UPDATE;
    SELECT status INTO v_sat_status     FROM satellites      WHERE sat_id     = v_sat     FOR UPDATE;

    IF v_station_status <> 'online' THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'STATION_UNAVAILABLE: ground station is not online';
    END IF;
    IF v_sat_status <> 'active' THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'SATELLITE_UNAVAILABLE: satellite is not active';
    END IF;

    SELECT sat_id, status INTO v_tp_sat, v_tp_status
      FROM transponders WHERE transponder_id = p_transponder_id;
    IF v_tp_sat IS NULL OR v_tp_sat <> v_sat THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'INVALID_TRANSPONDER: transponder is not on this satellite';
    END IF;
    IF v_tp_status <> 'active' THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'INVALID_TRANSPONDER: transponder is not active';
    END IF;

    SELECT status, start_date, end_date INTO v_c_status, v_c_start, v_c_end
      FROM contracts WHERE contract_id = p_contract_id;
    IF v_c_status IS NULL OR v_c_status <> 'active' THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'INVALID_CONTRACT: contract is not active';
    END IF;
    IF DATE(p_start) < v_c_start OR DATE(p_end) > v_c_end THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'INVALID_CONTRACT: booking is outside the contract period';
    END IF;

    -- overlap / band / window-containment checks are enforced by trg_bookings_bi
    INSERT INTO bookings (window_id, sat_id, station_id, transponder_id, contract_id,
                          booked_by, start_ts, end_ts, purpose)
    VALUES (p_window_id, v_sat, v_station, p_transponder_id, p_contract_id,
            p_user_id, p_start, p_end, p_purpose);

    SET p_booking_id = LAST_INSERT_ID();
    COMMIT;
END$$

CREATE PROCEDURE sp_cancel_booking(IN p_booking_id INT)
BEGIN
    DECLARE v_status VARCHAR(20);
    DECLARE EXIT HANDLER FOR SQLEXCEPTION BEGIN ROLLBACK; RESIGNAL; END;

    START TRANSACTION;
    SELECT status INTO v_status FROM bookings WHERE booking_id = p_booking_id FOR UPDATE;
    IF v_status IS NULL THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'NOT_FOUND: booking does not exist';
    END IF;
    IF v_status <> 'confirmed' THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'INVALID_STATE: only confirmed bookings can be cancelled';
    END IF;
    UPDATE bookings SET status = 'cancelled' WHERE booking_id = p_booking_id;
    COMMIT;
END$$

-- ---------------------------------------------------------------------
-- Lease a slice of transponder bandwidth. Locks the transponder row so
-- concurrent allocations are checked against each other's committed data.
-- ---------------------------------------------------------------------
CREATE PROCEDURE sp_allocate_bandwidth(
    IN  p_contract_id    INT,
    IN  p_transponder_id INT,
    IN  p_mhz            DECIMAL(7,2),
    IN  p_start          DATETIME,
    IN  p_end            DATETIME,
    OUT p_allocation_id  INT)
BEGIN
    DECLARE v_tp_status VARCHAR(20);
    DECLARE v_c_status VARCHAR(20);
    DECLARE v_c_start DATE;
    DECLARE v_c_end DATE;
    DECLARE EXIT HANDLER FOR SQLEXCEPTION BEGIN ROLLBACK; RESIGNAL; END;

    START TRANSACTION;

    SELECT status INTO v_tp_status FROM transponders
     WHERE transponder_id = p_transponder_id FOR UPDATE;
    IF v_tp_status IS NULL THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'NOT_FOUND: transponder does not exist';
    END IF;
    IF v_tp_status <> 'active' THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'INVALID_TRANSPONDER: transponder is not active';
    END IF;

    SELECT status, start_date, end_date INTO v_c_status, v_c_start, v_c_end
      FROM contracts WHERE contract_id = p_contract_id;
    IF v_c_status IS NULL OR v_c_status <> 'active' THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'INVALID_CONTRACT: contract is not active';
    END IF;
    IF DATE(p_start) < v_c_start OR DATE(p_end) > v_c_end THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'INVALID_CONTRACT: allocation is outside the contract period';
    END IF;

    -- capacity check is enforced by trg_alloc_bi
    INSERT INTO bandwidth_allocations (contract_id, transponder_id, allocated_mhz, start_ts, end_ts)
    VALUES (p_contract_id, p_transponder_id, p_mhz, p_start, p_end);

    SET p_allocation_id = LAST_INSERT_ID();
    COMMIT;
END$$

-- ---------------------------------------------------------------------
-- Compute (or recompute) the invoice for a contract over [p_from, p_to).
--   bandwidth charge = sum(allocated MHz x overlapping hours) x rate_per_mhz_hour
--   pass charge      = sum(non-cancelled booking minutes)     x rate_per_pass_min
-- ---------------------------------------------------------------------
CREATE PROCEDURE sp_generate_invoice(
    IN  p_contract_id INT,
    IN  p_from        DATE,
    IN  p_to          DATE,
    OUT p_invoice_id  INT)
BEGIN
    DECLARE v_rate_mhz DECIMAL(10,2);
    DECLARE v_rate_min DECIMAL(10,2);
    DECLARE v_mhz_hours DECIMAL(14,2);
    DECLARE v_minutes DECIMAL(12,2);
    DECLARE v_from DATETIME DEFAULT CAST(p_from AS DATETIME);
    DECLARE v_to   DATETIME DEFAULT CAST(p_to AS DATETIME);
    DECLARE EXIT HANDLER FOR SQLEXCEPTION BEGIN ROLLBACK; RESIGNAL; END;

    IF p_from >= p_to THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'INVALID_PERIOD: period start must be before period end';
    END IF;

    START TRANSACTION;

    SELECT rate_per_mhz_hour, rate_per_pass_min INTO v_rate_mhz, v_rate_min
      FROM contracts WHERE contract_id = p_contract_id;
    IF v_rate_mhz IS NULL THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'NOT_FOUND: contract does not exist';
    END IF;

    SELECT COALESCE(SUM(allocated_mhz * fn_overlap_hours(start_ts, end_ts, v_from, v_to)), 0)
      INTO v_mhz_hours
      FROM bandwidth_allocations
     WHERE contract_id = p_contract_id AND start_ts < v_to AND end_ts > v_from;

    SELECT COALESCE(SUM(TIMESTAMPDIFF(SECOND, GREATEST(start_ts, v_from), LEAST(end_ts, v_to))), 0) / 60
      INTO v_minutes
      FROM bookings
     WHERE contract_id = p_contract_id AND status <> 'cancelled'
       AND start_ts < v_to AND end_ts > v_from;

    INSERT INTO invoices (contract_id, period_start, period_end, mhz_hours, pass_minutes, amount)
    VALUES (p_contract_id, p_from, p_to, v_mhz_hours, v_minutes,
            ROUND(v_mhz_hours * v_rate_mhz + v_minutes * v_rate_min, 2)) AS new
    ON DUPLICATE KEY UPDATE
        mhz_hours    = new.mhz_hours,
        pass_minutes = new.pass_minutes,
        amount       = new.amount,
        invoice_id   = LAST_INSERT_ID(invoice_id);

    SET p_invoice_id = LAST_INSERT_ID();
    COMMIT;
END$$

DELIMITER ;
