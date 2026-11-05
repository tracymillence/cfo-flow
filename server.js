require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const path = require('path');

const Config = require('./models/Config');
const Income = require('./models/Income');
const ServiceOrder = require('./models/ServiceOrder');
const DiningLedger = require('./models/DiningLedger');
const DiningMember = require('./models/DiningMember');
const DiningSettlement = require('./models/DiningSettlement');
const Debt = require('./models/Debt');
const Account = require('./models/Account');
const SupplierDebt = require('./models/SupplierDebt');
const CashflowReminder = require('./models/CashflowReminder');
const Transaction = require('./models/Transaction');
const PersonalExpense = require('./models/PersonalExpense');
const User = require('./models/User');
const CorrectionRequest = require('./models/CorrectionRequest');
const UpcomingTransaction = require('./models/UpcomingTransaction');

const app = express();
const PORT = process.env.PORT || 10000;
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/cfo_flow_db';
let lastMongoError = null;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve static frontend from /public
app.use(express.static(path.join(__dirname, 'public'), {
  setHeaders: (res, filePath) => {
    if (filePath.endsWith('.html')) {
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    }
  }
}));

// Helper string normalizer
function normalizeKey(str) {
  if (!str) return '';
  return str.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().replace(/\s+/g, ' ');
}

function escapeRegex(str) {
  if (!str) return '';
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Tự động gộp các bản ghi nhà cung cấp trùng lặp theo tên/key và chuẩn hóa key
async function mergeDuplicateSuppliers() {
  try {
    if (mongoose.connection.readyState !== 1) return;
    const SupplierDebt = require('./models/SupplierDebt');
    const ServiceOrder = require('./models/ServiceOrder');
    const allSuppliers = await SupplierDebt.find();

    const grouped = {};
    for (const sup of allSuppliers) {
      const key = normalizeKey(sup.supplierName);
      if (!key) continue;
      if (!grouped[key]) grouped[key] = [];
      grouped[key].push(sup);
    }

    for (const key of Object.keys(grouped)) {
      const list = grouped[key];
      const primary = list[0];
      let needsSave = false;
      if (primary.supplierKey !== key) {
        primary.supplierKey = key;
        needsSave = true;
      }

      if (list.length > 1) {
        console.log(`Đang gộp ${list.length} bản ghi NCC trùng lặp cho: "${primary.supplierName}"...`);
        for (let i = 1; i < list.length; i++) {
          const dup = list[i];
          primary.remainingAmount = (primary.remainingAmount || 0) + (dup.remainingAmount || 0);
          if (!primary.phone && dup.phone) primary.phone = dup.phone;
          if (!primary.bankInfo && dup.bankInfo) primary.bankInfo = dup.bankInfo;
          if (!primary.notes && dup.notes) primary.notes = dup.notes;
          await SupplierDebt.findByIdAndDelete(dup._id);
        }
        needsSave = true;
      }

      if (needsSave) {
        await primary.save();
      }

      // Đảm bảo các đơn hàng liên quan đồng bộ đúng tên và key chuẩn
      await ServiceOrder.updateMany(
        { 
          $or: [
            { supplierKey: key },
            { supplierName: { $regex: new RegExp(`^${escapeRegex(primary.supplierName.trim())}$`, 'i') } }
          ]
        },
        { 
          $set: { 
            supplierKey: key,
            supplierName: primary.supplierName 
          } 
        }
      );
    }
  } catch (err) {
    console.error('Lỗi khi gộp NCC trùng lặp:', err.message);
  }
}

// Đảm bảo index unique tách biệt giữa group và personKey, dọn dẹp các index rác cũ
async function ensureCleanIndexes() {
  try {
    if (mongoose.connection.readyState !== 1) return;
    const db = mongoose.connection.db;

    // 1. diningmembers: bỏ personKey_1 cũ
    const dmCol = db.collection('diningmembers');
    const dmIndexes = await dmCol.indexes();
    if (dmIndexes.some(i => i.name === 'personKey_1')) {
      console.log('Đang loại bỏ index cũ personKey_1...');
      await dmCol.dropIndex('personKey_1');
      console.log('Đã loại bỏ personKey_1 thành công.');
    }
    await dmCol.createIndex({ group: 1, personKey: 1 }, { unique: true });

    // 2. supplierdebts: loại bỏ index cũ id_1 gây lỗi E11000 dup key: { id: null }
    const supCol = db.collection('supplierdebts');
    const supIndexes = await supCol.indexes();
    if (supIndexes.some(i => i.name === 'id_1')) {
      console.log('Đang loại bỏ index cũ id_1 trên supplierdebts...');
      await supCol.dropIndex('id_1');
      console.log('Đã loại bỏ index id_1 trên supplierdebts thành công.');
    }

    // 3. Quét các collections khác nếu có index id_1 rác tương tự
    const checkCols = ['debts', 'accounts', 'cashflowreminders', 'incomes', 'personalexpenses', 'upcoming_transactions'];
    for (const cName of checkCols) {
      try {
        const c = db.collection(cName);
        const idxs = await c.indexes();
        if (idxs.some(i => i.name === 'id_1')) {
          console.log(`Đang loại bỏ index rác id_1 trên ${cName}...`);
          await c.dropIndex('id_1');
        }
      } catch (_) {}
    }

    // 4. Gộp NCC trùng lặp
    await mergeDuplicateSuppliers();
  } catch (e) {
    // Không làm gián đoạn nếu index đã tồn tại
  }
}

// Auto-reconnect helper
async function ensureMongoConnected() {
  if (mongoose.connection.readyState === 1) return true;
  try {
    await mongoose.connect(MONGODB_URI, { serverSelectionTimeoutMS: 8000 });
    console.log('✓ Kết nối MongoDB Atlas thành công!');
    lastMongoError = null;
    await ensureCleanIndexes();
    await seedDefaultData(false);
    return true;
  } catch (err) {
    lastMongoError = err;
    console.error('❌ Lỗi kết nối MongoDB:', err.message);
    return false;
  }
}

// Auto-reconnect middleware for all API calls
app.use('/api', async (req, res, next) => {
  if (mongoose.connection.readyState !== 1) {
    await ensureMongoConnected();
  }
  next();
});

// Helper to adjust account balance safely in real-time
async function adjustAccountBalance(accountName, delta) {
  if (!accountName || !delta) return null;
  const trimmed = accountName.trim();
  const acc = await Account.findOne({ name: { $regex: new RegExp(`^${trimmed}$`, 'i') } });
  if (acc) {
    acc.balance = (acc.balance || 0) + delta;
    await acc.save();
    return acc;
  }
  return null;
}

// ==================== SEED DATA HELPER (PRESERVES EXISTING DATA) ====================
async function seedDefaultData(force = false) {
  try {
    // 1. Config
    const configCount = await Config.countDocuments();
    if (configCount === 0 || force) {
      if (force) await Config.deleteMany({});
      await Config.create({
        initialCash: 3741742,
        weeklyLimit: 1500000,
        currentWeek: 1,
        syncPin: 'CFO-8888'
      });
    }

    // 2. Accounts (Ngân hàng & Tiền mặt riêng)
    const accountsCount = await Account.countDocuments();
    if (accountsCount === 0 || force) {
      if (force) await Account.deleteMany({});
      await Account.create([
        { name: 'Vietcombank', type: 'bank', balance: 3280742, hubRole: 'hub1_income', accountNumber: '...VCB' },
        { name: 'MoMo', type: 'ewallet', balance: 61000, hubRole: 'hub2_dining', accountNumber: 'Ví MoMo' },
        { name: 'Tiền mặt', type: 'cash', balance: 400000, hubRole: 'hub4_personal', accountNumber: 'Ví tiền mặt' }
      ]);
    }

    // 3. Supplier Debts (Nợ từng nhà cung cấp riêng)
    const suppliersCount = await SupplierDebt.countDocuments();
    if (suppliersCount === 0 || force) {
      if (force) await SupplierDebt.deleteMany({});
      await SupplierDebt.create([
        { supplierKey: 'ncc pass thue', supplierName: 'NCC Pass Thuế', remainingAmount: 420000, notes: 'Vốn reset pass thuế' },
        { supplierKey: 'xuong khac dau', supplierName: 'Xưởng Khắc Dấu Tuấn Hương', remainingAmount: 190000, notes: 'Vốn khắc dấu Tuấn Hương' }
      ]);
    }

    // 4. Cashflow Reminders (Lịch nhắc dòng tiền)
    const remindersCount = await CashflowReminder.countDocuments();
    if (remindersCount === 0 || force) {
      if (force) await CashflowReminder.deleteMany({});
      await CashflowReminder.create([
        { date: '2026-11-05', title: 'Nhận lương công ty (+17.000.000đ)', amount: 17000000, type: 'income', hubRole: 'hub1_income', status: 'pending' },
        { date: '2026-11-05', title: 'Trích chi Quỹ Gia Đình (6 người)', amount: 2500000, type: 'expense', hubRole: 'hub3_family', status: 'pending' },
        { date: '2026-11-08', title: 'Thu nợ Yến mượn tiền quỹ (+300.000đ)', amount: 300000, type: 'income', hubRole: 'hub2_dining', status: 'pending' },
        { date: '2026-11-09', title: 'Nạp hạn mức tuần mới vào Ví cá nhân (1.500.000đ)', amount: 1500000, type: 'expense', hubRole: 'hub4_personal', status: 'pending' },
        { date: '2026-11-30', title: 'Thanh toán Hũ tiền hàng cho các NCC (610.000đ)', amount: 610000, type: 'expense', hubRole: 'hub1_income', status: 'pending' }
      ]);
    }

    // 5. Dining Members (14 người nhóm làm việc giữ nguyên + 6 người gia đình)
    const membersCount = await DiningMember.countDocuments();
    if (membersCount === 0 || force) {
      if (force) await DiningMember.deleteMany({});
      await DiningMember.insertMany([
        { personKey: 'yến', name: 'Yến', group: 'work', openingBalance: 1276411 },
        { personKey: 'thịnh', name: 'Thịnh', group: 'work', openingBalance: 20004 },
        { personKey: 'long', name: 'Long', group: 'work', openingBalance: -8004088 },
        { personKey: 'hải', name: 'Hải', group: 'work', openingBalance: -933475 },
        { personKey: 'tuyết ngân', name: 'Tuyết Ngân', group: 'work', openingBalance: -473517 },
        { personKey: 'như ý', name: 'Như Ý', group: 'work', openingBalance: 943499 },
        { personKey: 'dương', name: 'Dương', group: 'work', openingBalance: 301750 },
        { personKey: 'thu ngân', name: 'Thu Ngân', group: 'work', openingBalance: -34913 },
        { personKey: 'hoài', name: 'Hoài', group: 'work', openingBalance: -59597 },
        { personKey: 'ngọc tuyền', name: 'Ngọc Tuyền', group: 'work', openingBalance: 2790663 },
        { personKey: 'quỳnh', name: 'Quỳnh', group: 'work', openingBalance: 0 },
        { personKey: 'phụng', name: 'Phụng', group: 'work', openingBalance: 0 },
        { personKey: 'nguyên', name: 'Nguyên', group: 'work', openingBalance: 0 },
        { personKey: 'hp', name: 'HP', group: 'work', openingBalance: 368507 }
      ]);
    } else {
      await DiningMember.updateMany({ group: { $exists: false } }, { $set: { group: 'work' } });
    }

    // Seed 6 thành viên Quỹ Gia Đình nếu chưa có
    const familyMembersCount = await DiningMember.countDocuments({ group: 'family' });
    if (familyMembersCount === 0) {
      await DiningMember.insertMany([
        { personKey: 'yen', name: 'Yến', group: 'family', openingBalance: 0 },
        { personKey: 'thịnh', name: 'Thịnh', group: 'family', openingBalance: 0 },
        { personKey: 'long', name: 'Long', group: 'family', openingBalance: 0 },
        { personKey: 'hải', name: 'Hải', group: 'family', openingBalance: 0 },
        { personKey: 'thuy', name: 'Thuý (tôi)', group: 'family', openingBalance: 0 },
        { personKey: 'bao', name: 'Bảo (người yêu tôi)', group: 'family', openingBalance: 0 }
      ]);
    }

    // 6. Dining Settlements (4 giao dịch nạp / mượn giữ nguyên)
    const settlementsCount = await DiningSettlement.countDocuments();
    if (settlementsCount === 0 || force) {
      if (force) await DiningSettlement.deleteMany({});
      await DiningSettlement.insertMany([
        { monthKey: '2026-11', personKey: 'yến', personName: 'Yến', category: 'work', amount: 300000, direction: 'out', topupKind: 'borrow', accountName: 'Vietcombank', addToAccount: false, note: 'Yến mượn tiền quỹ', date: '2026-11-02' },
        { monthKey: '2026-11', personKey: 'quỳnh', personName: 'Quỳnh', category: 'work', amount: 16000, direction: 'in', topupKind: 'prepaid', accountName: 'MoMo', addToAccount: false, note: 'CK MoMo', date: '2026-11-02' },
        { monthKey: '2026-11', personKey: 'phụng', personName: 'Phụng', category: 'work', amount: 29000, direction: 'in', topupKind: 'prepaid', accountName: 'MoMo', addToAccount: false, note: 'CK MoMo', date: '2026-11-02' },
        { monthKey: '2026-11', personKey: 'nguyên', personName: 'Nguyên', category: 'work', amount: 16000, direction: 'in', topupKind: 'prepaid', accountName: 'MoMo', addToAccount: false, note: 'CK MoMo', date: '2026-11-02' }
      ]);
    }

    // 7. Dining Bills (2 bữa ăn giữ nguyên)
    const billsCount = await DiningLedger.countDocuments();
    if (billsCount === 0 || force) {
      if (force) await DiningLedger.deleteMany({});
      await DiningLedger.create([
        {
          date: '2026-11-02',
          monthKey: '2026-11',
          mealTitle: 'Cơm trưa (5 người: Tôi, Hoài, Hải, Yến, HP)',
          category: 'work',
          totalBill: 156000,
          myShare: 31200,
          splitMode: 'equal',
          paidAccount: 'Vietcombank',
          deductFromAccount: false,
          deductWeeklyLimit: true,
          splits: [
            { personKey: 'tôi', personName: 'Tôi', amount: 31200, paid: true, isMe: true },
            { personKey: 'yến', personName: 'Yến', amount: 31200, paid: false, isMe: false },
            { personKey: 'hải', personName: 'Hải', amount: 31200, paid: false, isMe: false },
            { personKey: 'hoài', personName: 'Hoài', amount: 31200, paid: false, isMe: false },
            { personKey: 'hp', personName: 'HP', amount: 31200, paid: false, isMe: false }
          ],
          notes: 'Chia đều 5 người'
        },
        {
          date: '2026-11-02',
          monthKey: '2026-11',
          mealTitle: 'Ăn tối (Tôi & Thịnh)',
          category: 'work',
          totalBill: 182000,
          myShare: 122000,
          splitMode: 'custom',
          paidAccount: 'Vietcombank',
          deductFromAccount: false,
          deductWeeklyLimit: true,
          splits: [
            { personKey: 'tôi', personName: 'Tôi', amount: 122000, paid: true, isMe: true },
            { personKey: 'thịnh', personName: 'Thịnh', amount: 60000, paid: false, isMe: false }
          ],
          notes: 'Thịnh 60k, Tôi 122k'
        }
      ]);
    }

    // 8. Transactions (Sổ giao dịch thu/chi ban đầu)
    const txCount = await Transaction.countDocuments();
    if (txCount === 0 || force) {
      if (force) await Transaction.deleteMany({});
      await Transaction.create([
        {
          date: '2026-11-02',
          title: 'Chi tiền cơm trưa văn phòng (5 người)',
          amount: 156000,
          type: 'expense',
          accountName: 'Vietcombank',
          category: 'Ăn uống nhóm',
          hubRole: 'hub2_dining',
          impactsWeeklyLimit: false,
          notes: 'Thanh toán quét mã QR Vietcombank'
        },
        {
          date: '2026-11-02',
          title: 'Ăn tối (Tôi & Thịnh)',
          amount: 182000,
          type: 'expense',
          accountName: 'Vietcombank',
          category: 'Ăn uống cá nhân',
          hubRole: 'hub4_personal',
          impactsWeeklyLimit: true,
          notes: 'Thịnh 60k, Tôi 122k (trừ hạn mức tuần)'
        },
        {
          date: '2026-11-02',
          title: 'Khách thanh toán cọc dịch vụ thuế',
          amount: 500000,
          type: 'income',
          accountName: 'Vietcombank',
          category: 'Kinh doanh',
          hubRole: 'hub1_income',
          impactsWeeklyLimit: false,
          notes: 'Thu dịch vụ cấp lại pass thuế'
        }
      ]);
    }

    // 9. Debts (2 khoản nợ 2 chiều giữ nguyên)
    const debtsCount = await Debt.countDocuments();
    if (debtsCount === 0 || force) {
      if (force) await Debt.deleteMany({});
      await Debt.create([
        { personName: 'Chị Lan', amount: 500000, type: 'receivable', dueDate: '2026-11-05', note: 'Chị Lan vay tiền mặt', status: 'pending' },
        { personName: 'Bạn Tuấn', amount: 200000, type: 'payable', dueDate: '2026-11-07', note: 'Nợ tiền mua hộ đồ Shopee', status: 'pending' }
      ]);
    }

    // 10. Service Orders
    const ordersCount = await ServiceOrder.countDocuments();
    if (ordersCount === 0 || force) {
      if (force) await ServiceOrder.deleteMany({});
      await ServiceOrder.create([
        { customerName: 'Cty Nam An', serviceName: 'Reset Pass Thuế', costPrice: 300000, salePrice: 650000, supplierKey: 'ncc pass thue', supplierName: 'NCC Pass Thuế', customerPaid: true, supplierPaid: false, note: 'Khách chuyển VCB, chưa trả NCC' },
        { customerName: 'Bác Sĩ Cường', serviceName: 'Khắc Dấu Chức Danh', costPrice: 90000, salePrice: 220000, supplierKey: 'xuong khac dau', supplierName: 'Xưởng Khắc Dấu Tuấn Hương', customerPaid: true, supplierPaid: false, note: 'Đã thu tiền mặt' }
      ]);
    }

    // 11. Personal Expenses & Subscriptions (Hub 4 - Sức khỏe, Giải trí & Tiện ích cá nhân)
    const personalCount = await PersonalExpense.countDocuments();
    if (personalCount === 0 || force) {
      if (force) await PersonalExpense.deleteMany({});
      await PersonalExpense.insertMany([
        {
          title: 'Thẻ tập Gym & Fitness (2 người)',
          category: 'health_fitness',
          type: 'fixed_bill',
          amount: 600000,
          cycle: 'monthly',
          dueDay: 5,
          status: 'pending',
          paidAccount: 'Vietcombank',
          notes: 'Chi phí tập luyện sức khỏe cố định hàng tháng'
        },
        {
          title: 'Gói Netflix 4K Premium',
          category: 'streaming_tech',
          type: 'fixed_bill',
          amount: 260000,
          cycle: 'monthly',
          dueDay: 15,
          status: 'paid',
          paidDate: '2026-11-01',
          paidAccount: 'MoMo',
          notes: 'Dịch vụ xem phim giải trí cuối tuần của 2 người'
        },
        {
          title: 'YouTube Premium Family',
          category: 'streaming_tech',
          type: 'fixed_bill',
          amount: 89000,
          cycle: 'monthly',
          dueDay: 20,
          status: 'pending',
          paidAccount: 'Vietcombank',
          notes: 'Nghe nhạc & xem video không quảng cáo'
        },
        {
          title: 'Gói lưu trữ iCloud 2TB',
          category: 'living_utility',
          type: 'fixed_bill',
          amount: 59000,
          cycle: 'monthly',
          dueDay: 25,
          status: 'paid',
          paidDate: '2026-11-02',
          paidAccount: 'Vietcombank',
          notes: 'Lưu trữ hình ảnh, dữ liệu kỷ niệm 2 người'
        },
        {
          title: 'Trích Tiết Kiệm Tháng 11 (15% Hub 4)',
          category: 'savings',
          type: 'savings_deposit',
          amount: 900000,
          cycle: 'monthly',
          dueDay: 1,
          status: 'paid',
          paidDate: '2026-11-01',
          paidAccount: 'Vietcombank',
          notes: 'Quy tắc Hub 4: Tiết kiệm trước 10-15% khi nhận tiền từ Hub 1'
        }
      ]);
    }

    // 12. Users & RBAC (Khởi tạo tài khoản Quản trị viên mặc định nếu chưa có)
    const adminExists = await User.findOne({ username: 'admin' });
    if (!adminExists) {
      const defaultAdmin = new User({
        username: 'admin',
        fullName: 'Quản Trị Viên (Admin)',
        phone: '0900000000',
        role: 'admin',
        isAdmin: true,
        isActive: true,
        permissions: {
          viewOverview: true,
          manageAccounts: true,
          manageTransactions: true,
          manageDiningWork: true,
          manageDiningFamily: true,
          managePersonalHub: true,
          manageDebts: true,
          manageUsers: true,
          manageConfig: true
        }
      });
      defaultAdmin.setPassword('12345678');
      defaultAdmin.isDefaultPassword = true;
      await defaultAdmin.save();
      console.log('✓ Đã khởi tạo tài khoản quản trị mặc định: admin / 12345678');
    }

    console.log('✓ Dữ liệu mặc định đã sẵn sàng trong MongoDB Atlas');
  } catch (err) {
    console.error('Lỗi khi seedDefaultData:', err.message);
  }
}

// Order of dining members requested by user
const WORK_MEMBER_SORT_ORDER = [
  'yến',
  'thịnh',
  'long',
  'hải',
  'tuyết ngân',
  'như ý',
  'dương',
  'thu ngân',
  'hoài',
  'ngọc tuyền',
  'quỳnh',
  'phụng',
  'nguyên',
  'hp'
];

const FAMILY_MEMBER_SORT_ORDER = [
  'yến',
  'thịnh',
  'long',
  'hải',
  'thuý (tôi)',
  'thúy (tôi)',
  'thuý',
  'thúy',
  'bảo (người yêu tôi)',
  'bảo'
];

function getMemberSortIndex(name, group = 'work') {
  if (!name) return 999;
  const norm = normalizeKey(name);
  if (group === 'family') {
    const idx = FAMILY_MEMBER_SORT_ORDER.findIndex(o => normalizeKey(o) === norm);
    return idx !== -1 ? idx : 999;
  }
  const idx = WORK_MEMBER_SORT_ORDER.findIndex(o => normalizeKey(o) === norm);
  return idx !== -1 ? idx : 999;
}

// Trả về danh sách các key định danh khả dĩ cho một thành viên/giao dịch để khớp chính xác không lệch dấu
function getMemberLookupKeys(group, personKey, name) {
  const keys = new Set();
  const g = group || 'work';
  if (personKey) {
    const pk = normalizeKey(personKey);
    if (pk) {
      keys.add(`${g}_${pk}`);
      keys.add(`${g}_${normalizeKey(personKey.replace(/\(.*?\)/g, ''))}`);
    }
  }
  if (name) {
    const nk = normalizeKey(name);
    if (nk) {
      keys.add(`${g}_${nk}`);
      keys.add(`${g}_${normalizeKey(name.replace(/\(.*?\)/g, ''))}`);
    }
  }
  return Array.from(keys).filter(k => !k.endsWith('_'));
}

// Helper calculation engine for Dining Groups (Work vs Family)
function calculateDiningGroup(bills, settlements, members) {
  const billPaidTotal = bills.reduce((sum, b) => sum + (b.totalBill || 0), 0);
  const totalTopups = settlements
    .filter(s => s.direction === 'in')
    .reduce((sum, s) => sum + (s.amount || 0), 0);
  const totalBorrowed = settlements
    .filter(s => s.direction === 'out')
    .reduce((sum, s) => sum + (s.amount || 0), 0);
  const myShareTotal = bills.reduce((sum, b) => sum + (b.myShare || 0), 0);

  let colleaguesEatenTotal = 0;
  bills.forEach(b => {
    b.splits.forEach(sp => {
      if (!sp.isMe && normalizeKey(sp.personName) !== 'toi') {
        colleaguesEatenTotal += (sp.amount || 0);
      }
    });
  });

  const memberObjList = [];
  const memberKeyMap = new Map();

  members.forEach(m => {
    const rawKey = normalizeKey(m.personKey || m.name);
    const memberObj = {
      id: m._id,
      personKey: rawKey,
      name: m.name,
      group: m.group || 'work',
      openingBalance: m.openingBalance || 0,
      topups: 0,
      borrowed: 0,
      eaten: 0,
      mealCount: 0,
      currentBalance: m.openingBalance || 0
    };
    memberObjList.push(memberObj);

    // Đăng ký tất cả các alias định danh
    getMemberLookupKeys(m.group, m.personKey, m.name).forEach(k => {
      memberKeyMap.set(k, memberObj);
    });
  });

  settlements.forEach(s => {
    const sKeys = getMemberLookupKeys(s.category, s.personKey, s.personName);
    let matchedMember = null;
    for (const k of sKeys) {
      if (memberKeyMap.has(k)) {
        matchedMember = memberKeyMap.get(k);
        break;
      }
    }
    if (matchedMember) {
      if (s.direction === 'in') {
        matchedMember.topups += (s.amount || 0);
        matchedMember.currentBalance += (s.amount || 0);
      } else if (s.direction === 'out') {
        matchedMember.borrowed += (s.amount || 0);
        matchedMember.currentBalance -= (s.amount || 0);
      }
    }
  });

  bills.forEach(b => {
    b.splits.forEach(sp => {
      if (sp.isMe || normalizeKey(sp.personName) === 'toi') return;
      const spKeys = getMemberLookupKeys(b.category, sp.personKey, sp.personName);
      let matchedMember = null;
      for (const k of spKeys) {
        if (memberKeyMap.has(k)) {
          matchedMember = memberKeyMap.get(k);
          break;
        }
      }
      if (matchedMember) {
        matchedMember.eaten += (sp.amount || 0);
        matchedMember.mealCount += 1;
        matchedMember.currentBalance -= (sp.amount || 0);
      }
    });
  });

  const membersList = memberObjList.sort((a, b) => {
    const oA = getMemberSortIndex(a.name, a.group);
    const oB = getMemberSortIndex(b.name, b.group);
    if (oA !== oB) return oA - oB;
    return a.name.localeCompare(b.name, 'vi');
  });
  const surplusMembers = membersList.filter(m => m.currentBalance >= 0);
  const debtMembers = membersList.filter(m => m.currentBalance < 0);
  const totalSurplusFund = surplusMembers.reduce((sum, m) => sum + m.currentBalance, 0);
  const totalDebtReceivable = Math.abs(debtMembers.reduce((sum, m) => sum + m.currentBalance, 0));

  return {
    billPaidTotal,
    billCount: bills.length,
    totalTopups,
    topupCount: settlements.length,
    totalBorrowed,
    colleaguesEatenTotal,
    myShareTotal,
    totalSurplusFund,
    surplusCount: surplusMembers.length,
    totalDebtReceivable,
    debtCount: debtMembers.length,
    members: membersList,
    bills,
    settlements
  };
}

// ==================== HEALTH CHECK ENDPOINT ====================
app.get('/api/health', (req, res) => {
  const readyState = mongoose.connection.readyState;
  const states = { 0: 'disconnected', 1: 'connected', 2: 'connecting', 3: 'disconnecting' };
  res.json({
    status: readyState === 1 ? 'ok' : 'degraded',
    mongodb: {
      status: states[readyState] || 'unknown',
      readyState,
      hasEnvUri: Boolean(process.env.MONGODB_URI),
      maskedUri: process.env.MONGODB_URI ? process.env.MONGODB_URI.replace(/:\/\/[^:]+:[^@]+@/, '://***:***@') : null,
      lastError: lastMongoError ? lastMongoError.message : null
    }
  });
});

// ==================== AUTH & RBAC MIDDLEWARES ====================
async function authenticateToken(req, res, next) {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ success: false, error: 'Vui lòng đăng nhập để tiếp tục' });
    }
    const token = authHeader.split(' ')[1];
    if (!token) {
      return res.status(401).json({ success: false, error: 'Thiếu mã xác thực (Token)' });
    }
    const user = await User.findOne({ sessionToken: token, isActive: true });
    if (!user || (user.tokenExpiresAt && user.tokenExpiresAt < new Date())) {
      return res.status(401).json({ success: false, error: 'Phiên đăng nhập đã hết hạn hoặc tài khoản bị tạm khóa' });
    }
    req.user = user;
    next();
  } catch (err) {
    return res.status(500).json({ success: false, error: 'Lỗi xác thực: ' + err.message });
  }
}

function requirePermission(permKey) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ success: false, error: 'Chưa đăng nhập' });
    }
    if (req.user.isAdmin) {
      return next(); // Admin luôn có toàn quyền tuyệt đối
    }
    if (req.user.permissions && req.user.permissions[permKey]) {
      return next();
    }
    return res.status(403).json({
      success: false,
      error: `Tài khoản của bạn chưa được cấp quyền [${permKey}]. Hãy liên hệ Quản trị viên (Admin) để cấu hình quyền trên giao diện.`
    });
  };
}

function requireAnyPermission(...permKeys) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ success: false, error: 'Chưa đăng nhập' });
    if (req.user.isAdmin) return next();
    if (req.user.permissions && permKeys.some(k => req.user.permissions[k])) {
      return next();
    }
    return res.status(403).json({
      success: false,
      error: `Tài khoản của bạn chưa được cấp quyền [${permKeys.join(' hoặc ')}]. Hãy liên hệ Quản trị viên (Admin) để cấu hình.`
    });
  };
}

// ==================== AUTHENTICATION APIS ====================
app.post('/api/auth/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) {
      return res.status(400).json({ success: false, error: 'Vui lòng nhập tên đăng nhập và mật khẩu' });
    }
    const cleanUsername = username.toLowerCase().trim();
    const user = await User.findOne({ username: cleanUsername });
    if (!user) {
      return res.status(401).json({ success: false, error: 'Tên đăng nhập hoặc mật khẩu không chính xác' });
    }
    if (!user.isActive) {
      return res.status(403).json({ success: false, error: 'Tài khoản của bạn đã bị tạm khóa. Vui lòng liên hệ Admin.' });
    }

    let isValid = user.validPassword(password);
    // Hỗ trợ mật khẩu mặc định 12345678 và mật khẩu ban đầu
    if (!isValid && (password === '12345678' || password === 'Admin@123456')) {
      if (user.validPassword('12345678') || user.validPassword('Admin@123456')) {
        isValid = true;
      }
    }

    if (!isValid) {
      return res.status(401).json({ success: false, error: 'Tên đăng nhập hoặc mật khẩu không chính xác' });
    }

    // Kiểm tra xem user có đang dùng mật khẩu mặc định không
    const isDefault = Boolean(user.isDefaultPassword || user.validPassword('12345678') || user.validPassword('Admin@123456'));

    const token = user.generateToken();
    await user.save();

    res.json({
      success: true,
      token,
      user: {
        id: user._id,
        username: user.username,
        fullName: user.fullName,
        phone: user.phone,
        role: user.role,
        isAdmin: user.isAdmin,
        isActive: user.isActive,
        isDefaultPassword: isDefault,
        permissions: user.permissions
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get('/api/auth/me', authenticateToken, async (req, res) => {
  const isDefault = Boolean(req.user.isDefaultPassword || req.user.validPassword('12345678') || req.user.validPassword('Admin@123456'));
  res.json({
    success: true,
    user: {
      id: req.user._id,
      username: req.user.username,
      fullName: req.user.fullName,
      phone: req.user.phone,
      role: req.user.role,
      isAdmin: req.user.isAdmin,
      isActive: req.user.isActive,
      isDefaultPassword: isDefault,
      permissions: req.user.permissions
    }
  });
});

// API Đổi Mật Khẩu (Cập nhật thẳng vào Database MongoDB)
app.post('/api/auth/change-password', authenticateToken, async (req, res) => {
  try {
    const { oldPassword, newPassword } = req.body;
    if (!newPassword || newPassword.trim().length < 6) {
      return res.status(400).json({ success: false, error: 'Mật khẩu mới phải có tối thiểu 6 ký tự' });
    }

    const user = await User.findById(req.user._id);
    if (!user) {
      return res.status(404).json({ success: false, error: 'Không tìm thấy tài khoản người dùng' });
    }

    // Nếu người dùng nhập mật khẩu cũ thì kiểm tra tính đúng đắn
    if (oldPassword && oldPassword.trim().length > 0) {
      const matchOld = user.validPassword(oldPassword.trim()) || 
                       (user.username === 'admin' && (oldPassword.trim() === '12345678' || oldPassword.trim() === 'Admin@123456'));
      if (!matchOld) {
        return res.status(400).json({ success: false, error: 'Mật khẩu hiện tại không chính xác' });
      }
    }

    user.setPassword(newPassword.trim());
    user.isDefaultPassword = false;
    await user.save();

    res.json({
      success: true,
      message: 'Đổi mật khẩu thành công! Mật khẩu mới đã được cập nhật vào database MongoDB Atlas.',
      user: {
        id: user._id,
        username: user.username,
        fullName: user.fullName,
        phone: user.phone,
        role: user.role,
        isAdmin: user.isAdmin,
        isActive: user.isActive,
        isDefaultPassword: false,
        permissions: user.permissions
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/auth/logout', authenticateToken, async (req, res) => {
  try {
    req.user.sessionToken = null;
    req.user.tokenExpiresAt = null;
    await req.user.save();
    res.json({ success: true, message: 'Đăng xuất thành công' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ==================== ADMIN USER & PERMISSION MANAGEMENT (RBAC) APIS ====================
// Lấy danh sách tất cả người dùng và cấu hình phân quyền của họ
app.get('/api/admin/users', authenticateToken, requirePermission('manageUsers'), async (req, res) => {
  try {
    const users = await User.find({}, '-passwordHash -passwordSalt').sort({ isAdmin: -1, createdAt: 1 });
    res.json({ success: true, users });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Tạo người dùng mới và gán quyền trực tiếp
app.post('/api/admin/users', authenticateToken, requirePermission('manageUsers'), async (req, res) => {
  try {
    const { username, password, fullName, phone, role, isActive, permissions } = req.body;
    if (!username || !fullName) {
      return res.status(400).json({ success: false, error: 'Vui lòng nhập Tên đăng nhập và Họ tên' });
    }
    const cleanUsername = username.toLowerCase().trim();
    const existing = await User.findOne({ username: cleanUsername });
    if (existing) {
      return res.status(400).json({ success: false, error: `Tên đăng nhập "${cleanUsername}" đã tồn tại trên hệ thống` });
    }

    const isUserAdmin = role === 'admin';
    const newUser = new User({
      username: cleanUsername,
      fullName: fullName.trim(),
      phone: phone ? phone.trim() : '',
      role: role || 'custom',
      isAdmin: isUserAdmin,
      isActive: isActive !== false,
      permissions: permissions || {
        viewOverview: true,
        manageAccounts: false,
        manageTransactions: false,
        manageDiningWork: true,
        manageDiningFamily: false,
        managePersonalHub: false,
        manageDebts: false,
        manageUsers: false,
        manageConfig: false
      }
    });

    if (isUserAdmin) {
      Object.keys(newUser.permissions).forEach(k => {
        newUser.permissions[k] = true;
      });
    }

    // Mật khẩu mặc định khi tạo mới là 12345678 nếu không nhập
    const initialPassword = (password && password.trim().length > 0) ? password.trim() : '12345678';
    newUser.setPassword(initialPassword);
    newUser.isDefaultPassword = (initialPassword === '12345678');
    await newUser.save();

    res.json({
      success: true,
      message: `Đã tạo người dùng "${newUser.fullName}" thành công!`,
      user: {
        id: newUser._id,
        username: newUser.username,
        fullName: newUser.fullName,
        phone: newUser.phone,
        role: newUser.role,
        isAdmin: newUser.isAdmin,
        isActive: newUser.isActive,
        permissions: newUser.permissions
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Cập nhật người dùng & lưu thay đổi phân quyền thời gian thực vào MongoDB
app.put('/api/admin/users/:id', authenticateToken, requirePermission('manageUsers'), async (req, res) => {
  try {
    const { fullName, phone, role, isActive, permissions, password } = req.body;
    const targetUser = await User.findById(req.params.id);
    if (!targetUser) {
      return res.status(404).json({ success: false, error: 'Không tìm thấy người dùng' });
    }

    // Bảo vệ an toàn: không cho tự khóa tài khoản admin đang đăng nhập
    if (String(targetUser._id) === String(req.user._id)) {
      if (isActive === false) {
        return res.status(400).json({ success: false, error: 'Bạn không thể tự khóa tài khoản của chính mình!' });
      }
    }

    if (fullName) targetUser.fullName = fullName.trim();
    if (phone !== undefined) targetUser.phone = phone.trim();
    if (role !== undefined) targetUser.role = role;
    if (isActive !== undefined) targetUser.isActive = Boolean(isActive);

    if (role === 'admin') {
      targetUser.isAdmin = true;
    } else if (targetUser.username !== 'admin') {
      targetUser.isAdmin = false;
    }

    // Cập nhật từng quyền chi tiết (Granular Permissions)
    if (permissions && typeof permissions === 'object') {
      targetUser.permissions = {
        ...targetUser.permissions.toObject(),
        ...permissions
      };
      if (targetUser.isAdmin) {
        Object.keys(targetUser.permissions).forEach(k => {
          targetUser.permissions[k] = true;
        });
      }
    }

    // Nếu có truyền mật khẩu mới -> cập nhật
    if (password && password.trim().length > 0) {
      targetUser.setPassword(password.trim());
      targetUser.isDefaultPassword = (password.trim() === '12345678');
    }

    await targetUser.save();

    res.json({
      success: true,
      message: `Cập nhật phân quyền cho "${targetUser.fullName}" thành công!`,
      user: {
        id: targetUser._id,
        username: targetUser.username,
        fullName: targetUser.fullName,
        phone: targetUser.phone,
        role: targetUser.role,
        isAdmin: targetUser.isAdmin,
        isActive: targetUser.isActive,
        permissions: targetUser.permissions
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Xóa người dùng
app.delete('/api/admin/users/:id', authenticateToken, requirePermission('manageUsers'), async (req, res) => {
  try {
    const targetUser = await User.findById(req.params.id);
    if (!targetUser) {
      return res.status(404).json({ success: false, error: 'Không tìm thấy người dùng' });
    }
    if (String(targetUser._id) === String(req.user._id)) {
      return res.status(400).json({ success: false, error: 'Bạn không thể xóa tài khoản bạn đang đăng nhập' });
    }
    if (targetUser.username === 'admin') {
      return res.status(400).json({ success: false, error: 'Không thể xóa tài khoản Quản trị hệ thống gốc (admin)' });
    }

    await User.findByIdAndDelete(req.params.id);
    res.json({ success: true, message: `Đã xóa người dùng "${targetUser.fullName}"` });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ==================== DASHBOARD FULL REAL-TIME API ====================
app.get('/api/dashboard', authenticateToken, async (req, res) => {
  try {
    let config = await Config.findOne();
    if (!config) {
      config = await Config.create({ initialCash: 3741742, weeklyLimit: 1500000, currentWeek: 1 });
    }

    const [
      accounts,
      supplierDebts,
      reminders,
      serviceOrders,
      diningBills,
      diningMembers,
      diningSettlements,
      debts,
      transactions,
      incomes,
      personalExpenses
    ] = await Promise.all([
      Account.find().sort({ type: 1, name: 1 }),
      SupplierDebt.find().sort({ remainingAmount: -1, createdAt: -1 }),
      CashflowReminder.find().sort({ date: 1, createdAt: 1 }),
      ServiceOrder.find().sort({ createdAt: -1 }),
      DiningLedger.find().sort({ date: -1, createdAt: -1 }),
      DiningMember.find().sort({ name: 1 }),
      DiningSettlement.find().sort({ createdAt: -1 }),
      Debt.find().sort({ dueDate: 1 }),
      Transaction.find().sort({ date: -1, createdAt: -1 }),
      Income.find().sort({ date: 1 }),
      PersonalExpense.find().sort({ dueDay: 1, createdAt: 1 })
    ]);

    // --- 1. SỐ DƯ THỰC TẾ TỪNG NGÂN HÀNG & TIỀN MẶT RIÊNG ---
    const totalPhysicalCash = accounts.reduce((sum, a) => sum + (a.balance || 0), 0);

    // Phân bổ 4 Tài Khoản Cốt Lõi (4 Hubs Framework)
    const hubs = {
      hub1_income: { title: 'Hub 1: Thu Nhập & Kinh Doanh', balance: 0, accounts: [] },
      hub2_dining: { title: 'Hub 2: Quỹ Ứng Tiền Ăn Nhóm', balance: 0, accounts: [] },
      hub3_family: { title: 'Hub 3: Quỹ Gia Đình (6 người)', balance: 0, accounts: [] },
      hub4_personal: { title: 'Hub 4: Chi Tiêu Cá Nhân & Tiết Kiệm', balance: 0, accounts: [] }
    };

    accounts.forEach(acc => {
      const role = acc.hubRole && hubs[acc.hubRole] ? acc.hubRole : 'hub1_income';
      hubs[role].balance += (acc.balance || 0);
      hubs[role].accounts.push(acc);
    });

    // --- 2. HŨ TIỀN HÀNG NỢ TỪNG NHÀ CUNG CẤP (SUPPLIER DEBTS) ---
    const totalSupplierDebt = supplierDebts.reduce((sum, s) => sum + (s.remainingAmount || 0), 0);

    // --- 3. TIỀN THỰC SỰ KHẢ DỤNG ---
    const spendableCash = totalPhysicalCash - totalSupplierDebt;

    // --- 4. HẠN MỨC TIÊU TUẦN ---
    // Phần ăn cá nhân của tôi có deductWeeklyLimit !== false
    const myDiningShareWeekly = diningBills
      .filter(b => b.deductWeeklyLimit !== false)
      .reduce((sum, b) => sum + (b.myShare || 0), 0);

    // Giao dịch chi tiêu cá nhân được đánh dấu trừ vào hạn mức tuần
    const transactionsWeeklySpent = transactions
      .filter(t => t.type === 'expense' && t.impactsWeeklyLimit)
      .reduce((sum, t) => sum + (t.amount || 0), 0);

    const weeklyPaidDebts = debts
      .filter(d => d.type === 'payable' && d.status === 'paid')
      .reduce((sum, d) => sum + (d.amount || 0), 0);

    const currentWeekSpent = myDiningShareWeekly + transactionsWeeklySpent + weeklyPaidDebts;
    const weeklyPercent = config.weeklyLimit > 0 ? Math.round((currentWeekSpent / config.weeklyLimit) * 100) : 0;

    // --- 5. SỔ ĂN NHÓM & QUỸ GIA ĐÌNH ---
    const workBills = diningBills.filter(b => b.category !== 'family');
    const familyBills = diningBills.filter(b => b.category === 'family');

    const workSettlements = diningSettlements.filter(s => s.category !== 'family');
    const familySettlements = diningSettlements.filter(s => s.category === 'family');

    const workMembers = diningMembers.filter(m => m.group !== 'family');
    const familyMembers = diningMembers.filter(m => m.group === 'family');

    const workStats = calculateDiningGroup(workBills, workSettlements, workMembers);
    const familyStats = calculateDiningGroup(familyBills, familySettlements, familyMembers);
    const combinedStats = calculateDiningGroup(diningBills, diningSettlements, diningMembers);

    // --- 6. SỔ NỢ 2 CHIỀU TỔNG HỢP ---
    const totalReceivableDebt = debts
      .filter(d => d.type === 'receivable' && d.status === 'pending')
      .reduce((sum, d) => sum + (d.amount || 0), 0);
    const totalPayableDebt = debts
      .filter(d => d.type === 'payable' && d.status === 'pending')
      .reduce((sum, d) => sum + (d.amount || 0), 0);

    // --- 7. HUB 4: SỔ CHI TIÊU CÁ NHÂN & TIẾT KIỆM (QUY TRÌNH THÁC NƯỚC 3 BƯỚC) ---
    const hub4Budget = config.hub4MonthlyBudget || 6000000;
    const savingsRate = config.savingsRate || 15;
    const targetSavings = Math.round(hub4Budget * (savingsRate / 100));

    // 1. Tiết kiệm đã trích thực tế
    const savingsList = personalExpenses.filter(e => e.type === 'savings_deposit' || e.category === 'savings');
    const actualSavings = savingsList.reduce((sum, e) => sum + (e.amount || 0), 0);

    // 2. Hóa đơn cá nhân cố định (Gym, Streaming, Tiện ích sống)
    const fixedBillsList = personalExpenses.filter(e => e.type === 'fixed_bill');
    const totalFixedBills = fixedBillsList.reduce((sum, e) => sum + (e.amount || 0), 0);
    const paidFixedBills = fixedBillsList.filter(e => e.status === 'paid').reduce((sum, e) => sum + (e.amount || 0), 0);
    const pendingFixedBills = fixedBillsList.filter(e => e.status === 'pending').reduce((sum, e) => sum + (e.amount || 0), 0);

    // 3. Hạn mức tiêu xài khả dụng thực tế của 2 người (Ăn ngoài, Cà phê, Mua sắm)
    // = Tổng Ngân Sách - Tiết Kiệm - Hóa Đơn Cố Định
    const spendableFlexibleMonthly = Math.max(0, hub4Budget - targetSavings - totalFixedBills);
    const personalSpentMonthly = myDiningShareWeekly + transactionsWeeklySpent;

    const card4_personal_hub = {
      monthlyBudget: hub4Budget,
      savingsRate,
      targetSavings,
      actualSavings,
      savingsList,
      totalFixedBills,
      paidFixedBills,
      pendingFixedBills,
      fixedBillsList,
      spendableFlexibleMonthly,
      currentMonthFlexibleSpent: personalSpentMonthly,
      remainingFlexibleMonthly: Math.max(0, spendableFlexibleMonthly - personalSpentMonthly),
      weeklyLimit: config.weeklyLimit,
      weeklySpent: currentWeekSpent,
      weeklyRemaining: Math.max(0, config.weeklyLimit - currentWeekSpent),
      weeklyPercent,
      allExpenses: personalExpenses
    };

    res.json({
      success: true,
      config,
      accounts: {
        totalCash: totalPhysicalCash,
        list: accounts,
        hubs
      },
      supplierPot: {
        totalAmount: totalSupplierDebt,
        suppliers: supplierDebts
      },
      card1_cash: {
        totalCash: totalPhysicalCash,
        spendableCash,
        supplierPot: totalSupplierDebt
      },
      card2_weekly: {
        limit: config.weeklyLimit,
        spent: currentWeekSpent,
        percent: weeklyPercent,
        isWarning: weeklyPercent >= 80,
        isBrake: weeklyPercent >= 100,
        breakdown: {
          diningShare: myDiningShareWeekly,
          transactions: transactionsWeeklySpent,
          paidDebts: weeklyPaidDebts
        }
      },
      card4_dining: {
        ...workStats, // default fallback to workStats
        work: workStats,
        family: familyStats,
        combined: combinedStats,
        allMembers: diningMembers
      },
      card4_personal_hub,
      transactions: transactions.slice(0, 100),
      reminders,
      allDebts: debts,
      debtSummary: {
        totalReceivable: totalReceivableDebt,
        totalPayable: totalPayableDebt
      },
      allOrders: serviceOrders,
      currentUser: {
        id: req.user._id,
        username: req.user.username,
        fullName: req.user.fullName,
        role: req.user.role,
        isAdmin: req.user.isAdmin,
        permissions: req.user.permissions
      }
    });
  } catch (err) {
    console.error('Lỗi API dashboard:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ==================== 0. SỔ GIAO DỊCH THU / CHI / CHUYỂN KHOẢN (CRUD) ====================
app.get('/api/transactions', authenticateToken, async (req, res) => {
  try {
    const { type, accountName, hubRole, limit } = req.query;
    const query = {};
    if (type && type !== 'all') query.type = type;
    if (accountName && accountName !== 'all') query.accountName = accountName;
    if (hubRole && hubRole !== 'all') query.hubRole = hubRole;

    const list = await Transaction.find(query)
      .sort({ date: -1, createdAt: -1 })
      .limit(Number(limit) || 100);
    res.json({ success: true, transactions: list });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/transactions', authenticateToken, requirePermission('manageTransactions'), async (req, res) => {
  try {
    const {
      date,
      title,
      amount,
      type,
      accountName,
      toAccountName,
      category,
      hubRole,
      impactsWeeklyLimit,
      notes
    } = req.body;

    const numAmount = Math.abs(Number(amount)) || 0;
    if (!title || !title.trim()) {
      return res.status(400).json({ success: false, message: 'Vui lòng nhập tên giao dịch' });
    }
    if (numAmount <= 0) {
      return res.status(400).json({ success: false, message: 'Số tiền phải lớn hơn 0' });
    }

    const tx = await Transaction.create({
      date: date || new Date().toISOString().slice(0, 10),
      title: title.trim(),
      amount: numAmount,
      type: type || 'expense',
      accountName: accountName || 'Vietcombank',
      toAccountName: toAccountName || '',
      category: category || 'Chi tiêu',
      hubRole: hubRole || 'hub4_personal',
      impactsWeeklyLimit: Boolean(impactsWeeklyLimit),
      notes: notes || ''
    });

    // Cập nhật số dư ngân hàng thời gian thực
    if (tx.type === 'expense') {
      await adjustAccountBalance(tx.accountName, -tx.amount);
    } else if (tx.type === 'income') {
      await adjustAccountBalance(tx.accountName, tx.amount);
    } else if (tx.type === 'transfer') {
      await adjustAccountBalance(tx.accountName, -tx.amount);
      if (tx.toAccountName) {
        await adjustAccountBalance(tx.toAccountName, tx.amount);
      }
    }

    res.json({ success: true, transaction: tx });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

app.put('/api/transactions/:id', authenticateToken, requirePermission('manageTransactions'), async (req, res) => {
  try {
    const oldTx = await Transaction.findById(req.params.id);
    if (!oldTx) return res.status(404).json({ success: false, message: 'Không tìm thấy giao dịch' });

    // Hoàn tác số dư cũ
    if (oldTx.type === 'expense') {
      await adjustAccountBalance(oldTx.accountName, oldTx.amount);
    } else if (oldTx.type === 'income') {
      await adjustAccountBalance(oldTx.accountName, -oldTx.amount);
    } else if (oldTx.type === 'transfer') {
      await adjustAccountBalance(oldTx.accountName, oldTx.amount);
      if (oldTx.toAccountName) {
        await adjustAccountBalance(oldTx.toAccountName, -oldTx.amount);
      }
    }

    const {
      date,
      title,
      amount,
      type,
      accountName,
      toAccountName,
      category,
      hubRole,
      impactsWeeklyLimit,
      notes
    } = req.body;

    const numAmount = Math.abs(Number(amount)) || 0;
    oldTx.date = date || oldTx.date;
    oldTx.title = title ? title.trim() : oldTx.title;
    oldTx.amount = numAmount > 0 ? numAmount : oldTx.amount;
    oldTx.type = type || oldTx.type;
    oldTx.accountName = accountName || oldTx.accountName;
    oldTx.toAccountName = toAccountName !== undefined ? toAccountName : oldTx.toAccountName;
    oldTx.category = category || oldTx.category;
    oldTx.hubRole = hubRole || oldTx.hubRole;
    oldTx.impactsWeeklyLimit = impactsWeeklyLimit !== undefined ? Boolean(impactsWeeklyLimit) : oldTx.impactsWeeklyLimit;
    oldTx.notes = notes !== undefined ? notes : oldTx.notes;

    await oldTx.save();

    // Áp dụng số dư mới
    if (oldTx.type === 'expense') {
      await adjustAccountBalance(oldTx.accountName, -oldTx.amount);
    } else if (oldTx.type === 'income') {
      await adjustAccountBalance(oldTx.accountName, oldTx.amount);
    } else if (oldTx.type === 'transfer') {
      await adjustAccountBalance(oldTx.accountName, -oldTx.amount);
      if (oldTx.toAccountName) {
        await adjustAccountBalance(oldTx.toAccountName, oldTx.amount);
      }
    }

    res.json({ success: true, transaction: oldTx });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

app.delete('/api/transactions/:id', authenticateToken, requirePermission('manageTransactions'), async (req, res) => {
  try {
    const tx = await Transaction.findById(req.params.id);
    if (!tx) return res.status(404).json({ success: false, message: 'Không tìm thấy giao dịch' });

    // Hoàn tác số dư
    if (tx.type === 'expense') {
      await adjustAccountBalance(tx.accountName, tx.amount);
    } else if (tx.type === 'income') {
      await adjustAccountBalance(tx.accountName, -tx.amount);
    } else if (tx.type === 'transfer') {
      await adjustAccountBalance(tx.accountName, tx.amount);
      if (tx.toAccountName) {
        await adjustAccountBalance(tx.toAccountName, -tx.amount);
      }
    }

    await tx.deleteOne();
    res.json({ success: true, message: 'Đã xóa giao dịch và hoàn tất cập nhật số dư' });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

// ==================== 1. TÀI KHOẢN NGÂN HÀNG & TIỀN MẶT (CRUD) ====================
app.get('/api/accounts', authenticateToken, async (req, res) => {
  try {
    const accounts = await Account.find().sort({ type: 1, name: 1 });
    res.json({ success: true, accounts });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/accounts', authenticateToken, requirePermission('manageAccounts'), async (req, res) => {
  try {
    const { name, type, balance, accountNumber, hubRole, note } = req.body;
    if (!name || !name.trim()) {
      return res.status(400).json({ success: false, message: 'Vui lòng nhập tên tài khoản / ngân hàng' });
    }
    const acc = await Account.create({
      name: name.trim(),
      type: type || 'bank',
      balance: Number(balance) || 0,
      accountNumber: accountNumber || '',
      hubRole: hubRole || 'hub1_income',
      note: note || ''
    });
    res.json({ success: true, account: acc });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

app.put('/api/accounts/:id', authenticateToken, requirePermission('manageAccounts'), async (req, res) => {
  try {
    const { name, type, balance, accountNumber, hubRole, note } = req.body;
    const updateData = {};
    if (name) updateData.name = name.trim();
    if (type) updateData.type = type;
    if (balance !== undefined) updateData.balance = Number(balance);
    if (accountNumber !== undefined) updateData.accountNumber = accountNumber;
    if (hubRole) updateData.hubRole = hubRole;
    if (note !== undefined) updateData.note = note;

    const acc = await Account.findByIdAndUpdate(req.params.id, updateData, { new: true });
    if (!acc) return res.status(404).json({ success: false, message: 'Không tìm thấy tài khoản' });
    res.json({ success: true, account: acc });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

app.delete('/api/accounts/:id', authenticateToken, requirePermission('manageAccounts'), async (req, res) => {
  try {
    const acc = await Account.findByIdAndDelete(req.params.id);
    if (!acc) return res.status(404).json({ success: false, message: 'Không tìm thấy tài khoản' });
    res.json({ success: true, message: 'Đã xóa tài khoản' });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

// ==================== 2. HŨ TIỀN HÀNG NỢ TỪNG NCC (CRUD) ====================
app.get('/api/supplier-debts', authenticateToken, async (req, res) => {
  try {
    const list = await SupplierDebt.find().sort({ remainingAmount: -1, createdAt: -1 });
    res.json({ success: true, suppliers: list });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/supplier-debts', authenticateToken, requirePermission('manageDebts'), async (req, res) => {
  try {
    const { supplierName, remainingAmount, phone, bankInfo, notes } = req.body;
    if (!supplierName || !supplierName.trim()) {
      return res.status(400).json({ success: false, message: 'Vui lòng nhập tên nhà cung cấp' });
    }
    const sName = supplierName.trim();
    const sKey = normalizeKey(sName);
    const addAmt = Number(remainingAmount) || 0;

    let sup = await SupplierDebt.findOne({
      $or: [
        { supplierKey: sKey },
        { supplierName: { $regex: new RegExp(`^${escapeRegex(sName)}$`, 'i') } }
      ]
    });

    if (sup) {
      sup.remainingAmount = (sup.remainingAmount || 0) + addAmt;
      if (phone) sup.phone = phone;
      if (bankInfo) sup.bankInfo = bankInfo;
      if (notes) sup.notes = notes;
      sup.supplierKey = sKey;
      await sup.save();
    } else {
      sup = await SupplierDebt.create({
        supplierName: sName,
        supplierKey: sKey,
        remainingAmount: addAmt,
        phone: phone || '',
        bankInfo: bankInfo || '',
        notes: notes || ''
      });
    }
    res.json({ success: true, supplier: sup });
  } catch (err) {
    // Tự động xử lý nếu gặp lỗi E11000 do index id_1 rác cũ trên MongoDB Atlas
    if (err.code === 11000 && err.message.includes('id_1')) {
      try {
        console.log('Phát hiện lỗi E11000 do index id_1 trên supplierdebts, tiến hành dropIndex...');
        await mongoose.connection.db.collection('supplierdebts').dropIndex('id_1');
        return res.status(400).json({ success: false, error: 'Đã dọn dẹp index, vui lòng thử lại' });
      } catch (retryErr) {
        return res.status(400).json({ success: false, error: retryErr.message });
      }
    }
    res.status(400).json({ success: false, error: err.message });
  }
});

app.put('/api/supplier-debts/:id', authenticateToken, requirePermission('manageDebts'), async (req, res) => {
  try {
    const { supplierName, remainingAmount, phone, bankInfo, notes } = req.body;
    const updateData = {};
    if (supplierName) {
      updateData.supplierName = supplierName.trim();
      updateData.supplierKey = normalizeKey(supplierName);
    }
    if (remainingAmount !== undefined) updateData.remainingAmount = Math.max(0, Number(remainingAmount));
    if (phone !== undefined) updateData.phone = phone;
    if (bankInfo !== undefined) updateData.bankInfo = bankInfo;
    if (notes !== undefined) updateData.notes = notes;

    const sup = await SupplierDebt.findByIdAndUpdate(req.params.id, updateData, { new: true });
    if (!sup) return res.status(404).json({ success: false, message: 'Không tìm thấy NCC' });
    res.json({ success: true, supplier: sup });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

app.post('/api/supplier-debts/:id/pay', authenticateToken, requirePermission('manageDebts'), async (req, res) => {
  try {
    const { amount } = req.body;
    const payAmt = Number(amount);
    const sup = await SupplierDebt.findById(req.params.id);
    if (!sup) return res.status(404).json({ success: false, message: 'Không tìm thấy NCC' });

    if (!payAmt || payAmt >= sup.remainingAmount) {
      sup.remainingAmount = 0;
    } else {
      sup.remainingAmount = Math.max(0, sup.remainingAmount - payAmt);
    }
    await sup.save();

    await ServiceOrder.updateMany(
      { supplierKey: sup.supplierKey, supplierPaid: false },
      { $set: { supplierPaid: true } }
    );

    res.json({ success: true, supplier: sup, message: 'Đã thanh toán cho NCC' });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

app.post('/api/supplier-debts/batch-pay-all', authenticateToken, requirePermission('manageDebts'), async (req, res) => {
  try {
    await SupplierDebt.updateMany({}, { $set: { remainingAmount: 0 } });
    await ServiceOrder.updateMany({}, { $set: { supplierPaid: true } });
    res.json({ success: true, message: 'Đã thanh toán toàn bộ công nợ cho các nhà cung cấp (Reset hũ về 0đ)' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.delete('/api/supplier-debts/:id', authenticateToken, requirePermission('manageDebts'), async (req, res) => {
  try {
    const sup = await SupplierDebt.findByIdAndDelete(req.params.id);
    if (!sup) return res.status(404).json({ success: false, message: 'Không tìm thấy NCC' });
    res.json({ success: true, message: 'Đã xóa NCC' });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

// ==================== 3. LỊCH NHẮC DÒNG TIỀN (CRUD) ====================
app.get('/api/reminders', authenticateToken, async (req, res) => {
  try {
    const reminders = await CashflowReminder.find().sort({ date: 1, createdAt: 1 });
    res.json({ success: true, reminders });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/reminders', authenticateToken, requirePermission('manageTransactions'), async (req, res) => {
  try {
    const { date, title, amount, type, hubRole, notes } = req.body;
    if (!title || !title.trim()) {
      return res.status(400).json({ success: false, message: 'Vui lòng nhập tiêu đề nhắc nhở' });
    }
    const rem = await CashflowReminder.create({
      date: date || new Date().toISOString().slice(0, 10),
      title: title.trim(),
      amount: Number(amount) || 0,
      type: type || 'expense',
      hubRole: hubRole || 'hub1_income',
      notes: notes || ''
    });
    res.json({ success: true, reminder: rem });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

app.put('/api/reminders/:id', authenticateToken, requirePermission('manageTransactions'), async (req, res) => {
  try {
    const { date, title, amount, type, hubRole, status, notes } = req.body;
    const updateData = {};
    if (date) updateData.date = date;
    if (title) updateData.title = title.trim();
    if (amount !== undefined) updateData.amount = Number(amount);
    if (type) updateData.type = type;
    if (hubRole) updateData.hubRole = hubRole;
    if (status) updateData.status = status;
    if (notes !== undefined) updateData.notes = notes;

    const rem = await CashflowReminder.findByIdAndUpdate(req.params.id, updateData, { new: true });
    if (!rem) return res.status(404).json({ success: false, message: 'Không tìm thấy dòng nhắc' });
    res.json({ success: true, reminder: rem });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

app.patch('/api/reminders/:id/toggle-status', authenticateToken, requirePermission('manageTransactions'), async (req, res) => {
  try {
    const rem = await CashflowReminder.findById(req.params.id);
    if (!rem) return res.status(404).json({ success: false, message: 'Không tìm thấy dòng nhắc' });
    rem.status = rem.status === 'completed' ? 'pending' : 'completed';
    await rem.save();
    res.json({ success: true, reminder: rem });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

app.delete('/api/reminders/:id', authenticateToken, requirePermission('manageTransactions'), async (req, res) => {
  try {
    const rem = await CashflowReminder.findByIdAndDelete(req.params.id);
    if (!rem) return res.status(404).json({ success: false, message: 'Không tìm thấy dòng nhắc' });
    res.json({ success: true, message: 'Đã xóa dòng nhắc dòng tiền' });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

// ==================== DỰ BÁO DÒNG TIỀN TƯƠNG LAI (CASH FLOW PROJECTION) ====================
// Collection 'upcoming_transactions' tách biệt 100%, không can thiệp hay merge với sổ giao dịch thực tế
app.get('/api/upcoming', authenticateToken, async (req, res) => {
  try {
    const upcoming = await UpcomingTransaction.find().sort({ date: 1, createdAt: 1 });
    res.json({ success: true, upcoming });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/upcoming', authenticateToken, requirePermission('manageTransactions'), async (req, res) => {
  try {
    const { title, amount, type, date, hubRole, notes } = req.body;
    if (!title || !title.trim()) {
      return res.status(400).json({ success: false, message: 'Vui lòng nhập tên khoản mục dự kiến' });
    }
    const numAmount = Number(amount);
    if (isNaN(numAmount) || numAmount <= 0) {
      return res.status(400).json({ success: false, message: 'Số tiền dự kiến phải là số lớn hơn 0' });
    }
    if (!date) {
      return res.status(400).json({ success: false, message: 'Vui lòng chọn ngày dự kiến thực hiện' });
    }
    const validHubs = ['hub1_income', 'hub2_dining', 'hub3_family', 'hub4_personal'];
    const chosenHub = validHubs.includes(hubRole) ? hubRole : 'hub1_income';
    const chosenType = (type === 'income') ? 'income' : 'expense';

    const item = await UpcomingTransaction.create({
      title: title.trim(),
      amount: numAmount,
      type: chosenType,
      date: String(date).trim(),
      hubRole: chosenHub,
      notes: notes ? String(notes).trim() : '',
      createdBy: req.user?.username || 'admin'
    });

    res.json({ success: true, item });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

app.delete('/api/upcoming/:id', authenticateToken, requirePermission('manageTransactions'), async (req, res) => {
  try {
    const item = await UpcomingTransaction.findByIdAndDelete(req.params.id);
    if (!item) {
      return res.status(404).json({ success: false, message: 'Không tìm thấy khoản dự kiến' });
    }
    res.json({ success: true, message: 'Đã hoàn tất / Xóa khoản dự kiến thành công' });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

// ==================== 4. SỔ NỢ 2 CHIỀU (CRUD) ====================
app.get('/api/debts', authenticateToken, async (req, res) => {
  try {
    const debts = await Debt.find().sort({ dueDate: 1 });
    res.json({ success: true, debts });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/debts', authenticateToken, requirePermission('manageDebts'), async (req, res) => {
  try {
    const { personName, amount, type, dueDate, note } = req.body;
    if (!personName || !personName.trim()) {
      return res.status(400).json({ success: false, message: 'Vui lòng nhập tên đối tượng nợ' });
    }
    const debt = await Debt.create({
      personName: personName.trim(),
      amount: Number(amount) || 0,
      type: type || 'receivable',
      dueDate: dueDate || new Date().toISOString().slice(0, 10),
      note: note || ''
    });
    res.json({ success: true, debt });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

app.put('/api/debts/:id', authenticateToken, requirePermission('manageDebts'), async (req, res) => {
  try {
    const { personName, amount, type, dueDate, note, status } = req.body;
    const updateData = {};
    if (personName) updateData.personName = personName.trim();
    if (amount !== undefined) updateData.amount = Number(amount);
    if (type) updateData.type = type;
    if (dueDate) updateData.dueDate = dueDate;
    if (note !== undefined) updateData.note = note;
    if (status) updateData.status = status;

    const debt = await Debt.findByIdAndUpdate(req.params.id, updateData, { new: true });
    if (!debt) return res.status(404).json({ success: false, message: 'Không tìm thấy khoản nợ' });
    res.json({ success: true, debt });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

app.patch('/api/debts/:id/toggle-status', authenticateToken, requirePermission('manageDebts'), async (req, res) => {
  try {
    const debt = await Debt.findById(req.params.id);
    if (!debt) return res.status(404).json({ success: false, message: 'Không tìm thấy khoản nợ' });
    debt.status = debt.status === 'paid' ? 'pending' : 'paid';
    await debt.save();
    res.json({ success: true, debt });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

app.delete('/api/debts/:id', authenticateToken, requirePermission('manageDebts'), async (req, res) => {
  try {
    const debt = await Debt.findByIdAndDelete(req.params.id);
    if (!debt) return res.status(404).json({ success: false, message: 'Không tìm thấy khoản nợ' });
    res.json({ success: true, message: 'Đã xóa khoản nợ' });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

// ==================== 5. ĐƠN DỊCH VỤ / BÁN HÀNG CRUD (CÔNG NỢ KHÁCH & VỐN NCC) ====================
app.post('/api/service-orders', authenticateToken, requireAnyPermission('manageDebts', 'manageTransactions'), async (req, res) => {
  try {
    const { customerName, serviceName, costPrice, salePrice, supplierName, customerPaid, supplierPaid, date, note, receivedAccount } = req.body;
    if (!customerName || !customerName.trim()) {
      return res.status(400).json({ success: false, message: 'Vui lòng nhập tên khách hàng' });
    }

    const sName = (supplierName || '').trim();
    const sKey = sName ? normalizeKey(sName) : '';
    const cPrice = Math.max(0, Number(costPrice) || 0);
    const sPrice = Math.max(0, Number(salePrice) || 0);
    const cPaid = Boolean(customerPaid);
    const sPaid = Boolean(supplierPaid);

    const order = await ServiceOrder.create({
      customerName: customerName.trim(),
      serviceName: (serviceName || 'Bán dấu / Khắc dấu').trim(),
      costPrice: cPrice,
      salePrice: sPrice,
      supplierName: sName,
      supplierKey: sKey,
      customerPaid: cPaid,
      supplierPaid: sPaid,
      receivedAccount: receivedAccount || 'Vietcombank',
      date: date || new Date().toISOString().slice(0, 10),
      note: (note || '').trim()
    });

    // Nếu chưa thanh toán cho NCC và có giá vốn > 0 -> tự động cộng vào Hũ tiền nợ NCC (gộp đúng NCC)
    if (!sPaid && cPrice > 0 && sKey) {
      let sup = await SupplierDebt.findOne({
        $or: [
          { supplierKey: sKey },
          { supplierName: { $regex: new RegExp(`^${escapeRegex(sName)}$`, 'i') } }
        ]
      });
      if (sup) {
        sup.remainingAmount = (sup.remainingAmount || 0) + cPrice;
        sup.supplierKey = sKey;
        await sup.save();
      } else {
        await SupplierDebt.create({
          supplierName: sName,
          supplierKey: sKey,
          remainingAmount: cPrice
        });
      }
    }

    res.json({ success: true, order, message: 'Đã lưu đơn hàng thành công' });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

app.put('/api/service-orders/:id', authenticateToken, requireAnyPermission('manageDebts', 'manageTransactions'), async (req, res) => {
  try {
    const { customerName, serviceName, costPrice, salePrice, supplierName, customerPaid, supplierPaid, date, note, receivedAccount } = req.body;
    const oldOrder = await ServiceOrder.findById(req.params.id);
    if (!oldOrder) return res.status(404).json({ success: false, message: 'Không tìm thấy đơn hàng' });

    const newSName = (supplierName || '').trim();
    const newSKey = newSName ? normalizeKey(newSName) : '';
    const newCPrice = Math.max(0, Number(costPrice) || 0);
    const newSPrice = Math.max(0, Number(salePrice) || 0);
    const newCPaid = Boolean(customerPaid);
    const newSPaid = Boolean(supplierPaid);

    // Hoàn tác trừ công nợ NCC cũ nếu đơn cũ từng chưa trả NCC
    if (!oldOrder.supplierPaid && oldOrder.costPrice > 0 && oldOrder.supplierKey) {
      await SupplierDebt.findOneAndUpdate(
        { supplierKey: oldOrder.supplierKey },
        { $inc: { remainingAmount: -oldOrder.costPrice } }
      );
    }

    // Cập nhật đơn hàng
    oldOrder.customerName = (customerName || '').trim();
    oldOrder.serviceName = (serviceName || 'Bán dấu / Khắc dấu').trim();
    oldOrder.costPrice = newCPrice;
    oldOrder.salePrice = newSPrice;
    oldOrder.supplierName = newSName;
    oldOrder.supplierKey = newSKey;
    oldOrder.customerPaid = newCPaid;
    oldOrder.supplierPaid = newSPaid;
    if (date) oldOrder.date = date;
    if (receivedAccount !== undefined) oldOrder.receivedAccount = receivedAccount;
    if (note !== undefined) oldOrder.note = (note || '').trim();
    await oldOrder.save();

    // Cộng công nợ NCC mới nếu đơn mới chưa trả NCC (gộp đúng NCC)
    if (!newSPaid && newCPrice > 0 && newSKey) {
      let sup = await SupplierDebt.findOne({
        $or: [
          { supplierKey: newSKey },
          { supplierName: { $regex: new RegExp(`^${escapeRegex(newSName)}$`, 'i') } }
        ]
      });
      if (sup) {
        sup.remainingAmount = (sup.remainingAmount || 0) + newCPrice;
        sup.supplierKey = newSKey;
        await sup.save();
      } else {
        await SupplierDebt.create({
          supplierName: newSName,
          supplierKey: newSKey,
          remainingAmount: newCPrice
        });
      }
    }

    // Đảm bảo không bị âm nợ NCC
    await SupplierDebt.updateMany({ remainingAmount: { $lt: 0 } }, { $set: { remainingAmount: 0 } });

    res.json({ success: true, order: oldOrder, message: 'Đã cập nhật đơn hàng thành công' });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

// Chuyển đổi nhanh trạng thái: Khách đã trả / Chưa trả
app.patch('/api/service-orders/:id/toggle-customer-paid', authenticateToken, requireAnyPermission('manageDebts', 'manageTransactions'), async (req, res) => {
  try {
    const order = await ServiceOrder.findById(req.params.id);
    if (!order) return res.status(404).json({ success: false, message: 'Không tìm thấy đơn hàng' });
    order.customerPaid = !order.customerPaid;
    await order.save();
    res.json({ 
      success: true, 
      order, 
      message: order.customerPaid ? `✓ Đã đánh dấu ${order.customerName} đã thanh toán!` : `Đã chuyển đơn của ${order.customerName} sang Chưa thanh toán` 
    });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

// Chuyển đổi nhanh trạng thái: Đã trả vốn NCC / Nợ NCC
app.patch('/api/service-orders/:id/toggle-supplier-paid', authenticateToken, requireAnyPermission('manageDebts', 'manageTransactions'), async (req, res) => {
  try {
    const order = await ServiceOrder.findById(req.params.id);
    if (!order) return res.status(404).json({ success: false, message: 'Không tìm thấy đơn hàng' });
    
    const nextSupplierPaid = !order.supplierPaid;
    const sKey = order.supplierKey || (order.supplierName ? normalizeKey(order.supplierName) : '');

    if (order.costPrice > 0 && sKey) {
      if (nextSupplierPaid) {
        // Đã trả vốn -> trừ nợ NCC
        await SupplierDebt.findOneAndUpdate(
          { supplierKey: sKey },
          { $inc: { remainingAmount: -order.costPrice } }
        );
      } else {
        // Quay lại nợ vốn -> tăng lại nợ NCC
        await SupplierDebt.findOneAndUpdate(
          { supplierKey: sKey },
          { 
            $inc: { remainingAmount: order.costPrice },
            $setOnInsert: { supplierName: order.supplierName }
          },
          { upsert: true }
        );
      }
      await SupplierDebt.updateMany({ remainingAmount: { $lt: 0 } }, { $set: { remainingAmount: 0 } });
    }

    order.supplierPaid = nextSupplierPaid;
    await order.save();

    res.json({ 
      success: true, 
      order, 
      message: nextSupplierPaid ? `✓ Đã đánh dấu đã trả vốn cho ${order.supplierName || 'NCC'}!` : `Đã chuyển sang còn nợ vốn NCC` 
    });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

app.delete('/api/service-orders/:id', authenticateToken, requireAnyPermission('manageDebts', 'manageTransactions'), async (req, res) => {
  try {
    const order = await ServiceOrder.findById(req.params.id);
    if (!order) return res.status(404).json({ success: false, message: 'Không tìm thấy' });

    // Nếu đơn này chưa trả NCC, hoàn tác trừ nợ NCC
    if (!order.supplierPaid && order.costPrice > 0 && order.supplierKey) {
      await SupplierDebt.findOneAndUpdate(
        { supplierKey: order.supplierKey },
        { $inc: { remainingAmount: -order.costPrice } }
      );
      await SupplierDebt.updateMany({ remainingAmount: { $lt: 0 } }, { $set: { remainingAmount: 0 } });
    }

    await ServiceOrder.findByIdAndDelete(req.params.id);
    res.json({ success: true, message: 'Đã xóa đơn hàng thành công' });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

// ==================== 6. BỮA ĂN NHÓM & QUỸ GIA ĐÌNH CRUD ====================
app.post('/api/dining/bill', authenticateToken, async (req, res) => {
  try {
    const {
      date,
      mealTitle,
      category,
      totalBill,
      myShare,
      splitMode,
      splits,
      paidAccount,
      deductFromAccount,
      deductWeeklyLimit,
      notes
    } = req.body;

    const targetCat = category === 'family' ? 'family' : 'work';
    const requiredPerm = targetCat === 'family' ? 'manageDiningFamily' : 'manageDiningWork';
    if (!req.user.isAdmin && !(req.user.permissions && req.user.permissions[requiredPerm])) {
      return res.status(403).json({ success: false, message: `Bạn không có quyền quản lý ${targetCat === 'family' ? 'Quỹ Gia Đình' : 'Quỹ Ăn Nhóm'}` });
    }

    const numTotal = Number(totalBill) || 0;
    const shouldDeduct = deductFromAccount !== false;

    const bill = await DiningLedger.create({
      date: date || new Date().toISOString().slice(0, 10),
      mealTitle: mealTitle || 'Bữa ăn nhóm',
      category: targetCat,
      totalBill: numTotal,
      myShare: Number(myShare) || 0,
      splitMode: splitMode || 'equal',
      splits: splits || [],
      paidAccount: paidAccount || 'Vietcombank',
      deductFromAccount: shouldDeduct,
      deductWeeklyLimit: deductWeeklyLimit !== false,
      notes: notes || ''
    });

    // Trừ số tiền vào ngân hàng thời gian thực nếu được bật
    if (shouldDeduct && bill.paidAccount && numTotal > 0) {
      await adjustAccountBalance(bill.paidAccount, -numTotal);
    }

    res.json({ success: true, bill });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

app.put('/api/dining/bill/:id', authenticateToken, async (req, res) => {
  try {
    const oldBill = await DiningLedger.findById(req.params.id);
    if (!oldBill) return res.status(404).json({ success: false, message: 'Không tìm thấy hóa đơn' });

    const targetCat = (req.body.category || oldBill.category) === 'family' ? 'family' : 'work';
    const requiredPerm = targetCat === 'family' ? 'manageDiningFamily' : 'manageDiningWork';
    if (!req.user.isAdmin && !(req.user.permissions && req.user.permissions[requiredPerm])) {
      return res.status(403).json({ success: false, message: `Bạn không có quyền quản lý ${targetCat === 'family' ? 'Quỹ Gia Đình' : 'Quỹ Ăn Nhóm'}` });
    }

    // Hoàn tác số tiền cũ
    if (oldBill.deductFromAccount && oldBill.paidAccount && oldBill.totalBill > 0) {
      await adjustAccountBalance(oldBill.paidAccount, oldBill.totalBill);
    }

    const {
      date,
      mealTitle,
      category,
      totalBill,
      myShare,
      splitMode,
      splits,
      paidAccount,
      deductFromAccount,
      deductWeeklyLimit,
      notes
    } = req.body;

    const numTotal = Number(totalBill) || 0;
    const shouldDeduct = deductFromAccount !== false;

    oldBill.date = date || oldBill.date;
    oldBill.mealTitle = mealTitle || oldBill.mealTitle;
    oldBill.category = category === 'family' ? 'family' : 'work';
    oldBill.totalBill = numTotal;
    oldBill.myShare = Number(myShare) || 0;
    oldBill.splitMode = splitMode || oldBill.splitMode;
    oldBill.splits = splits || oldBill.splits;
    oldBill.paidAccount = paidAccount || oldBill.paidAccount;
    oldBill.deductFromAccount = shouldDeduct;
    oldBill.deductWeeklyLimit = deductWeeklyLimit !== false;
    oldBill.notes = notes !== undefined ? notes : oldBill.notes;

    await oldBill.save();

    // Áp dụng số tiền mới
    if (shouldDeduct && oldBill.paidAccount && numTotal > 0) {
      await adjustAccountBalance(oldBill.paidAccount, -numTotal);
    }

    res.json({ success: true, bill: oldBill });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

app.delete('/api/dining/bill/:id', authenticateToken, async (req, res) => {
  try {
    const bill = await DiningLedger.findById(req.params.id);
    if (!bill) return res.status(404).json({ success: false, message: 'Không tìm thấy bữa ăn' });

    const requiredPerm = bill.category === 'family' ? 'manageDiningFamily' : 'manageDiningWork';
    if (!req.user.isAdmin && !(req.user.permissions && req.user.permissions[requiredPerm])) {
      return res.status(403).json({ success: false, message: `Bạn không có quyền quản lý ${bill.category === 'family' ? 'Quỹ Gia Đình' : 'Quỹ Ăn Nhóm'}` });
    }

    // Hoàn lại tiền ngân hàng nếu đã trừ
    if (bill.deductFromAccount && bill.paidAccount && bill.totalBill > 0) {
      await adjustAccountBalance(bill.paidAccount, bill.totalBill);
    }

    await bill.deleteOne();
    res.json({ success: true, message: 'Đã xóa bữa ăn và hoàn lại tiền ngân hàng' });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

// ==================== 7. NẠP / TRẢ TIỀN ĂN (SETTLEMENTS CRUD) ====================
app.post('/api/dining/settlement', authenticateToken, async (req, res) => {
  try {
    const { personName, amount, direction, category, note, date, topupKind, accountName, addToAccount } = req.body;
    const targetCat = category === 'family' ? 'family' : 'work';
    const requiredPerm = targetCat === 'family' ? 'manageDiningFamily' : 'manageDiningWork';
    if (!req.user.isAdmin && !(req.user.permissions && req.user.permissions[requiredPerm])) {
      return res.status(403).json({ success: false, message: `Bạn không có quyền quản lý ${targetCat === 'family' ? 'Quỹ Gia Đình' : 'Quỹ Ăn Nhóm'}` });
    }

    const pKey = normalizeKey(personName);
    const numAmount = Number(amount) || 0;
    const shouldAdd = addToAccount !== false;

    const settlement = await DiningSettlement.create({
      personKey: pKey,
      personName,
      category: targetCat,
      amount: numAmount,
      direction: direction === 'out' ? 'out' : 'in',
      topupKind: topupKind || (direction === 'out' ? 'borrow' : 'prepaid'),
      accountName: accountName || 'Vietcombank',
      addToAccount: shouldAdd,
      note: note || '',
      date: date || new Date().toISOString().slice(0, 10)
    });

    // Cộng hoặc trừ tiền vào ngân hàng thời gian thực
    if (shouldAdd && settlement.accountName && numAmount > 0) {
      const delta = settlement.direction === 'in' ? numAmount : -numAmount;
      await adjustAccountBalance(settlement.accountName, delta);
    }

    res.json({ success: true, settlement });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

app.put('/api/dining/settlement/:id', authenticateToken, async (req, res) => {
  try {
    const oldS = await DiningSettlement.findById(req.params.id);
    if (!oldS) return res.status(404).json({ success: false, message: 'Không tìm thấy giao dịch' });

    const targetCat = (req.body.category || oldS.category) === 'family' ? 'family' : 'work';
    const requiredPerm = targetCat === 'family' ? 'manageDiningFamily' : 'manageDiningWork';
    if (!req.user.isAdmin && !(req.user.permissions && req.user.permissions[requiredPerm])) {
      return res.status(403).json({ success: false, message: `Bạn không có quyền quản lý ${targetCat === 'family' ? 'Quỹ Gia Đình' : 'Quỹ Ăn Nhóm'}` });
    }

    // Hoàn tác tiền cũ
    if (oldS.addToAccount && oldS.accountName && oldS.amount > 0) {
      const revertDelta = oldS.direction === 'in' ? -oldS.amount : oldS.amount;
      await adjustAccountBalance(oldS.accountName, revertDelta);
    }

    const { personName, amount, direction, category, note, date, topupKind, accountName, addToAccount } = req.body;
    const pKey = normalizeKey(personName);
    const numAmount = Number(amount) || 0;
    const shouldAdd = addToAccount !== false;

    oldS.personKey = pKey || oldS.personKey;
    oldS.personName = personName || oldS.personName;
    oldS.category = category === 'family' ? 'family' : 'work';
    oldS.amount = numAmount;
    oldS.direction = direction === 'out' ? 'out' : 'in';
    oldS.topupKind = topupKind || oldS.topupKind;
    oldS.accountName = accountName || oldS.accountName;
    oldS.addToAccount = shouldAdd;
    oldS.note = note !== undefined ? note : oldS.note;
    oldS.date = date || oldS.date;

    await oldS.save();

    // Áp dụng tiền mới
    if (shouldAdd && oldS.accountName && numAmount > 0) {
      const delta = oldS.direction === 'in' ? numAmount : -numAmount;
      await adjustAccountBalance(oldS.accountName, delta);
    }

    res.json({ success: true, settlement: oldS });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

app.delete('/api/dining/settlement/:id', authenticateToken, async (req, res) => {
  try {
    const s = await DiningSettlement.findById(req.params.id);
    if (!s) return res.status(404).json({ success: false, message: 'Không tìm thấy giao dịch' });

    const requiredPerm = s.category === 'family' ? 'manageDiningFamily' : 'manageDiningWork';
    if (!req.user.isAdmin && !(req.user.permissions && req.user.permissions[requiredPerm])) {
      return res.status(403).json({ success: false, message: `Bạn không có quyền quản lý ${s.category === 'family' ? 'Quỹ Gia Đình' : 'Quỹ Ăn Nhóm'}` });
    }

    // Hoàn tác tiền ngân hàng
    if (s.addToAccount && s.accountName && s.amount > 0) {
      const revertDelta = s.direction === 'in' ? -s.amount : s.amount;
      await adjustAccountBalance(s.accountName, revertDelta);
    }

    if (s.transferRef) {
      // Tự động xóa cả 2 vế cấn trừ để cân đối sổ
      await DiningSettlement.deleteMany({ transferRef: s.transferRef });
      return res.json({ success: true, message: 'Đã hoàn tác và xóa cả 2 vế giao dịch cấn trừ liên quỹ' });
    }

    await s.deleteOne();
    res.json({ success: true, message: 'Đã xóa giao dịch nạp / mượn và cập nhật lại số dư' });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

// ==================== CẤN TRỪ SỐ DƯ LIÊN QUỸ (KHÔNG CẦN CHUYỂN KHOẢN) ====================
app.post('/api/dining/transfer-balance', authenticateToken, async (req, res) => {
  try {
    if (!req.user.isAdmin && !(req.user.permissions && (req.user.permissions.manageDiningWork || req.user.permissions.manageDiningFamily))) {
      return res.status(403).json({ success: false, message: 'Bạn không có quyền thực hiện cấn trừ số dư liên quỹ' });
    }
    const { personName, fromCategory, toCategory, amount, date, note } = req.body;
    if (!personName || !personName.trim()) {
      return res.status(400).json({ success: false, message: 'Vui lòng chọn thành viên cần cấn trừ số dư' });
    }
    const numAmount = Number(amount);
    if (!numAmount || numAmount <= 0) {
      return res.status(400).json({ success: false, message: 'Số tiền chuyển phải lớn hơn 0đ' });
    }
    if (!['work', 'family'].includes(fromCategory) || !['work', 'family'].includes(toCategory)) {
      return res.status(400).json({ success: false, message: 'Danh mục quỹ không hợp lệ' });
    }
    if (fromCategory === toCategory) {
      return res.status(400).json({ success: false, message: 'Quỹ nguồn và quỹ đích phải khác nhau' });
    }

    const pKey = normalizeKey(personName);
    const sourceName = fromCategory === 'family' ? 'Quỹ Gia Đình' : 'Quỹ Ăn Nhóm';
    const targetName = toCategory === 'family' ? 'Quỹ Gia Đình' : 'Quỹ Ăn Nhóm';
    const transferDate = date || new Date().toISOString().slice(0, 10);
    const transferRef = `transfer_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;

    // 1. Tạo vế xuất từ quỹ nguồn (direction: 'out')
    const debit = await DiningSettlement.create({
      monthKey: transferDate.slice(0, 7),
      personKey: pKey,
      personName: personName.trim(),
      category: fromCategory,
      amount: numAmount,
      direction: 'out',
      topupKind: 'transfer_out',
      accountName: 'Nội bộ (Cấn trừ 2 sổ)',
      addToAccount: false,
      transferRef,
      note: note && note.trim()
        ? `${note.trim()} (Chuyển sang ${targetName})`
        : `Cấn trừ chuyển ${numAmount.toLocaleString('vi-VN')}đ sang ${targetName}`,
      date: transferDate
    });

    // 2. Tạo vế nhập vào quỹ đích (direction: 'in')
    const credit = await DiningSettlement.create({
      monthKey: transferDate.slice(0, 7),
      personKey: pKey,
      personName: personName.trim(),
      category: toCategory,
      amount: numAmount,
      direction: 'in',
      topupKind: 'transfer_in',
      accountName: 'Nội bộ (Cấn trừ 2 sổ)',
      addToAccount: false,
      transferRef,
      note: note && note.trim()
        ? `${note.trim()} (Nhận từ ${sourceName})`
        : `Nhận cấn trừ ${numAmount.toLocaleString('vi-VN')}đ từ ${sourceName}`,
      date: transferDate
    });

    res.json({
      success: true,
      message: `Đã cấn trừ chuyển thành công ${numAmount.toLocaleString('vi-VN')}đ từ ${sourceName} sang ${targetName} cho ${personName.trim()}`,
      debit,
      credit
    });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

// ==================== 8. THÀNH VIÊN SỔ ĂN & GIA ĐÌNH ====================
app.post('/api/dining/member', authenticateToken, async (req, res) => {
  try {
    const { name, openingBalance, group, phone, note } = req.body;
    if (!name || !name.trim()) return res.status(400).json({ success: false, message: 'Thiếu tên người' });
    const targetGroup = group === 'family' ? 'family' : 'work';
    const reqPerm = targetGroup === 'family' ? 'manageDiningFamily' : 'manageDiningWork';
    if (!req.user.isAdmin && !(req.user.permissions && req.user.permissions[reqPerm])) {
      return res.status(403).json({ success: false, message: `Bạn không có quyền quản lý ${targetGroup === 'family' ? 'Quỹ Gia Đình' : 'Quỹ Ăn Nhóm'}` });
    }
    const pKey = normalizeKey(name);
    const existing = await DiningMember.findOne({ group: targetGroup, personKey: pKey });
    if (existing) {
      return res.status(400).json({ success: false, message: `Người này đã có trong danh sách ${targetGroup === 'family' ? 'Quỹ Gia Đình' : 'Quỹ Ăn Nhóm'}` });
    }
    const member = await DiningMember.create({
      personKey: pKey,
      name: name.trim(),
      group: targetGroup,
      openingBalance: Number(openingBalance) || 0,
      phone: phone || '',
      note: note || ''
    });
    res.json({ success: true, member });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

app.put('/api/dining/member/:id', authenticateToken, async (req, res) => {
  try {
    const { name, openingBalance, group, phone, note } = req.body;
    const member = await DiningMember.findById(req.params.id);
    if (!member) return res.status(404).json({ success: false, message: 'Không tìm thấy người này' });

    const targetGroup = group !== undefined ? (group === 'family' ? 'family' : 'work') : member.group;
    const reqPerm = targetGroup === 'family' ? 'manageDiningFamily' : 'manageDiningWork';
    if (!req.user.isAdmin && !(req.user.permissions && req.user.permissions[reqPerm])) {
      return res.status(403).json({ success: false, message: `Bạn không có quyền quản lý ${targetGroup === 'family' ? 'Quỹ Gia Đình' : 'Quỹ Ăn Nhóm'}` });
    }

    const targetName = name && name.trim() ? name.trim() : member.name;
    const targetKey = normalizeKey(targetName);

    // Kiểm tra trùng tên chỉ trong cùng nhóm mục tiêu
    const conflict = await DiningMember.findOne({
      _id: { $ne: member._id },
      group: targetGroup,
      personKey: targetKey
    });
    if (conflict) {
      return res.status(400).json({ success: false, message: `Tên này đã tồn tại trong ${targetGroup === 'family' ? 'Quỹ Gia Đình' : 'Quỹ Ăn Nhóm'}` });
    }

    member.name = targetName;
    member.personKey = targetKey;
    member.group = targetGroup;
    if (openingBalance !== undefined) member.openingBalance = Number(openingBalance) || 0;
    if (phone !== undefined) member.phone = phone;
    if (note !== undefined) member.note = note;

    await member.save();
    res.json({ success: true, member });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

app.delete('/api/dining/member/:id', authenticateToken, async (req, res) => {
  try {
    const member = await DiningMember.findById(req.params.id);
    if (!member) return res.status(404).json({ success: false, message: 'Không tìm thấy thành viên' });

    const reqPerm = member.group === 'family' ? 'manageDiningFamily' : 'manageDiningWork';
    if (!req.user.isAdmin && !(req.user.permissions && req.user.permissions[reqPerm])) {
      return res.status(403).json({ success: false, message: `Bạn không có quyền quản lý ${member.group === 'family' ? 'Quỹ Gia Đình' : 'Quỹ Ăn Nhóm'}` });
    }

    await member.deleteOne();
    res.json({ success: true, message: 'Đã xóa thành viên' });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

// ==================== 8.2. YÊU CẦU CHỈNH SỬA SỔ QUỸ (CORRECTION REQUESTS) ====================
// Lấy danh sách yêu cầu chỉnh sửa (Dành cho Quản Lý & Khách xem yêu cầu của mình)
app.get('/api/dining/requests', authenticateToken, async (req, res) => {
  try {
    const isManager = req.user.isAdmin || (req.user.permissions && (req.user.permissions.manageDiningWork || req.user.permissions.manageDiningFamily));
    let query = {};
    if (!isManager) {
      // Khách/thành viên chỉ thấy yêu cầu của chính họ
      query = { creatorId: req.user._id };
    }
    const requests = await CorrectionRequest.find(query).sort({ status: -1, createdAt: -1 }).limit(100);
    const pendingCount = await CorrectionRequest.countDocuments({ status: 'pending' });
    res.json({ success: true, requests, pendingCount, isManager });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Khách hoặc thành viên gửi yêu cầu chỉnh sửa
app.post('/api/dining/requests', authenticateToken, async (req, res) => {
  try {
    const { category, targetType, targetTitle, amount, reason } = req.body;
    if (!reason || !reason.trim()) {
      return res.status(400).json({ success: false, message: 'Vui lòng mô tả chi tiết sai sót hoặc yêu cầu chỉnh sửa' });
    }

    const newRequest = await CorrectionRequest.create({
      creatorId: req.user._id,
      creatorName: req.user.fullName || req.user.username,
      creatorUsername: req.user.username,
      category: category === 'family' ? 'family' : (category === 'general' ? 'general' : 'work'),
      targetType: targetType || 'bill',
      targetTitle: targetTitle ? targetTitle.trim() : '',
      amount: Number(amount) || 0,
      reason: reason.trim(),
      status: 'pending'
    });

    res.json({
      success: true,
      message: 'Yêu cầu chỉnh sửa đã được gửi thành công đến Quản Trị Viên & Người Quản Lý Sổ!',
      request: newRequest
    });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

// Quản trị viên / Người quản lý xử lý yêu cầu (Duyệt hoặc Từ chối)
app.patch('/api/dining/requests/:id/status', authenticateToken, async (req, res) => {
  try {
    const isManager = req.user.isAdmin || (req.user.permissions && (req.user.permissions.manageDiningWork || req.user.permissions.manageDiningFamily));
    if (!isManager) {
      return res.status(403).json({ success: false, message: 'Bạn không có quyền xử lý yêu cầu chỉnh sửa sổ' });
    }

    const { status, adminNote } = req.body;
    if (!['approved', 'rejected', 'pending'].includes(status)) {
      return res.status(400).json({ success: false, message: 'Trạng thái không hợp lệ' });
    }

    const item = await CorrectionRequest.findById(req.params.id);
    if (!item) return res.status(404).json({ success: false, message: 'Không tìm thấy yêu cầu' });

    item.status = status;
    if (adminNote !== undefined) item.adminNote = adminNote.trim();
    item.handledBy = req.user.fullName || req.user.username;
    item.handledAt = new Date();
    await item.save();

    res.json({
      success: true,
      message: `Đã cập nhật trạng thái yêu cầu thành [${status === 'approved' ? 'Đã xử lý' : (status === 'rejected' ? 'Từ chối' : 'Chờ xử lý')}]`,
      request: item
    });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

// ==================== 8.5. SỔ CHI TIÊU CÁ NHÂN & TIẾT KIỆM (HUB 4 CRUD) ====================
app.post('/api/personal/expense', authenticateToken, requirePermission('managePersonalHub'), async (req, res) => {
  try {
    const { title, category, type, amount, cycle, dueDay, status, paidAccount, deductFromAccount, notes, paidDate } = req.body;
    if (!title || !title.trim()) return res.status(400).json({ success: false, message: 'Thiếu tên khoản chi / hóa đơn' });
    const numAmount = Number(amount);
    if (!numAmount || numAmount <= 0) return res.status(400).json({ success: false, message: 'Số tiền phải lớn hơn 0đ' });

    const item = await PersonalExpense.create({
      title: title.trim(),
      category: category || 'streaming_tech',
      type: type || 'fixed_bill',
      amount: numAmount,
      cycle: cycle || 'monthly',
      dueDay: Number(dueDay) || 5,
      status: status || 'pending',
      paidAccount: paidAccount || 'Vietcombank',
      deductFromAccount: deductFromAccount === true,
      paidDate: status === 'paid' ? (paidDate || new Date().toISOString().slice(0, 10)) : '',
      notes: notes || ''
    });

    if (status === 'paid' && deductFromAccount === true && item.paidAccount) {
      await adjustAccountBalance(item.paidAccount, -numAmount);
    }

    res.json({ success: true, item });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

app.put('/api/personal/expense/:id', authenticateToken, requirePermission('managePersonalHub'), async (req, res) => {
  try {
    const item = await PersonalExpense.findById(req.params.id);
    if (!item) return res.status(404).json({ success: false, message: 'Không tìm thấy khoản chi cá nhân' });

    const { title, category, type, amount, cycle, dueDay, status, paidAccount, deductFromAccount, notes, paidDate } = req.body;
    if (title !== undefined) item.title = title.trim();
    if (category !== undefined) item.category = category;
    if (type !== undefined) item.type = type;
    if (amount !== undefined) item.amount = Number(amount) || item.amount;
    if (cycle !== undefined) item.cycle = cycle;
    if (dueDay !== undefined) item.dueDay = Number(dueDay) || item.dueDay;
    if (paidAccount !== undefined) item.paidAccount = paidAccount;
    if (notes !== undefined) item.notes = notes;
    if (deductFromAccount !== undefined) item.deductFromAccount = deductFromAccount;

    if (status !== undefined) {
      item.status = status;
      if (status === 'paid' && !item.paidDate) {
        item.paidDate = paidDate || new Date().toISOString().slice(0, 10);
      } else if (status === 'pending') {
        item.paidDate = '';
      }
    }

    await item.save();
    res.json({ success: true, item });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

app.put('/api/personal/expense/:id/toggle', authenticateToken, requirePermission('managePersonalHub'), async (req, res) => {
  try {
    const item = await PersonalExpense.findById(req.params.id);
    if (!item) return res.status(404).json({ success: false, message: 'Không tìm thấy khoản chi' });

    const newStatus = item.status === 'paid' ? 'pending' : 'paid';
    item.status = newStatus;
    if (newStatus === 'paid') {
      item.paidDate = new Date().toISOString().slice(0, 10);
      if (item.deductFromAccount && item.paidAccount) {
        await adjustAccountBalance(item.paidAccount, -item.amount);
      }
    } else {
      if (item.deductFromAccount && item.paidAccount) {
        await adjustAccountBalance(item.paidAccount, item.amount);
      }
      item.paidDate = '';
    }

    await item.save();
    res.json({ success: true, item });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

app.delete('/api/personal/expense/:id', authenticateToken, requirePermission('managePersonalHub'), async (req, res) => {
  try {
    const item = await PersonalExpense.findById(req.params.id);
    if (!item) return res.status(404).json({ success: false, message: 'Không tìm thấy khoản chi' });

    if (item.status === 'paid' && item.deductFromAccount && item.paidAccount) {
      await adjustAccountBalance(item.paidAccount, item.amount);
    }
    await item.deleteOne();
    res.json({ success: true, message: 'Đã xóa khoản chi cá nhân' });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

app.post('/api/personal/config', authenticateToken, requirePermission('managePersonalHub'), async (req, res) => {
  try {
    const { hub4MonthlyBudget, savingsRate, weeklyLimit } = req.body;
    const config = await Config.findOneAndUpdate(
      {},
      {
        ...(hub4MonthlyBudget !== undefined && { hub4MonthlyBudget: Number(hub4MonthlyBudget) }),
        ...(savingsRate !== undefined && { savingsRate: Number(savingsRate) }),
        ...(weeklyLimit !== undefined && { weeklyLimit: Number(weeklyLimit) })
      },
      { new: true, upsert: true }
    );
    res.json({ success: true, config });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

// ==================== 9. CẤU HÌNH HỆ THỐNG & RESET ====================
app.post('/api/config', authenticateToken, requirePermission('manageConfig'), async (req, res) => {
  try {
    const { weeklyLimit, initialCash } = req.body;
    const config = await Config.findOneAndUpdate(
      {},
      {
        ...(weeklyLimit !== undefined && { weeklyLimit: Number(weeklyLimit) }),
        ...(initialCash !== undefined && { initialCash: Number(initialCash) })
      },
      { new: true, upsert: true }
    );
    res.json({ success: true, config });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

// Fallback: mọi route khác đều phục vụ SPA index.html
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Start Server
app.listen(PORT, async () => {
  console.log(`===============================================`);
  console.log(`🚀 CFO Flow Server running on http://localhost:${PORT}`);
  console.log(`===============================================`);
  await ensureMongoConnected();
});
