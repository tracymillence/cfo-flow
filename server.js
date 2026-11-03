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

const app = express();
const PORT = process.env.PORT || 10000;
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/cfo_flow_db';
let lastMongoError = null;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve static frontend from /public
app.use(express.static(path.join(__dirname, 'public')));

// Helper string normalizer
function normalizeKey(str) {
  if (!str) return '';
  return str.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().replace(/\s+/g, ' ');
}

// Đảm bảo index unique tách biệt giữa group và personKey, không chặn người trùng tên giữa 2 nhóm
async function ensureCleanIndexes() {
  try {
    if (mongoose.connection.readyState !== 1) return;
    const col = mongoose.connection.db.collection('diningmembers');
    const indexes = await col.indexes();
    if (indexes.some(i => i.name === 'personKey_1')) {
      console.log('Đang loại bỏ index cũ personKey_1...');
      await col.dropIndex('personKey_1');
      console.log('Đã loại bỏ personKey_1 thành công.');
    }
    await col.createIndex({ group: 1, personKey: 1 }, { unique: true });
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

  const memberMap = {};
  members.forEach(m => {
    const rawKey = m.personKey || normalizeKey(m.name);
    // Prefix with group to ensure 100% isolation in combined view
    const key = `${m.group || 'work'}_${rawKey}`;
    memberMap[key] = {
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
  });

  settlements.forEach(s => {
    const rawKey = s.personKey || normalizeKey(s.personName);
    const key = `${s.category || 'work'}_${rawKey}`;
    if (memberMap[key]) {
      if (s.direction === 'in') {
        memberMap[key].topups += (s.amount || 0);
        memberMap[key].currentBalance += (s.amount || 0);
      } else if (s.direction === 'out') {
        memberMap[key].borrowed += (s.amount || 0);
        memberMap[key].currentBalance -= (s.amount || 0);
      }
    }
  });

  bills.forEach(b => {
    b.splits.forEach(sp => {
      if (sp.isMe || normalizeKey(sp.personName) === 'toi') return;
      const rawKey = sp.personKey || normalizeKey(sp.personName);
      const key = `${b.category || 'work'}_${rawKey}`;
      if (memberMap[key]) {
        memberMap[key].eaten += (sp.amount || 0);
        memberMap[key].mealCount += 1;
        memberMap[key].currentBalance -= (sp.amount || 0);
      }
    });
  });

  const membersList = Object.values(memberMap).sort((a, b) => {
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

// ==================== DASHBOARD FULL REAL-TIME API ====================
app.get('/api/dashboard', async (req, res) => {
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
      incomes
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
      Income.find().sort({ date: 1 })
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
      transactions: transactions.slice(0, 100),
      reminders,
      allDebts: debts,
      debtSummary: {
        totalReceivable: totalReceivableDebt,
        totalPayable: totalPayableDebt
      },
      allOrders: serviceOrders
    });
  } catch (err) {
    console.error('Lỗi API dashboard:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ==================== 0. SỔ GIAO DỊCH THU / CHI / CHUYỂN KHOẢN (CRUD) ====================
app.get('/api/transactions', async (req, res) => {
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

app.post('/api/transactions', async (req, res) => {
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

app.put('/api/transactions/:id', async (req, res) => {
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

app.delete('/api/transactions/:id', async (req, res) => {
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
app.get('/api/accounts', async (req, res) => {
  try {
    const accounts = await Account.find().sort({ type: 1, name: 1 });
    res.json({ success: true, accounts });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/accounts', async (req, res) => {
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

app.put('/api/accounts/:id', async (req, res) => {
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

app.delete('/api/accounts/:id', async (req, res) => {
  try {
    const acc = await Account.findByIdAndDelete(req.params.id);
    if (!acc) return res.status(404).json({ success: false, message: 'Không tìm thấy tài khoản' });
    res.json({ success: true, message: 'Đã xóa tài khoản' });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

// ==================== 2. HŨ TIỀN HÀNG NỢ TỪNG NCC (CRUD) ====================
app.get('/api/supplier-debts', async (req, res) => {
  try {
    const list = await SupplierDebt.find().sort({ remainingAmount: -1, createdAt: -1 });
    res.json({ success: true, suppliers: list });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/supplier-debts', async (req, res) => {
  try {
    const { supplierName, remainingAmount, phone, bankInfo, notes } = req.body;
    if (!supplierName || !supplierName.trim()) {
      return res.status(400).json({ success: false, message: 'Vui lòng nhập tên nhà cung cấp' });
    }
    const sup = await SupplierDebt.create({
      supplierName: supplierName.trim(),
      supplierKey: normalizeKey(supplierName),
      remainingAmount: Number(remainingAmount) || 0,
      phone: phone || '',
      bankInfo: bankInfo || '',
      notes: notes || ''
    });
    res.json({ success: true, supplier: sup });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

app.put('/api/supplier-debts/:id', async (req, res) => {
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

app.post('/api/supplier-debts/:id/pay', async (req, res) => {
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

app.post('/api/supplier-debts/batch-pay-all', async (req, res) => {
  try {
    await SupplierDebt.updateMany({}, { $set: { remainingAmount: 0 } });
    await ServiceOrder.updateMany({}, { $set: { supplierPaid: true } });
    res.json({ success: true, message: 'Đã thanh toán toàn bộ công nợ cho các nhà cung cấp (Reset hũ về 0đ)' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.delete('/api/supplier-debts/:id', async (req, res) => {
  try {
    const sup = await SupplierDebt.findByIdAndDelete(req.params.id);
    if (!sup) return res.status(404).json({ success: false, message: 'Không tìm thấy NCC' });
    res.json({ success: true, message: 'Đã xóa NCC' });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

// ==================== 3. LỊCH NHẮC DÒNG TIỀN (CRUD) ====================
app.get('/api/reminders', async (req, res) => {
  try {
    const reminders = await CashflowReminder.find().sort({ date: 1, createdAt: 1 });
    res.json({ success: true, reminders });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/reminders', async (req, res) => {
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

app.put('/api/reminders/:id', async (req, res) => {
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

app.patch('/api/reminders/:id/toggle-status', async (req, res) => {
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

app.delete('/api/reminders/:id', async (req, res) => {
  try {
    const rem = await CashflowReminder.findByIdAndDelete(req.params.id);
    if (!rem) return res.status(404).json({ success: false, message: 'Không tìm thấy dòng nhắc' });
    res.json({ success: true, message: 'Đã xóa dòng nhắc dòng tiền' });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

// ==================== 4. SỔ NỢ 2 CHIỀU (CRUD) ====================
app.get('/api/debts', async (req, res) => {
  try {
    const debts = await Debt.find().sort({ dueDate: 1 });
    res.json({ success: true, debts });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/debts', async (req, res) => {
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

app.put('/api/debts/:id', async (req, res) => {
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

app.patch('/api/debts/:id/toggle-status', async (req, res) => {
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

app.delete('/api/debts/:id', async (req, res) => {
  try {
    const debt = await Debt.findByIdAndDelete(req.params.id);
    if (!debt) return res.status(404).json({ success: false, message: 'Không tìm thấy khoản nợ' });
    res.json({ success: true, message: 'Đã xóa khoản nợ' });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

// ==================== 5. ĐƠN DỊCH VỤ / BÁN DẤU CRUD ====================
app.post('/api/service-orders', async (req, res) => {
  try {
    const { customerName, serviceName, costPrice, salePrice, supplierKey, supplierName, customerPaid, supplierPaid, note } = req.body;
    const order = await ServiceOrder.create({
      customerName,
      serviceName,
      costPrice: Number(costPrice) || 0,
      salePrice: Number(salePrice) || 0,
      supplierKey: supplierKey || normalizeKey(supplierName),
      supplierName: supplierName || 'NCC',
      customerPaid: Boolean(customerPaid),
      supplierPaid: Boolean(supplierPaid),
      note: note || ''
    });

    if (!order.supplierPaid && order.costPrice > 0) {
      const sKey = order.supplierKey || normalizeKey(order.supplierName);
      await SupplierDebt.findOneAndUpdate(
        { supplierKey: sKey },
        { 
          $inc: { remainingAmount: order.costPrice },
          $setOnInsert: { supplierName: order.supplierName }
        },
        { upsert: true }
      );
    }

    res.json({ success: true, order });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

app.put('/api/service-orders/:id', async (req, res) => {
  try {
    const { customerName, serviceName, costPrice, salePrice, supplierName, customerPaid, supplierPaid, note } = req.body;
    const order = await ServiceOrder.findByIdAndUpdate(
      req.params.id,
      {
        customerName,
        serviceName,
        costPrice: Number(costPrice) || 0,
        salePrice: Number(salePrice) || 0,
        supplierName,
        supplierKey: normalizeKey(supplierName),
        customerPaid: Boolean(customerPaid),
        supplierPaid: Boolean(supplierPaid),
        note: note || ''
      },
      { new: true }
    );
    if (!order) return res.status(404).json({ success: false, message: 'Không tìm thấy đơn hàng' });
    res.json({ success: true, order });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

app.delete('/api/service-orders/:id', async (req, res) => {
  try {
    const order = await ServiceOrder.findByIdAndDelete(req.params.id);
    if (!order) return res.status(404).json({ success: false, message: 'Không tìm thấy' });
    res.json({ success: true, message: 'Đã xóa đơn hàng' });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

// ==================== 6. BỮA ĂN NHÓM & QUỸ GIA ĐÌNH CRUD ====================
app.post('/api/dining/bill', async (req, res) => {
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

    const numTotal = Number(totalBill) || 0;
    const shouldDeduct = deductFromAccount !== false;

    const bill = await DiningLedger.create({
      date: date || new Date().toISOString().slice(0, 10),
      mealTitle: mealTitle || 'Bữa ăn nhóm',
      category: category === 'family' ? 'family' : 'work',
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

app.put('/api/dining/bill/:id', async (req, res) => {
  try {
    const oldBill = await DiningLedger.findById(req.params.id);
    if (!oldBill) return res.status(404).json({ success: false, message: 'Không tìm thấy hóa đơn' });

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

app.delete('/api/dining/bill/:id', async (req, res) => {
  try {
    const bill = await DiningLedger.findById(req.params.id);
    if (!bill) return res.status(404).json({ success: false, message: 'Không tìm thấy bữa ăn' });

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
app.post('/api/dining/settlement', async (req, res) => {
  try {
    const { personName, amount, direction, category, note, date, topupKind, accountName, addToAccount } = req.body;
    const pKey = normalizeKey(personName);
    const numAmount = Number(amount) || 0;
    const shouldAdd = addToAccount !== false;

    const settlement = await DiningSettlement.create({
      personKey: pKey,
      personName,
      category: category === 'family' ? 'family' : 'work',
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

app.put('/api/dining/settlement/:id', async (req, res) => {
  try {
    const oldS = await DiningSettlement.findById(req.params.id);
    if (!oldS) return res.status(404).json({ success: false, message: 'Không tìm thấy giao dịch' });

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

app.delete('/api/dining/settlement/:id', async (req, res) => {
  try {
    const s = await DiningSettlement.findById(req.params.id);
    if (!s) return res.status(404).json({ success: false, message: 'Không tìm thấy giao dịch' });

    // Hoàn tác tiền ngân hàng
    if (s.addToAccount && s.accountName && s.amount > 0) {
      const revertDelta = s.direction === 'in' ? -s.amount : s.amount;
      await adjustAccountBalance(s.accountName, revertDelta);
    }

    await s.deleteOne();
    res.json({ success: true, message: 'Đã xóa giao dịch nạp / mượn và cập nhật lại số dư' });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

// ==================== 8. THÀNH VIÊN SỔ ĂN & GIA ĐÌNH ====================
app.post('/api/dining/member', async (req, res) => {
  try {
    const { name, openingBalance, group, phone, note } = req.body;
    if (!name || !name.trim()) return res.status(400).json({ success: false, message: 'Thiếu tên người' });
    const targetGroup = group === 'family' ? 'family' : 'work';
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

app.put('/api/dining/member/:id', async (req, res) => {
  try {
    const { name, openingBalance, group, phone, note } = req.body;
    const member = await DiningMember.findById(req.params.id);
    if (!member) return res.status(404).json({ success: false, message: 'Không tìm thấy người này' });

    const targetGroup = group !== undefined ? (group === 'family' ? 'family' : 'work') : member.group;
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

app.delete('/api/dining/member/:id', async (req, res) => {
  try {
    const member = await DiningMember.findByIdAndDelete(req.params.id);
    if (!member) return res.status(404).json({ success: false, message: 'Không tìm thấy thành viên' });
    res.json({ success: true, message: 'Đã xóa thành viên' });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

// ==================== 9. CẤU HÌNH HỆ THỐNG & RESET ====================
app.post('/api/config', async (req, res) => {
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
