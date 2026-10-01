-- =====================================================================
-- 06_events.sql  —  scheduled housekeeping (requires event_scheduler=ON)
-- =====================================================================
USE scms;

DROP EVENT IF EXISTS ev_nightly_housekeeping;
DROP PROCEDURE IF EXISTS sp_housekeeping;

DELIMITER $$

-- Kept as a procedure so it can also be run on demand (CALL sp_housekeeping()).
CREATE PROCEDURE sp_housekeeping()
BEGIN
    UPDATE contracts SET status = 'expired'
     WHERE status = 'active' AND end_date < CURDATE();

    UPDATE bookings SET status = 'completed'
     WHERE status = 'confirmed' AND end_ts < NOW();

    UPDATE bandwidth_allocations SET status = 'released'
     WHERE status = 'active' AND end_ts < NOW();

    UPDATE invoices SET status = 'overdue'
     WHERE status = 'issued' AND issued_at < NOW() - INTERVAL 30 DAY;
END$$

DELIMITER ;

CREATE EVENT ev_nightly_housekeeping
    ON SCHEDULE EVERY 1 DAY
    STARTS (CURRENT_DATE + INTERVAL 1 DAY + INTERVAL 5 MINUTE)
    COMMENT 'Expire contracts, complete past bookings, release allocations, flag overdue invoices'
    DO CALL sp_housekeeping();
