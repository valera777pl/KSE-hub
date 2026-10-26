/* How a class location reads in the app: "корпус, аудиторія", without sponsor room names (PRODUCT.md). */

const BUILDINGS: [RegExp, string][] = [
  [/^M\.?\s*Shpaka\s*(\d+)/i, 'М. Шпака $1'],
  [/^Y\.?\s*Myroshnychenko\s*([\d/]+)/i, 'Мирошниченка $1'],
];

/** "M. Shpaka 3, 2.15.1 Roy Gartner Memorial Classroom" → "М. Шпака 3, 2.15.1" */
export function shortPlace(location: string | null): string | null {
  if (!location) return null;
  if (/^online$/i.test(location.trim())) return 'Онлайн';
  const [building, rest] = location.split(/,\s*/, 2);
  let b = building.trim();
  for (const [re, to] of BUILDINGS) if (re.test(b)) { b = b.replace(re, to); break; }
  const room = rest?.trim().split(/\s+/)[0];
  return room ? `${b}, ${room}` : b;
}

/** "P6" → "Практика", "L1" → "Лекція" */
export const classKind = (section: string | null) =>
  section?.startsWith('L') ? 'Лекція' : section?.startsWith('P') ? 'Практика' : section?.startsWith('S') ? 'Семінар' : null;

/** "Данило Гнатенко" → "ДГ"; one letter when there's one word */
export const initials = (name: string) =>
  name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase();
