import { api } from './api.js';

document.addEventListener('DOMContentLoaded', async () => {
    // Si ya hay sesión, directo a la aplicación
    try { await fetch('/api/auth/me', { credentials: 'same-origin' }).then(r => { if (r.ok) window.location.replace('/app.html'); }); } catch { /* sin sesión */ }

    const form = document.getElementById('loginForm');
    const box = document.getElementById('loginError');
    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        box.classList.add('hidden');
        const btn = form.querySelector('button');
        btn.disabled = true;
        try {
            await api.post('/auth/login', { email: form.email.value.trim(), password: form.password.value });
            window.location.replace('/app.html');
        } catch (err) {
            box.textContent = err.message;
            box.classList.remove('hidden');
            form.password.value = '';
        } finally {
            btn.disabled = false;
        }
    });
});
