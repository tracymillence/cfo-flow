const mongoose = require('mongoose');

const serviceOrderSchema = new mongoose.Schema({
  customerName: { type: String, required: true, trim: true },
  serviceName: { type: String, default: 'Bán dấu / Khắc dấu', trim: true },
  serviceType: { type: String, default: 'Bán dấu / Khắc dấu' },

  // Customer Side (Receivable / Doanh thu & Thu tiền khách)
  salePrice: { type: Number, required: true, default: 0, min: 0 },
  customerPaid: { type: Boolean, default: false, index: true },
  customerPaidAmount: { type: Number, required: true, default: 0, min: 0 },
  customerRemainingAmount: { type: Number, default: 0 },
  customerPaymentStatus: {
    type: String,
    enum: ['pending', 'partial', 'completed'],
    default: 'pending',
    index: true
  },
  receivedAccount: { type: String, default: 'Vietcombank' },
  customerPaidDate: { type: String, default: '' },
  customerAccountSynced: { type: Boolean, default: false },
  customerTransactionId: { type: mongoose.Schema.Types.ObjectId, ref: 'Transaction', default: null },

  // Supplier Side (Payable / Vốn nợ nhà cung cấp)
  costPrice: { type: Number, required: true, default: 0, min: 0 },
  supplierPaid: { type: Boolean, default: false, index: true },
  supplierPaidAmount: { type: Number, required: true, default: 0, min: 0 },
  supplierRemainingAmount: { type: Number, default: 0 },
  supplierPaymentStatus: {
    type: String,
    enum: ['pending', 'partial', 'completed'],
    default: 'pending',
    index: true
  },
  supplierPaidAccount: { type: String, default: 'Vietcombank' },
  supplierPaidDate: { type: String, default: '' },
  supplierAccountSynced: { type: Boolean, default: false },
  supplierTransactionId: { type: mongoose.Schema.Types.ObjectId, ref: 'Transaction', default: null },

  supplierName: { type: String, default: '', trim: true },
  supplierKey: { type: String, default: '', trim: true, index: true },
  date: { type: String, default: () => new Date().toISOString().slice(0, 10) },
  note: { type: String, default: '', trim: true }
}, { timestamps: true });

// Virtual profit: salePrice - costPrice
serviceOrderSchema.virtual('profit').get(function() {
  return (this.salePrice || 0) - (this.costPrice || 0);
});

// Post-init hook: đảm bảo đồng bộ các bản ghi cũ giữa customerPaymentStatus/supplierPaymentStatus và customerPaid/supplierPaid
serviceOrderSchema.post('init', function(doc) {
  if (doc.customerPaymentStatus === 'completed' && !doc.customerPaid) {
    doc.customerPaid = true;
  }
  if (doc.supplierPaymentStatus === 'completed' && !doc.supplierPaid) {
    doc.supplierPaid = true;
  }
});

// Pre-save lifecycle hook to compute remaining balances and payment statuses automatically
serviceOrderSchema.pre('save', function(next) {
  // 1. Compute Customer Side
  const sale = Math.max(0, Number(this.salePrice) || 0);
  if (this.isModified('customerPaid')) {
    if (this.customerPaid) {
      this.customerPaidAmount = sale;
      this.customerRemainingAmount = 0;
      this.customerPaymentStatus = 'completed';
    } else {
      this.customerPaidAmount = 0;
      this.customerRemainingAmount = sale;
      this.customerPaymentStatus = 'pending';
    }
  } else if (this.isModified('customerPaidAmount')) {
    const cPaid = Math.max(0, Number(this.customerPaidAmount) || 0);
    this.customerRemainingAmount = Math.max(0, sale - cPaid);
    if (cPaid === 0) {
      this.customerPaymentStatus = 'pending';
      this.customerPaid = false;
    } else if (cPaid < sale) {
      this.customerPaymentStatus = 'partial';
      this.customerPaid = false;
    } else {
      this.customerPaymentStatus = 'completed';
      this.customerPaid = true;
    }
  } else if (this.customerPaid || this.customerPaymentStatus === 'completed') {
    this.customerPaid = true;
    this.customerPaidAmount = sale;
    this.customerRemainingAmount = 0;
    this.customerPaymentStatus = 'completed';
  } else {
    this.customerPaid = false;
    this.customerPaidAmount = 0;
    this.customerRemainingAmount = sale;
    this.customerPaymentStatus = 'pending';
  }

  // 2. Compute Supplier Side
  const cost = Math.max(0, Number(this.costPrice) || 0);
  if (this.isModified('supplierPaid')) {
    if (this.supplierPaid) {
      this.supplierPaidAmount = cost;
      this.supplierRemainingAmount = 0;
      this.supplierPaymentStatus = 'completed';
    } else {
      this.supplierPaidAmount = 0;
      this.supplierRemainingAmount = cost;
      this.supplierPaymentStatus = 'pending';
    }
  } else if (this.isModified('supplierPaidAmount')) {
    const sPaid = Math.max(0, Number(this.supplierPaidAmount) || 0);
    this.supplierRemainingAmount = Math.max(0, cost - sPaid);
    if (sPaid === 0) {
      this.supplierPaymentStatus = 'pending';
      this.supplierPaid = false;
    } else if (sPaid < cost) {
      this.supplierPaymentStatus = 'partial';
      this.supplierPaid = false;
    } else {
      this.supplierPaymentStatus = 'completed';
      this.supplierPaid = true;
    }
  } else if (this.supplierPaid || this.supplierPaymentStatus === 'completed') {
    this.supplierPaid = true;
    this.supplierPaidAmount = cost;
    this.supplierRemainingAmount = 0;
    this.supplierPaymentStatus = 'completed';
  } else {
    this.supplierPaid = false;
    this.supplierPaidAmount = 0;
    this.supplierRemainingAmount = cost;
    this.supplierPaymentStatus = 'pending';
  }

  next();
});

serviceOrderSchema.set('toJSON', { virtuals: true });
serviceOrderSchema.set('toObject', { virtuals: true });

module.exports = mongoose.model('ServiceOrder', serviceOrderSchema);
