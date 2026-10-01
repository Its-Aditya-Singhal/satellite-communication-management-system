// Minimal inline stroke icons (no icon-font dependency).
const PATHS = {
  dashboard: 'M3 3h7v9H3zM14 3h7v5h-7zM14 12h7v9h-7zM3 16h7v5H3z',
  satellite: 'M13 7l4 4M9.5 9.5l5 5M7 13l4 4M4.5 10.5l3-3 2 2-3 3zM14.5 20.5l3-3 2 2-3 3zM10 6l3-3 8 8-3 3zM17 17l1.5 1.5',
  antenna: 'M12 12v9M8 21h8M5.6 5.6a9 9 0 0 0 0 12.7M18.4 5.6a9 9 0 0 1 0 12.7M8.5 9a5 5 0 0 0 0 6M15.5 9a5 5 0 0 1 0 6M12 11a1 1 0 1 0 0 2 1 1 0 0 0 0-2',
  calendar: 'M4 5h16v16H4zM4 9h16M8 3v4M16 3v4M8 13h3M8 17h3M14 13h2',
  bars: 'M4 20V10M10 20V4M16 20v-7M22 20H2',
  file: 'M6 2h9l5 5v15H6zM14 2v6h6M9 13h8M9 17h6',
  pulse: 'M2 12h4l3-8 4 16 3-8h6',
  chart: 'M3 3v18h18M7 15l4-5 4 3 5-7',
  users: 'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8M22 21v-2a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8',
  shield: 'M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10zM9 12l2 2 4-4',
  logout: 'M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9',
  menu: 'M3 6h18M3 12h18M3 18h18',
  plus: 'M12 5v14M5 12h14',
  refresh: 'M21 12a9 9 0 1 1-3-6.7L21 8M21 3v5h-5',
  alert: 'M12 9v4M12 17h.01M10.3 3.9L1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z',
  back: 'M19 12H5M12 19l-7-7 7-7',
};

export function Icon({ name, size = 18 }) {
  if (name === 'logo') {
    return (
      <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
        <rect width="32" height="32" rx="7" fill="var(--accent)" />
        <g fill="none" stroke="#fff" strokeWidth="2">
          <rect x="12" y="12" width="8" height="8" rx="1.5" fill="#fff" />
          <path d="M4 9l7 7M21 16l7 7" />
          <rect x="2" y="5" width="7" height="5" transform="rotate(45 5.5 7.5)" />
          <rect x="23" y="22" width="7" height="5" transform="rotate(45 26.5 24.5)" />
        </g>
      </svg>
    );
  }
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"
         strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="icon">
      <path d={PATHS[name] || ''} />
    </svg>
  );
}
