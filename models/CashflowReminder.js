const mongoose = require('mongoose');

const cashflowReminderSchema = new mongoose.Schema({
  date: { type: String, required: true }, // 'YYYY-MM-DD'
  title: { type: String, required: true },
  amount: { type: Number, default: 0 },
  type: { 
    type: String, 
    enum: ['income', 'expense', 'reminder'], 
    default: 'reminder' 
  },
  hubRole: { 
    type: String, 
    enum: ['hub1_income', 'hub2_dining', 'hub3_family', 'hub4_personal'], 
    default: 'hub1_income' 
  },
  status: { 
    type: String, 
    enum: ['pending', 'completed'], 
    default: 'pending' 
  },
  notes: { type: String, default: '' }
}, { timestamps: true });

module.exports = mongoose.model('CashflowReminder', cashflowReminderSchema);

