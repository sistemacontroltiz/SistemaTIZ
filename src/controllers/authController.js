import { COOKIE_NAME, cookieOptions, signSession } from '../middleware/auth.js';
import * as users from '../services/userService.js';
import { audit } from '../services/auditService.js';

export async function login(req, res) {
    const user = await users.authenticate(req.body.email, req.body.password);
    res.cookie(COOKIE_NAME, signSession(user), cookieOptions());
    req.user = user;
    await audit(req, 'auth.login', 'User', user._id, 'Ingreso');
    res.json({ user: users.sessionPayload(user) });
}

export async function logout(req, res) {
    res.clearCookie(COOKIE_NAME, { path: '/' });
    res.json({ ok: true });
}

export async function me(req, res) {
    res.json({ user: users.sessionPayload(req.user) });
}

export async function changePassword(req, res) {
    const user = await users.changeOwnPassword(req.user._id, req.body.currentPassword, req.body.newPassword);
    const fresh = await user.populate('role');
    res.cookie(COOKIE_NAME, signSession(fresh), cookieOptions()); // nueva sesión, las otras quedan inválidas
    await audit(req, 'auth.password', 'User', user._id, 'Cambio de contraseña');
    res.json({ ok: true });
}
