const mongoose = require('mongoose');

const correctionRequestSchema = new mongoose.Schema({
  creatorId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  creatorName: { type: String, required: true },
  creatorUsername: { type: String, required: true },
  category: { type: String, enum: ['work', 'family', 'general'], default: 'work' },
  targetType: { type: String, enum: ['bill', 'balance', 'settlement', 'other'], default: 'bill' },
  targetTitle: { type: String, default: '' },
  amount: { type: Number, default: 0 },
  reason: { type: String, required: true },
  status: { type: String, enum: ['pending', 'approved', 'rejected'], default: 'pending' },
  adminNote: { type: String, default: '' },
  handledBy: { type: String, default: '' },
  handledAt: { type: Date, default: null }
}, { timestamps: true });

module.exports = mongoose.model('CorrectionRequest', correctionRequestSchema);
