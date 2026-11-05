const mongoose = require('mongoose');

const transactionSchema = new mongoose.Schema({
  date: { type: String, required: true }, // 'YYYY-MM-DD'
  title: { type: String, required: true },
  amount: { type: Number, required: true },
  type: { 
    type: String, 
    enum: ['expense', 'income', 'transfer'], 
    default: 'expense' 
  },
  accountId: { type: String, default: '' },
  accountName: { type: String, required: true, default: 'Vietcombank' },
  toAccountId: { type: String, default: '' },
  toAccountName: { type: String, default: '' },
  category: { type: String, default: 'Chi tiêu' },
  hubRole: { 
    type: String, 
    enum: ['hub1_income', 'hub2_dining', 'hub3_family', 'hub4_personal'], 
    default: 'hub4_personal' 
  },
  impactsWeeklyLimit: { type: Boolean, default: false },
  usingSupplierFloat: { type: Boolean, default: false },
  relatedBillId: { type: String, default: '' },
  notes: { type: String, default: '' }
}, { timestamps: true });

module.exports = mongoose.model('Transaction', transactionSchema);

