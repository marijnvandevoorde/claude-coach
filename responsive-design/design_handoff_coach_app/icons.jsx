/* icons.jsx — functional line-icon set. window.Icon */
function Icon({ name, size = 20, stroke = 'currentColor', sw = 1.6, fill = 'none', style }) {
  const p = { width: size, height: size, viewBox: '0 0 24 24', fill, stroke, strokeWidth: sw, strokeLinecap: 'round', strokeLinejoin: 'round', style };
  const paths = {
    today: <><circle cx="12" cy="13" r="8" /><path d="M12 9v4l2.5 1.5M12 5V3M9 3h6" /></>,
    calendar: <><rect x="3.5" y="5" width="17" height="16" rx="2.5" /><path d="M3.5 9.5h17M8 3v4M16 3v4" /></>,
    trends: <><path d="M4 18l5-5 3 3 7-7" /><path d="M15 9h4v4" /></>,
    activity: <><path d="M3 12h3l2.5-6 4 13 2.5-7H21" /></>,
    journal: <><path d="M5 4.5A1.5 1.5 0 016.5 3H18a1 1 0 011 1v15a1 1 0 01-1 1H6.5A1.5 1.5 0 015 18.5z" /><path d="M5 17.5A1.5 1.5 0 016.5 16H19M9 7.5h6M9 11h4" /></>,
    run: <><circle cx="14.5" cy="4.5" r="1.8" /><path d="M5 21l3-5 3 1.5 1-4.5-3-2 1-4 3 3h3" /><path d="M11 13l-2-1.5" /></>,
    bike: <><circle cx="6" cy="17" r="3.2" /><circle cx="18" cy="17" r="3.2" /><path d="M6 17l4-7h5l-2.5 7M9 6h3l1.5 4M14 7h3" /></>,
    swim: <><circle cx="17" cy="7" r="1.6" /><path d="M3 16c1.5-1 2.5-1 4 0s2.5 1 4 0 2.5-1 4 0 2.5 1 4 0M5 14l5-3.5-2-2 4-1.5" /></>,
    hike: <><path d="M8 4.5a1.5 1.5 0 100 3 1.5 1.5 0 000-3zM8 9l-2 5 3 1v6M9 13l3 1 2-3 3 1" /><path d="M14 21l-1-5" /></>,
    water: <><path d="M12 3s6 6.5 6 11a6 6 0 11-12 0c0-4.5 6-11 6-11z" /></>,
    info: <><circle cx="12" cy="12" r="9" /><path d="M12 11v5M12 8h.01" /></>,
    moon: <><path d="M20 14.5A8 8 0 119.5 4a6.5 6.5 0 0010.5 10.5z" /></>,
    heart: <><path d="M12 20s-7-4.7-7-10a4 4 0 017-2.6A4 4 0 0119 10c0 5.3-7 10-7 10z" /></>,
    battery: <><rect x="3" y="8" width="15" height="9" rx="2" /><path d="M20 11v3" /><rect x="5.5" y="10.5" width="7" height="4" rx="1" fill="currentColor" stroke="none" /></>,
    pulse: <><path d="M3 12h4l2-5 4 10 2-5h6" /></>,
    gauge: <><path d="M5 18a8 8 0 1114 0" /><path d="M12 18l4-5" /><circle cx="12" cy="18" r="1.4" fill="currentColor" stroke="none" /></>,
    drop: <><path d="M12 3s6 6.5 6 11a6 6 0 11-12 0c0-4.5 6-11 6-11z" /></>,
    plus: <><path d="M12 5v14M5 12h14" /></>,
    chevR: <><path d="M9 5l7 7-7 7" /></>,
    chevL: <><path d="M15 5l-7 7 7 7" /></>,
    chevD: <><path d="M5 9l7 7 7-7" /></>,
    x: <><path d="M6 6l12 12M18 6L6 18" /></>,
    sun: <><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4 12H2M22 12h-2M5 5l1.5 1.5M19 19l-1.5-1.5M19 5l-1.5 1.5M5 19l1.5-1.5" /></>,
    bolt: <><path d="M13 2L4 14h7l-1 8 9-12h-7z" /></>,
    foot: <><path d="M7 5c1.5 0 2.5 2 2.5 5s-1 5-2.5 5-2-2-2-5 .5-5 2-5z" /><path d="M11 16c0 2 1 3 2.5 3s2.5-1 2.5-2.5S15 14 14 13" /></>,
    flag: <><path d="M5 21V4M5 5h11l-2 4 2 4H5" /></>,
    scale: <><path d="M5 7h14M9 7c0 1.7-1.3 3-3 3M15 7c0 1.7 1.3 3 3 3M3 21h18M12 7v14" /></>,
    check: <><path d="M5 12.5l4.5 4.5L19 7" /></>,
    undo: <><path d="M9 14L4 9l5-5" /><path d="M4 9h11a5 5 0 010 10h-3" /></>,
    settings: <><circle cx="12" cy="12" r="3" /><path d="M12 2v3M12 19v3M4 6l2 1.5M18 16.5L20 18M2 12h3M19 12h3M4 18l2-1.5M18 7.5L20 6" /></>,
    layers: <><path d="M12 3l8 4-8 4-8-4 8-4zM4 12l8 4 8-4M4 16l8 4 8-4" /></>,
  };
  return <svg {...p}>{paths[name] || null}</svg>;
}
window.Icon = Icon;
