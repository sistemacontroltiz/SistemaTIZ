// Redondeo a centavos. Todo importe que se guarda pasa por acá para evitar
// errores de punto flotante (0.1 + 0.2).
export const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
export const sum = (arr, fn = (x) => x) => round2(arr.reduce((acc, x) => acc + (Number(fn(x)) || 0), 0));
