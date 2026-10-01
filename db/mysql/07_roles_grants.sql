-- =====================================================================
-- 07_roles_grants.sql  —  database-level access control (least privilege)
-- Passwords here are for LOCAL DEVELOPMENT only.
-- =====================================================================

DROP USER IF EXISTS 'scms_app'@'localhost', 'scms_analyst'@'localhost';
DROP ROLE IF EXISTS scms_admin, scms_operator, scms_readonly;

CREATE ROLE scms_admin, scms_operator, scms_readonly;

-- Full control of the schema (DDL included)
GRANT ALL PRIVILEGES ON scms.* TO scms_admin;

-- Day-to-day operations: DML + run procedures/functions, no DDL.
-- audit_log is append-only through triggers, so it is read-only here.
GRANT SELECT, EXECUTE ON scms.* TO scms_operator;
GRANT INSERT, UPDATE, DELETE ON scms.clients               TO scms_operator;
GRANT INSERT, UPDATE, DELETE ON scms.users                 TO scms_operator;
GRANT INSERT, UPDATE, DELETE ON scms.satellites            TO scms_operator;
GRANT INSERT, UPDATE, DELETE ON scms.orbits                TO scms_operator;
GRANT INSERT, UPDATE, DELETE ON scms.frequency_bands       TO scms_operator;
GRANT INSERT, UPDATE, DELETE ON scms.transponders          TO scms_operator;
GRANT INSERT, UPDATE, DELETE ON scms.ground_stations       TO scms_operator;
GRANT INSERT, UPDATE, DELETE ON scms.station_bands         TO scms_operator;
GRANT INSERT, UPDATE, DELETE ON scms.comm_windows          TO scms_operator;
GRANT INSERT, UPDATE, DELETE ON scms.contracts             TO scms_operator;
GRANT INSERT, UPDATE, DELETE ON scms.bandwidth_allocations TO scms_operator;
GRANT INSERT, UPDATE         ON scms.bookings              TO scms_operator;
GRANT INSERT, UPDATE         ON scms.invoices              TO scms_operator;

-- Analysts / report viewers: reporting views only
GRANT SELECT ON scms.v_booking_details         TO scms_readonly;
GRANT SELECT ON scms.v_upcoming_schedule       TO scms_readonly;
GRANT SELECT ON scms.v_transponder_utilization TO scms_readonly;
GRANT SELECT ON scms.v_revenue_by_client       TO scms_readonly;
GRANT SELECT ON scms.v_station_overview        TO scms_readonly;

-- Application account used by the Express API
CREATE USER 'scms_app'@'localhost' IDENTIFIED BY 'scms_app_pw' DEFAULT ROLE scms_operator;
GRANT scms_operator TO 'scms_app'@'localhost';

-- Read-only account for report demos
CREATE USER 'scms_analyst'@'localhost' IDENTIFIED BY 'scms_analyst_pw' DEFAULT ROLE scms_readonly;
GRANT scms_readonly TO 'scms_analyst'@'localhost';
