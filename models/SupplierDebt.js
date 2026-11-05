const mongoose = require('mongoose');

const supplierDebtSchema = new mongoose.Schema({
  supplierKey: { type: String, required: true, trim: true, index: true },
  supplierName: { type: String, required: true, trim: true },

  // Numeric tracking replacing static remaining amounts
  totalAmount: { type: Number, required: true, default: 0, min: 0 },
  paidAmount: { type: Number, required: true, default: 0, min: 0 },
  remainingAmount: { type: Number, default: 0, index: true },

  status: {
    type: String,
    enum: ['pending', 'partial', 'completed'],
    default: 'pending',
    index: true
  },

  phone: { type: String, default: '', trim: true },
  bankInfo: { type: String, default: '', trim: true },
  notes: { type: String, default: '', trim: true }
}, { timestamps: true });

// Pre-save lifecycle hook: automated calculation for installment debt tracking
supplierDebtSchema.pre('save', function(next) {
  // Safe backfill for legacy documents where totalAmount might be 0 but remainingAmount exists
  if ((!this.totalAmount || this.totalAmount === 0) && (this.remainingAmount > 0 || this.paidAmount > 0)) {
    this.totalAmount = (this.remainingAmount || 0) + (this.paidAmount || 0);
  }

  const total = Math.max(0, Number(this.totalAmount) || 0);
  const paid = Math.max(0, Number(this.paidAmount) || 0);

  this.remainingAmount = Math.max(0, total - paid);

  if (paid === 0) {
    this.status = 'pending';
  } else if (paid < total) {
    this.status = 'partial';
  } else {
    this.status = 'completed';
  }

  next();
});

module.exports = mongoose.model('SupplierDebt', supplierDebtSchema);
