const mongoose = require('mongoose');

const supplierDebtSchema = new mongoose.Schema({
  id: { type: String, required: true, unique: true },
  supplierKey: { type: String, required: true },
  supplierName: { type: String, required: true },
  remainingAmount: { type: Number, default: 0 }
}, { timestamps: true });

module.exports = mongoose.model('SupplierDebt', supplierDebtSchema);
