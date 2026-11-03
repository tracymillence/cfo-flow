const mongoose = require('mongoose');

const diningSettlementSchema = new mongoose.Schema({
  monthKey: { type: String, default: '2026-11' },
  personKey: { type: String, required: true },
  personName: { type: String, required: true },
  category: { type: String, enum: ['work', 'family'], default: 'work' },
  amount: { type: Number, required: true },
  direction: { type: String, enum: ['in', 'out'], required: true }, // 'in' = nạp tiền vào quỹ, 'out' = mượn tiền quỹ
  topupKind: { type: String, enum: ['prepaid', 'repay_old', 'borrow'], default: 'prepaid' },
  accountName: { type: String, default: 'Vietcombank' },
  addToAccount: { type: Boolean, default: true }, // Cộng/trừ tiền trực tiếp vào tài khoản ngân hàng
  note: { type: String, default: '' },
  date: { type: String, default: '2026-11-02' }
}, { timestamps: true });

module.exports = mongoose.model('DiningSettlement', diningSettlementSchema);
