const mongoose = require('mongoose');

const configSchema = new mongoose.Schema({
  initialCash: { type: Number, default: 3341742 },
  weeklyLimit: { type: Number, default: 1500000 },
  currentWeek: { type: Number, default: 1 },
  syncPin: { type: String, default: 'CFO-8888' }
}, { timestamps: true });

module.exports = mongoose.model('Config', configSchema);
