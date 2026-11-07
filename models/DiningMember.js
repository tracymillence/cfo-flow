const mongoose = require('mongoose');

const diningMemberSchema = new mongoose.Schema({
  personKey: { type: String, required: true },
  name: { type: String, required: true },
  group: { type: String, enum: ['work', 'family'], default: 'work' },
  openingBalance: { type: Number, default: 0 },
  isBadDebt: { type: Boolean, default: false }, // Đánh dấu nợ dài hạn / khó đòi
  phone: { type: String, default: '' },
  note: { type: String, default: '' }
}, { timestamps: true });

// Tách biệt personKey theo từng nhóm (work vs family) để các thành viên trùng tên không bị xung đột
diningMemberSchema.index({ group: 1, personKey: 1 }, { unique: true });

module.exports = mongoose.model('DiningMember', diningMemberSchema);
