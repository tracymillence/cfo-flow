const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');

const Account = require('../models/Account');
const Ledger = require('../models/Ledger');
const DiningMember = require('../models/DiningMember');
const DiningBill = require('../models/DiningBill');
const DiningSettlement = require('../models/DiningSettlement');
const DiningRequest = require('../models/DiningRequest');
const ServiceOrder = require('../models/ServiceOrder');
const SupplierDebt = require('../models/SupplierDebt');
const WeeklyExpense = require('../models/WeeklyExpense');

const { calculateMemberLedger } = require('../services/diningService');
const { getCashflowKPIs } = require('../services/cashflowService');
const seedDatabase = require('../seed');

// 1. Health check
router.get('/status', (req, res) => {
  const isConnected = mongoose.connection.readyState === 1;
  res.json({
    status: 'ok',
    database: isConnected ? 'connected' : 'disconnected',
    timestamp: new Date().toISOString()
  });
});

// 2. Dining Summary
router.get('/dining/summary', async (req, res) => {
  try {
    const monthKey = req.query.month || new Date().toISOString().slice(0, 7);
    const ledgerData = await calculateMemberLedger(monthKey);
    const bills = await DiningBill.find({ monthKey }).sort({ date: -1 }).lean();
    const settlements = await DiningSettlement.find({ monthKey }).sort({ date: -1 }).lean();
    const requests = await DiningRequest.find().sort({ createdAt: -1 }).lean();

    const totalAdvanced = bills.reduce((s, b) => s + (Number(b.totalBill) || 0), 0);
    const groupShareTotal = bills.reduce((s, b) => s + Math.max(0, (Number(b.totalBill) || 0) - (Number(b.myShare) || 0)), 0);
    const myShareTotal = bills.reduce((s, b) => s + (Number(b.myShare) || 0), 0);
    const totalCollected = settlements
      .filter(s => s.direction !== 'out' && s.topupKind !== 'borrow')
      .reduce((s, st) => s + (Number(st.amount) || 0), 0);
    const totalBorrowed = settlements
      .filter(s => s.direction === 'out' || s.topupKind === 'borrow')
      .reduce((s, st) => s + (Number(st.amount) || 0), 0);

    res.json({
      success: true,
      monthKey,
      ...ledgerData,
      bills,
      settlements,
      requests,
      monthlyStats: {
        billCount: bills.length,
        topupCount: settlements.length,
        totalAdvanced,
        groupShareTotal,
        myShareTotal,
        totalCollected,
        totalBorrowed
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 3. Create Dining Bill
router.post('/dining/bills', async (req, res) => {
  try {
    const { accountId, title, totalBill, myShare, splits, date } = req.body;
    const billId = 'dbill-' + Date.now();
    const cleanDate = date || new Date().toISOString().slice(0, 10);
    const monthKey = cleanDate.slice(0, 7);

    let acc = await Account.findOne({ accountId });
    if (!acc && accountId) {
      acc = await Account.findOne();
    }
    const accName = acc ? acc.name : 'Vietcombank';
    const accId = acc ? acc.accountId : 'acc_vcb';

    if (acc) {
      acc.balance -= Number(totalBill) || 0;
      await acc.save();

      await Ledger.create({
        id: 'ldg-' + Date.now(),
        accountId: accId,
        direction: 'out',
        amount: Number(totalBill) || 0,
        label: `Chi ăn nhóm: ${title}`,
        category: `Sổ ăn nhóm tháng ${monthKey}`,
        refId: billId,
        date: cleanDate
      });
    }

    const bill = await DiningBill.create({
      id: billId,
      date: cleanDate,
      monthKey,
      accountId: accId,
      accountName: accName,
      title,
      totalBill: Number(totalBill) || 0,
      myShare: Number(myShare) || 0,
      splits: Array.isArray(splits) ? splits : []
    });

    res.status(201).json({ success: true, bill });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

// 4. Create Dining Settlement (Topup / Borrow)
router.post('/dining/settlements', async (req, res) => {
  try {
    const { personKey, personName, amount, direction, topupKind, accountId, note, date } = req.body;
    const stId = 'dst-' + Date.now();
    const cleanDate = date || new Date().toISOString().slice(0, 10);
    const monthKey = cleanDate.slice(0, 7);
    const amt = Math.abs(Number(amount) || 0);

    let acc = await Account.findOne({ accountId });
    if (!acc) acc = await Account.findOne();
    const accName = acc ? acc.name : 'MoMo';
    const accId = acc ? acc.accountId : 'acc_momo';

    if (acc) {
      if (direction === 'out' || topupKind === 'borrow') {
        acc.balance -= amt;
      } else {
        acc.balance += amt;
      }
      await acc.save();

      await Ledger.create({
        id: 'ldg-' + Date.now(),
        accountId: accId,
        direction: (direction === 'out' || topupKind === 'borrow') ? 'out' : 'in',
        amount: amt,
        label: (direction === 'out' || topupKind === 'borrow') ? `Cho ${personName} mượn quỹ` : `${personName} nạp quỹ ăn`,
        category: `Quỹ ăn nhóm (${personName})`,
        refId: stId,
        date: cleanDate
      });
    }

    const st = await DiningSettlement.create({
      id: stId,
      monthKey,
      personKey,
      personName,
      amount: amt,
      direction: direction || 'in',
      topupKind: topupKind || 'prepaid',
      accountId: accId,
      accountName: accName,
      note: note || '',
      date: cleanDate
    });

    res.status(201).json({ success: true, settlement: st });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

// 5. Member / Assistant isolated slice
router.get('/member/slice', async (req, res) => {
  try {
    const monthKey = req.query.month || new Date().toISOString().slice(0, 7);
    const ledgerData = await calculateMemberLedger(monthKey);
    const bills = await DiningBill.find({ monthKey }).sort({ date: -1 }).lean();
    const settlements = await DiningSettlement.find({ monthKey }).sort({ date: -1 }).lean();
    const requests = await DiningRequest.find().sort({ createdAt: -1 }).lean();

    res.json({
      success: true,
      diningMembers: ledgerData.members,
      diningBills: bills,
      diningSettlements: settlements,
      diningRequests: requests,
      accountDirectory: [
        { id: 'acc_vcb', name: 'Vietcombank', type: 'bank' },
        { id: 'acc_momo', name: 'MoMo', type: 'ewallet' }
      ]
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 6. Create Member Dispute Request
router.post('/member/requests', async (req, res) => {
  try {
    const { memberName, personKey, category, targetRefId, targetDesc, amount, note } = req.body;
    const reqItem = await DiningRequest.create({
      id: 'dreq-' + Date.now(),
      createdAt: Date.now(),
      date: new Date().toISOString().slice(0, 10),
      memberName,
      personKey,
      category: category || 'meal',
      targetRefId: targetRefId || '',
      targetDesc: targetDesc || '',
      amount: Number(amount) || 0,
      note: note || '',
      status: 'pending'
    });
    res.status(201).json({ success: true, request: reqItem });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

// 7. Full Owner State snapshot (Get & Put)
router.get('/owner/state', async (req, res) => {
  try {
    const kpis = await getCashflowKPIs();
    const members = await DiningMember.find().lean();
    const bills = await DiningBill.find().sort({ date: -1 }).lean();
    const settlements = await DiningSettlement.find().sort({ date: -1 }).lean();
    const requests = await DiningRequest.find().sort({ createdAt: -1 }).lean();
    const serviceOrders = await ServiceOrder.find().lean();
    const supplierDebts = await SupplierDebt.find().lean();
    const weeklyExpenses = await WeeklyExpense.find().lean();
    const ledger = await Ledger.find().sort({ ts: -1 }).limit(100).lean();

    res.json({
      success: true,
      kpis,
      state: {
        isInitialized: true,
        updatedAt: Date.now(),
        diningUpdatedAt: Date.now(),
        accounts: kpis.accounts,
        diningMembers: members,
        diningBills: bills,
        diningSettlements: settlements,
        diningRequests: requests,
        serviceOrders,
        supplierDebts,
        expenses: weeklyExpenses,
        ledger
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST Owner State snapshot (Persists from SPA into MongoDB)
router.post('/owner/state', async (req, res) => {
  try {
    const st = req.body;
    if (!st || typeof st !== 'object') return res.status(400).json({ error: 'Invalid state' });

    if (Array.isArray(st.accounts)) {
      for (const a of st.accounts) {
        if (!a || !a.id) continue;
        await Account.findOneAndUpdate(
          { accountId: a.id },
          { name: a.name, type: a.type || 'bank', balance: Number(a.balance) || 0 },
          { upsert: true }
        );
      }
    }
    if (Array.isArray(st.diningMembers)) {
      for (const m of st.diningMembers) {
        if (!m || !m.personKey) continue;
        await DiningMember.findOneAndUpdate(
          { personKey: m.personKey },
          { id: m.id || ('dmem-' + m.personKey), name: m.name, openingBalance: Number(m.openingBalance) || 0 },
          { upsert: true }
        );
      }
    }
    if (Array.isArray(st.diningBills)) {
      for (const b of st.diningBills) {
        if (!b || !b.id) continue;
        await DiningBill.findOneAndUpdate(
          { id: b.id },
          {
            date: b.date,
            monthKey: b.monthKey,
            accountId: b.accountId,
            accountName: b.accountName,
            title: b.title,
            totalBill: Number(b.totalBill) || 0,
            myShare: Number(b.myShare) || 0,
            splits: Array.isArray(b.splits) ? b.splits : []
          },
          { upsert: true }
        );
      }
    }
    if (Array.isArray(st.diningSettlements)) {
      for (const s of st.diningSettlements) {
        if (!s || !s.id) continue;
        await DiningSettlement.findOneAndUpdate(
          { id: s.id },
          {
            monthKey: s.monthKey,
            personKey: s.personKey,
            personName: s.personName,
            amount: Number(s.amount) || 0,
            direction: s.direction || 'in',
            topupKind: s.topupKind || 'prepaid',
            accountId: s.accountId,
            accountName: s.accountName,
            note: s.note || '',
            date: s.date
          },
          { upsert: true }
        );
      }
    }
    if (Array.isArray(st.expenses)) {
      for (const e of st.expenses) {
        if (!e || !e.id) continue;
        await WeeklyExpense.findOneAndUpdate(
          { id: e.id },
          {
            accountId: e.accountId,
            week: Number(e.week) || 1,
            category: e.category,
            note: e.note,
            amount: Number(e.amount) || 0,
            date: e.date
          },
          { upsert: true }
        );
      }
    }

    res.json({ success: true, message: 'Đã đồng bộ an toàn vào MongoDB!' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 8. Seed database endpoint
router.post('/seed', async (req, res) => {
  try {
    const result = await seedDatabase(true);
    res.json({ success: true, message: 'Đã nạp thành công 100% dữ liệu thực tế vào MongoDB!', ...result });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
