const mongoose = require('mongoose');

const debtSchema = new mongoose.Schema({
  type: { 
    type: String, 
    enum: ['payable', 'receivable'], // 'payable': Tôi nợ bạn, 'receivable': Bạn nợ tôi
    required: true 
  },
  personName: { type: String, required: true },
  amount: { type: Number, required: true },
  dueDate: { type: String, required: true }, // 'YYYY-MM-DD'
  status: { 
    type: String, 
    enum: ['pending', 'paid'], 
    default: 'pending' 
  },
  note: { type: String, default: '' }
}, { timestamps: true });

module.exports = mongoose.model('Debt', debtSchema);

