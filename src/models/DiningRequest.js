const mongoose = require('mongoose');

const diningRequestSchema = new mongoose.Schema({
  id: { type: String, required: true, unique: true },
  createdAt: { type: Number, default: () => Date.now() },
  date: { type: String, required: true },
  memberName: { type: String, required: true },
  personKey: { type: String, required: true },
  category: { type: String, enum: ['meal', 'topup', 'borrow', 'balance'], default: 'meal' },
  targetRefId: { type: String, default: '' },
  targetDesc: { type: String, default: '' },
  amount: { type: Number, default: 0 },
  note: { type: String, required: true },
  status: { type: String, enum: ['pending', 'approved', 'rejected'], default: 'pending' },
  reviewedBy: { type: String, default: '' },
  reviewedAt: { type: Number, default: null },
  reviewNote: { type: String, default: '' }
}, { timestamps: true });

module.exports = mongoose.model('DiningRequest', diningRequestSchema);
