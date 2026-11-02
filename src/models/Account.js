const mongoose = require('mongoose');

const accountSchema = new mongoose.Schema({
  accountId: { type: String, required: true, unique: true },
  name: { type: String, required: true },
  type: { type: String, enum: ['bank', 'ewallet', 'cash'], default: 'bank' },
  balance: { type: Number, default: 0 }
}, { timestamps: true });

module.exports = mongoose.model('Account', accountSchema);
