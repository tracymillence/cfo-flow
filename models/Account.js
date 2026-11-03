const mongoose = require('mongoose');

const accountSchema = new mongoose.Schema({
  accountId: { type: String, default: () => 'acc_' + Date.now() },
  name: { type: String, required: true }, // 'Vietcombank', 'MoMo', 'Tiền mặt', ...
  type: { type: String, enum: ['bank', 'ewallet', 'cash'], default: 'bank' },
  balance: { type: Number, default: 0 },
  accountNumber: { type: String, default: '' },
  hubRole: { 
    type: String, 
    enum: ['hub1_income', 'hub2_dining', 'hub3_family', 'hub4_personal'], 
    default: 'hub1_income' 
  },
  note: { type: String, default: '' }
}, { timestamps: true });

module.exports = mongoose.model('Account', accountSchema);
