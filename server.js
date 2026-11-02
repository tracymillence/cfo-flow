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

const app = express();
const PORT = process.env.PORT || 10000;
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/cfo_flow_db';

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

// ==================== SEED DATA HELPER ====================
async function seedDefaultData(force = false) {
  try {
    const existingBills = await DiningLedger.countDocuments();
    if (existingBills > 0 && !force) return;

    console.log('🌱 Đang đồng bộ và nạp dữ liệu chuẩn xác cho CFO Flow...');

    // Drop legacy indexes if any
    try { await ServiceOrder.collection.dropIndexes(); } catch (e) {}
    try { await DiningLedger.collection.dropIndexes(); } catch (e) {}
    try { await Debt.collection.dropIndexes(); } catch (e) {}
    try { await DiningMember.collection.dropIndexes(); } catch (e) {}
    try { await DiningSettlement.collection.dropIndexes(); } catch (e) {}

    // 1. Config
    await Config.deleteMany({});
    await Config.create({
      initialCash: 3341742,
      weeklyLimit: 1500000,
      currentWeek: 1,
      syncPin: 'CFO-8888'
    });

    // 2. Service Orders (Reset pass thuế / Khắc dấu)
    await ServiceOrder.deleteMany({});
    await ServiceOrder.create([
      {
        customerName: 'Chị Vy ChipZB',
        serviceType: 'Reset pass thuế',
        costPrice: 420000,
        salePrice: 600000,
        customerPaid: true,
        supplierPaid: false,
        receivedAccount: 'Vietcombank',
        date: '2026-11-02'
      },
      {
        customerName: 'Chị Vân Dấu Tuấn Hương',
        serviceType: 'Bán dấu / Khắc dấu',
        costPrice: 190000,
        salePrice: 200000,
        customerPaid: true,
        supplierPaid: false,
        receivedAccount: 'Vietcombank',
        date: '2026-11-02'
      }
    ]);

    // 3. 14 Thành viên Sổ Ăn Nhóm với số dư đầu kỳ từ Google Sheet
    await DiningMember.deleteMany({});
    const defaultMembers = [
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
    ];
    await DiningMember.insertMany(defaultMembers);

    // 4. Các khoản Nạp tiền & Cho mượn tiền quỹ
    await DiningSettlement.deleteMany({});
    await DiningSettlement.insertMany([
      {
        monthKey: '2026-11',
        personKey: 'yến',
        personName: 'Yến',
        amount: 300000,
        direction: 'out',
        topupKind: 'borrow',
        accountName: 'Vietcombank',
        note: 'Yến mượn tiền quỹ',
        date: '2026-11-02'
      },
      {
        monthKey: '2026-11',
        personKey: 'quỳnh',
        personName: 'Quỳnh',
        amount: 16000,
        direction: 'in',
        topupKind: 'prepaid',
        accountName: 'MoMo',
        note: 'CK MoMo',
        date: '2026-11-02'
      },
      {
        monthKey: '2026-11',
        personKey: 'phụng',
        personName: 'Phụng',
        amount: 29000,
        direction: 'in',
        topupKind: 'prepaid',
        accountName: 'MoMo',
        note: 'CK MoMo',
        date: '2026-11-02'
      },
      {
        monthKey: '2026-11',
        personKey: 'nguyên',
        personName: 'Nguyên',
        amount: 16000,
        direction: 'in',
        topupKind: 'prepaid',
        accountName: 'MoMo',
        note: 'CK MoMo',
        date: '2026-11-02'
      }
    ]);

    // 5. 2 Bữa ăn thực tế (156k trưa chia 5 & 182k tối với Thịnh)
    await DiningLedger.deleteMany({});
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

    // 6. Sổ Nợ (Yến mượn 300k, Bảo ăn tối 45k)
    await Debt.deleteMany({});
    await Debt.create([
      {
        type: 'receivable',
        personName: 'Yến',
        amount: 300000,
        dueDate: '2026-11-05',
        status: 'pending',
        note: 'Yến mượn tiền quỹ lúc 19h53'
      },
      {
        type: 'payable',
        personName: 'Tiền ăn tối cho Bảo',
        amount: 45000,
        dueDate: '2026-11-02',
        status: 'paid',
        note: 'Mua đồ ăn tối cho Bảo (Trừ hạn mức tuần)'
      }
    ]);

    // 7. Thu nhập dự kiến
    await Income.deleteMany({});
    await Income.create([
      {
        source: 'Lương',
        amount: 17000000,
        date: '2026-11-05',
        note: 'Lương công ty chuyển khoản',
        receivedAccount: 'Vietcombank'
      }
    ]);

    console.log('✓ Hoàn tất nạp dữ liệu mẫu!');
  } catch (err) {
    console.warn('⚠️ Lỗi khi nạp seed:', err.message);
  }
}

// ==================== RESTFUL API ROUTES ====================

// 1. GET /api/dashboard (CFO Logic Aggregator)
app.get('/api/dashboard', async (req, res) => {
  try {
    let config = await Config.findOne();
    if (!config) {
      config = await Config.create({ initialCash: 3341742, weeklyLimit: 1500000, currentWeek: 1 });
    }

    const [serviceOrders, diningBills, diningMembers, diningSettlements, debts, incomes] = await Promise.all([
      ServiceOrder.find().sort({ createdAt: -1 }),
      DiningLedger.find().sort({ date: -1, createdAt: -1 }),
      DiningMember.find().sort({ name: 1 }),
      DiningSettlement.find().sort({ createdAt: -1 }),
      Debt.find().sort({ dueDate: 1 }),
      Income.find().sort({ date: 1 })
    ]);

    // --- CARD 1: Số dư tiền mặt thực tế hiện có ---
    const collectedCustomerSales = serviceOrders
      .filter(o => o.customerPaid)
      .reduce((sum, o) => sum + (o.salePrice || 0), 0);
    const paidSupplierCosts = serviceOrders
      .filter(o => o.supplierPaid)
      .reduce((sum, o) => sum + (o.costPrice || 0), 0);
    const totalDiningSpent = diningBills.reduce((sum, b) => sum + (b.totalBill || 0), 0);
    const paidPayableDebts = debts
      .filter(d => d.type === 'payable' && d.status === 'paid')
      .reduce((sum, d) => sum + (d.amount || 0), 0);
    const collectedReceivableDebts = debts
      .filter(d => d.type === 'receivable' && d.status === 'paid')
      .reduce((sum, d) => sum + (d.amount || 0), 0);
    const totalRealizedIncomes = incomes
      .filter(i => new Date(i.date) <= new Date())
      .reduce((sum, i) => sum + (i.amount || 0), 0);

    const cashBalance = Math.round(
      config.initialCash +
      totalRealizedIncomes +
      collectedCustomerSales -
      paidSupplierCosts -
      totalDiningSpent -
      paidPayableDebts +
      collectedReceivableDebts
    );

    // --- CARD 2: Hạn mức tiêu tuần ---
    const myDiningShareTotal = diningBills.reduce((sum, b) => sum + (b.myShare || 0), 0);
    const weeklyPaidExpenses = debts
      .filter(d => d.type === 'payable' && d.status === 'paid')
      .reduce((sum, d) => sum + (d.amount || 0), 0);
    const currentWeekSpent = myDiningShareTotal + weeklyPaidExpenses;
    const weeklyPercent = config.weeklyLimit > 0 ? Math.round((currentWeekSpent / config.weeklyLimit) * 100) : 0;

    // --- CARD 3: Hũ tiền hàng phải trả NCC ---
    const pendingSupplierOrders = serviceOrders.filter(o => o.customerPaid && !o.supplierPaid);
    const supplierPot = pendingSupplierOrders.reduce((sum, o) => sum + (o.costPrice || 0), 0);

    // --- CARD 4: Sổ Ăn Nhóm Theo Từng Người & Cơm Trưa Cá Nhân ---
    // 1. Thu / Chi thực tế tháng này
    const billPaidTotal = totalDiningSpent; // -338.000đ
    const totalTopups = diningSettlements
      .filter(s => s.direction === 'in')
      .reduce((sum, s) => sum + (s.amount || 0), 0); // +61.000đ
    const totalBorrowed = diningSettlements
      .filter(s => s.direction === 'out')
      .reduce((sum, s) => sum + (s.amount || 0), 0); // -300.000đ
    
    // Tính phần các bạn ăn (loại bỏ phần của Tôi)
    let colleaguesEatenTotal = 0;
    diningBills.forEach(b => {
      b.splits.forEach(sp => {
        if (!sp.isMe && normalizeKey(sp.personName) !== 'toi') {
          colleaguesEatenTotal += (sp.amount || 0);
        }
      });
    });

    // 2. Tính số dư cho từng thành viên (14 người)
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

    // Cộng nạp / trừ mượn từ settlements
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

    // Trừ tiền ăn từ diningBills
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

    const totalSurplusFund = surplusMembers.reduce((sum, m) => sum + m.currentBalance, 0); // 5.379.430đ
    const totalDebtReceivable = Math.abs(debtMembers.reduce((sum, m) => sum + m.currentBalance, 0)); // 9.607.986đ

    // --- CARD 5: Lịch nhắc Dòng tiền (Timeline view) ---
    const timeline = [];
    incomes.forEach(i => {
      timeline.push({
        id: 'inc-' + i._id,
        date: i.date,
        type: 'income',
        title: `Thu: ${i.source} (${i.note || ''})`,
        amount: i.amount,
        badge: 'Tiền Vào'
      });
    });
    debts.forEach(d => {
      timeline.push({
        id: 'deb-' + d._id,
        date: d.dueDate,
        type: d.type === 'payable' ? 'expense' : 'income',
        title: d.type === 'payable' ? `Trả: ${d.personName}` : `Thu: ${d.personName}`,
        amount: d.amount,
        badge: d.status === 'paid' ? 'Đã Xong' : (d.type === 'payable' ? 'Cần Trả' : 'Chờ Thu')
      });
    });
    serviceOrders.forEach(o => {
      if (!o.customerPaid) {
        timeline.push({
          id: 'ord-cust-' + o._id,
          date: o.date,
          type: 'income',
          title: `Thu DV: ${o.customerName}`,
          amount: o.salePrice,
          badge: 'Khách Nợ'
        });
      }
      if (o.customerPaid && !o.supplierPaid) {
        timeline.push({
          id: 'ord-sup-' + o._id,
          date: o.date,
          type: 'expense',
          title: `Vốn NCC: ${o.serviceType}`,
          amount: o.costPrice,
          badge: 'Hũ NCC'
        });
      }
    });

    timeline.sort((a, b) => new Date(a.date) - new Date(b.date));
    const spendableCash = cashBalance - supplierPot;

    res.json({
      success: true,
      config,
      card1_cash: {
        totalCash: cashBalance,
        spendableCash,
        supplierPot
      },
      card2_weekly: {
        limit: config.weeklyLimit,
        spent: currentWeekSpent,
        percent: weeklyPercent,
        isWarning: weeklyPercent >= 80,
        isBrake: weeklyPercent >= 100
      },
      card3_supplierPot: {
        totalAmount: supplierPot,
        pendingCount: pendingSupplierOrders.length,
        orders: pendingSupplierOrders
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
      card5_timeline: timeline,
      allOrders: serviceOrders,
      allDebts: debts
    });
  } catch (err) {
    console.error('Lỗi API dashboard:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// 2. POST /api/service-orders (Tạo đơn hàng dịch vụ)
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

// 2b. PUT /api/service-orders/:id (Cập nhật đơn hàng dịch vụ)
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

// 2c. DELETE /api/service-orders/:id (Xoá đơn hàng dịch vụ)
app.delete('/api/service-orders/:id', async (req, res) => {
  try {
    const order = await ServiceOrder.findByIdAndDelete(req.params.id);
    if (!order) return res.status(404).json({ success: false, message: 'Không tìm thấy' });
    res.json({ success: true, message: 'Đã xóa đơn hàng' });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

// 3. POST /api/service-orders/batch-pay-supplier (Thanh toán gom cho NCC -> Hũ NCC = 0)
app.post('/api/service-orders/batch-pay-supplier', async (req, res) => {
  try {
    const result = await ServiceOrder.updateMany(
      { customerPaid: true, supplierPaid: false },
      { $set: { supplierPaid: true } }
    );
    res.json({ success: true, updatedCount: result.modifiedCount });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

// 4. POST /api/dining/bill (Thêm bữa ăn mới)
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

    // Tự động thêm thành viên vào danh sách nếu chưa có
    if (Array.isArray(splits)) {
      for (const sp of splits) {
        if (sp.isMe || normalizeKey(sp.personName) === 'toi') continue;
        const key = sp.personKey || normalizeKey(sp.personName);
        const exists = await DiningMember.findOne({ personKey: key });
        if (!exists) {
          await DiningMember.create({
            personKey: key,
            name: sp.personName,
            openingBalance: 0
          });
        }
      }
    }

    res.json({ success: true, bill });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

// 4b. PUT /api/dining/bill/:id (Cập nhật bữa ăn nhóm)
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

// 4c. DELETE /api/dining/bill/:id (Xoá bữa ăn nhóm)
app.delete('/api/dining/bill/:id', async (req, res) => {
  try {
    const bill = await DiningLedger.findByIdAndDelete(req.params.id);
    if (!bill) return res.status(404).json({ success: false, message: 'Không tìm thấy' });
    res.json({ success: true, message: 'Đã xóa bữa ăn' });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

// 5. POST /api/dining/settlement (Nạp tiền / Mượn tiền quỹ)
app.post('/api/dining/settlement', async (req, res) => {
  try {
    const { personName, amount, direction, note, date, topupKind } = req.body;
    const pKey = normalizeKey(personName);
    
    // Đảm bảo thành viên tồn tại
    let member = await DiningMember.findOne({ personKey: pKey });
    if (!member) {
      member = await DiningMember.create({
        personKey: pKey,
        name: personName,
        openingBalance: 0
      });
    }

    const settlement = await DiningSettlement.create({
      personKey: pKey,
      personName: member.name,
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

// 5b. PUT /api/dining/settlement/:id (Cập nhật nạp / mượn tiền quỹ)
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

// 5c. DELETE /api/dining/settlement/:id (Xoá giao dịch nạp / mượn)
app.delete('/api/dining/settlement/:id', async (req, res) => {
  try {
    const settlement = await DiningSettlement.findByIdAndDelete(req.params.id);
    if (!settlement) return res.status(404).json({ success: false, message: 'Không tìm thấy' });
    res.json({ success: true, message: 'Đã xóa giao dịch nạp / mượn' });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

// 6. POST /api/dining/member (Thêm hoặc cập nhật số đầu kỳ từng người)
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

// 6b. DELETE /api/dining/member/:id (Xoá thành viên)
app.delete('/api/dining/member/:id', async (req, res) => {
  try {
    const member = await DiningMember.findByIdAndDelete(req.params.id);
    if (!member) return res.status(404).json({ success: false, message: 'Không tìm thấy' });
    res.json({ success: true, message: 'Đã xóa thành viên' });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

// 7. POST /api/debts (Tạo khoản nợ mới)
app.post('/api/debts', async (req, res) => {
  try {
    const { type, personName, amount, dueDate, note } = req.body;
    const debt = await Debt.create({
      type: type || 'receivable',
      personName,
      amount: Number(amount) || 0,
      dueDate: dueDate || new Date().toISOString().slice(0, 10),
      note: note || ''
    });
    res.json({ success: true, debt });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

// 8. PATCH /api/debts/:id/toggle-status (Đổi trạng thái nợ pending/paid)
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

// 8b. PUT /api/debts/:id (Cập nhật khoản nợ)
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
        note: note || '',
        status: status || 'pending'
      },
      { new: true }
    );
    if (!debt) return res.status(404).json({ success: false, message: 'Không tìm thấy' });
    res.json({ success: true, debt });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

// 8c. DELETE /api/debts/:id (Xoá khoản nợ)
app.delete('/api/debts/:id', async (req, res) => {
  try {
    const debt = await Debt.findByIdAndDelete(req.params.id);
    if (!debt) return res.status(404).json({ success: false, message: 'Không tìm thấy' });
    res.json({ success: true, message: 'Đã xóa khoản nợ' });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

// 9. POST /api/config (Cập nhật số dư đầu kỳ & Hạn mức tuần)
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

// 10. POST /api/seed (Force reseed)
app.post('/api/seed', async (req, res) => {
  try {
    await seedDefaultData(true);
    res.json({ success: true, message: 'Dữ liệu đã được nạp lại thành công!' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
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
    await seedDefaultData(false);
  })
  .catch(err => {
    console.error('❌ Lỗi kết nối MongoDB:', err.message);
  });
});
