const mongoose = require('mongoose');

const configSchema = new mongoose.Schema({
  initialCash: { type: Number, default: 3341742 },
  weeklyLimit: { type: Number, default: 1500000 },
  hub4MonthlyBudget: { type: Number, default: 6000000 }, // Tổng ngân sách tháng chuyển sang Hub 4
  savingsRate: { type: Number, default: 15 }, // Tỷ lệ trích tiết kiệm trước (10% - 15%)
  currentWeek: { type: Number, default: 1 },
  syncPin: { type: String, default: 'CFO-8888' }
}, { timestamps: true });

module.exports = mongoose.model('Config', configSchema);

