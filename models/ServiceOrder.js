const mongoose = require('mongoose');

const serviceOrderSchema = new mongoose.Schema({
  customerName: { type: String, required: true },
  serviceType: { 
    type: String, 
    enum: ['Reset pass thuế', 'Bán dấu / Khắc dấu', 'Chữ ký số / Hóa đơn', 'Dịch vụ doanh nghiệp khác'], 
    default: 'Reset pass thuế' 
  },
  costPrice: { type: Number, required: true }, // Giá vốn trả NCC
  salePrice: { type: Number, required: true }, // Giá thu khách
  customerPaid: { type: Boolean, default: false }, // Đã thu khách / Chưa thu (Nợ)
  supplierPaid: { type: Boolean, default: false }, // Đã trả NCC / Chờ trả gom
  receivedAccount: { type: String, default: 'Vietcombank' },
  date: { type: String, required: true } // 'YYYY-MM-DD'
}, { timestamps: true });

// Virtual profit: salePrice - costPrice
serviceOrderSchema.virtual('profit').get(function() {
  return (this.salePrice || 0) - (this.costPrice || 0);
});

module.exports = mongoose.model('ServiceOrder', serviceOrderSchema);
