const mongoose = require('mongoose');

const upcomingTransactionSchema = new mongoose.Schema({
  title: { 
    type: String, 
    required: [true, 'Vui lòng nhập tên khoản mục'], 
    trim: true 
  },
  amount: { 
    type: Number, 
    required: [true, 'Vui lòng nhập số tiền'], 
    min: [0, 'Số tiền không được âm'] 
  },
  type: { 
    type: String, 
    enum: ['income', 'expense'], 
    required: true,
    default: 'expense'
  },
  date: { 
    type: String, 
    required: [true, 'Vui lòng chọn ngày dự kiến thực hiện'] // 'YYYY-MM-DD'
  },
  hubRole: { 
    type: String, 
    enum: ['hub1_income', 'hub2_dining', 'hub3_family', 'hub4_personal'], 
    required: true,
    default: 'hub1_income'
  },
  notes: { 
    type: String, 
    default: '' 
  },
  createdBy: { 
    type: String, 
    default: 'admin' 
  }
}, { 
  collection: 'upcoming_transactions',
  timestamps: true 
});

// Index for fast timeline ordering
upcomingTransactionSchema.index({ date: 1, createdAt: 1 });
upcomingTransactionSchema.index({ hubRole: 1, date: 1 });

module.exports = mongoose.model('UpcomingTransaction', upcomingTransactionSchema);
