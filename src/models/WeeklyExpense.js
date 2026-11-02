const mongoose = require('mongoose');

const weeklyExpenseSchema = new mongoose.Schema({
  id: { type: String, required: true, unique: true },
  accountId: { type: String, required: true },
  week: { type: Number, required: true },
  category: { type: String, required: true },
  note: { type: String, required: true },
  amount: { type: Number, required: true },
  date: { type: String, required: true }
}, { timestamps: true });

module.exports = mongoose.model('WeeklyExpense', weeklyExpenseSchema);
