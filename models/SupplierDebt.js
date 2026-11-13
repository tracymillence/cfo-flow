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
  notes: { type: String, default: '', trim: true },

  // Accounts Payable Aging: Ngày đến hạn thanh toán công nợ
  dueDate: { type: Date, required: false, default: null, index: true },

  // Lịch sử các lần trả nợ nhà cung cấp (từng phần hoặc toàn bộ)
  paymentHistory: {
    type: [{
      amount: { type: Number, required: true, min: 0 },
      date: { type: String, required: true },
      accountName: { type: String, default: '' },
      deductFromAccount: { type: Boolean, default: true },
      appliedToOrders: { type: Boolean, default: false },
      note: { type: String, default: '' },
      transactionId: { type: mongoose.Schema.Types.ObjectId, ref: 'Transaction', default: null },
      createdAt: { type: Date, default: Date.now }
    }],
    default: []
  }
}, { timestamps: true });

// Pre-save lifecycle hook: automated calculation for installment debt tracking
supplierDebtSchema.pre('save', function(next) {
  const paid = Math.max(0, Number(this.paidAmount) || 0);

  if (this.isModified('remainingAmount') && !this.isModified('totalAmount')) {
    // Khi cập nhật trực tiếp remainingAmount (cộng/trừ từ đơn hàng hoặc trả nợ), giữ nguyên remainingAmount làm chuẩn
    this.remainingAmount = Math.max(0, Number(this.remainingAmount) || 0);
    this.totalAmount = this.remainingAmount + paid;
  } else {
    // Safe backfill for legacy documents where totalAmount might be 0 but remainingAmount exists
    if ((!this.totalAmount || this.totalAmount === 0) && (this.remainingAmount > 0 || paid > 0)) {
      this.totalAmount = (this.remainingAmount || 0) + paid;
    }
    const total = Math.max(0, Number(this.totalAmount) || 0);
    this.remainingAmount = Math.max(0, total - paid);
  }

  if (this.remainingAmount === 0 && (this.totalAmount > 0 || paid > 0)) {
    this.status = 'completed';
  } else if (paid > 0 && this.remainingAmount > 0) {
    this.status = 'partial';
  } else {
    this.status = 'pending';
  }

  next();
});

module.exports = mongoose.model('SupplierDebt', supplierDebtSchema);
