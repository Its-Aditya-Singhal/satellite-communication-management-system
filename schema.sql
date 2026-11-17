-- SCMS: 4 tables, 1 trigger, 1 view, 1 report query
DROP DATABASE IF EXISTS scms;
CREATE DATABASE scms;
USE scms;

CREATE TABLE satellites (
  sat_id         INT AUTO_INCREMENT PRIMARY KEY,
  name           VARCHAR(50) NOT NULL UNIQUE,
  orbit_type     ENUM('LEO','MEO','GEO') NOT NULL,
  frequency_band ENUM('L','S','C','X','Ku','Ka') NOT NULL,
  status         ENUM('active','inactive') NOT NULL DEFAULT 'active'
);

CREATE TABLE ground_stations (
  station_id INT AUTO_INCREMENT PRIMARY KEY,
  name       VARCHAR(50) NOT NULL UNIQUE,
  location   VARCHAR(50) NOT NULL
);

CREATE TABLE clients (
  client_id INT AUTO_INCREMENT PRIMARY KEY,
  name      VARCHAR(50) NOT NULL,
  email     VARCHAR(80) NOT NULL UNIQUE
);

CREATE TABLE bookings (
  booking_id INT AUTO_INCREMENT PRIMARY KEY,
  sat_id     INT NOT NULL,
  station_id INT NOT NULL,
  client_id  INT NOT NULL,
  start_time DATETIME NOT NULL,
  end_time   DATETIME NOT NULL,
  FOREIGN KEY (sat_id)     REFERENCES satellites(sat_id),
  FOREIGN KEY (station_id) REFERENCES ground_stations(station_id),
  FOREIGN KEY (client_id)  REFERENCES clients(client_id),
  CHECK (end_time > start_time)
);

-- TRIGGER: refuse a booking if the station or the satellite is already booked in that time range
DELIMITER //
CREATE TRIGGER trg_no_overlap BEFORE INSERT ON bookings
FOR EACH ROW
BEGIN
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

-- VIEW: bookings joined with names
CREATE VIEW v_booking_details AS
SELECT b.booking_id, s.name AS satellite, g.name AS station, c.name AS client,
       b.start_time, b.end_time,
       TIMESTAMPDIFF(MINUTE, b.start_time, b.end_time) AS minutes
FROM bookings b
JOIN satellites s      ON s.sat_id = b.sat_id
JOIN ground_stations g ON g.station_id = b.station_id
JOIN clients c         ON c.client_id = b.client_id;

-- SAMPLE DATA
INSERT INTO satellites (name, orbit_type, frequency_band, status) VALUES
 ('INSAT-4A','GEO','Ku','active'),
 ('GSAT-30','GEO','C','active'),
 ('NavIC-1','MEO','L','active'),
 ('Cartosat-3','LEO','X','inactive');

INSERT INTO ground_stations (name, location) VALUES
 ('Hassan Station','Karnataka'),
 ('Bhopal Station','Madhya Pradesh'),
 ('Lucknow Station','Uttar Pradesh');

INSERT INTO clients (name, email) VALUES
 ('SkyLink Telecom','noc@skylink.example'),
 ('AgriSense','eo@agrisense.example'),
 ('OrbitCast TV','uplink@orbitcast.example');

INSERT INTO bookings (sat_id, station_id, client_id, start_time, end_time) VALUES
 (1,1,1,'2026-12-01 09:00:00','2026-12-01 10:00:00'),
 (2,2,3,'2026-12-01 09:30:00','2026-12-01 11:00:00'),
 (1,3,1,'2026-12-02 14:00:00','2026-12-02 15:30:00'),
 (3,1,2,'2026-12-03 06:00:00','2026-12-03 07:00:00');
