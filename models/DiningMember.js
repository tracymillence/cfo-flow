const mongoose = require('mongoose');

const diningMemberSchema = new mongoose.Schema({
  personKey: { type: String, required: true, unique: true },
  name: { type: String, required: true },
  openingBalance: { type: Number, default: 0 },
  note: { type: String, default: '' }
}, { timestamps: true });

module.exports = mongoose.model('DiningMember', diningMemberSchema);
