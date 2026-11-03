const mongoose = require('mongoose');
const crypto = require('crypto');

const userSchema = new mongoose.Schema({
  username: { type: String, required: true, unique: true, lowercase: true, trim: true },
  passwordHash: { type: String, required: true },
  passwordSalt: { type: String, required: true },
  fullName: { type: String, required: true },
  phone: { type: String, default: '' },
  role: { type: String, default: 'custom' },
  isAdmin: { type: Boolean, default: false },
  isActive: { type: Boolean, default: true },
  isDefaultPassword: { type: Boolean, default: true },
  sessionToken: { type: String, default: null },
  tokenExpiresAt: { type: Date, default: null },
  // Granular permissions object - Cấu hình trực tiếp trên UI admin không cần sửa code!
  permissions: {
    viewOverview: { type: Boolean, default: true },       // Xem Dashboard tổng quan
    manageAccounts: { type: Boolean, default: false },     // Thêm/sửa số dư tài khoản ngân hàng (Hub 1)
    manageTransactions: { type: Boolean, default: false }, // Ghi/sửa sổ giao dịch thu chi
    manageDiningWork: { type: Boolean, default: true },    // Quỹ ăn nhóm đồng nghiệp (Hub 2)
    manageDiningFamily: { type: Boolean, default: false }, // Quỹ gia đình 6 người (Hub 3)
    managePersonalHub: { type: Boolean, default: false },  // Sổ cá nhân & Tiết kiệm của 2 bạn (Hub 4)
    manageDebts: { type: Boolean, default: false },        // Sổ công nợ 2 chiều & NCC
    manageUsers: { type: Boolean, default: false },        // Quản lý user & phân quyền
    manageConfig: { type: Boolean, default: false }        // Cài đặt hệ thống
  }
}, { timestamps: true });

// Helper mã hóa mật khẩu bảo mật chuẩn pbkdf2
userSchema.methods.setPassword = function(password) {
  this.passwordSalt = crypto.randomBytes(16).toString('hex');
  this.passwordHash = crypto.pbkdf2Sync(password, this.passwordSalt, 10000, 64, 'sha512').toString('hex');
};

userSchema.methods.validPassword = function(password) {
  const hash = crypto.pbkdf2Sync(password, this.passwordSalt, 10000, 64, 'sha512').toString('hex');
  return this.passwordHash === hash;
};

userSchema.methods.generateToken = function() {
  this.sessionToken = crypto.randomBytes(32).toString('hex');
  this.tokenExpiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000); // Lưu phiên 30 ngày
  return this.sessionToken;
};

module.exports = mongoose.model('User', userSchema);
