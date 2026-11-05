const mongoose = require('mongoose');

const serviceOrderSchema = new mongoose.Schema({
  customerName: { type: String, required: true, trim: true },
  serviceName: { type: String, default: 'Bán dấu / Khắc dấu', trim: true },
  serviceType: { type: String, default: 'Bán dấu / Khắc dấu' },
  costPrice: { type: Number, required: true, default: 0 }, // Giá vốn trả NCC (VD: 50.000đ)
  salePrice: { type: Number, required: true, default: 0 }, // Giá thu khách (VD: 90.000đ)
  customerPaid: { type: Boolean, default: false }, // false = Khách chưa trả (Nợ tôi), true = Đã thu khách
  supplierPaid: { type: Boolean, default: false }, // false = Chưa trả NCC (Nợ NCC), true = Đã trả NCC
  supplierName: { type: String, default: '', trim: true }, // Tên NCC (VD: Xưởng Khắc Dấu, Thuỳ BH...)
  supplierKey: { type: String, default: '', trim: true },
  receivedAccount: { type: String, default: 'Vietcombank' },
  date: { type: String, default: () => new Date().toISOString().slice(0, 10) }, // 'YYYY-MM-DD'
  note: { type: String, default: '', trim: true }
}, { timestamps: true });

// Virtual profit: salePrice - costPrice
serviceOrderSchema.virtual('profit').get(function() {
  return (this.salePrice || 0) - (this.costPrice || 0);
});

serviceOrderSchema.set('toJSON', { virtuals: true });
serviceOrderSchema.set('toObject', { virtuals: true });

module.exports = mongoose.model('ServiceOrder', serviceOrderSchema);
