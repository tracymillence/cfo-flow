const mongoose = require('mongoose');

const diningMemberSchema = new mongoose.Schema({
  personKey: { type: String, required: true, unique: true },
  name: { type: String, required: true },
  group: { type: String, enum: ['work', 'family'], default: 'work' },
  openingBalance: { type: Number, default: 0 },
  phone: { type: String, default: '' },
  note: { type: String, default: '' }
}, { timestamps: true });

module.exports = mongoose.model('DiningMember', diningMemberSchema);
