// Validación de CUIT/CUIL con dígito verificador (módulo 11).
export function normalizeCuit(value) {
    return String(value ?? '').replace(/\D/g, '');
}

export function isValidCuit(value) {
    const cuit = normalizeCuit(value);
    if (!/^\d{11}$/.test(cuit)) return false;
    if (!['20', '23', '24', '27', '30', '33', '34'].includes(cuit.slice(0, 2))) return false;
    const weights = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2];
    const sum = weights.reduce((acc, w, i) => acc + w * Number(cuit[i]), 0);
    let check = 11 - (sum % 11);
    if (check === 11) check = 0;
    if (check === 10) return false;
    return check === Number(cuit[10]);
}

export function formatCuit(value) {
    const c = normalizeCuit(value);
    return c.length === 11 ? `${c.slice(0, 2)}-${c.slice(2, 10)}-${c.slice(10)}` : c;
}
