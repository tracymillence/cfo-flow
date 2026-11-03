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

// Auto-reconnect helper
async function ensureMongoConnected() {
  if (mongoose.connection.readyState === 1) return true;
  try {
    await mongoose.connect(MONGODB_URI, { serverSelectionTimeoutMS: 8000 });
    console.log('✓ Kết nối MongoDB Atlas thành công!');
    lastMongoError = null;
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

    // 5. Dining Members (14 người giữ nguyên)
    const membersCount = await DiningMember.countDocuments();
    if (membersCount === 0 || force) {
      if (force) await DiningMember.deleteMany({});
      await DiningMember.insertMany([
        { personKey: 'yến', name: 'Yến', openingBalance: 1276411 },
        { personKey: 'thịnh', name: 'Thịnh', openingBalance: 20004 },
        { personKey: 'long', name: 'Long', openingBalance: -8004088 },
        { personKey: 'hải', name: 'Hải', openingBalance: -933475 },
        { personKey: 'tuyết ngân', name: 'Tuyết Ngân', openingBalance: -473517 },
        { personKey: 'như ý', name: 'Như Ý', openingBalance: 943499 },
        { personKey: 'dương', name: 'Dương', openingBalance: 301750 },
        { personKey: 'thu ngân', name: 'Thu Ngân', openingBalance: -34913 },
        { personKey: 'hoài', name: 'Hoài', openingBalance: -59597 },
        { personKey: 'ngọc tuyền', name: 'Ngọc Tuyền', openingBalance: 2790663 },
        { personKey: 'quỳnh', name: 'Quỳnh', openingBalance: 0 },
        { personKey: 'phụng', name: 'Phụng', openingBalance: 0 },
        { personKey: 'nguyên', name: 'Nguyên', openingBalance: 0 },
        { personKey: 'hp', name: 'HP', openingBalance: 368507 }
      ]);
    }

    // 6. Dining Settlements (4 giao dịch nạp / mượn giữ nguyên)
    const settlementsCount = await DiningSettlement.countDocuments();
    if (settlementsCount === 0 || force) {
      if (force) await DiningSettlement.deleteMany({});
      await DiningSettlement.insertMany([
        { monthKey: '2026-11', personKey: 'yến', personName: 'Yến', amount: 300000, direction: 'out', topupKind: 'borrow', accountName: 'Vietcombank', note: 'Yến mượn tiền quỹ', date: '2026-11-02' },
        { monthKey: '2026-11', personKey: 'quỳnh', personName: 'Quỳnh', amount: 16000, direction: 'in', topupKind: 'prepaid', accountName: 'MoMo', note: 'CK MoMo', date: '2026-11-02' },
        { monthKey: '2026-11', personKey: 'phụng', personName: 'Phụng', amount: 29000, direction: 'in', topupKind: 'prepaid', accountName: 'MoMo', note: 'CK MoMo', date: '2026-11-02' },
        { monthKey: '2026-11', personKey: 'nguyên', personName: 'Nguyên', amount: 16000, direction: 'in', topupKind: 'prepaid', accountName: 'MoMo', note: 'CK MoMo', date: '2026-11-02' }
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
          totalBill: 156000,
          myShare: 31200,
          paidAccount: 'Vietcombank',
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
          totalBill: 182000,
          myShare: 122000,
          paidAccount: 'Vietcombank',
          splits: [
            { personKey: 'tôi', personName: 'Tôi', amount: 122000, paid: true, isMe: true },
            { personKey: 'thịnh', personName: 'Thịnh', amount: 60000, paid: false, isMe: false }
          ],
          notes: 'Thịnh 60k, Tôi 122k'
        }
      ]);
    }

    // 8. Debts (Sổ nợ 2 chiều)
    const debtsCount = await Debt.countDocuments();
    if (debtsCount === 0 || force) {
      if (force) await Debt.deleteMany({});
      await Debt.create([
        { type: 'receivable', personName: 'Yến', amount: 300000, dueDate: '2026-11-05', status: 'pending', note: 'Yến mượn tiền quỹ lúc 19h53' },
        { type: 'payable', personName: 'Tiền ăn tối cho Bảo', amount: 45000, dueDate: '2026-11-02', status: 'paid', note: 'Mua đồ ăn tối cho Bảo' }
      ]);
    }

    console.log('✓ Hoàn tất đồng bộ dữ liệu chuẩn xác cho CFO Flow!');
  } catch (err) {
    console.warn('⚠️ Lỗi khi nạp seed:', err.message);
  }
}

// ==================== RESTFUL API ROUTES ====================

// 0. GET /api/health (Diagnostics & Mongo Status)
app.get('/api/health', (req, res) => {
  const uri = process.env.MONGODB_URI || '';
  const maskedUri = uri ? uri.replace(/:\/\/([^:]+):([^@]+)@/, '://$1:***@') : 'CHƯA_CÓ_BIẾN_MÔI_TRƯỜNG';
  res.json({
    status: 'ok',
    mongodb: {
      status: mongoose.connection.readyState === 1 ? 'connected' : (mongoose.connection.readyState === 2 ? 'connecting' : 'disconnected'),
      readyState: mongoose.connection.readyState,
      hasEnvUri: !!process.env.MONGODB_URI,
      maskedUri,
      lastError: lastMongoError ? lastMongoError.message : null
    }
  });
});

// 1. GET /api/dashboard (CFO Logic Aggregator)
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
    // Tiền khả dụng = Tổng tiền thực tế - Hũ tiền hàng phải trả NCC
    const spendableCash = totalPhysicalCash - totalSupplierDebt;

    // --- 4. HẠN MỨC TIÊU TUẦN ---
    const myDiningShareTotal = diningBills.reduce((sum, b) => sum + (b.myShare || 0), 0);
    const weeklyPaidExpenses = debts
      .filter(d => d.type === 'payable' && d.status === 'paid')
      .reduce((sum, d) => sum + (d.amount || 0), 0);
    const currentWeekSpent = myDiningShareTotal + weeklyPaidExpenses;
    const weeklyPercent = config.weeklyLimit > 0 ? Math.round((currentWeekSpent / config.weeklyLimit) * 100) : 0;

    // --- 5. SỔ ĂN NHÓM THEO TỪNG NGƯỜI & CƠM TRƯA CÁ NHÂN ---
    const billPaidTotal = diningBills.reduce((sum, b) => sum + (b.totalBill || 0), 0);
    const totalTopups = diningSettlements
      .filter(s => s.direction === 'in')
      .reduce((sum, s) => sum + (s.amount || 0), 0);
    const totalBorrowed = diningSettlements
      .filter(s => s.direction === 'out')
      .reduce((sum, s) => sum + (s.amount || 0), 0);

    let colleaguesEatenTotal = 0;
    diningBills.forEach(b => {
      b.splits.forEach(sp => {
        if (!sp.isMe && normalizeKey(sp.personName) !== 'toi') {
          colleaguesEatenTotal += (sp.amount || 0);
        }
      });
    });

    // Tính toán số dư 14 thành viên
    const memberMap = {};
    diningMembers.forEach(m => {
      const key = m.personKey || normalizeKey(m.name);
      memberMap[key] = {
        id: m._id,
        personKey: key,
        name: m.name,
        openingBalance: m.openingBalance || 0,
        topups: 0,
        borrowed: 0,
        eaten: 0,
        mealCount: 0,
        currentBalance: m.openingBalance || 0
      };
    });

    diningSettlements.forEach(s => {
      const key = s.personKey || normalizeKey(s.personName);
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

    diningBills.forEach(b => {
      b.splits.forEach(sp => {
        if (sp.isMe || normalizeKey(sp.personName) === 'toi') return;
        const key = sp.personKey || normalizeKey(sp.personName);
        if (memberMap[key]) {
          memberMap[key].eaten += (sp.amount || 0);
          memberMap[key].mealCount += 1;
          memberMap[key].currentBalance -= (sp.amount || 0);
        }
      });
    });

    const membersList = Object.values(memberMap);
    const surplusMembers = membersList.filter(m => m.currentBalance >= 0);
    const debtMembers = membersList.filter(m => m.currentBalance < 0);
    const totalSurplusFund = surplusMembers.reduce((sum, m) => sum + m.currentBalance, 0);
    const totalDebtReceivable = Math.abs(debtMembers.reduce((sum, m) => sum + m.currentBalance, 0));

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
        isBrake: weeklyPercent >= 100
      },
      card4_dining: {
        billPaidTotal,
        billCount: diningBills.length,
        totalTopups,
        topupCount: diningSettlements.length,
        totalBorrowed,
        colleaguesEatenTotal,
        myShareTotal: myDiningShareTotal,
        totalSurplusFund,
        surplusCount: surplusMembers.length,
        totalDebtReceivable,
        debtCount: debtMembers.length,
        members: membersList,
        bills: diningBills,
        settlements: diningSettlements
      },
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
    const account = await Account.create({
      name,
      type: type || 'bank',
      balance: Number(balance) || 0,
      accountNumber: accountNumber || '',
      hubRole: hubRole || 'hub1_income',
      note: note || ''
    });
    res.json({ success: true, account });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

app.put('/api/accounts/:id', async (req, res) => {
  try {
    const { name, type, balance, accountNumber, hubRole, note } = req.body;
    const account = await Account.findByIdAndUpdate(
      req.params.id,
      {
        name,
        type: type || 'bank',
        balance: Number(balance) || 0,
        accountNumber: accountNumber || '',
        hubRole: hubRole || 'hub1_income',
        note: note || ''
      },
      { new: true }
    );
    if (!account) return res.status(404).json({ success: false, message: 'Không tìm thấy tài khoản' });
    res.json({ success: true, account });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

app.delete('/api/accounts/:id', async (req, res) => {
  try {
    const account = await Account.findByIdAndDelete(req.params.id);
    if (!account) return res.status(404).json({ success: false, message: 'Không tìm thấy tài khoản' });
    res.json({ success: true, message: 'Đã xóa tài khoản' });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

// ==================== 2. NỢ TỪNG NHÀ CUNG CẤP (SUPPLIER DEBTS CRUD) ====================
app.get('/api/supplier-debts', async (req, res) => {
  try {
    const suppliers = await SupplierDebt.find().sort({ remainingAmount: -1 });
    res.json({ success: true, suppliers });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/supplier-debts', async (req, res) => {
  try {
    const { supplierName, remainingAmount, phone, bankInfo, notes } = req.body;
    const supplier = await SupplierDebt.create({
      supplierKey: normalizeKey(supplierName),
      supplierName,
      remainingAmount: Number(remainingAmount) || 0,
      phone: phone || '',
      bankInfo: bankInfo || '',
      notes: notes || ''
    });
    res.json({ success: true, supplier });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

app.put('/api/supplier-debts/:id', async (req, res) => {
  try {
    const { supplierName, remainingAmount, phone, bankInfo, notes } = req.body;
    const supplier = await SupplierDebt.findByIdAndUpdate(
      req.params.id,
      {
        supplierKey: normalizeKey(supplierName),
        supplierName,
        remainingAmount: Number(remainingAmount) || 0,
        phone: phone || '',
        bankInfo: bankInfo || '',
        notes: notes || ''
      },
      { new: true }
    );
    if (!supplier) return res.status(404).json({ success: false, message: 'Không tìm thấy NCC' });
    res.json({ success: true, supplier });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

// Thanh toán một phần hoặc toàn bộ cho 1 NCC cụ thể
app.post('/api/supplier-debts/:id/pay', async (req, res) => {
  try {
    const { payAmount } = req.body;
    const supplier = await SupplierDebt.findById(req.params.id);
    if (!supplier) return res.status(404).json({ success: false, message: 'Không tìm thấy NCC' });
    
    const amount = Number(payAmount) || supplier.remainingAmount;
    supplier.remainingAmount = Math.max(0, supplier.remainingAmount - amount);
    await supplier.save();
    
    res.json({ success: true, supplier });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

// Thanh toán gom toàn bộ tất cả NCC -> Hũ NCC = 0đ
app.post('/api/supplier-debts/batch-pay-all', async (req, res) => {
  try {
    await SupplierDebt.updateMany({}, { $set: { remainingAmount: 0 } });
    await ServiceOrder.updateMany({ customerPaid: true, supplierPaid: false }, { $set: { supplierPaid: true } });
    res.json({ success: true, message: 'Đã thanh toán toàn bộ công nợ các NCC về 0đ!' });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

app.delete('/api/supplier-debts/:id', async (req, res) => {
  try {
    const supplier = await SupplierDebt.findByIdAndDelete(req.params.id);
    if (!supplier) return res.status(404).json({ success: false, message: 'Không tìm thấy NCC' });
    res.json({ success: true, message: 'Đã xóa NCC' });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

// ==================== 3. LỊCH NHẮC DÒNG TIỀN (CASHFLOW REMINDERS CRUD) ====================
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
    const { date, title, amount, type, hubRole, status, notes } = req.body;
    const reminder = await CashflowReminder.create({
      date: date || new Date().toISOString().slice(0, 10),
      title,
      amount: Number(amount) || 0,
      type: type || 'reminder',
      hubRole: hubRole || 'hub1_income',
      status: status || 'pending',
      notes: notes || ''
    });
    res.json({ success: true, reminder });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

app.put('/api/reminders/:id', async (req, res) => {
  try {
    const { date, title, amount, type, hubRole, status, notes } = req.body;
    const reminder = await CashflowReminder.findByIdAndUpdate(
      req.params.id,
      {
        date,
        title,
        amount: Number(amount) || 0,
        type: type || 'reminder',
        hubRole: hubRole || 'hub1_income',
        status: status || 'pending',
        notes: notes || ''
      },
      { new: true }
    );
    if (!reminder) return res.status(404).json({ success: false, message: 'Không tìm thấy lịch nhắc' });
    res.json({ success: true, reminder });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

app.patch('/api/reminders/:id/toggle-status', async (req, res) => {
  try {
    const reminder = await CashflowReminder.findById(req.params.id);
    if (!reminder) return res.status(404).json({ success: false, message: 'Không tìm thấy' });
    reminder.status = reminder.status === 'completed' ? 'pending' : 'completed';
    await reminder.save();
    res.json({ success: true, reminder });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

app.delete('/api/reminders/:id', async (req, res) => {
  try {
    const reminder = await CashflowReminder.findByIdAndDelete(req.params.id);
    if (!reminder) return res.status(404).json({ success: false, message: 'Không tìm thấy' });
    res.json({ success: true, message: 'Đã xóa lịch nhắc' });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

// ==================== 4. SỔ NỢ 2 CHIỀU (DEBTS CRUD) ====================
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
    const { type, personName, amount, dueDate, note, status } = req.body;
    const debt = await Debt.create({
      type: type || 'receivable',
      personName,
      amount: Number(amount) || 0,
      dueDate: dueDate || new Date().toISOString().slice(0, 10),
      status: status || 'pending',
      note: note || ''
    });
    res.json({ success: true, debt });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

app.put('/api/debts/:id', async (req, res) => {
  try {
    const { type, personName, amount, dueDate, note, status } = req.body;
    const debt = await Debt.findByIdAndUpdate(
      req.params.id,
      {
        type,
        personName,
        amount: Number(amount) || 0,
        dueDate: dueDate || new Date().toISOString().slice(0, 10),
        status: status || 'pending',
        note: note || ''
      },
      { new: true }
    );
    if (!debt) return res.status(404).json({ success: false, message: 'Không tìm thấy' });
    res.json({ success: true, debt });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

app.patch('/api/debts/:id/toggle-status', async (req, res) => {
  try {
    const debt = await Debt.findById(req.params.id);
    if (!debt) return res.status(404).json({ success: false, message: 'Không tìm thấy' });
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
    if (!debt) return res.status(404).json({ success: false, message: 'Không tìm thấy' });
    res.json({ success: true, message: 'Đã xóa khoản nợ' });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

// ==================== 5. SERVICE ORDERS (DỊCH VỤ CRUD) ====================
app.post('/api/service-orders', async (req, res) => {
  try {
    const { customerName, serviceType, costPrice, salePrice, customerPaid, supplierPaid, date } = req.body;
    const order = await ServiceOrder.create({
      customerName: customerName || 'Khách lẻ',
      serviceType: serviceType || 'Dịch vụ',
      costPrice: Number(costPrice) || 0,
      salePrice: Number(salePrice) || 0,
      customerPaid: customerPaid !== false,
      supplierPaid: supplierPaid === true,
      date: date || new Date().toISOString().slice(0, 10)
    });
    res.json({ success: true, order });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

app.put('/api/service-orders/:id', async (req, res) => {
  try {
    const { customerName, serviceType, costPrice, salePrice, customerPaid, supplierPaid, date } = req.body;
    const order = await ServiceOrder.findByIdAndUpdate(
      req.params.id,
      {
        customerName: customerName || 'Khách lẻ',
        serviceType: serviceType || 'Dịch vụ',
        costPrice: Number(costPrice) || 0,
        salePrice: Number(salePrice) || 0,
        customerPaid: customerPaid !== false,
        supplierPaid: supplierPaid === true,
        date: date || new Date().toISOString().slice(0, 10)
      },
      { new: true }
    );
    if (!order) return res.status(404).json({ success: false, message: 'Không tìm thấy' });
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

// ==================== 6. BỮA ĂN NHÓM & SETTLEMENTS CRUD ====================
app.post('/api/dining/bill', async (req, res) => {
  try {
    const { date, mealTitle, totalBill, myShare, splits, notes } = req.body;
    const bill = await DiningLedger.create({
      date: date || new Date().toISOString().slice(0, 10),
      mealTitle: mealTitle || 'Bữa ăn nhóm',
      totalBill: Number(totalBill) || 0,
      myShare: Number(myShare) || 0,
      splits: splits || [],
      notes: notes || ''
    });
    res.json({ success: true, bill });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

app.put('/api/dining/bill/:id', async (req, res) => {
  try {
    const { date, mealTitle, totalBill, myShare, splits, notes } = req.body;
    const bill = await DiningLedger.findByIdAndUpdate(
      req.params.id,
      {
        date: date || new Date().toISOString().slice(0, 10),
        mealTitle: mealTitle || 'Bữa ăn nhóm',
        totalBill: Number(totalBill) || 0,
        myShare: Number(myShare) || 0,
        splits: splits || [],
        notes: notes || ''
      },
      { new: true }
    );
    if (!bill) return res.status(404).json({ success: false, message: 'Không tìm thấy' });
    res.json({ success: true, bill });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

app.delete('/api/dining/bill/:id', async (req, res) => {
  try {
    const bill = await DiningLedger.findByIdAndDelete(req.params.id);
    if (!bill) return res.status(404).json({ success: false, message: 'Không tìm thấy' });
    res.json({ success: true, message: 'Đã xóa bữa ăn' });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

app.post('/api/dining/settlement', async (req, res) => {
  try {
    const { personName, amount, direction, note, date, topupKind } = req.body;
    const pKey = normalizeKey(personName);
    const settlement = await DiningSettlement.create({
      personKey: pKey,
      personName,
      amount: Number(amount) || 0,
      direction: direction === 'out' ? 'out' : 'in',
      topupKind: topupKind || (direction === 'out' ? 'borrow' : 'prepaid'),
      note: note || '',
      date: date || new Date().toISOString().slice(0, 10)
    });
    res.json({ success: true, settlement });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

app.put('/api/dining/settlement/:id', async (req, res) => {
  try {
    const { personName, amount, direction, note, date, topupKind } = req.body;
    const pKey = normalizeKey(personName);
    const settlement = await DiningSettlement.findByIdAndUpdate(
      req.params.id,
      {
        personKey: pKey,
        personName,
        amount: Number(amount) || 0,
        direction: direction === 'out' ? 'out' : 'in',
        topupKind: topupKind || (direction === 'out' ? 'borrow' : 'prepaid'),
        note: note || '',
        date: date || new Date().toISOString().slice(0, 10)
      },
      { new: true }
    );
    if (!settlement) return res.status(404).json({ success: false, message: 'Không tìm thấy' });
    res.json({ success: true, settlement });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

app.delete('/api/dining/settlement/:id', async (req, res) => {
  try {
    const settlement = await DiningSettlement.findByIdAndDelete(req.params.id);
    if (!settlement) return res.status(404).json({ success: false, message: 'Không tìm thấy' });
    res.json({ success: true, message: 'Đã xóa giao dịch nạp / mượn' });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

app.post('/api/dining/member', async (req, res) => {
  try {
    const { name, openingBalance } = req.body;
    const pKey = normalizeKey(name);
    const member = await DiningMember.findOneAndUpdate(
      { personKey: pKey },
      { name, openingBalance: Number(openingBalance) || 0 },
      { upsert: true, new: true }
    );
    res.json({ success: true, member });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

app.delete('/api/dining/member/:id', async (req, res) => {
  try {
    const member = await DiningMember.findByIdAndDelete(req.params.id);
    if (!member) return res.status(404).json({ success: false, message: 'Không tìm thấy' });
    res.json({ success: true, message: 'Đã xóa thành viên' });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

// ==================== CONFIG ====================
app.post('/api/config', async (req, res) => {
  try {
    const { initialCash, weeklyLimit } = req.body;
    let config = await Config.findOne();
    if (!config) config = new Config();
    if (initialCash !== undefined) config.initialCash = Number(initialCash);
    if (weeklyLimit !== undefined) config.weeklyLimit = Number(weeklyLimit);
    await config.save();
    res.json({ success: true, config });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

// SPA Fallback: Trả về /public/index.html cho mọi route không phải API
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Start Express Server immediately, connect MongoDB asynchronously
app.listen(PORT, () => {
  console.log(`🚀 CFO Flow Server đang chạy tại: http://localhost:${PORT}`);
  console.log(`📡 Đang kết nối tới MongoDB Atlas...`);

  mongoose.connect(MONGODB_URI, {
    serverSelectionTimeoutMS: 8000
  })
  .then(async () => {
    console.log('✓ Kết nối MongoDB Atlas thành công!');
    lastMongoError = null;
    await seedDefaultData(false);
  })
  .catch(err => {
    lastMongoError = err;
    console.error('❌ Lỗi kết nối MongoDB:', err.message);
  });
});
