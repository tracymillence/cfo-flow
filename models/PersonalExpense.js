const mongoose = require('mongoose');

const personalExpenseSchema = new mongoose.Schema({
  title: { type: String, required: true },
  category: { 
    type: String, 
    enum: ['health_fitness', 'streaming_tech', 'living_utility', 'savings', 'flexible_spending'], 
    default: 'streaming_tech' 
  },
  type: {
    type: String,
    enum: ['fixed_bill', 'savings_deposit', 'flexible'],
    default: 'fixed_bill'
  },
  amount: { type: Number, required: true },
  cycle: { type: String, default: 'monthly' }, // monthly, yearly, one_time
  dueDay: { type: Number, default: 5 }, // Ngày đóng tiền trong tháng
  status: { type: String, enum: ['pending', 'paid'], default: 'pending' },
  paidDate: { type: String, default: '' },
  paidAccount: { type: String, default: 'Vietcombank' },
  deductFromAccount: { type: Boolean, default: false },
  notes: { type: String, default: '' }
}, { timestamps: true });

module.exports = mongoose.model('PersonalExpense', personalExpenseSchema);

