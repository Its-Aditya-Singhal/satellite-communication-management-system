// Telemetry packet model. Different satellite buses report different fields,
// which is exactly why telemetry lives in a document store instead of MySQL.
// Pure module (no imports) so the seed script, the simulator and the API share it.

export const FAMILY_BY_MODEL = {
  'I-3K': 'comsat',
  'I-2K': 'comsat',
  'SSL-1300': 'comsat',
  'Eurostar-3000': 'comsat',
  'IRS-1': 'earth_observation',
  'AstroBus-L': 'earth_observation',
  'LEOStar-3': 'earth_observation',
  ISS: 'crewed_station',
  'GPS-III': 'navigation',
  'Galileo-FOC': 'navigation',
  Meridian: 'generic',
};

export const familyOf = (model) => FAMILY_BY_MODEL[model] || 'generic';

// Metrics charted in the UI for each family: [dot.path, label, unit]
export const CHART_METRICS = {
  comsat: [
    ['power.batterySoC', 'Battery SoC', '%'],
    ['thermal.payloadTempC', 'Payload temp', '°C'],
    ['aocs.pointingErrorDeg', 'Pointing error', '°'],
    ['linkMarginDb', 'Link margin', 'dB'],
  ],
  earth_observation: [
    ['power.batterySoC', 'Battery SoC', '%'],
    ['thermal.cameraTempC', 'Camera temp', '°C'],
    ['storage.recorderUsedPct', 'Recorder used', '%'],
    ['linkMarginDb', 'Link margin', 'dB'],
  ],
  crewed_station: [
    ['cabin.co2mmHg', 'Cabin CO₂', 'mmHg'],
    ['cabin.pressureKpa', 'Cabin pressure', 'kPa'],
    ['power.totalKw', 'Power generation', 'kW'],
    ['linkMarginDb', 'Link margin', 'dB'],
  ],
  navigation: [
    ['clock.biasNs', 'Clock bias', 'ns'],
    ['signal.l1PowerDbW', 'L1 power', 'dBW'],
    ['power.batterySoC', 'Battery SoC', '%'],
    ['linkMarginDb', 'Link margin', 'dB'],
  ],
  generic: [
    ['power.batterySoC', 'Battery SoC', '%'],
    ['thermal.busTempC', 'Bus temp', '°C'],
    ['linkMarginDb', 'Link margin', 'dB'],
  ],
};

export function getPath(obj, dotPath) {
  return dotPath.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);
}

const round = (v, d = 2) => Math.round(v * 10 ** d) / 10 ** d;
const noise = (amp) => (Math.random() * 2 - 1) * amp;

// Orbital phase in [0,1) — LEO satellites see eclipse every orbit, which shows
// up as a saw-tooth battery state of charge.
function orbitPhase(sat, ts) {
  const periodMin = sat.period_min || (sat.orbit_type === 'LEO' ? 95 : 720);
  return ((ts.getTime() / 60000 + sat.sat_id * 17) % periodMin) / periodMin;
}

/**
 * Build one telemetry document.
 * @param sat   {sat_id, name, model, orbit_type, period_min}
 * @param ts    Date
 * @param fault optional fault name that pushes a metric out of limits
 */
export function generatePacket(sat, ts = new Date(), fault = null) {
  const family = familyOf(sat.model);
  const phase = orbitPhase(sat, ts);
  const inEclipse = sat.orbit_type === 'LEO' ? phase > 0.62 : false;
  const soc = sat.orbit_type === 'LEO'
    ? (inEclipse ? 92 - (phase - 0.62) * 70 : 66 + phase * 42)
    : 94 + noise(2);

  const base = {
    ts,
    meta: { satId: sat.sat_id, model: sat.model, family },
    linkMarginDb: round(9 + noise(1.5)),
  };

  let body;
  switch (family) {
    case 'comsat':
      body = {
        power: { busVoltage: round(100 + noise(0.8)), solarArrayCurrentA: round(48 + noise(2)), batterySoC: round(soc) },
        thermal: { payloadTempC: round(38 + noise(3)), batteryTempC: round(18 + noise(2)) },
        aocs: { pointingErrorDeg: round(0.03 + Math.random() * 0.03, 3), wheelSpeedRpm: [1, 2, 3, 4].map(() => Math.round(3000 + noise(400))) },
        propellantKg: round(Math.max(40, 380 - (ts.getFullYear() - 2016) * 22), 1),
        transponders: ['C-01', 'Ku-01'].map((label) => ({ label, twtaTempC: round(52 + noise(4)), outputPowerDbW: round(20 + noise(0.5)) })),
      };
      break;
    case 'earth_observation':
      body = {
        power: { busVoltage: round(28 + noise(0.4)), batterySoC: round(soc), inEclipse },
        thermal: { cameraTempC: round(21 + noise(2.5)), obcTempC: round(30 + noise(2)) },
        attitude: { rateDegS: round(Math.abs(noise(0.02)), 4), mode: 'nadir' },
        storage: { recorderUsedPct: round(35 + ((ts.getTime() / 3.6e6 + sat.sat_id * 5) % 12) * 4 + noise(2)) },
        gps: { lat: round(Math.sin(phase * 2 * Math.PI) * 80), lon: round(((phase * 360 + sat.sat_id * 40) % 360) - 180), altKm: round((sat.altitude_km || 600) + noise(2)) },
      };
      break;
    case 'crewed_station':
      body = {
        cabin: { pressureKpa: round(101.3 + noise(0.3)), o2Pct: round(21 + noise(0.4)), co2mmHg: round(2.6 + noise(0.5)), tempC: round(22.5 + noise(1)) },
        power: { totalKw: round(inEclipse ? 0 : 90 + noise(5)), batterySoC: round(soc) },
        attitude: { mode: 'LVLH', rateDegS: round(0.0667 + noise(0.001), 4) },
        crewCount: 7,
      };
      break;
    case 'navigation':
      body = {
        clock: { type: 'Rb', biasNs: round(noise(8)), driftNsPerDay: round(noise(1.5)) },
        signal: { l1PowerDbW: round(-157 + noise(0.6)), healthy: true },
        power: { batterySoC: round(soc) },
        thermal: { clockTempC: round(20 + noise(0.3)) },
      };
      break;
    default:
      body = {
        power: { batterySoC: round(soc) },
        thermal: { busTempC: round(15 + noise(3)) },
      };
  }

  const packet = { ...base, ...body };
  if (fault) applyFault(packet, fault);
  return packet;
}

// Faults the seed/simulator can inject. Each one breaches an alert rule.
export const FAULTS = {
  battery_low: { families: ['comsat', 'earth_observation', 'navigation', 'generic', 'crewed_station'], apply: (p) => { p.power.batterySoC = round(18 + Math.random() * 6); } },
  payload_overheat: { families: ['comsat'], apply: (p) => { p.thermal.payloadTempC = round(58 + Math.random() * 6); } },
  pointing_drift: { families: ['comsat'], apply: (p) => { p.aocs.pointingErrorDeg = round(0.14 + Math.random() * 0.1, 3); } },
  recorder_full: { families: ['earth_observation'], apply: (p) => { p.storage.recorderUsedPct = round(93 + Math.random() * 6); } },
  camera_overheat: { families: ['earth_observation'], apply: (p) => { p.thermal.cameraTempC = round(37 + Math.random() * 4); } },
  co2_high: { families: ['crewed_station'], apply: (p) => { p.cabin.co2mmHg = round(5.6 + Math.random()); } },
  clock_jump: { families: ['navigation'], apply: (p) => { p.clock.biasNs = round(60 + Math.random() * 40); } },
  link_fade: { families: ['comsat', 'earth_observation', 'crewed_station', 'navigation', 'generic'], apply: (p) => { p.linkMarginDb = round(1 + Math.random() * 1.5); } },
};

export function applyFault(packet, fault) {
  const f = FAULTS[fault];
  if (f && f.families.includes(packet.meta.family)) f.apply(packet);
  return packet;
}

export function faultsFor(model) {
  const family = familyOf(model);
  return Object.entries(FAULTS).filter(([, f]) => f.families.includes(family)).map(([name]) => name);
}

// Default threshold rules (stored in MongoDB `alert_rules`).
export const DEFAULT_ALERT_RULES = [
  { scope: { family: 'comsat' }, metric: 'power.batterySoC', op: '<', threshold: 30, severity: 'critical', description: 'Battery state of charge below 30%' },
  { scope: { family: 'comsat' }, metric: 'thermal.payloadTempC', op: '>', threshold: 55, severity: 'warning', description: 'Payload panel over-temperature' },
  { scope: { family: 'comsat' }, metric: 'aocs.pointingErrorDeg', op: '>', threshold: 0.1, severity: 'warning', description: 'Antenna pointing error above 0.1°' },
  { scope: { family: 'earth_observation' }, metric: 'power.batterySoC', op: '<', threshold: 30, severity: 'critical', description: 'Battery state of charge below 30%' },
  { scope: { family: 'earth_observation' }, metric: 'storage.recorderUsedPct', op: '>', threshold: 90, severity: 'warning', description: 'On-board recorder above 90% — schedule a downlink' },
  { scope: { family: 'earth_observation' }, metric: 'thermal.cameraTempC', op: '>', threshold: 35, severity: 'warning', description: 'Imaging payload over-temperature' },
  { scope: { family: 'crewed_station' }, metric: 'cabin.co2mmHg', op: '>', threshold: 5.3, severity: 'critical', description: 'Cabin CO₂ partial pressure above limit' },
  { scope: { family: 'crewed_station' }, metric: 'cabin.pressureKpa', op: '<', threshold: 97, severity: 'critical', description: 'Cabin pressure drop' },
  { scope: { family: 'crewed_station' }, metric: 'power.batterySoC', op: '<', threshold: 30, severity: 'critical', description: 'Battery state of charge below 30%' },
  { scope: { family: 'navigation' }, metric: 'clock.biasNs', op: '>', threshold: 50, severity: 'critical', description: 'Atomic clock bias out of tolerance' },
  { scope: { family: 'navigation' }, metric: 'power.batterySoC', op: '<', threshold: 30, severity: 'critical', description: 'Battery state of charge below 30%' },
  { scope: { family: 'generic' }, metric: 'power.batterySoC', op: '<', threshold: 30, severity: 'critical', description: 'Battery state of charge below 30%' },
  { scope: { all: true }, metric: 'linkMarginDb', op: '<', threshold: 3, severity: 'warning', description: 'RF link margin below 3 dB' },
];
