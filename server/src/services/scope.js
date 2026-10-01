import { query } from '../db/mysql.js';
import { isClient } from '../middleware/auth.js';
import { HttpError } from '../middleware/errors.js';

// Satellites a client has commercial activity on (sessions or bandwidth leases).
export async function clientSatelliteIds(clientId) {
  const rows = await query(
    `SELECT b.sat_id FROM bookings b JOIN contracts c ON c.contract_id = b.contract_id WHERE c.client_id = ?
     UNION
     SELECT t.sat_id FROM bandwidth_allocations a
       JOIN contracts c    ON c.contract_id = a.contract_id
       JOIN transponders t ON t.transponder_id = a.transponder_id
      WHERE c.client_id = ?`,
    [clientId, clientId],
  );
  return rows.map((r) => r.sat_id);
}

/** null = unrestricted (staff); otherwise the satellite ids the caller may see. */
export async function visibleSatelliteIds(req) {
  return isClient(req) ? clientSatelliteIds(req.user.clientId) : null;
}

export async function assertSatelliteVisible(req, satId) {
  const ids = await visibleSatelliteIds(req);
  if (ids && !ids.includes(Number(satId))) throw new HttpError(404, 'NOT_FOUND', 'Satellite not found');
}

let satCache = { at: 0, map: new Map() };
/** sat_id -> {sat_id, name, model, orbit_type, status}, cached briefly for telemetry ingest. */
export async function satellitesById() {
  if (Date.now() - satCache.at > 60_000) {
    const rows = await query('SELECT sat_id, name, model, orbit_type, status FROM satellites');
    satCache = { at: Date.now(), map: new Map(rows.map((r) => [r.sat_id, r])) };
  }
  return satCache.map;
}
