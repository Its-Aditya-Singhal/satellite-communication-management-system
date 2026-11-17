-- =====================================================================
-- SCMS : SQL PART (MySQL)
-- Structured, relational data that needs keys, constraints and joins:
--   users, satellites, ground_stations, bookings
-- 4 tables, 1 trigger, 2 views
-- (Flexible data - profiles, technical details, requests, sessions,
--  activity log - lives in MongoDB, see db.js)
-- =====================================================================
DROP DATABASE IF EXISTS scms;
CREATE DATABASE scms;
USE scms;

-- every person who can log in: admin, client or organisation
CREATE TABLE users (
  user_id       INT AUTO_INCREMENT PRIMARY KEY,
  name          VARCHAR(80)  NOT NULL,
  email         VARCHAR(100) NOT NULL UNIQUE,
  password_hash VARCHAR(200) NOT NULL,
  role          ENUM('admin','client','organisation') NOT NULL,
  created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- satellites registered by an organisation, approved by the admin
CREATE TABLE satellites (
  sat_id         INT AUTO_INCREMENT PRIMARY KEY,
  org_id         INT NOT NULL,
  name           VARCHAR(60) NOT NULL UNIQUE,
  orbit_type     ENUM('LEO','MEO','GEO') NOT NULL,
  frequency_band ENUM('L','S','C','X','Ku','Ka') NOT NULL,
  status         ENUM('pending','approved','rejected') NOT NULL DEFAULT 'pending',
  FOREIGN KEY (org_id) REFERENCES users(user_id)
);

-- ground / launch stations registered by an organisation, approved by the admin
CREATE TABLE ground_stations (
  station_id INT AUTO_INCREMENT PRIMARY KEY,
  org_id     INT NOT NULL,
  name       VARCHAR(60) NOT NULL UNIQUE,
  location   VARCHAR(80) NOT NULL,
  status     ENUM('pending','approved','rejected') NOT NULL DEFAULT 'pending',
  FOREIGN KEY (org_id) REFERENCES users(user_id)
);

-- a confirmed slot: created only when the admin approves a client's access request
CREATE TABLE bookings (
  booking_id INT AUTO_INCREMENT PRIMARY KEY,
  sat_id     INT NOT NULL,
  station_id INT NOT NULL,
  client_id  INT NOT NULL,
  start_time DATETIME NOT NULL,
  end_time   DATETIME NOT NULL,
  FOREIGN KEY (sat_id)     REFERENCES satellites(sat_id),
  FOREIGN KEY (station_id) REFERENCES ground_stations(station_id),
  FOREIGN KEY (client_id)  REFERENCES users(user_id),
  CHECK (end_time > start_time)
);

-- TRIGGER: before a booking is saved, the database checks
--   1. the satellite and the station are approved
--   2. neither of them is already booked in that time range
DELIMITER //
CREATE TRIGGER trg_no_overlap BEFORE INSERT ON bookings
FOR EACH ROW
BEGIN
  IF (SELECT status FROM satellites WHERE sat_id = NEW.sat_id) <> 'approved' THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Satellite is not approved yet';
  END IF;
  IF (SELECT status FROM ground_stations WHERE station_id = NEW.station_id) <> 'approved' THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Ground station is not approved yet';
  END IF;
  IF EXISTS (SELECT 1 FROM bookings
             WHERE station_id = NEW.station_id
               AND NEW.start_time < end_time AND NEW.end_time > start_time) THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Ground station is already booked in this time range';
  END IF;
  IF EXISTS (SELECT 1 FROM bookings
             WHERE sat_id = NEW.sat_id
               AND NEW.start_time < end_time AND NEW.end_time > start_time) THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Satellite is already booked in this time range';
  END IF;
END//
DELIMITER ;

-- VIEW: bookings with names instead of ids
CREATE VIEW v_booking_details AS
SELECT b.booking_id, b.client_id, b.sat_id,
       s.name AS satellite, g.name AS station, u.name AS client,
       b.start_time, b.end_time,
       TIMESTAMPDIFF(MINUTE, b.start_time, b.end_time) AS minutes
FROM bookings b
JOIN satellites s      ON s.sat_id = b.sat_id
JOIN ground_stations g ON g.station_id = b.station_id
JOIN users u           ON u.user_id = b.client_id;

-- VIEW: satellites with the owning organisation's name
CREATE VIEW v_satellites AS
SELECT s.sat_id, s.name, s.orbit_type, s.frequency_band, s.status,
       s.org_id, u.name AS organisation
FROM satellites s
JOIN users u ON u.user_id = s.org_id;

-- Sample data is inserted by seed.js (it needs hashed passwords
-- and also fills MongoDB).  Run:  npm run setup
