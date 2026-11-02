const mongoose = require('mongoose');

const splitSchema = new mongoose.Schema({
  personKey: { type: String, required: true },
  name: { type: String, required: true },
  amount: { type: Number, required: true },
  isMe: { type: Boolean, default: false }
}, { _id: false });

const diningBillSchema = new mongoose.Schema({
  id: { type: String, required: true, unique: true },
  date: { type: String, required: true },
  monthKey: { type: String, required: true },
  accountId: { type: String, required: true },
  accountName: { type: String, required: true },
  title: { type: String, required: true },
  totalBill: { type: Number, required: true },
  myShare: { type: Number, default: 0 },
  splits: [splitSchema]
}, { timestamps: true });

module.exports = mongoose.model('DiningBill', diningBillSchema);
