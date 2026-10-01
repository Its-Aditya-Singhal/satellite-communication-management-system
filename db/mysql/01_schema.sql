-- =====================================================================
-- SCMS : Satellite Communication Management System
-- 01_schema.sql  —  relational schema (3NF / BCNF)
-- =====================================================================
DROP DATABASE IF EXISTS scms;
CREATE DATABASE scms CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;
USE scms;

-- ---------------------------------------------------------------------
-- Customers and application users
-- ---------------------------------------------------------------------
CREATE TABLE clients (
    client_id      INT AUTO_INCREMENT PRIMARY KEY,
    name           VARCHAR(120) NOT NULL UNIQUE,
    org_type       ENUM('government','commercial','research','defense','ngo') NOT NULL,
    country        VARCHAR(60)  NOT NULL,
    contact_email  VARCHAR(120) NOT NULL,
    created_at     TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE users (
    user_id        INT AUTO_INCREMENT PRIMARY KEY,
    full_name      VARCHAR(100) NOT NULL,
    email          VARCHAR(120) NOT NULL UNIQUE,
    password_hash  VARCHAR(100) NOT NULL,
    role           ENUM('admin','operator','client') NOT NULL,
    client_id      INT NULL,
    is_active      BOOLEAN NOT NULL DEFAULT TRUE,
    created_at     TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_users_client FOREIGN KEY (client_id) REFERENCES clients(client_id),
    -- a client-role user must belong to a client; staff must not
    CONSTRAINT chk_users_client CHECK (
        (role = 'client' AND client_id IS NOT NULL) OR (role <> 'client' AND client_id IS NULL))
);

-- ---------------------------------------------------------------------
-- Space segment
-- ---------------------------------------------------------------------
CREATE TABLE satellites (
    sat_id         INT AUTO_INCREMENT PRIMARY KEY,
    norad_id       INT NOT NULL UNIQUE,
    name           VARCHAR(80) NOT NULL UNIQUE,
    model          VARCHAR(40) NOT NULL,            -- bus/platform; drives telemetry format
    orbit_type     ENUM('LEO','MEO','GEO','HEO') NOT NULL,
    operator_org   VARCHAR(100) NOT NULL,
    launch_date    DATE NOT NULL,
    mass_kg        DECIMAL(8,1) NOT NULL CHECK (mass_kg > 0),
    status         ENUM('active','standby','maintenance','decommissioned') NOT NULL DEFAULT 'active'
);

-- 1:1 with satellites (orbital elements kept separate: different update cadence)
CREATE TABLE orbits (
    sat_id           INT PRIMARY KEY,
    altitude_km      DECIMAL(9,2) NOT NULL CHECK (altitude_km > 100),
    inclination_deg  DECIMAL(6,3) NOT NULL CHECK (inclination_deg BETWEEN 0 AND 180),
    period_min       DECIMAL(8,2) NOT NULL CHECK (period_min > 0),
    geo_longitude    DECIMAL(7,3) NULL CHECK (geo_longitude BETWEEN -180 AND 180),
    epoch            DATETIME NOT NULL,
    CONSTRAINT fk_orbits_sat FOREIGN KEY (sat_id) REFERENCES satellites(sat_id) ON DELETE CASCADE
);

CREATE TABLE frequency_bands (
    band_id    INT AUTO_INCREMENT PRIMARY KEY,
    code       VARCHAR(4) NOT NULL UNIQUE,          -- L, S, C, X, Ku, Ka
    min_mhz    DECIMAL(10,2) NOT NULL,
    max_mhz    DECIMAL(10,2) NOT NULL,
    typical_use VARCHAR(120),
    CONSTRAINT chk_band_range CHECK (min_mhz > 0 AND min_mhz < max_mhz)
);

CREATE TABLE transponders (
    transponder_id    INT AUTO_INCREMENT PRIMARY KEY,
    sat_id            INT NOT NULL,
    band_id           INT NOT NULL,
    label             VARCHAR(20) NOT NULL,         -- e.g. "Ku-07"
    center_freq_mhz   DECIMAL(10,2) NOT NULL,
    bandwidth_mhz     DECIMAL(7,2) NOT NULL CHECK (bandwidth_mhz > 0),
    polarization      ENUM('H','V','LHCP','RHCP') NOT NULL,
    status            ENUM('active','faulty','reserved') NOT NULL DEFAULT 'active',
    CONSTRAINT fk_tp_sat  FOREIGN KEY (sat_id)  REFERENCES satellites(sat_id) ON DELETE CASCADE,
    CONSTRAINT fk_tp_band FOREIGN KEY (band_id) REFERENCES frequency_bands(band_id),
    CONSTRAINT uq_tp_label UNIQUE (sat_id, label),
    -- two transponders on one satellite may not share centre frequency + polarization
    CONSTRAINT uq_tp_freq  UNIQUE (sat_id, center_freq_mhz, polarization)
);

-- ---------------------------------------------------------------------
-- Ground segment
-- ---------------------------------------------------------------------
CREATE TABLE ground_stations (
    station_id     INT AUTO_INCREMENT PRIMARY KEY,
    code           VARCHAR(10) NOT NULL UNIQUE,
    name           VARCHAR(100) NOT NULL,
    city           VARCHAR(60) NOT NULL,
    country        VARCHAR(60) NOT NULL,
    latitude       DECIMAL(8,5) NOT NULL CHECK (latitude  BETWEEN -90  AND 90),
    longitude      DECIMAL(8,5) NOT NULL CHECK (longitude BETWEEN -180 AND 180),
    antenna_diameter_m DECIMAL(5,2) NOT NULL CHECK (antenna_diameter_m > 0),
    status         ENUM('online','offline','maintenance') NOT NULL DEFAULT 'online'
);

-- M:N  ground_stations <-> frequency_bands
CREATE TABLE station_bands (
    station_id  INT NOT NULL,
    band_id     INT NOT NULL,
    PRIMARY KEY (station_id, band_id),
    CONSTRAINT fk_sb_station FOREIGN KEY (station_id) REFERENCES ground_stations(station_id) ON DELETE CASCADE,
    CONSTRAINT fk_sb_band    FOREIGN KEY (band_id)    REFERENCES frequency_bands(band_id)
);

-- Predicted visibility passes (satellite above the station's horizon)
CREATE TABLE comm_windows (
    window_id          INT AUTO_INCREMENT PRIMARY KEY,
    sat_id             INT NOT NULL,
    station_id         INT NOT NULL,
    aos_ts             DATETIME NOT NULL,            -- acquisition of signal
    los_ts             DATETIME NOT NULL,            -- loss of signal
    max_elevation_deg  DECIMAL(5,2) NOT NULL CHECK (max_elevation_deg BETWEEN 0 AND 90),
    CONSTRAINT fk_cw_sat     FOREIGN KEY (sat_id)     REFERENCES satellites(sat_id) ON DELETE CASCADE,
    CONSTRAINT fk_cw_station FOREIGN KEY (station_id) REFERENCES ground_stations(station_id) ON DELETE CASCADE,
    CONSTRAINT chk_cw_time CHECK (aos_ts < los_ts),
    CONSTRAINT uq_cw UNIQUE (sat_id, station_id, aos_ts)
);

-- ---------------------------------------------------------------------
-- Commercial layer
-- ---------------------------------------------------------------------
CREATE TABLE contracts (
    contract_id         INT AUTO_INCREMENT PRIMARY KEY,
    client_id           INT NOT NULL,
    contract_code       VARCHAR(20) NOT NULL UNIQUE,
    start_date          DATE NOT NULL,
    end_date            DATE NOT NULL,
    rate_per_mhz_hour   DECIMAL(10,2) NOT NULL CHECK (rate_per_mhz_hour >= 0),
    rate_per_pass_min   DECIMAL(10,2) NOT NULL CHECK (rate_per_pass_min >= 0),
    status              ENUM('draft','active','expired','terminated') NOT NULL DEFAULT 'active',
    CONSTRAINT fk_contract_client FOREIGN KEY (client_id) REFERENCES clients(client_id),
    CONSTRAINT chk_contract_dates CHECK (start_date < end_date)
);

-- Leased bandwidth slice of a transponder over a time range
CREATE TABLE bandwidth_allocations (
    allocation_id   INT AUTO_INCREMENT PRIMARY KEY,
    contract_id     INT NOT NULL,
    transponder_id  INT NOT NULL,
    allocated_mhz   DECIMAL(7,2) NOT NULL CHECK (allocated_mhz > 0),
    start_ts        DATETIME NOT NULL,
    end_ts          DATETIME NOT NULL,
    status          ENUM('active','released') NOT NULL DEFAULT 'active',
    created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_alloc_contract FOREIGN KEY (contract_id)    REFERENCES contracts(contract_id),
    CONSTRAINT fk_alloc_tp       FOREIGN KEY (transponder_id) REFERENCES transponders(transponder_id),
    CONSTRAINT chk_alloc_time CHECK (start_ts < end_ts)
);

-- A booked uplink/downlink session inside a visibility window.
-- sat_id / station_id are copied from the window (controlled redundancy) so
-- that the overlap checks can use a direct composite index.
CREATE TABLE bookings (
    booking_id      INT AUTO_INCREMENT PRIMARY KEY,
    window_id       INT NOT NULL,
    sat_id          INT NOT NULL,
    station_id      INT NOT NULL,
    transponder_id  INT NOT NULL,
    contract_id     INT NOT NULL,
    booked_by       INT NOT NULL,
    start_ts        DATETIME NOT NULL,
    end_ts          DATETIME NOT NULL,
    purpose         ENUM('telemetry','command','data_downlink','broadcast','ranging') NOT NULL,
    status          ENUM('confirmed','completed','cancelled') NOT NULL DEFAULT 'confirmed',
    created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_bk_window   FOREIGN KEY (window_id)      REFERENCES comm_windows(window_id),
    CONSTRAINT fk_bk_sat      FOREIGN KEY (sat_id)         REFERENCES satellites(sat_id),
    CONSTRAINT fk_bk_station  FOREIGN KEY (station_id)     REFERENCES ground_stations(station_id),
    CONSTRAINT fk_bk_tp       FOREIGN KEY (transponder_id) REFERENCES transponders(transponder_id),
    CONSTRAINT fk_bk_contract FOREIGN KEY (contract_id)    REFERENCES contracts(contract_id),
    CONSTRAINT fk_bk_user     FOREIGN KEY (booked_by)      REFERENCES users(user_id),
    CONSTRAINT chk_bk_time CHECK (start_ts < end_ts)
);

CREATE TABLE invoices (
    invoice_id      INT AUTO_INCREMENT PRIMARY KEY,
    contract_id     INT NOT NULL,
    period_start    DATE NOT NULL,
    period_end      DATE NOT NULL,
    mhz_hours       DECIMAL(14,2) NOT NULL DEFAULT 0,
    pass_minutes    DECIMAL(12,2) NOT NULL DEFAULT 0,
    amount          DECIMAL(14,2) NOT NULL DEFAULT 0,
    status          ENUM('issued','paid','overdue') NOT NULL DEFAULT 'issued',
    issued_at       TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_inv_contract FOREIGN KEY (contract_id) REFERENCES contracts(contract_id),
    CONSTRAINT uq_inv_period UNIQUE (contract_id, period_start, period_end),
    CONSTRAINT chk_inv_period CHECK (period_start < period_end)
);

-- ---------------------------------------------------------------------
-- Audit trail (written only by triggers)
-- ---------------------------------------------------------------------
CREATE TABLE audit_log (
    audit_id     BIGINT AUTO_INCREMENT PRIMARY KEY,
    table_name   VARCHAR(40) NOT NULL,
    action       ENUM('INSERT','UPDATE','DELETE') NOT NULL,
    record_id    INT NOT NULL,
    old_values   JSON NULL,
    new_values   JSON NULL,
    changed_by   INT NULL,                 -- app user id, from session variable @app_user_id
    changed_at   TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP(3)
);

-- ---------------------------------------------------------------------
-- Indexes supporting the hot queries (overlap checks, schedules, reports)
-- ---------------------------------------------------------------------
CREATE INDEX idx_bk_station_time ON bookings (station_id, start_ts, end_ts);
CREATE INDEX idx_bk_sat_time     ON bookings (sat_id, start_ts);
CREATE INDEX idx_bk_contract     ON bookings (contract_id, start_ts);
CREATE INDEX idx_alloc_tp_time   ON bandwidth_allocations (transponder_id, start_ts, end_ts);
CREATE INDEX idx_cw_station_aos  ON comm_windows (station_id, aos_ts);
CREATE INDEX idx_cw_sat_aos      ON comm_windows (sat_id, aos_ts);
CREATE INDEX idx_audit_table_rec ON audit_log (table_name, record_id);
