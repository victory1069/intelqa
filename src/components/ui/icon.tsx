/** 24px grid, 2px stroke, round caps (brand guide §08). Paths match Icon.dc.html. */
const ICONS = {
  home: "M3.5 10.5 12 3.5l8.5 7V20a1 1 0 0 1-1 1H15v-6H9v6H4.5a1 1 0 0 1-1-1z",
  play: "M8 5.5v13l11-6.5z",
  board: "M3 20.5h18M4.5 20.5v-6h5v6M9.5 20.5V9.5h5v11M14.5 20.5v-8h5v8",
  profile: "M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4.5 20.5a7.5 7.5 0 0 1 15 0",
  timer: "M12 21a8 8 0 1 0 0-16 8 8 0 0 0 0 16zM12 9v4l2.5 2.5M9.5 2.5h5",
  flag: "M5.5 21V4M5.5 4h11.5l-2.5 4.5L17 13H5.5",
  grid: "M4 4h6.5v6.5H4zM13.5 4H20v6.5h-6.5zM4 13.5h6.5V20H4zM13.5 13.5H20V20h-6.5z",
  flame: "M12 21.5a6.5 6.5 0 0 0 6.5-6.5c0-4.5-4-7-5-12-2.5 2-4 4.5-4 7.5-1 0-2-1-2.3-2.3C5.9 9.6 5.5 12.2 5.5 15a6.5 6.5 0 0 0 6.5 6.5z",
  bolt: "M13.5 2.5 4.5 14h7l-1 7.5 9-11.5h-7z",
  bookmark: "M6.5 3.5h11v17l-5.5-4-5.5 4z",
  download: "M12 3.5v11M7.5 10l4.5 4.5 4.5-4.5M4.5 20.5h15",
  book: "M3.5 5h6a2.5 2.5 0 0 1 2.5 2.5v13a2 2 0 0 0-2-2H3.5zM20.5 5h-6A2.5 2.5 0 0 0 12 7.5v13a2 2 0 0 1 2-2h6.5z",
  chat: "M4 5.5h16v11H10l-6 4zM8.5 11h.01M12 11h.01M15.5 11h.01",
  report: "M12 3.5 21.5 20h-19zM12 10v4.5M12 17.5v.01",
  offline: "M3 3l18 18M8.5 16.4a5 5 0 0 1 6.4-.4M5 12.6a10 10 0 0 1 4.3-2.4M19 12.6a10 10 0 0 0-3.6-2.2M2 9a15 15 0 0 1 3.4-2.1M22 9a15 15 0 0 0-8.6-3.7M12 20h.01",
  share: "M12 15V3.5M7.5 8 12 3.5 16.5 8M5 13.5v6h14v-6",
  trophy: "M7.5 4h9v5a4.5 4.5 0 0 1-9 0zM7.5 6H4.5a3 3 0 0 0 3 4M16.5 6h3a3 3 0 0 1-3 4M12 13.5V17M8.5 20.5h7M9.5 17h5v3.5h-5z",
  check: "M5 12.5l4.5 4.5L19 7.5",
  cross: "M6 6l12 12M18 6 6 18",
  close: "M6 6l12 12M18 6 6 18",
  upload: "M12 20.5V9M7.5 13.5 12 9l4.5 4.5M4.5 3.5h15",
  back: "M15 5l-7 7 7 7",
  chevR: "M9 5l7 7-7 7",
  chevD: "M5 9l7 7 7-7",
  chevU: "M5 15l7-7 7 7",
  chevL: "M15 5l-7 7 7 7",
  search: "M11 18.5a7.5 7.5 0 1 0 0-15 7.5 7.5 0 0 0 0 15zM20.5 20.5l-4.2-4.2",
  plus: "M12 5v14M5 12h14",
  minus: "M5 12h14",
  more: "M5 12h.01M12 12h.01M19 12h.01",
  moreV: "M12 5h.01M12 12h.01M12 19h.01",
  settings: "M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zM12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.3 5.3l2.1 2.1M16.6 16.6l2.1 2.1M5.3 18.7l2.1-2.1M16.6 7.4l2.1-2.1",
  bell: "M6 16.5V11a6 6 0 0 1 12 0v5.5l1.5 2H4.5zM10 21h4",
  moon: "M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z",
  sun: "M12 16.5a4.5 4.5 0 1 0 0-9 4.5 4.5 0 0 0 0 9zM12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4",
  refresh: "M20 11a8 8 0 0 0-14.5-4.5M4 4v4h4M4 13a8 8 0 0 0 14.5 4.5M20 20v-4h-4",
  lock: "M6 10.5h12v10H6zM8.5 10.5V7a3.5 3.5 0 0 1 7 0v3.5",
  mail: "M3.5 5.5h17v13h-17zM3.5 6l8.5 7 8.5-7",
  phone: "M8 2.5h8a1.5 1.5 0 0 1 1.5 1.5v16a1.5 1.5 0 0 1-1.5 1.5H8A1.5 1.5 0 0 1 6.5 20V4A1.5 1.5 0 0 1 8 2.5zM11 18.5h2",
  edit: "M4 20h4l10.5-10.5a2.8 2.8 0 0 0-4-4L4 16zM13.5 6.5l4 4",
  trash: "M4.5 6.5h15M9.5 6.5V4h5v2.5M6.5 6.5l1 14h9l1-14",
  eye: "M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12zM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z",
  eyeOff: "M3 3l18 18M10.6 5.6A9 9 0 0 1 12 5.5c6 0 9.5 6.5 9.5 6.5a16 16 0 0 1-2.7 3.4M6.5 6.9C3.9 8.6 2.5 12 2.5 12S6 18.5 12 18.5a9 9 0 0 0 4-1M9.9 9.9a3 3 0 0 0 4.2 4.2",
  filter: "M3.5 5h17l-6.5 8v6l-4 2v-8z",
  image: "M3.5 4.5h17v15h-17zM3.5 16l5-5 4 4 3-3 5 5M15.5 9.5h.01",
  crop: "M6 2.5V18h15.5M2.5 6H18v15.5",
  copy: "M8.5 8.5h11v11h-11zM15.5 8.5v-4h-11v11h4",
  link: "M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1",
  users: "M9 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zM2.5 20a6.5 6.5 0 0 1 13 0M16 4.3a3.5 3.5 0 0 1 0 6.4M18 14a6.5 6.5 0 0 1 3.5 6",
  shield: "M12 2.5l8 3v6c0 5-3.5 8.5-8 10-4.5-1.5-8-5-8-10v-6z",
  ban: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM5.6 5.6l12.8 12.8",
  sparkle: "M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8zM19 16l.7 2 2 .7-2 .7-.7 2-.7-2-2-.7 2-.7z",
  send: "M21 3 10.5 13.5M21 3l-6.5 18-4-7.5L3 9.5z",
  info: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 11v5.5M12 7.5h.01",
  alert: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 7.5V13M12 16.5h.01",
  clock: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 7v5l3 2",
  calendar: "M4 5.5h16v15H4zM4 10h16M8.5 3v4M15.5 3v4",
  star: "M12 3l2.7 5.6 6.1.8-4.4 4.3 1 6.1L12 17l-5.4 2.8 1-6.1L3.2 9.4l6.1-.8z",
  snow: "M12 2.5v19M3.8 7.2l16.4 9.6M3.8 16.8l16.4-9.6M9.5 4.5 12 7l2.5-2.5M9.5 19.5 12 17l2.5 2.5",
  logout: "M14.5 4.5h5v15h-5M10 16.5l-4.5-4.5L10 7.5M5.5 12h10",
  chart: "M4 20.5V4M4 20.5h16.5M8 16l4-5 3 3 5-6.5",
  file: "M6 2.5h8.5L19 7v14.5H6zM14 2.5V7.5h5",
  camera: "M3 7.5h4l2-3h6l2 3h4v12H3zM12 16.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7z",
  list: "M9 6h11.5M9 12h11.5M9 18h11.5M4 6h.01M4 12h.01M4 18h.01",
  cloud: "M7 18.5a4.5 4.5 0 0 1-.5-9 6 6 0 0 1 11.4 1.6A3.8 3.8 0 0 1 17.5 18.5z",
  storage: "M12 8c4.4 0 8-1.3 8-3s-3.6-3-8-3-8 1.3-8 3 3.6 3 8 3zM4 5v14c0 1.7 3.6 3 8 3s8-1.3 8-3V5M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3",
  history: "M3.5 12a8.5 8.5 0 1 0 2.5-6M3.5 4v4h4M12 8v4.5l3 2",
  building: "M3 21h18M5 21V9.5L12 5l7 4.5V21M9 21v-6h6v6M9 11h.01M15 11h.01",
  layers: "M12 3 2.5 8 12 13l9.5-5zM2.5 12.5 12 17.5l9.5-5M2.5 16.5 12 21.5l9.5-5",
  inbox: "M3 13.5 5.5 4.5h13l2.5 9v6H3zM3 13.5h5.5l1 2.5h5l1-2.5H21",
  arrowUp: "M12 19V5M6 11l6-6 6 6",
  arrowDown: "M12 5v14M6 13l6 6 6-6",
  arrowR: "M5 12h14M13 6l6 6-6 6",
  pie: "M12 21a9 9 0 1 1 9-9M12 3v9h9",
  target: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8z",
  drag: "M9 6h.01M15 6h.01M9 12h.01M15 12h.01M9 18h.01M15 18h.01",
  pause: "M8 5v14M16 5v14",
  calculator: "M6 2.5h12v19H6zM9 6.5h6v3H9zM9 13h.01M12 13h.01M15 13h.01M9 17h.01M12 17h.01M15 17h.01",
  key: "M14.5 9.5a4.5 4.5 0 1 1-9 0 4.5 4.5 0 0 1 9 0zM13.5 12.5l7 7M17.5 16.5l2-2",
  zoom: "M11 18.5a7.5 7.5 0 1 0 0-15 7.5 7.5 0 0 0 0 15zM20.5 20.5l-4.2-4.2M8 11h6M11 8v6",
} as const;

export type Glyph = keyof typeof ICONS;

export function Icon({
  name,
  size = 20,
  color = "currentColor",
  weight = 2,
  fill = "none",
  className,
  label,
}: {
  name: Glyph | string;
  size?: number;
  color?: string;
  weight?: number;
  fill?: string;
  className?: string;
  /** Accessible label; icons are decorative when omitted. */
  label?: string;
}) {
  const d = ICONS[name as Glyph] ?? ICONS.info;
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      className={className}
      style={{ display: "block", flex: "none", fill, stroke: color, strokeWidth: weight, strokeLinecap: "round", strokeLinejoin: "round" }}
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    >
      <path d={d} />
    </svg>
  );
}

export function Spinner({ size = 18, color = "currentColor" }: { size?: number; color?: string }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} className="spin" style={{ fill: "none", stroke: color, strokeWidth: 2.5, strokeLinecap: "round" }} aria-hidden>
      <path d="M12 3a9 9 0 1 0 9 9" />
    </svg>
  );
}
