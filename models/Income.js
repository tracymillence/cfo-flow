const mongoose = require('mongoose');

const incomeSchema = new mongoose.Schema({
  source: { 
    type: String, 
    enum: ['Lương', 'Tip', 'Lợi nhuận dịch vụ', 'Khác'], 
    default: 'Lương' 
  },
  amount: { type: Number, required: true },
  date: { type: String, required: true }, // 'YYYY-MM-DD'
  note: { type: String, default: '' },
  receivedAccount: { type: String, default: 'Vietcombank' }
}, { timestamps: true });

module.exports = mongoose.model('Income', incomeSchema);
