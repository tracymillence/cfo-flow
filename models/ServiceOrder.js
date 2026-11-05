const mongoose = require('mongoose');

const serviceOrderSchema = new mongoose.Schema({
  customerName: { type: String, required: true, trim: true },
  serviceName: { type: String, default: 'Bán dấu / Khắc dấu', trim: true },
  serviceType: { type: String, default: 'Bán dấu / Khắc dấu' },

  // Customer Side (Receivable / Doanh thu & Thu tiền khách)
  salePrice: { type: Number, required: true, default: 0, min: 0 },
  customerPaidAmount: { type: Number, required: true, default: 0, min: 0 },
  customerRemainingAmount: { type: Number, default: 0 },
  customerPaymentStatus: {
    type: String,
    enum: ['pending', 'partial', 'completed'],
    default: 'pending',
    index: true
  },

  // Supplier Side (Payable / Vốn nợ nhà cung cấp)
  costPrice: { type: Number, required: true, default: 0, min: 0 },
  supplierPaidAmount: { type: Number, required: true, default: 0, min: 0 },
  supplierRemainingAmount: { type: Number, default: 0 },
  supplierPaymentStatus: {
    type: String,
    enum: ['pending', 'partial', 'completed'],
    default: 'pending',
    index: true
  },

  supplierName: { type: String, default: '', trim: true },
  supplierKey: { type: String, default: '', trim: true, index: true },
  receivedAccount: { type: String, default: 'Vietcombank' },
  date: { type: String, default: () => new Date().toISOString().slice(0, 10) },
  note: { type: String, default: '', trim: true }
}, { timestamps: true });

// Virtual profit: salePrice - costPrice
serviceOrderSchema.virtual('profit').get(function() {
  return (this.salePrice || 0) - (this.costPrice || 0);
});

// Backward compatibility virtuals for frontend UI
serviceOrderSchema.virtual('customerPaid')
  .get(function() {
    return this.customerPaymentStatus === 'completed';
  })
  .set(function(val) {
    if (val) {
      this.customerPaidAmount = this.salePrice || 0;
      this.customerRemainingAmount = 0;
      this.customerPaymentStatus = 'completed';
    } else {
      this.customerPaidAmount = 0;
      this.customerRemainingAmount = this.salePrice || 0;
      this.customerPaymentStatus = 'pending';
    }
  });

serviceOrderSchema.virtual('supplierPaid')
  .get(function() {
    return this.supplierPaymentStatus === 'completed';
  })
  .set(function(val) {
    if (val) {
      this.supplierPaidAmount = this.costPrice || 0;
      this.supplierRemainingAmount = 0;
      this.supplierPaymentStatus = 'completed';
    } else {
      this.supplierPaidAmount = 0;
      this.supplierRemainingAmount = this.costPrice || 0;
      this.supplierPaymentStatus = 'pending';
    }
  });

// Pre-save lifecycle hook to compute remaining balances and payment statuses automatically
serviceOrderSchema.pre('save', function(next) {
  // 1. Compute Customer Side
  const sale = Math.max(0, Number(this.salePrice) || 0);
  const cPaid = Math.max(0, Number(this.customerPaidAmount) || 0);
  this.customerRemainingAmount = Math.max(0, sale - cPaid);

  if (cPaid === 0) {
    this.customerPaymentStatus = 'pending';
  } else if (cPaid < sale) {
    this.customerPaymentStatus = 'partial';
  } else {
    this.customerPaymentStatus = 'completed';
  }

  // 2. Compute Supplier Side
  const cost = Math.max(0, Number(this.costPrice) || 0);
  const sPaid = Math.max(0, Number(this.supplierPaidAmount) || 0);
  this.supplierRemainingAmount = Math.max(0, cost - sPaid);

  if (sPaid === 0) {
    this.supplierPaymentStatus = 'pending';
  } else if (sPaid < cost) {
    this.supplierPaymentStatus = 'partial';
  } else {
    this.supplierPaymentStatus = 'completed';
  }

  next();
});

serviceOrderSchema.set('toJSON', { virtuals: true });
serviceOrderSchema.set('toObject', { virtuals: true });

module.exports = mongoose.model('ServiceOrder', serviceOrderSchema);
