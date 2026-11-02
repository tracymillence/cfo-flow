const mongoose = require('mongoose');

const splitSchema = new mongoose.Schema({
  personKey: { type: String, default: '' },
  personName: { type: String, required: true },
  amount: { type: Number, required: true },
  paid: { type: Boolean, default: false }, // Đã trả tôi chưa
  isMe: { type: Boolean, default: false }  // true = Phần của Chủ Sổ (Tôi)
}, { _id: true });

const diningLedgerSchema = new mongoose.Schema({
  date: { type: String, required: true }, // 'YYYY-MM-DD'
  monthKey: { type: String, default: '2026-11' },
  mealTitle: { type: String, required: true }, // 'Cơm trưa nhóm'
  totalBill: { type: Number, required: true }, // Tổng tiền hóa đơn
  myShare: { type: Number, default: 0 },       // Phần ăn của Tôi
  splits: [splitSchema],
  paidAccount: { type: String, default: 'Vietcombank' },
  notes: { type: String, default: '' }
}, { timestamps: true });

module.exports = mongoose.model('DiningLedger', diningLedgerSchema);
