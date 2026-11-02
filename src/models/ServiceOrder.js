const mongoose = require('mongoose');

const serviceOrderSchema = new mongoose.Schema({
  id: { type: String, required: true, unique: true },
  customerName: { type: String, required: true },
  serviceType: { type: String, required: true },
  supplierName: { type: String, required: true },
  costPrice: { type: Number, required: true },
  salePrice: { type: Number, required: true },
  customerPaid: { type: Boolean, default: false },
  receivedAccountId: { type: String, default: '' },
  supplierPaid: { type: Boolean, default: false },
  paidSupplierAccountId: { type: String, default: '' },
  date: { type: String, required: true }
}, { timestamps: true });

module.exports = mongoose.model('ServiceOrder', serviceOrderSchema);
