const mongoose = require('mongoose');

const supplierDebtSchema = new mongoose.Schema({
  supplierKey: { type: String, default: '' },
  supplierName: { type: String, required: true },
  remainingAmount: { type: Number, required: true, default: 0 },
  phone: { type: String, default: '' },
  bankInfo: { type: String, default: '' },
  notes: { type: String, default: '' }
}, { timestamps: true });

module.exports = mongoose.model('SupplierDebt', supplierDebtSchema);
