-- =====================================================================
-- 04_triggers.sql  —  integrity triggers and audit trail
-- =====================================================================
USE scms;

DROP TRIGGER IF EXISTS trg_bookings_bi;
DROP TRIGGER IF EXISTS trg_bookings_bu;
DROP TRIGGER IF EXISTS trg_alloc_bi;
DROP TRIGGER IF EXISTS trg_alloc_bu;
DROP TRIGGER IF EXISTS trg_bookings_audit_ai;
DROP TRIGGER IF EXISTS trg_bookings_audit_au;
DROP TRIGGER IF EXISTS trg_bookings_audit_ad;
DROP TRIGGER IF EXISTS trg_alloc_audit_ai;
DROP TRIGGER IF EXISTS trg_alloc_audit_au;
DROP TRIGGER IF EXISTS trg_alloc_audit_ad;
DROP TRIGGER IF EXISTS trg_contracts_audit_ai;
DROP TRIGGER IF EXISTS trg_contracts_audit_au;
DROP TRIGGER IF EXISTS trg_contracts_audit_ad;

DELIMITER $$

-- ---------------------------------------------------------------------
-- Booking integrity: window containment, band compatibility, no overlap
-- on the same ground station or the same satellite.
-- ---------------------------------------------------------------------
CREATE TRIGGER trg_bookings_bi BEFORE INSERT ON bookings
FOR EACH ROW
BEGIN
    DECLARE v_sat INT;
    DECLARE v_station INT;
    DECLARE v_aos DATETIME;
    DECLARE v_los DATETIME;

    SELECT sat_id, station_id, aos_ts, los_ts INTO v_sat, v_station, v_aos, v_los
      FROM comm_windows WHERE window_id = NEW.window_id;

    IF NEW.sat_id <> v_sat OR NEW.station_id <> v_station THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'INVALID_WINDOW: satellite/station do not match the window';
    END IF;
    IF NEW.start_ts < v_aos OR NEW.end_ts > v_los THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'OUTSIDE_WINDOW: booking must lie within the visibility window (AOS-LOS)';
    END IF;

    IF NOT EXISTS (SELECT 1 FROM transponders t
                     JOIN station_bands sb ON sb.band_id = t.band_id
                    WHERE t.transponder_id = NEW.transponder_id
                      AND sb.station_id   = NEW.station_id) THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'BAND_MISMATCH: ground station does not support the transponder''s frequency band';
    END IF;

    IF NEW.status <> 'cancelled' THEN
        IF EXISTS (SELECT 1 FROM bookings
                    WHERE station_id = NEW.station_id AND status <> 'cancelled'
                      AND start_ts < NEW.end_ts AND end_ts > NEW.start_ts) THEN
            SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'STATION_CONFLICT: ground station is already booked in this time range';
        END IF;
        IF EXISTS (SELECT 1 FROM bookings
                    WHERE sat_id = NEW.sat_id AND status <> 'cancelled'
                      AND start_ts < NEW.end_ts AND end_ts > NEW.start_ts) THEN
            SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'SATELLITE_CONFLICT: satellite already has a session in this time range';
        END IF;
    END IF;
END$$

-- Re-validate when a booking is moved or re-activated.
CREATE TRIGGER trg_bookings_bu BEFORE UPDATE ON bookings
FOR EACH ROW
BEGIN
    IF NEW.status <> 'cancelled'
       AND (NEW.start_ts <> OLD.start_ts OR NEW.end_ts <> OLD.end_ts
            OR NEW.station_id <> OLD.station_id OR NEW.sat_id <> OLD.sat_id
            OR OLD.status = 'cancelled') THEN
        IF EXISTS (SELECT 1 FROM bookings
                    WHERE booking_id <> NEW.booking_id
                      AND station_id = NEW.station_id AND status <> 'cancelled'
                      AND start_ts < NEW.end_ts AND end_ts > NEW.start_ts) THEN
            SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'STATION_CONFLICT: ground station is already booked in this time range';
        END IF;
        IF EXISTS (SELECT 1 FROM bookings
                    WHERE booking_id <> NEW.booking_id
                      AND sat_id = NEW.sat_id AND status <> 'cancelled'
                      AND start_ts < NEW.end_ts AND end_ts > NEW.start_ts) THEN
            SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'SATELLITE_CONFLICT: satellite already has a session in this time range';
        END IF;
    END IF;
END$$

-- ---------------------------------------------------------------------
-- Transponder capacity: at no instant may the active allocations on a
-- transponder exceed its bandwidth.
-- ---------------------------------------------------------------------
CREATE TRIGGER trg_alloc_bi BEFORE INSERT ON bandwidth_allocations
FOR EACH ROW
BEGIN
    DECLARE v_capacity DECIMAL(7,2);
    DECLARE v_peak DECIMAL(10,2);
    DECLARE v_msg VARCHAR(200);

    IF NEW.status = 'active' THEN
        SELECT bandwidth_mhz INTO v_capacity FROM transponders WHERE transponder_id = NEW.transponder_id;
        SET v_peak = fn_allocated_mhz_at_peak(NEW.transponder_id, NEW.start_ts, NEW.end_ts, NULL);
        IF v_peak + NEW.allocated_mhz > v_capacity THEN
            SET v_msg = CONCAT('CAPACITY_EXCEEDED: transponder has ', v_capacity - v_peak,
                               ' MHz free at peak in this range; requested ', NEW.allocated_mhz, ' MHz');
            SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = v_msg;
        END IF;
    END IF;
END$$

CREATE TRIGGER trg_alloc_bu BEFORE UPDATE ON bandwidth_allocations
FOR EACH ROW
BEGIN
    DECLARE v_capacity DECIMAL(7,2);
    DECLARE v_peak DECIMAL(10,2);
    DECLARE v_msg VARCHAR(200);

    IF NEW.status = 'active' THEN
        SELECT bandwidth_mhz INTO v_capacity FROM transponders WHERE transponder_id = NEW.transponder_id;
        SET v_peak = fn_allocated_mhz_at_peak(NEW.transponder_id, NEW.start_ts, NEW.end_ts, NEW.allocation_id);
        IF v_peak + NEW.allocated_mhz > v_capacity THEN
            SET v_msg = CONCAT('CAPACITY_EXCEEDED: transponder has ', v_capacity - v_peak,
                               ' MHz free at peak in this range; requested ', NEW.allocated_mhz, ' MHz');
            SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = v_msg;
        END IF;
    END IF;
END$$

-- ---------------------------------------------------------------------
-- Audit trail. The API sets @app_user_id on each connection it uses.
-- ---------------------------------------------------------------------
CREATE TRIGGER trg_bookings_audit_ai AFTER INSERT ON bookings FOR EACH ROW
INSERT INTO audit_log (table_name, action, record_id, new_values, changed_by)
VALUES ('bookings', 'INSERT', NEW.booking_id,
        JSON_OBJECT('window_id', NEW.window_id, 'transponder_id', NEW.transponder_id,
                    'contract_id', NEW.contract_id, 'start_ts', NEW.start_ts,
                    'end_ts', NEW.end_ts, 'purpose', NEW.purpose, 'status', NEW.status),
        @app_user_id)$$

CREATE TRIGGER trg_bookings_audit_au AFTER UPDATE ON bookings FOR EACH ROW
INSERT INTO audit_log (table_name, action, record_id, old_values, new_values, changed_by)
VALUES ('bookings', 'UPDATE', NEW.booking_id,
        JSON_OBJECT('start_ts', OLD.start_ts, 'end_ts', OLD.end_ts, 'status', OLD.status),
        JSON_OBJECT('start_ts', NEW.start_ts, 'end_ts', NEW.end_ts, 'status', NEW.status),
        @app_user_id)$$

CREATE TRIGGER trg_bookings_audit_ad AFTER DELETE ON bookings FOR EACH ROW
INSERT INTO audit_log (table_name, action, record_id, old_values, changed_by)
VALUES ('bookings', 'DELETE', OLD.booking_id,
        JSON_OBJECT('window_id', OLD.window_id, 'contract_id', OLD.contract_id,
                    'start_ts', OLD.start_ts, 'end_ts', OLD.end_ts, 'status', OLD.status),
        @app_user_id)$$

CREATE TRIGGER trg_alloc_audit_ai AFTER INSERT ON bandwidth_allocations FOR EACH ROW
INSERT INTO audit_log (table_name, action, record_id, new_values, changed_by)
VALUES ('bandwidth_allocations', 'INSERT', NEW.allocation_id,
        JSON_OBJECT('contract_id', NEW.contract_id, 'transponder_id', NEW.transponder_id,
                    'allocated_mhz', NEW.allocated_mhz, 'start_ts', NEW.start_ts,
                    'end_ts', NEW.end_ts, 'status', NEW.status),
        @app_user_id)$$

CREATE TRIGGER trg_alloc_audit_au AFTER UPDATE ON bandwidth_allocations FOR EACH ROW
INSERT INTO audit_log (table_name, action, record_id, old_values, new_values, changed_by)
VALUES ('bandwidth_allocations', 'UPDATE', NEW.allocation_id,
        JSON_OBJECT('allocated_mhz', OLD.allocated_mhz, 'start_ts', OLD.start_ts,
                    'end_ts', OLD.end_ts, 'status', OLD.status),
        JSON_OBJECT('allocated_mhz', NEW.allocated_mhz, 'start_ts', NEW.start_ts,
                    'end_ts', NEW.end_ts, 'status', NEW.status),
        @app_user_id)$$

CREATE TRIGGER trg_alloc_audit_ad AFTER DELETE ON bandwidth_allocations FOR EACH ROW
INSERT INTO audit_log (table_name, action, record_id, old_values, changed_by)
VALUES ('bandwidth_allocations', 'DELETE', OLD.allocation_id,
        JSON_OBJECT('contract_id', OLD.contract_id, 'transponder_id', OLD.transponder_id,
                    'allocated_mhz', OLD.allocated_mhz, 'status', OLD.status),
        @app_user_id)$$

CREATE TRIGGER trg_contracts_audit_ai AFTER INSERT ON contracts FOR EACH ROW
INSERT INTO audit_log (table_name, action, record_id, new_values, changed_by)
VALUES ('contracts', 'INSERT', NEW.contract_id,
        JSON_OBJECT('client_id', NEW.client_id, 'contract_code', NEW.contract_code,
                    'start_date', NEW.start_date, 'end_date', NEW.end_date,
                    'rate_per_mhz_hour', NEW.rate_per_mhz_hour,
                    'rate_per_pass_min', NEW.rate_per_pass_min, 'status', NEW.status),
        @app_user_id)$$

CREATE TRIGGER trg_contracts_audit_au AFTER UPDATE ON contracts FOR EACH ROW
INSERT INTO audit_log (table_name, action, record_id, old_values, new_values, changed_by)
VALUES ('contracts', 'UPDATE', NEW.contract_id,
        JSON_OBJECT('end_date', OLD.end_date, 'rate_per_mhz_hour', OLD.rate_per_mhz_hour,
                    'rate_per_pass_min', OLD.rate_per_pass_min, 'status', OLD.status),
        JSON_OBJECT('end_date', NEW.end_date, 'rate_per_mhz_hour', NEW.rate_per_mhz_hour,
                    'rate_per_pass_min', NEW.rate_per_pass_min, 'status', NEW.status),
        @app_user_id)$$

CREATE TRIGGER trg_contracts_audit_ad AFTER DELETE ON contracts FOR EACH ROW
INSERT INTO audit_log (table_name, action, record_id, old_values, changed_by)
VALUES ('contracts', 'DELETE', OLD.contract_id,
        JSON_OBJECT('client_id', OLD.client_id, 'contract_code', OLD.contract_code, 'status', OLD.status),
        @app_user_id)$$

DELIMITER ;
