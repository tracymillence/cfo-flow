const mongoose = require('mongoose');

const debtSchema = new mongoose.Schema({
  type: { 
    type: String, 
    enum: ['payable', 'receivable'], // 'payable': Tôi nợ bạn, 'receivable': Bạn nợ tôi
    required: true 
  },
  personName: { type: String, required: true, trim: true },
  amount: { type: Number, required: true, min: 0 },
  dueDate: { type: String, required: true }, // 'YYYY-MM-DD'
  status: { 
    type: String, 
    enum: ['pending', 'paid'], 
    default: 'pending',
    index: true
  },
  settledAccount: { type: String, default: 'Vietcombank' },
  paidDate: { type: String, default: '' },
  accountSynced: { type: Boolean, default: false },
  transactionId: { type: mongoose.Schema.Types.ObjectId, ref: 'Transaction', default: null },
  note: { type: String, default: '' }
}, { timestamps: true });

module.exports = mongoose.model('Debt', debtSchema);

