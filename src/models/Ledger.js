const mongoose = require('mongoose');

const ledgerSchema = new mongoose.Schema({
  id: { type: String, required: true, unique: true },
  accountId: { type: String, required: true },
  direction: { type: String, enum: ['in', 'out', 'transfer_in', 'transfer_out'], required: true },
  amount: { type: Number, required: true },
  label: { type: String, required: true },
  category: { type: String, required: true },
  refId: { type: String, default: '' },
  date: { type: String, required: true },
  ts: { type: Number, default: () => Date.now() }
}, { timestamps: true });

module.exports = mongoose.model('Ledger', ledgerSchema);
