import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';

const UserSchema = new mongoose.Schema({
    name: { type: String, required: true, trim: true, maxlength: 120 },
    email: { type: String, required: true, unique: true, trim: true, lowercase: true, maxlength: 160 },
    password: { type: String, required: true, select: false },
    role: { type: mongoose.Schema.Types.ObjectId, ref: 'Role', required: true },
    sector: { type: mongoose.Schema.Types.ObjectId, ref: 'Sector', default: null },
    active: { type: Boolean, default: true },
    // Seguridad de acceso
    failedLogins: { type: Number, default: 0, select: false },
    lockUntil: { type: Date, default: null, select: false },
    tokenVersion: { type: Number, default: 0, select: false }, // al subirlo se invalidan las sesiones abiertas
    mustChangePassword: { type: Boolean, default: false },
    lastLoginAt: { type: Date, default: null },
}, { timestamps: true });

UserSchema.pre('save', async function hashPassword() {
    if (!this.isModified('password')) return;
    this.password = await bcrypt.hash(this.password, 12);
    if (!this.isNew) this.tokenVersion += 1;
});

UserSchema.methods.matchPassword = function matchPassword(plain) {
    return bcrypt.compare(plain, this.password);
};

UserSchema.methods.toSafeJSON = function toSafeJSON() {
    const o = this.toObject();
    delete o.password; delete o.failedLogins; delete o.lockUntil; delete o.tokenVersion;
    return o;
};

export default mongoose.model('User', UserSchema);
