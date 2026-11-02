const mongoose = require('mongoose');

const diningMemberSchema = new mongoose.Schema({
  id: { type: String, required: true, unique: true },
  personKey: { type: String, required: true, unique: true },
  name: { type: String, required: true },
  openingBalance: { type: Number, default: 0 }
}, { timestamps: true });

module.exports = mongoose.model('DiningMember', diningMemberSchema);
