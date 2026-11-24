// Cliente de la API. La sesión viaja en una cookie httpOnly: este código nunca
// ve ni guarda el token. Toda escritura lleva la cabecera anti-CSRF.
export class ApiError extends Error {
    constructor(message, status, details) { super(message); this.status = status; this.details = details; }
}

async function request(method, url, body) {
    const opts = { method, credentials: 'same-origin', headers: { 'X-Requested-With': 'fetch' } };
    if (body instanceof FormData) opts.body = body;
    else if (body !== undefined) { opts.headers['Content-Type'] = 'application/json'; opts.body = JSON.stringify(body); }
    let res;
    try { res = await fetch(`/api${url}`, opts); } catch { throw new ApiError('Sin conexión con el servidor.', 0); }
    if (res.status === 401 && !url.startsWith('/auth/login')) {
        window.location.href = '/';
        throw new ApiError('Sesión vencida.', 401);
    }
    const data = res.headers.get('content-type')?.includes('json') ? await res.json() : null;
    if (!res.ok) throw new ApiError(data?.message || `Error ${res.status}`, res.status, data?.details);
    return data;
}

const qs = (params) => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries(params || {})) if (v !== undefined && v !== null && v !== '') p.set(k, v);
    const s = p.toString();
    return s ? `?${s}` : '';
};

export const api = {
    get: (url, params) => request('GET', url + qs(params)),
    post: (url, body = {}) => request('POST', url, body),
    put: (url, body = {}) => request('PUT', url, body),
    del: (url) => request('DELETE', url),
    upload: (url, formData) => request('POST', url, formData),
};
