// Fechas en zona horaria de Argentina (UTC-3, sin horario de verano).
const AR_OFFSET_MS = -3 * 60 * 60 * 1000;

export function todayAR() {
    const d = new Date(Date.now() + AR_OFFSET_MS);
    return d.toISOString().slice(0, 10); // YYYY-MM-DD
}

export function toYMD(date) {
    const d = new Date(new Date(date).getTime() + AR_OFFSET_MS);
    return d.toISOString().slice(0, 10);
}

// Formato que pide ARCA: AAAAMMDD
export function toArcaDate(date) {
    return toYMD(date).replace(/-/g, '');
}

export function fromArcaDate(s) {
    if (!s || !/^\d{8}$/.test(s)) return null;
    return new Date(`${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}T12:00:00-03:00`);
}

export function addDays(date, days) {
    const d = new Date(date);
    d.setUTCDate(d.getUTCDate() + Number(days || 0));
    return d;
}

export function daysBetween(a, b) {
    const ms = new Date(toYMD(b)).getTime() - new Date(toYMD(a)).getTime();
    return Math.round(ms / 86400000);
}

// Semana ISO (lunes a domingo) como 'AAAA-Www'
export function isoWeek(date) {
    const d = new Date(toYMD(date) + 'T00:00:00Z');
    const day = d.getUTCDay() || 7;
    d.setUTCDate(d.getUTCDate() + 4 - day);
    const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
    const week = Math.ceil(((d - yearStart) / 86400000 + 1) / 7);
    return `${d.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

export function weekStart(date) {
    const d = new Date(toYMD(date) + 'T12:00:00Z');
    const day = d.getUTCDay() || 7;
    d.setUTCDate(d.getUTCDate() - (day - 1));
    return toYMD(d);
}
