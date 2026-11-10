// Datas e horários sempre no fuso configurado (padrão America/Sao_Paulo).

export function zonedParts(date, timeZone) {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    weekday: 'short',
    hourCycle: 'h23',
  });
  const p = Object.fromEntries(fmt.formatToParts(date).map((x) => [x.type, x.value]));
  const weekday = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }[p.weekday];
  return { date: `${p.year}-${p.month}-${p.day}`, time: `${p.hour}:${p.minute}`, weekday };
}

/** "1-6" ou "1,2,3" -> Set de dias da semana (0=domingo). */
export function parseDays(spec) {
  const days = new Set();
  for (const part of String(spec).split(',')) {
    const [a, b] = part.split('-').map((s) => parseInt(s.trim(), 10));
    if (Number.isNaN(a)) continue;
    for (let d = a; d <= (Number.isNaN(b) ? a : b); d++) days.add(d % 7);
  }
  return days;
}

export function inWindow(hhmm, windowSpec) {
  const [from, to] = String(windowSpec).split('-').map((s) => s.trim());
  if (!from || !to) return true;
  return hhmm >= from && hhmm <= to;
}
