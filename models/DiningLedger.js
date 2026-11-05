const mongoose = require('mongoose');

const splitSchema = new mongoose.Schema({
  memberId: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'DiningMember', 
    default: null,
    index: true 
  },
  personKey: { type: String, default: '' },
  personName: { type: String, required: true },
  amount: { type: Number, required: true },
  paid: { type: Boolean, default: false }, // Đã trả tôi chưa
  isMe: { type: Boolean, default: false }, // true = Phần của Chủ Sổ (Tôi)
  group: { type: String, enum: ['work', 'family'], default: 'work' }
}, { _id: true });

const diningLedgerSchema = new mongoose.Schema({
  date: { type: String, required: true }, // 'YYYY-MM-DD'
  monthKey: { type: String, default: '2026-11' },
  mealTitle: { type: String, required: true }, // Tên bữa ăn / Giao dịch
  category: { 
    type: String, 
    enum: ['work', 'family'], 
    default: 'work' // 'work' = Quỹ ứng tiền ăn nhóm, 'family' = Quỹ gia đình
  },
  totalBill: { type: Number, required: true }, // Tổng tiền hóa đơn
  myShare: { type: Number, default: 0 },       // Phần ăn / chi của Tôi
  splitMode: { 
    type: String, 
    enum: ['equal', 'custom'], 
    default: 'equal' 
  },
  splits: [splitSchema],
  paidAccount: { type: String, default: 'Vietcombank' }, // Ngân hàng thanh toán
  deductFromAccount: { type: Boolean, default: true },   // Trừ trực tiếp vào ngân hàng thời gian thực
  deductWeeklyLimit: { type: Boolean, default: true },   // Trừ phần của tôi vào Hạn mức tuần hay không
  notes: { type: String, default: '' }
}, { timestamps: true });

module.exports = mongoose.model('DiningLedger', diningLedgerSchema);
