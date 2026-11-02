const mongoose = require('mongoose');

const diningSettlementSchema = new mongoose.Schema({
  id: { type: String, required: true, unique: true },
  monthKey: { type: String, required: true },
  personKey: { type: String, required: true },
  personName: { type: String, required: true },
  amount: { type: Number, required: true },
  direction: { type: String, enum: ['in', 'out'], required: true },
  topupKind: { type: String, enum: ['prepaid', 'borrow', 'repay_old'], required: true },
  accountId: { type: String, required: true },
  accountName: { type: String, required: true },
  note: { type: String, default: '' },
  date: { type: String, required: true }
}, { timestamps: true });

module.exports = mongoose.model('DiningSettlement', diningSettlementSchema);
