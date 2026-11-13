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
const { validateTransaction } = require('./middlewares/validateTransaction');
const { validateSupplierDebt } = require('./middlewares/validateSupplierDebt');
const safeMath = require('./utils/math.util');
const { getUnifiedFeed } = require('./services/unifiedFeed.service');
const { calculateWeeklySpeedometerAgg, getVietnamWeekRange } = require('./services/speedometer.service');

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

    // Đồng bộ cờ boolean customerPaid & supplierPaid trên các đơn hàng cũ
    await ServiceOrder.updateMany(
      { customerPaymentStatus: 'completed', customerPaid: { $ne: true } },
      { $set: { customerPaid: true } }
    );
    await ServiceOrder.updateMany(
      { supplierPaymentStatus: 'completed', supplierPaid: { $ne: true } },
      { $set: { supplierPaid: true } }
    );

    // Đồng bộ chính xác Tổng nợ trong hũ NCC theo tổng các đơn hàng lẻ của từng NCC
    const allCurrentSups = await SupplierDebt.find();
    for (const s of allCurrentSups) {
      await reconcileSupplierDebtFromOrders(s.supplierName, s.supplierKey);
      // Tự động phục hồi lịch sử trả nợ cho các NCC độc lập đã có paidAmount > 0 nhưng chưa có paymentHistory
      const freshSup = await SupplierDebt.findById(s._id);
      if (freshSup && (freshSup.paidAmount || 0) > 0 && (!freshSup.paymentHistory || freshSup.paymentHistory.length === 0)) {
        const orderCount = await ServiceOrder.countDocuments({ supplierKey: freshSup.supplierKey });
        if (orderCount === 0) {
          freshSup.paymentHistory = [{
            amount: freshSup.paidAmount,
            date: (freshSup.updatedAt || new Date()).toISOString().slice(0, 10),
            accountName: '',
            deductFromAccount: false,
            appliedToOrders: false,
            note: 'Khoản trả nợ đã nhập (bấm "Chọn Ngân Hàng" để trừ số dư & ghi Sổ Giao Dịch)'
          }];
          await freshSup.save();
        }
      }
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
    await backfillMemberIds();
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

// ==================== CORE FINANCIAL ENGINE & GUARDS ====================

// BUG 3 (Financial Isolation): Thấu chi nội bộ (Supplier Float)
// Cờ usingSupplierFloat CHỈ ÁP DỤNG cho các khoản chi thuộc Hub 1 (Thu Nhập & Kinh Doanh) vì nợ NCC gắn liền với kinh doanh.
// Dòng tiền Hub 4 (Cá nhân), Hub 2 (Quỹ ăn), Hub 3 (Gia đình) tách biệt hoàn toàn, tuyệt đối không chạm vào vốn NCC.
async function isUsingSupplierFloat(amountToSpend, hubRole = 'hub1_income', session = null) {
  if (hubRole !== 'hub1_income') return false;

  const parsedAmount = Number(amountToSpend);
  if (isNaN(parsedAmount) || parsedAmount <= 0) return false;

  // Lấy số dư thực tế các tài khoản thuộc Hub 1 (hoặc toàn bộ nếu chưa phân bổ)
  const hub1Accounts = await Account.aggregate([
    { $match: { hubRole: 'hub1_income' } },
    { $group: { _id: null, totalCash: { $sum: '$balance' } } }
  ]).session(session);

  let hub1Cash = hub1Accounts.length > 0 ? hub1Accounts[0].totalCash : 0;
  if (!hub1Accounts.length) {
    const [allCash] = await Account.aggregate([
      { $group: { _id: null, totalCash: { $sum: '$balance' } } }
    ]).session(session);
    hub1Cash = allCash ? allCash.totalCash : 0;
  }

  const [debtResult] = await SupplierDebt.aggregate([
    { $group: { _id: null, totalDebt: { $sum: '$remainingAmount' } } }
  ]).session(session);

  const totalSupplierDebt = debtResult ? debtResult.totalDebt : 0;
  const spendableCashHub1 = hub1Cash - totalSupplierDebt;

  // Chỉ báo động thấu chi nếu số dư khả dụng của Hub 1 không đủ chi trả khoản chi kinh doanh này
  return spendableCashHub1 < parsedAmount;
}

// Giữ lại hàm tương thích ngược
async function checkSpendableCashBlock(amountToSpend, hubRole = 'hub1_income', session = null) {
  return await isUsingSupplierFloat(amountToSpend, hubRole, session);
}

// ISSUE 4: Atomic Account Balance Update using MongoDB $inc operator (Prevents race conditions)
async function adjustAccountBalance(accountName, delta, session = null) {
  const numDelta = Number(delta);
  if (!accountName || !numDelta) return null;
  const trimmed = accountName.trim();
  const filter = trimmed.match(/^[0-9a-fA-F]{24}$/)
    ? { _id: trimmed }
    : { name: { $regex: new RegExp(`^${escapeRegex(trimmed)}$`, 'i') } };

  const updatedAcc = await Account.findOneAndUpdate(
    filter,
    { $inc: { balance: numDelta } },
    { new: true, runValidators: true, session }
  );
  return updatedAcc;
}

// ISSUE 3: Safe backfill of memberId for existing DiningSettlement and DiningLedger
async function backfillMemberIds() {
  try {
    const allMembers = await DiningMember.find().lean();
    if (allMembers.length === 0) return;

    const memberMap = new Map();
    allMembers.forEach(m => {
      memberMap.set(`${m.group || 'work'}_${normalizeKey(m.name)}`, m._id);
    });

    // 1. DiningSettlement
    const unlinkedSettlements = await DiningSettlement.find({ memberId: { $in: [null, undefined] } });
    for (const s of unlinkedSettlements) {
      const key = `${s.category || 'work'}_${normalizeKey(s.personName)}`;
      const mId = memberMap.get(key);
      if (mId) {
        await DiningSettlement.updateOne({ _id: s._id }, { $set: { memberId: mId } });
      }
    }

    // 2. DiningLedger splits
    const unlinkedBills = await DiningLedger.find({ 'splits.memberId': { $in: [null, undefined] } });
    for (const b of unlinkedBills) {
      let modified = false;
      for (const sp of b.splits) {
        if (!sp.memberId) {
          const key = `${b.category || 'work'}_${normalizeKey(sp.personName)}`;
          const mId = memberMap.get(key);
          if (mId) {
            sp.memberId = mId;
            modified = true;
          }
        }
      }
      if (modified) {
        await DiningLedger.updateOne({ _id: b._id }, { $set: { splits: b.splits } });
      }
    }
  } catch (err) {
    console.error('Lỗi backfill memberIds:', err.message);
  }
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

    // 9. Debts (Không tự động tạo nợ mẫu khi danh sách rỗng để tránh tái sinh nợ ảo)
    if (force) {
      await Debt.deleteMany({});
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
      isBadDebt: Boolean(m.isBadDebt), // Nợ dài hạn / khó đòi
      phone: m.phone || '',
      note: m.note || '',
      topups: 0,
      borrowed: 0,
      eaten: 0,
      mealCount: 0,
      currentBalance: m.openingBalance || 0
    };
    memberObjList.push(memberObj);

    // Đăng ký cả ObjectId chuẩn
    if (m._id) {
      memberKeyMap.set(m._id.toString(), memberObj);
    }

    // Đăng ký tất cả các alias định danh
    getMemberLookupKeys(m.group, m.personKey, m.name).forEach(k => {
      memberKeyMap.set(k, memberObj);
    });
  });

  settlements.forEach(s => {
    let matchedMember = null;
    if (s.memberId && memberKeyMap.has(s.memberId.toString())) {
      matchedMember = memberKeyMap.get(s.memberId.toString());
    } else {
      const sKeys = getMemberLookupKeys(s.category, s.personKey, s.personName);
      for (const k of sKeys) {
        if (memberKeyMap.has(k)) {
          matchedMember = memberKeyMap.get(k);
          break;
        }
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
      let matchedMember = null;
      if (sp.memberId && memberKeyMap.has(sp.memberId.toString())) {
        matchedMember = memberKeyMap.get(sp.memberId.toString());
      } else {
        const spKeys = getMemberLookupKeys(b.category, sp.personKey, sp.personName);
        for (const k of spKeys) {
          if (memberKeyMap.has(k)) {
            matchedMember = memberKeyMap.get(k);
            break;
          }
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

  // Phân loại nợ dài hạn / khó đòi vs Nợ thu hồi được (cho Hub 2)
  const badDebtMembers = debtMembers.filter(m => m.isBadDebt);
  const collectibleDebtMembers = debtMembers.filter(m => !m.isBadDebt);
  const totalBadDebtReceivable = Math.abs(badDebtMembers.reduce((sum, m) => sum + m.currentBalance, 0));
  const totalCollectibleDebtReceivable = Math.abs(collectibleDebtMembers.reduce((sum, m) => sum + m.currentBalance, 0));

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
    totalBadDebtReceivable,
    badDebtCount: badDebtMembers.length,
    totalCollectibleDebtReceivable,
    collectibleDebtCount: collectibleDebtMembers.length,
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
    const { startStr: currentWeekStartStr, endStr: currentWeekEndStr } = getVietnamWeekRange();

    // Phần ăn cá nhân của tôi trong tuần này có deductWeeklyLimit !== false
    const myDiningShareWeekly = diningBills
      .filter(b => b.deductWeeklyLimit !== false && b.date >= currentWeekStartStr && b.date <= currentWeekEndStr)
      .reduce((sum, b) => sum + (b.myShare || 0), 0);

    // Tính toán chi tiêu cá nhân Hub 4 và hoàn tiền theo múi giờ Việt Nam (Asia/Ho_Chi_Minh) qua MongoDB aggregation
    const speedometerData = await calculateWeeklySpeedometerAgg();
    const transactionsWeeklySpent = speedometerData.grossWeeklySpent;
    const hub4WeeklyRefunds = speedometerData.hub4WeeklyRefunds;

    const weeklyPaidDebts = debts
      .filter(d => d.type === 'payable' && d.status === 'paid' && d.paidDate >= currentWeekStartStr && d.paidDate <= currentWeekEndStr)
      .reduce((sum, d) => sum + (d.amount || 0), 0);

    const grossWeeklySpent = safeMath.add(safeMath.add(myDiningShareWeekly, transactionsWeeklySpent), weeklyPaidDebts);
    const currentWeekSpent = Math.max(0, safeMath.subtract(grossWeeklySpent, hub4WeeklyRefunds));
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
    // Sử dụng safeMath để triệt tiêu sai số dấu phẩy động (IEEE 754 precision)
    const hub4Budget = config.hub4MonthlyBudget || 6000000;
    const savingsRate = config.savingsRate || 15;
    const targetSavings = safeMath.percent(hub4Budget, savingsRate);

    // 1. Tiết kiệm đã trích thực tế
    const savingsList = personalExpenses.filter(e => e.type === 'savings_deposit' || e.category === 'savings');
    const actualSavings = safeMath.sum(savingsList.map(e => e.amount));

    // 2. Hóa đơn cá nhân cố định (Gym, Streaming, Tiện ích sống)
    const fixedBillsList = personalExpenses.filter(e => e.type === 'fixed_bill');
    const totalFixedBills = safeMath.sum(fixedBillsList.map(e => e.amount));
    const paidFixedBills = safeMath.sum(fixedBillsList.filter(e => e.status === 'paid').map(e => e.amount));
    const pendingFixedBills = safeMath.sum(fixedBillsList.filter(e => e.status === 'pending').map(e => e.amount));

    // 3. Hạn mức tiêu xài khả dụng thực tế của 2 người (Ăn ngoài, Cà phê, Mua sắm)
    // = Tổng Ngân Sách - Tiết Kiệm - Hóa Đơn Cố Định (Tính toán chính xác từng xu với safeMath)
    const spendableFlexibleMonthly = Math.max(0, safeMath.subtract(safeMath.subtract(hub4Budget, targetSavings), totalFixedBills));
    const personalSpentMonthly = safeMath.add(myDiningShareWeekly, transactionsWeeklySpent);

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

    // --- 8. TỔNG HỢP GIAO DỊCH TOÀN HỆ THỐNG (UNIFIED TRANSACTIONS) ---
    const unifiedTransactions = await getUnifiedTransactions({ limit: 150 });

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
        grossSpent: grossWeeklySpent,
        hub4Refunds: hub4WeeklyRefunds,
        percent: weeklyPercent,
        isWarning: weeklyPercent >= 80,
        isBrake: weeklyPercent >= 100,
        breakdown: {
          diningShare: myDiningShareWeekly,
          transactions: transactionsWeeklySpent,
          paidDebts: weeklyPaidDebts,
          refundsCredit: hub4WeeklyRefunds
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
      transactions: unifiedTransactions,
      reminders,
      allDebts: debts,
      debtSummary: {
        totalReceivable: totalReceivableDebt,
        totalPayable: totalPayableDebt
      },
      allOrders: serviceOrders,
      projectionHealth: await calculateProjectionHealth('all'),
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

// ISSUE 3: Database-level Unified Feed using MongoDB $unionWith aggregation pipeline (prevents OOM)
async function getUnifiedTransactions(filter = {}) {
  const page = parseInt(filter.page, 10) || 1;
  const limit = parseInt(filter.limit, 10) || 150;
  const result = await getUnifiedFeed(page, limit, filter);
  return result.transactions;
}

// ==================== 0. SỔ GIAO DỊCH THU / CHI / CHUYỂN KHOẢN (CRUD) ====================
app.get('/api/transactions', authenticateToken, async (req, res) => {
  try {
    const page = parseInt(req.query.page, 10) || 1;
    const limit = parseInt(req.query.limit, 10) || 150;
    const result = await getUnifiedFeed(page, limit, req.query);
    res.json({
      success: true,
      transactions: result.transactions,
      pagination: result.pagination
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/transactions', authenticateToken, requirePermission('manageTransactions'), validateTransaction, async (req, res) => {
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

    const numAmount = Number(amount);
    const resolvedHubRole = hubRole || 'hub4_personal';

    // BUG 3 (Financial Isolation): Cờ Thấu chi NCC (usingSupplierFloat) CHỈ ĐƯỢC PHÉP kích hoạt nếu thuộc Hub 1 (Kinh doanh)
    // Hub 4 (Cá nhân), Hub 2 (Quỹ ăn), Hub 3 (Gia đình) tách biệt hoàn toàn
    let usingSupplierFloat = false;
    if (type === 'expense' && resolvedHubRole === 'hub1_income') {
      usingSupplierFloat = await isUsingSupplierFloat(numAmount, resolvedHubRole);
    }

    // BUG 4: impactsWeeklyLimit chỉ áp dụng cho Hub 4 (Cá nhân)
    const safeImpactsWeeklyLimit = (resolvedHubRole === 'hub4_personal')
      ? (impactsWeeklyLimit !== undefined ? Boolean(impactsWeeklyLimit) : (type === 'expense'))
      : false;

    const tx = await Transaction.create({
      date: date || new Date().toISOString().slice(0, 10),
      title: title.trim(),
      amount: numAmount,
      type: type || 'expense',
      accountName: accountName || 'Vietcombank',
      toAccountName: toAccountName || '',
      category: category || 'Chi tiêu',
      hubRole: resolvedHubRole,
      impactsWeeklyLimit: safeImpactsWeeklyLimit,
      usingSupplierFloat,
      notes: notes || ''
    });

    // ISSUE 4: Cập nhật số dư ngân hàng thời gian thực bằng toán tử $inc nguyên tử
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
    res.status(err.statusCode || 400).json({ success: false, message: err.message });
  }
});

app.put('/api/transactions/:id', authenticateToken, requirePermission('manageTransactions'), validateTransaction, async (req, res) => {
  try {
    const oldTx = await Transaction.findById(req.params.id);
    if (!oldTx) return res.status(404).json({ success: false, message: 'Không tìm thấy giao dịch' });

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

    const numAmount = Number(amount);

    // Hoàn tác số dư cũ nguyên tử bằng $inc
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

    // BUG 3 (Financial Isolation): Thấu chi nội bộ khi cập nhật giao dịch
    const resolvedHubRole = hubRole || oldTx.hubRole || 'hub4_personal';
    let usingSupplierFloat = false;
    if (type === 'expense' && resolvedHubRole === 'hub1_income') {
      usingSupplierFloat = await isUsingSupplierFloat(numAmount, resolvedHubRole);
    }

    // BUG 4: impactsWeeklyLimit chỉ áp dụng cho Hub 4 (Cá nhân)
    const safeImpactsWeeklyLimit = (resolvedHubRole === 'hub4_personal')
      ? (impactsWeeklyLimit !== undefined ? Boolean(impactsWeeklyLimit) : (type === 'expense'))
      : false;

    oldTx.date = date || oldTx.date;
    oldTx.title = title.trim();
    oldTx.amount = numAmount;
    oldTx.type = type;
    oldTx.accountName = accountName;
    oldTx.toAccountName = toAccountName || '';
    oldTx.category = category;
    oldTx.hubRole = resolvedHubRole;
    oldTx.impactsWeeklyLimit = safeImpactsWeeklyLimit;
    oldTx.usingSupplierFloat = usingSupplierFloat;
    oldTx.notes = notes || '';

    await oldTx.save();

    // Áp dụng số dư mới nguyên tử bằng $inc
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
    res.status(err.statusCode || 400).json({ success: false, message: err.message });
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

app.post('/api/supplier-debts', authenticateToken, requirePermission('manageDebts'), validateSupplierDebt, async (req, res) => {
  try {
    const { supplierName, remainingAmount, totalAmount, paidAmount, phone, bankInfo, notes, dueDate } = req.body;
    if (!supplierName || !supplierName.trim()) {
      return res.status(400).json({ success: false, message: 'Vui lòng nhập tên nhà cung cấp' });
    }
    const sName = supplierName.trim();
    const sKey = normalizeKey(sName);
    const addAmt = Number(remainingAmount) || 0;
    const parsedDueDate = dueDate ? new Date(dueDate) : null;

    let sup = await SupplierDebt.findOne({
      $or: [
        { supplierKey: sKey },
        { supplierName: { $regex: new RegExp(`^${escapeRegex(sName)}$`, 'i') } }
      ]
    });

    if (sup) {
      sup.remainingAmount = (sup.remainingAmount || 0) + addAmt;
      if (totalAmount !== undefined) sup.totalAmount = (sup.totalAmount || 0) + (Number(totalAmount) || addAmt);
      if (paidAmount !== undefined) sup.paidAmount = (sup.paidAmount || 0) + (Number(paidAmount) || 0);
      if (phone !== undefined) sup.phone = phone;
      if (bankInfo !== undefined) sup.bankInfo = bankInfo;
      if (notes !== undefined) sup.notes = notes;
      if (dueDate !== undefined) sup.dueDate = parsedDueDate;
      sup.supplierKey = sKey;
      await sup.save();
    } else {
      sup = await SupplierDebt.create({
        supplierName: sName,
        supplierKey: sKey,
        totalAmount: totalAmount !== undefined ? Number(totalAmount) : addAmt,
        paidAmount: paidAmount !== undefined ? Number(paidAmount) : 0,
        remainingAmount: addAmt,
        dueDate: parsedDueDate,
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

app.put('/api/supplier-debts/:id', authenticateToken, requirePermission('manageDebts'), validateSupplierDebt, async (req, res) => {
  try {
    const { supplierName, remainingAmount, totalAmount, paidAmount, phone, bankInfo, notes, dueDate } = req.body;
    const sup = await SupplierDebt.findById(req.params.id);
    if (!sup) return res.status(404).json({ success: false, message: 'Không tìm thấy NCC' });

    if (supplierName) {
      sup.supplierName = supplierName.trim();
      sup.supplierKey = normalizeKey(supplierName);
    }
    if (totalAmount !== undefined) sup.totalAmount = Math.max(0, Number(totalAmount));
    if (paidAmount !== undefined) sup.paidAmount = Math.max(0, Number(paidAmount));
    if (remainingAmount !== undefined) {
      sup.remainingAmount = Math.max(0, Number(remainingAmount));
      if (totalAmount === undefined) {
        sup.totalAmount = sup.remainingAmount + (sup.paidAmount || 0);
      }
    }
    if (phone !== undefined) sup.phone = phone;
    if (bankInfo !== undefined) sup.bankInfo = bankInfo;
    if (notes !== undefined) sup.notes = notes;
    if (dueDate !== undefined) sup.dueDate = dueDate ? new Date(dueDate) : null;

    await sup.save();
    res.json({ success: true, supplier: sup });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

app.post('/api/supplier-debts/:id/pay', authenticateToken, requirePermission('manageDebts'), async (req, res) => {
  try {
    const { amount, accountName, deductFromAccount = true, date, note } = req.body;
    const payAmt = Number(amount);
    const sup = await SupplierDebt.findById(req.params.id);
    if (!sup) return res.status(404).json({ success: false, message: 'Không tìm thấy NCC' });

    const actualPaid = (!payAmt || payAmt >= sup.remainingAmount) ? sup.remainingAmount : Math.max(0, payAmt);
    if (actualPaid <= 0) {
      return res.status(400).json({ success: false, message: 'Số tiền trả nợ phải lớn hơn 0đ' });
    }

    const payDate = date || new Date().toISOString().slice(0, 10);
    const cleanAcc = (accountName || '').trim();
    const shouldDeduct = deductFromAccount !== false && Boolean(cleanAcc);

    if (!payAmt || payAmt >= sup.remainingAmount) {
      sup.remainingAmount = 0;
    } else {
      sup.remainingAmount = Math.max(0, sup.remainingAmount - payAmt);
    }
    sup.paidAmount = (sup.paidAmount || 0) + actualPaid;

    let createdTx = null;
    if (shouldDeduct && actualPaid > 0) {
      const updatedAcc = await adjustAccountBalance(cleanAcc, -actualPaid);
      const accHubRole = updatedAcc?.hubRole || 'hub1_income';
      createdTx = await Transaction.create({
        date: payDate,
        title: `Thanh toán nợ NCC: ${sup.supplierName}`,
        amount: actualPaid,
        type: 'expense',
        accountName: cleanAcc,
        category: 'Trả vốn NCC',
        hubRole: accHubRole,
        impactsWeeklyLimit: false,
        notes: note ? `${note} • [Đồng bộ Hũ Nợ NCC]` : '[Đồng bộ Hũ Nợ NCC]'
      });
    }

    const appliedToOrders = sup.remainingAmount === 0;
    if (appliedToOrders) {
      await ServiceOrder.updateMany(
        { supplierKey: sup.supplierKey, supplierPaid: { $ne: true } },
        {
          $set: {
            supplierPaid: true,
            supplierPaymentStatus: 'completed',
            supplierRemainingAmount: 0,
            supplierPaidDate: payDate,
            ...(cleanAcc ? { supplierPaidAccount: cleanAcc } : {})
          }
        }
      );
      if (Array.isArray(sup.paymentHistory)) {
        sup.paymentHistory.forEach(p => { p.appliedToOrders = true; });
      }
    }

    if (!Array.isArray(sup.paymentHistory)) sup.paymentHistory = [];
    sup.paymentHistory.push({
      amount: actualPaid,
      date: payDate,
      accountName: shouldDeduct ? cleanAcc : '',
      deductFromAccount: shouldDeduct,
      appliedToOrders,
      note: note || '',
      transactionId: createdTx ? createdTx._id : null
    });

    await sup.save();

    res.json({ success: true, supplier: sup, transaction: createdTx, message: 'Đã thanh toán cho NCC' });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

// Cập nhật tài khoản ngân hàng / đồng bộ Sổ Giao Dịch cho 1 lần trả nợ NCC trong lịch sử
app.put('/api/supplier-debts/:id/payments/:paymentId', authenticateToken, requirePermission('manageDebts'), async (req, res) => {
  try {
    const { accountName, deductFromAccount = true, date, note } = req.body;
    const sup = await SupplierDebt.findById(req.params.id);
    if (!sup) return res.status(404).json({ success: false, message: 'Không tìm thấy NCC' });

    const payment = (sup.paymentHistory || []).id(req.params.paymentId);
    if (!payment) return res.status(404).json({ success: false, message: 'Không tìm thấy bản ghi trả nợ' });

    // Nếu trước đó đã trừ tiền tài khoản cũ, hoàn tác trước
    if (payment.deductFromAccount && payment.accountName) {
      await adjustAccountBalance(payment.accountName, payment.amount);
    }
    if (payment.transactionId) {
      await Transaction.findByIdAndDelete(payment.transactionId);
      payment.transactionId = null;
    }

    const cleanAcc = (accountName || '').trim();
    const shouldDeduct = deductFromAccount !== false && Boolean(cleanAcc);
    if (date) payment.date = date;
    if (note !== undefined) payment.note = note;

    let createdTx = null;
    if (shouldDeduct && payment.amount > 0) {
      const updatedAcc = await adjustAccountBalance(cleanAcc, -payment.amount);
      const accHubRole = updatedAcc?.hubRole || 'hub1_income';
      createdTx = await Transaction.create({
        date: payment.date || new Date().toISOString().slice(0, 10),
        title: `Thanh toán nợ NCC: ${sup.supplierName}`,
        amount: payment.amount,
        type: 'expense',
        accountName: cleanAcc,
        category: 'Trả vốn NCC',
        hubRole: accHubRole,
        impactsWeeklyLimit: false,
        notes: payment.note ? `${payment.note} • [Đồng bộ Hũ Nợ NCC]` : '[Đồng bộ Hũ Nợ NCC]'
      });
      payment.accountName = cleanAcc;
      payment.deductFromAccount = true;
      payment.transactionId = createdTx._id;
      if (payment.note && payment.note.includes('bấm "Chọn Ngân Hàng"')) {
        payment.note = '';
      }
    } else {
      payment.accountName = '';
      payment.deductFromAccount = false;
    }

    await sup.save();
    res.json({ success: true, supplier: sup, transaction: createdTx, message: 'Đã cập nhật nguồn tiền trả nợ NCC' });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

// Xóa / Hoàn tác 1 lần trả nợ NCC trong lịch sử
app.delete('/api/supplier-debts/:id/payments/:paymentId', authenticateToken, requirePermission('manageDebts'), async (req, res) => {
  try {
    const sup = await SupplierDebt.findById(req.params.id);
    if (!sup) return res.status(404).json({ success: false, message: 'Không tìm thấy NCC' });

    const payment = (sup.paymentHistory || []).id(req.params.paymentId);
    if (!payment) return res.status(404).json({ success: false, message: 'Không tìm thấy bản ghi trả nợ' });

    const payAmt = Number(payment.amount) || 0;

    if (payment.deductFromAccount && payment.accountName && payAmt > 0) {
      await adjustAccountBalance(payment.accountName, payAmt);
    }
    if (payment.transactionId) {
      await Transaction.findByIdAndDelete(payment.transactionId);
    }

    sup.paidAmount = Math.max(0, (sup.paidAmount || 0) - payAmt);
    sup.remainingAmount = Math.max(0, (sup.remainingAmount || 0) + payAmt);
    sup.paymentHistory.pull({ _id: payment._id });

    await sup.save();
    res.json({ success: true, supplier: sup, message: 'Đã hoàn tác khoản trả nợ NCC' });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

app.post('/api/supplier-debts/batch-pay-all', authenticateToken, requirePermission('manageDebts'), async (req, res) => {
  try {
    const { accountName, deductFromAccount = true, date, note } = req.body || {};
    const payDate = date || new Date().toISOString().slice(0, 10);
    const cleanAcc = (accountName || '').trim();
    const shouldDeduct = deductFromAccount !== false && Boolean(cleanAcc);

    const activeSuppliers = await SupplierDebt.find({ remainingAmount: { $gt: 0 } });
    for (const sup of activeSuppliers) {
      const payAmt = sup.remainingAmount || 0;
      if (payAmt <= 0) continue;

      let createdTx = null;
      if (shouldDeduct) {
        const updatedAcc = await adjustAccountBalance(cleanAcc, -payAmt);
        const accHubRole = updatedAcc?.hubRole || 'hub1_income';
        createdTx = await Transaction.create({
          date: payDate,
          title: `Thanh toán nợ NCC: ${sup.supplierName}`,
          amount: payAmt,
          type: 'expense',
          accountName: cleanAcc,
          category: 'Trả vốn NCC',
          hubRole: accHubRole,
          impactsWeeklyLimit: false,
          notes: note ? `${note} • [Tất toán gom toàn bộ NCC]` : '[Tất toán gom toàn bộ NCC]'
        });
      }

      sup.paidAmount = (sup.paidAmount || 0) + payAmt;
      sup.remainingAmount = 0;
      sup.status = 'completed';
      if (!Array.isArray(sup.paymentHistory)) sup.paymentHistory = [];
      sup.paymentHistory.forEach(p => { p.appliedToOrders = true; });
      sup.paymentHistory.push({
        amount: payAmt,
        date: payDate,
        accountName: shouldDeduct ? cleanAcc : '',
        deductFromAccount: shouldDeduct,
        appliedToOrders: true,
        note: note || 'Tất toán gom toàn bộ NCC',
        transactionId: createdTx ? createdTx._id : null
      });
      await sup.save();
    }

    await ServiceOrder.updateMany(
      { supplierPaid: { $ne: true } },
      {
        $set: {
          supplierPaid: true,
          supplierPaymentStatus: 'completed',
          supplierRemainingAmount: 0,
          supplierPaidDate: payDate,
          ...(cleanAcc ? { supplierPaidAccount: cleanAcc } : {})
        }
      }
    );
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

// ==================== TỔNG HỢP & DỰ BÁO SỨC KHỎE TÀI CHÍNH (UNIFIED PROJECTION HEALTH ENGINE) ====================
// BUG 1 & BUG 2: Đồng bộ hóa 100% giữa phương trình dự báo (operands) và số tổng (totalHealth)
// Không để Frontend tự tính nhẩm làm lệch số. Hỗ trợ các bộ lọc thời gian: 'all', '7days', '30days'.
async function calculateProjectionHealth(range = 'all', customStart = null, customEnd = null) {
  const [
    accounts,
    supplierDebts,
    diningBills,
    diningMembers,
    diningSettlements,
    upcomingTransactions
  ] = await Promise.all([
    Account.find().lean(),
    SupplierDebt.find().lean(),
    DiningLedger.find().lean(),
    DiningMember.find().lean(),
    DiningSettlement.find().lean(),
    UpcomingTransaction.find().sort({ date: 1, createdAt: 1 }).lean()
  ]);

  // 1. Tiền mặt thực tế (Tổng số dư tất cả tài khoản ngân hàng & tiền mặt)
  const totalPhysicalCash = accounts.reduce((sum, a) => sum + (Number(a.balance) || 0), 0);

  // Phân bổ số dư cho 4 Hubs
  const hubs = {
    hub1_income: { title: 'Hub 1: Thu Nhập & Kinh Doanh', balance: 0 },
    hub2_dining: { title: 'Hub 2: Quỹ Ứng Tiền Ăn Nhóm', balance: 0 },
    hub3_family: { title: 'Hub 3: Quỹ Gia Đình (6 người)', balance: 0 },
    hub4_personal: { title: 'Hub 4: Chi Tiêu Cá Nhân & Tiết Kiệm', balance: 0 }
  };
  accounts.forEach(acc => {
    const role = acc.hubRole && hubs[acc.hubRole] ? acc.hubRole : 'hub1_income';
    hubs[role].balance += (Number(acc.balance) || 0);
  });

  // 2. Hũ tiền hàng nợ Nhà Cung Cấp
  const totalAllSupplierDebt = supplierDebts.reduce((sum, s) => sum + (Number(s.remainingAmount) || 0), 0);

  // 3. Sổ quỹ ăn nhóm & gia đình
  const combinedStats = calculateDiningGroup(diningBills, diningSettlements, diningMembers);
  const totalDebtReceivable = combinedStats.totalDebtReceivable || 0;
  const badDebtReceivable = combinedStats.totalBadDebtReceivable || 0;
  const collectibleDebtReceivable = combinedStats.totalCollectibleDebtReceivable || 0;
  const diningPayable = combinedStats.totalSurplusFund || 0;

  // 4. Xác định mốc thời gian theo múi giờ Việt Nam (Asia/Ho_Chi_Minh)
  const now = new Date();
  const vnDateStr = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' }).format(now);
  let minDateStr = vnDateStr;
  let maxDateStr = null;

  if (range === '7days') {
    const [y, m, d] = vnDateStr.split('-').map(Number);
    const d7 = new Date(Date.UTC(y, m - 1, d + 7));
    maxDateStr = d7.toISOString().slice(0, 10);
  } else if (range === '30days') {
    const [y, m, d] = vnDateStr.split('-').map(Number);
    const d30 = new Date(Date.UTC(y, m - 1, d + 30));
    maxDateStr = d30.toISOString().slice(0, 10);
  } else if (range === 'custom') {
    minDateStr = customStart || vnDateStr;
    maxDateStr = customEnd || null;
  }

  // Mặc định dueDate nếu trống: Ngày cuối cùng của tháng hiện tại (theo giờ VN/local) dạng YYYY-MM-DD
  const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  const defaultEndOfMonthStr = `${endOfMonth.getFullYear()}-${String(endOfMonth.getMonth() + 1).padStart(2, '0')}-${String(endOfMonth.getDate()).padStart(2, '0')}`;

  const getSupplierDueDateStr = (sup) => {
    if (sup.dueDate) {
      try {
        return new Date(sup.dueDate).toISOString().slice(0, 10);
      } catch (e) {
        return defaultEndOfMonthStr;
      }
    }
    return defaultEndOfMonthStr;
  };

  // TÍNH NĂNG: Lọc nợ NCC theo đúng ngày đến hạn (dueDate):
  // Chỉ trừ các khoản nợ NCC đến hạn trong khung thời gian lọc (dueDate <= maxDateStr, hoặc toàn bộ nếu không giới hạn ngày).
  const dueSupplierDebts = supplierDebts.filter(sup => {
    const rem = Number(sup.remainingAmount) || 0;
    if (rem <= 0) return false;
    if (!maxDateStr) return true;
    const dueStr = getSupplierDueDateStr(sup);
    return dueStr <= maxDateStr;
  });

  const dueSupplierDebt = dueSupplierDebts.reduce((sum, s) => sum + (Number(s.remainingAmount) || 0), 0);
  const futureSupplierDebt = Math.max(0, totalAllSupplierDebt - dueSupplierDebt);

  // TÍNH NĂNG: Đánh dấu nợ dài hạn / khó đòi cho Quỹ ăn nợ tôi (Hub 2)
  // Trong filter 7 ngày, 30 ngày hoặc custom <= 30 ngày: loại trừ (trừ ra) các khoản nợ dài hạn/khó đòi khỏi phương trình thanh khoản ngắn hạn!
  let isShortTermFilter = (range === '7days' || range === '30days');
  if (range === 'custom' && maxDateStr) {
    const endD = new Date(maxDateStr);
    const startD = new Date(minDateStr);
    const diffDays = Math.round((endD - startD) / (1000 * 60 * 60 * 24));
    if (diffDays >= 0 && diffDays <= 30) {
      isShortTermFilter = true;
    }
  }
  const diningReceivable = isShortTermFilter ? collectibleDebtReceivable : totalDebtReceivable;
  const badDebtExcluded = isShortTermFilter ? badDebtReceivable : 0;

  // Lọc các khoản dự kiến trong khung thời gian yêu cầu
  let rangeUpcoming = upcomingTransactions;
  if (range === 'custom') {
    rangeUpcoming = rangeUpcoming.filter(it => {
      if (minDateStr && it.date < minDateStr) return false;
      if (maxDateStr && it.date > maxDateStr) return false;
      return true;
    });
  } else if (maxDateStr) {
    rangeUpcoming = rangeUpcoming.filter(it => it.date >= vnDateStr && it.date <= maxDateStr);
  }

  // 5. Tính toán các khoản Dự Thu / Dự Chi
  const upcomingIncome = rangeUpcoming
    .filter(it => it.type === 'income')
    .reduce((sum, it) => sum + (Number(it.amount) || 0), 0);

  const upcomingExpense = rangeUpcoming
    .filter(it => it.type === 'expense')
    .reduce((sum, it) => sum + (Number(it.amount) || 0), 0);

  // 6. CÔNG THỨC CHUẨN KẾ TOÁN HỆ THỐNG:
  // [Sức khỏe tài chính tổng thể] = [Tiền mặt thực tế] - [Nợ NCC đến hạn] + [Quỹ ăn nợ tôi] - [Dư quỹ ăn (tôi nợ)] + [Tổng Dự Thu] - [Tổng Dự Chi]
  const totalHealth = safeMath.subtract(
    safeMath.add(
      safeMath.subtract(
        safeMath.add(
          safeMath.subtract(totalPhysicalCash, dueSupplierDebt),
          diningReceivable
        ),
        diningPayable
      ),
      upcomingIncome
    ),
    upcomingExpense
  );

  // 7. Mô phỏng timeline để tìm ngày xuất hiện thiếu hụt thanh khoản sớm nhất (Running balance)
  const sortedItems = [...rangeUpcoming].sort((a, b) => (a.date || '').localeCompare(b.date || ''));
  const baseBalance = totalPhysicalCash - dueSupplierDebt + diningReceivable - diningPayable;
  let runningBalance = baseBalance;
  let earliestDeficitDate = null;
  let earliestDeficitAmount = 0;

  for (const it of sortedItems) {
    if (it.type === 'income') {
      runningBalance += (Number(it.amount) || 0);
    } else {
      runningBalance -= (Number(it.amount) || 0);
    }
    if (runningBalance < 0 && !earliestDeficitDate) {
      earliestDeficitDate = it.date;
      earliestDeficitAmount = runningBalance;
    }
  }

  if (totalHealth < 0 && !earliestDeficitDate) {
    earliestDeficitDate = sortedItems.length > 0 ? sortedItems[sortedItems.length - 1].date : vnDateStr;
    earliestDeficitAmount = totalHealth;
  }

  // 8. Mô phỏng thanh khoản cho từng Hub trong khung thời gian đã chọn
  const hubRoles = ['hub1_income', 'hub2_dining', 'hub3_family', 'hub4_personal'];
  const hubResults = {};
  const alerts = [];

  const hubNames = {
    hub1_income: 'Hub 1: Thu Nhập & Kinh Doanh',
    hub2_dining: 'Hub 2: Quỹ Ứng Ăn Nhóm',
    hub3_family: 'Hub 3: Quỹ Gia Đình (6 người)',
    hub4_personal: 'Hub 4: Cá Nhân & Tiết Kiệm'
  };

  hubRoles.forEach(role => {
    // Với Hub 1: Bắt đầu từ số dư đã trừ nợ NCC đến hạn trong kỳ để phản ánh tiền thực khả dụng
    const rawCash = hubs[role].balance || 0;
    const supDebt = (role === 'hub1_income') ? dueSupplierDebt : 0;
    const curBal = (role === 'hub1_income') ? (rawCash - supDebt) : rawCash;
    const hItems = sortedItems.filter(it => it.hubRole === role);
    const inc = hItems.filter(it => it.type === 'income').reduce((s, it) => s + (Number(it.amount) || 0), 0);
    const exp = hItems.filter(it => it.type === 'expense').reduce((s, it) => s + (Number(it.amount) || 0), 0);
    const projBal = curBal + inc - exp;

    let rBal = curBal;
    let hEarliestDate = null;
    let hEarliestAmt = 0;

    for (const it of hItems) {
      if (it.type === 'income') rBal += (Number(it.amount) || 0);
      else rBal -= (Number(it.amount) || 0);

      if (rBal < 0 && !hEarliestDate) {
        hEarliestDate = it.date;
        hEarliestAmt = rBal;
      }
    }

    if (projBal < 0 && !hEarliestDate) {
      hEarliestDate = hItems.length > 0 ? hItems[hItems.length - 1].date : vnDateStr;
      hEarliestAmt = projBal;
    }

    const isDeficit = (projBal < 0) || (hEarliestDate !== null);

    hubResults[role] = {
      hubRole: role,
      hubName: hubNames[role],
      rawCash,
      supplierDebt: supDebt,
      currentBalance: curBal,
      totalIncome: inc,
      totalExpense: exp,
      projectedBalance: projBal,
      isDeficit,
      earliestDeficitDate: hEarliestDate,
      earliestDeficitAmount: hEarliestAmt,
      itemCount: hItems.length
    };

    if (isDeficit) {
      alerts.push({
        hubRole: role,
        hubName: hubNames[role],
        currentBalance: curBal,
        projectedBalance: projBal,
        earliestDeficitDate: hEarliestDate || (sortedItems.length > 0 ? sortedItems[0].date : vnDateStr),
        earliestDeficitAmount: hEarliestAmt || projBal
      });
    }
  });

  const isTotalDeficit = (totalHealth < 0) || (earliestDeficitDate !== null);

  let rangeLabel = 'Toàn bộ thời gian';
  if (range === '7days') rangeLabel = '7 ngày tới';
  else if (range === '30days') rangeLabel = '30 ngày tới';
  else if (range === 'custom') {
    const formatVn = (s) => {
      const m = String(s).match(/^(\d{4})-(\d{2})-(\d{2})/);
      return m ? `${m[3]}/${m[2]}/${m[1]}` : s;
    };
    rangeLabel = `${formatVn(minDateStr)} ➔ ${maxDateStr ? formatVn(maxDateStr) : 'nay'}`;
  }

  return {
    range,
    rangeLabel,
    startDate: minDateStr,
    endDate: maxDateStr,
    operands: {
      actualCash: totalPhysicalCash,
      supplierDebt: dueSupplierDebt,
      totalAllSupplierDebt,
      futureSupplierDebt,
      diningReceivable,
      diningPayable,
      upcomingIncome,
      upcomingExpense,
      badDebtExcluded,
      totalDebtReceivable,
      collectibleDebtReceivable,
      badDebtReceivable,
      badDebtCount: combinedStats.badDebtCount || 0
    },
    totalHealth,
    projectedBalance: totalHealth,
    isDeficit: isTotalDeficit,
    earliestDeficitDate,
    earliestDeficitAmount,
    hubs: hubResults,
    alerts
  };
}

// Endpoint trả về kết quả Sức khỏe tài chính tổng thể + Operands đồng bộ cho Frontend
app.get('/api/projection-health', authenticateToken, async (req, res) => {
  try {
    const range = req.query.range || 'all';
    const startDate = req.query.startDate;
    const endDate = req.query.endDate;
    const health = await calculateProjectionHealth(range, startDate, endDate);
    res.json({ success: true, ...health });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ==================== DỰ BÁO DÒNG TIỀN TƯƠNG LAI (CASH FLOW PROJECTION) ====================
// Collection 'upcoming_transactions' tách biệt 100%, không can thiệp hay merge với sổ giao dịch thực tế
app.get('/api/upcoming', authenticateToken, async (req, res) => {
  try {
    const upcoming = await UpcomingTransaction.find().sort({ date: 1, createdAt: 1 }).lean();

    // Accounts Payable Aging: Query các bản ghi SupplierDebt có trạng thái pending hoặc partial (còn nợ NCC)
    const supplierDebts = await SupplierDebt.find({
      $or: [
        { status: { $in: ['pending', 'partial'] } },
        { remainingAmount: { $gt: 0 } }
      ]
    }).lean();

    // Mặc định dueDate nếu trống: Ngày cuối cùng của tháng hiện tại (theo giờ VN/local) dạng YYYY-MM-DD
    const now = new Date();
    const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0);
    const defaultEndOfMonthStr = `${endOfMonth.getFullYear()}-${String(endOfMonth.getMonth() + 1).padStart(2, '0')}-${String(endOfMonth.getDate()).padStart(2, '0')}`;

    // Ánh xạ nợ NCC sang danh sách "Dự Chi" (Cash Outflow) theo dueDate
    const supplierOutflowItems = supplierDebts
      .filter(sup => (Number(sup.remainingAmount) || 0) > 0)
      .map(sup => {
        let dateStr = defaultEndOfMonthStr;
        if (sup.dueDate) {
          try {
            dateStr = new Date(sup.dueDate).toISOString().slice(0, 10);
          } catch (e) {
            dateStr = defaultEndOfMonthStr;
          }
        }

        return {
          _id: 'supplier_debt_' + sup._id,
          supplierDebtId: sup._id,
          title: `Trả nợ NCC: ${sup.supplierName}`,
          amount: Number(sup.remainingAmount) || 0,
          type: 'expense',
          hubRole: 'hub1_income', // Nợ NCC được phân bổ cho Hub 1: Kinh doanh
          date: dateStr,
          dueDate: sup.dueDate || null,
          notes: sup.notes ? `[Hạn nợ NCC] ${sup.notes}` : `[Hạn nợ NCC: ${dateStr}]`,
          source: 'supplier_debt',
          isSupplierDebt: true,
          status: sup.status || 'pending',
          createdAt: sup.createdAt || new Date()
        };
      });

    // Kết hợp và sắp xếp theo ngày tăng dần
    const combined = [...upcoming, ...supplierOutflowItems].sort((a, b) => {
      const cmp = (a.date || '').localeCompare(b.date || '');
      if (cmp !== 0) return cmp;
      return new Date(a.createdAt || 0) - new Date(b.createdAt || 0);
    });

    res.json({ success: true, upcoming: combined });
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

app.put('/api/upcoming/:id', authenticateToken, requirePermission('manageTransactions'), async (req, res) => {
  try {
    if (String(req.params.id).startsWith('supplier_debt_')) {
      return res.status(400).json({
        success: false,
        message: 'Khoản nợ NCC này được đồng bộ từ Hũ Tiền Hàng NCC. Vui lòng chỉnh sửa trực tiếp tại mục Hũ Tiền Hàng Nợ Từng NCC!'
      });
    }

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

    const item = await UpcomingTransaction.findByIdAndUpdate(
      req.params.id,
      {
        title: title.trim(),
        amount: numAmount,
        type: chosenType,
        date: String(date).trim(),
        hubRole: chosenHub,
        notes: notes !== undefined ? String(notes).trim() : ''
      },
      { new: true, runValidators: true }
    );

    if (!item) {
      return res.status(404).json({ success: false, message: 'Không tìm thấy khoản dự kiến để cập nhật' });
    }

    res.json({ success: true, item });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

app.delete('/api/upcoming/:id', authenticateToken, requirePermission('manageTransactions'), async (req, res) => {
  try {
    if (String(req.params.id).startsWith('supplier_debt_')) {
      return res.status(400).json({
        success: false,
        message: 'Khoản nợ NCC này được liên kết tự động từ Danh mục Nhà cung cấp theo ngày đến hạn (dueDate). Vui lòng thanh toán hoặc cập nhật tại mục Quản lý NCC!'
      });
    }
    const item = await UpcomingTransaction.findByIdAndDelete(req.params.id);
    if (!item) {
      return res.status(404).json({ success: false, message: 'Không tìm thấy khoản dự kiến' });
    }
    res.json({ success: true, message: 'Đã hoàn tất / Xóa khoản dự kiến thành công' });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

// ==================== 4. SỔ NỢ 2 CHIỀU (CRUD & ĐỒNG BỘ SỐ DƯ NGÂN HÀNG) ====================
async function applyDebtSettlementState(debt, { targetStatus, accountName, syncToAccount = true, dateStr } = {}) {
  const nextPaid = targetStatus === 'paid';
  const wasPaid = debt.status === 'paid';
  const targetAcc = (accountName || debt.settledAccount || 'Vietcombank').trim();
  const amt = Math.max(0, Number(debt.amount) || 0);
  const txDate = dateStr || debt.paidDate || new Date().toISOString().slice(0, 10);
  const isReceivable = debt.type === 'receivable'; // receivable: Bạn nợ tôi (+), payable: Tôi nợ bạn (-)

  if (nextPaid) {
    // Nếu trước đó đã từng đồng bộ tài khoản, hoàn tác giao dịch cũ trước khi ghi nhận mới (tránh trùng lặp khi sửa)
    if (debt.accountSynced) {
      if (debt.transactionId) {
        const oldTx = await Transaction.findById(debt.transactionId);
        if (oldTx) {
          await adjustAccountBalance(oldTx.accountName, oldTx.type === 'income' ? -oldTx.amount : oldTx.amount);
          await Transaction.findByIdAndDelete(oldTx._id);
        }
      } else if (amt > 0) {
        await adjustAccountBalance(debt.settledAccount || 'Vietcombank', isReceivable ? -amt : amt);
      }
      debt.accountSynced = false;
      debt.transactionId = null;
    }

    if (syncToAccount && amt > 0) {
      const delta = isReceivable ? amt : -amt;
      const updatedAcc = await adjustAccountBalance(targetAcc, delta);
      const accHubRole = updatedAcc?.hubRole || 'hub1_income';
      const tx = await Transaction.create({
        date: txDate,
        title: isReceivable
          ? `Thu nợ cá nhân: ${debt.personName}${debt.note ? ' (' + debt.note + ')' : ''}`
          : `Trả nợ cá nhân: ${debt.personName}${debt.note ? ' (' + debt.note + ')' : ''}`,
        amount: amt,
        type: isReceivable ? 'income' : 'expense',
        accountName: targetAcc,
        category: isReceivable ? 'Thu hồi nợ' : 'Trả nợ cá nhân',
        hubRole: accHubRole,
        impactsWeeklyLimit: false,
        notes: debt.note ? `${debt.note} • [Đồng bộ Sổ Nợ 2 Chiều]` : '[Đồng bộ Sổ Nợ 2 Chiều]'
      });
      debt.transactionId = tx._id;
      debt.accountSynced = true;
    }

    debt.status = 'paid';
    debt.settledAccount = targetAcc;
    debt.paidDate = txDate;
  } else {
    // Hoàn tác về Chờ trả (pending)
    if (debt.accountSynced) {
      if (debt.transactionId) {
        const oldTx = await Transaction.findById(debt.transactionId);
        if (oldTx) {
          if (syncToAccount !== false) {
            await adjustAccountBalance(oldTx.accountName, oldTx.type === 'income' ? -oldTx.amount : oldTx.amount);
          }
          await Transaction.findByIdAndDelete(oldTx._id);
        } else if (syncToAccount !== false && amt > 0) {
          await adjustAccountBalance(debt.settledAccount || 'Vietcombank', isReceivable ? -amt : amt);
        }
      } else if (syncToAccount !== false && amt > 0) {
        await adjustAccountBalance(debt.settledAccount || 'Vietcombank', isReceivable ? -amt : amt);
      }
      debt.accountSynced = false;
      debt.transactionId = null;
      debt.paidDate = '';
    }
    debt.status = 'pending';
    if (accountName) debt.settledAccount = targetAcc;
  }
}

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
    const { personName, amount, type, dueDate, note, status, settledAccount, syncToAccount, paidDate } = req.body;
    if (!personName || !personName.trim()) {
      return res.status(400).json({ success: false, message: 'Vui lòng nhập tên đối tượng nợ' });
    }
    const debt = new Debt({
      personName: personName.trim(),
      amount: Math.max(0, Number(amount) || 0),
      type: type || 'receivable',
      dueDate: dueDate || new Date().toISOString().slice(0, 10),
      settledAccount: settledAccount || 'Vietcombank',
      note: note || '',
      status: 'pending'
    });

    if (status === 'paid') {
      await applyDebtSettlementState(debt, {
        targetStatus: 'paid',
        accountName: settledAccount || 'Vietcombank',
        syncToAccount: syncToAccount !== false,
        dateStr: paidDate || dueDate || new Date().toISOString().slice(0, 10)
      });
    }

    await debt.save();
    res.json({ success: true, debt });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

app.put('/api/debts/:id', authenticateToken, requirePermission('manageDebts'), async (req, res) => {
  try {
    const { personName, amount, type, dueDate, note, status, settledAccount, syncToAccount, paidDate } = req.body;
    const debt = await Debt.findById(req.params.id);
    if (!debt) return res.status(404).json({ success: false, message: 'Không tìm thấy khoản nợ' });

    if (personName) debt.personName = personName.trim();
    if (amount !== undefined) debt.amount = Math.max(0, Number(amount) || 0);
    if (type) debt.type = type;
    if (dueDate) debt.dueDate = dueDate;
    if (note !== undefined) debt.note = note;

    const targetStatus = status || debt.status;
    await applyDebtSettlementState(debt, {
      targetStatus,
      accountName: settledAccount || debt.settledAccount || 'Vietcombank',
      syncToAccount: syncToAccount !== false,
      dateStr: paidDate || debt.paidDate || new Date().toISOString().slice(0, 10)
    });

    await debt.save();
    res.json({ success: true, debt });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

app.patch('/api/debts/:id/toggle-status', authenticateToken, requirePermission('manageDebts'), async (req, res) => {
  try {
    const debt = await Debt.findById(req.params.id);
    if (!debt) return res.status(404).json({ success: false, message: 'Không tìm thấy khoản nợ' });

    const { accountName, syncToAccount, date, status } = req.body || {};
    const targetStatus = status ? status : (debt.status === 'paid' ? 'pending' : 'paid');

    await applyDebtSettlementState(debt, {
      targetStatus,
      accountName: accountName || debt.settledAccount || 'Vietcombank',
      syncToAccount: syncToAccount !== false,
      dateStr: date || new Date().toISOString().slice(0, 10)
    });

    await debt.save();
    res.json({
      success: true,
      debt,
      message: debt.status === 'paid'
        ? `✓ Đã tất toán khoản nợ của ${debt.personName} (${debt.type === 'receivable' ? 'Cộng vào' : 'Trừ từ'} ${debt.settledAccount})!`
        : `↩️ Đã chuyển khoản nợ của ${debt.personName} về trạng thái Chờ trả!`
    });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

// Chuyển trạng thái hàng loạt cho Sổ Nợ 2 Chiều (kèm cộng/trừ tài khoản ngân hàng thực tế)
app.post('/api/debts/batch-settle', authenticateToken, requirePermission('manageDebts'), async (req, res) => {
  try {
    const { debtIds, action, accountName, syncToAccount, date } = req.body;
    if (!Array.isArray(debtIds) || debtIds.length === 0) {
      return res.status(400).json({ success: false, message: 'Vui lòng chọn ít nhất 1 khoản nợ' });
    }
    const targetStatus = action === 'pending' ? 'pending' : 'paid';
    const targetAcc = (accountName || 'Vietcombank').trim();
    const shouldSync = syncToAccount !== false;
    const txDate = date || new Date().toISOString().slice(0, 10);

    const debts = await Debt.find({ _id: { $in: debtIds } });
    let processedCount = 0;

    for (const debt of debts) {
      if (targetStatus === 'paid' && debt.status === 'paid') continue;
      if (targetStatus === 'pending' && debt.status === 'pending') continue;

      await applyDebtSettlementState(debt, {
        targetStatus,
        accountName: targetAcc,
        syncToAccount: shouldSync,
        dateStr: txDate
      });
      await debt.save();
      processedCount++;
    }

    res.json({
      success: true,
      processedCount,
      message: targetStatus === 'paid'
        ? `✓ Đã tất toán ${processedCount} khoản nợ qua tài khoản ${targetAcc}!`
        : `↩️ Đã chuyển ${processedCount} khoản nợ về trạng thái Chờ trả!`
    });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

app.delete('/api/debts/:id', authenticateToken, requirePermission('manageDebts'), async (req, res) => {
  try {
    const debt = await Debt.findById(req.params.id);
    if (!debt) return res.status(404).json({ success: false, message: 'Không tìm thấy khoản nợ' });

    // Nếu khoản nợ đã từng cộng/trừ vào tài khoản ngân hàng, hoàn tác trước khi xóa
    if (debt.status === 'paid' && debt.accountSynced) {
      await applyDebtSettlementState(debt, { targetStatus: 'pending', syncToAccount: true });
    }

    await Debt.findByIdAndDelete(req.params.id);
    res.json({ success: true, message: 'Đã xóa khoản nợ' });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

// ==================== 5. ĐƠN DỊCH VỤ / BÁN HÀNG CRUD (CÔNG NỢ KHÁCH & VỐN NCC) ====================
async function reconcileSupplierDebtFromOrders(supplierName, supplierKey, { allowZeroWhenNoOrders = false } = {}) {
  const sName = (supplierName || '').trim();
  const sKey = supplierKey || (sName ? normalizeKey(sName) : '');
  if (!sKey) return null;

  const orders = await ServiceOrder.find({
    $or: [
      { supplierKey: sKey },
      ...(sName ? [{ supplierName: { $regex: new RegExp(`^${escapeRegex(sName)}$`, 'i') } }] : [])
    ]
  }).lean();

  if (orders.length === 0 && !allowZeroWhenNoOrders) {
    return null;
  }

  const unpaidCost = orders
    .filter(o => !(o.supplierPaid === true || o.supplierPaymentStatus === 'completed'))
    .reduce((sum, o) => sum + Math.max(0, Number(o.costPrice) || 0), 0);

  const paidCost = orders
    .filter(o => o.supplierPaid === true || o.supplierPaymentStatus === 'completed')
    .reduce((sum, o) => sum + Math.max(0, Number(o.costPrice) || 0), 0);

  const totalCost = unpaidCost + paidCost;

  let sup = await SupplierDebt.findOne({
    $or: [
      { supplierKey: sKey },
      ...(sName ? [{ supplierName: { $regex: new RegExp(`^${escapeRegex(sName)}$`, 'i') } }] : [])
    ]
  });

  if (sup) {
    const unappliedDirectPaid = (sup.paymentHistory || [])
      .filter(p => !p.appliedToOrders)
      .reduce((sum, p) => sum + Math.max(0, Number(p.amount) || 0), 0);
    sup.supplierKey = sKey;
    if (sName && !sup.supplierName) sup.supplierName = sName;
    sup.paidAmount = paidCost + unappliedDirectPaid;
    sup.totalAmount = totalCost;
    sup.remainingAmount = Math.max(0, unpaidCost - unappliedDirectPaid);
    await sup.save();
    return sup;
  } else if (totalCost > 0) {
    sup = await SupplierDebt.create({
      supplierName: sName || sKey,
      supplierKey: sKey,
      totalAmount: totalCost,
      paidAmount: paidCost,
      remainingAmount: unpaidCost
    });
    return sup;
  }
  return null;
}

async function adjustSupplierDebtPot(supplierName, supplierKey, deltaAmount) {
  const delta = Number(deltaAmount) || 0;
  const sName = (supplierName || '').trim();
  const sKey = supplierKey || (sName ? normalizeKey(sName) : '');
  if (!sKey) return null;

  // Nếu NCC có đơn hàng lẻ trong ServiceOrder, tính chuẩn 100% từ danh sách đơn hàng lẻ
  const synced = await reconcileSupplierDebtFromOrders(sName, sKey);
  if (synced) return synced;
  if (delta === 0) return null;

  let sup = await SupplierDebt.findOne({
    $or: [
      { supplierKey: sKey },
      ...(sName ? [{ supplierName: { $regex: new RegExp(`^${escapeRegex(sName)}$`, 'i') } }] : [])
    ]
  });

  if (sup) {
    sup.remainingAmount = Math.max(0, (sup.remainingAmount || 0) + delta);
    sup.supplierKey = sKey;
    if (sName && !sup.supplierName) sup.supplierName = sName;
    await sup.save();
    return sup;
  } else if (delta > 0) {
    sup = await SupplierDebt.create({
      supplierName: sName || sKey,
      supplierKey: sKey,
      totalAmount: delta,
      remainingAmount: delta
    });
    return sup;
  }
  return null;
}

async function applyOrderCustomerPaymentState(order, { customerPaid, receivedAccount, syncToAccount = true, dateStr } = {}) {
  const nextPaid = Boolean(customerPaid);
  const targetAcc = (receivedAccount || order.receivedAccount || 'Vietcombank').trim();
  const saleAmt = Math.max(0, Number(order.salePrice) || 0);
  const txDate = dateStr || order.customerPaidDate || order.date || new Date().toISOString().slice(0, 10);

  if (nextPaid) {
    // Nếu trước đó đơn này đã cộng tiền vào ngân hàng, hoàn tác giao dịch cũ trước khi cập nhật lại
    if (order.customerAccountSynced) {
      if (order.customerTransactionId) {
        const oldTx = await Transaction.findById(order.customerTransactionId);
        if (oldTx) {
          await adjustAccountBalance(oldTx.accountName, -oldTx.amount);
          await Transaction.findByIdAndDelete(oldTx._id);
        }
      } else if (saleAmt > 0) {
        await adjustAccountBalance(order.receivedAccount || 'Vietcombank', -saleAmt);
      }
      order.customerAccountSynced = false;
      order.customerTransactionId = null;
    }

    if (syncToAccount && saleAmt > 0) {
      const updatedAcc = await adjustAccountBalance(targetAcc, saleAmt);
      const accHubRole = updatedAcc?.hubRole || 'hub1_income';
      const tx = await Transaction.create({
        date: txDate,
        title: `Thu tiền khách: ${order.customerName} (${order.serviceName || 'Bán dấu / Khắc dấu'})`,
        amount: saleAmt,
        type: 'income',
        accountName: targetAcc,
        category: 'Thu tiền đơn hàng',
        hubRole: accHubRole,
        impactsWeeklyLimit: false,
        notes: order.note ? `${order.note} • [Đồng bộ Sổ Đơn Hàng]` : '[Đồng bộ Sổ Đơn Hàng]'
      });
      order.customerTransactionId = tx._id;
      order.customerAccountSynced = true;
    }

    order.customerPaid = true;
    order.customerPaidAmount = saleAmt;
    order.customerRemainingAmount = 0;
    order.customerPaymentStatus = 'completed';
    order.receivedAccount = targetAcc;
    order.customerPaidDate = txDate;
  } else {
    // Hoàn tác về Chưa thu tiền (Khách nợ)
    if (order.customerAccountSynced) {
      if (order.customerTransactionId) {
        const oldTx = await Transaction.findById(order.customerTransactionId);
        if (oldTx) {
          if (syncToAccount !== false) {
            await adjustAccountBalance(oldTx.accountName, -oldTx.amount);
          }
          await Transaction.findByIdAndDelete(oldTx._id);
        } else if (syncToAccount !== false && saleAmt > 0) {
          await adjustAccountBalance(order.receivedAccount || 'Vietcombank', -saleAmt);
        }
      } else if (syncToAccount !== false && saleAmt > 0) {
        await adjustAccountBalance(order.receivedAccount || 'Vietcombank', -saleAmt);
      }
      order.customerAccountSynced = false;
      order.customerTransactionId = null;
      order.customerPaidDate = '';
    }

    order.customerPaid = false;
    order.customerPaidAmount = 0;
    order.customerRemainingAmount = saleAmt;
    order.customerPaymentStatus = 'pending';
    if (receivedAccount) order.receivedAccount = targetAcc;
  }
}

async function applyOrderSupplierPaymentState(order, { supplierPaid, supplierPaidAccount, syncToAccount = true, dateStr } = {}) {
  const nextPaid = Boolean(supplierPaid);
  const targetAcc = (supplierPaidAccount || order.supplierPaidAccount || order.receivedAccount || 'Vietcombank').trim();
  const costAmt = Math.max(0, Number(order.costPrice) || 0);
  const txDate = dateStr || order.supplierPaidDate || order.date || new Date().toISOString().slice(0, 10);

  if (nextPaid) {
    // Nếu trước đó đơn này đã trừ tiền khỏi ngân hàng, hoàn tác giao dịch cũ trước khi cập nhật lại
    if (order.supplierAccountSynced) {
      if (order.supplierTransactionId) {
        const oldTx = await Transaction.findById(order.supplierTransactionId);
        if (oldTx) {
          await adjustAccountBalance(oldTx.accountName, oldTx.amount);
          await Transaction.findByIdAndDelete(oldTx._id);
        }
      } else if (costAmt > 0) {
        await adjustAccountBalance(order.supplierPaidAccount || 'Vietcombank', costAmt);
      }
      order.supplierAccountSynced = false;
      order.supplierTransactionId = null;
    }

    if (syncToAccount && costAmt > 0) {
      const updatedAcc = await adjustAccountBalance(targetAcc, -costAmt);
      const accHubRole = updatedAcc?.hubRole || 'hub1_income';
      const tx = await Transaction.create({
        date: txDate,
        title: `Trả vốn NCC (${order.supplierName || 'Đối tác'}): Đơn ${order.customerName} (${order.serviceName || 'Bán dấu / Khắc dấu'})`,
        amount: costAmt,
        type: 'expense',
        accountName: targetAcc,
        category: 'Trả vốn NCC',
        hubRole: accHubRole,
        impactsWeeklyLimit: false,
        notes: order.note ? `${order.note} • [Đồng bộ Sổ Đơn Hàng]` : '[Đồng bộ Sổ Đơn Hàng]'
      });
      order.supplierTransactionId = tx._id;
      order.supplierAccountSynced = true;
    }

    order.supplierPaid = true;
    order.supplierPaidAmount = costAmt;
    order.supplierRemainingAmount = 0;
    order.supplierPaymentStatus = 'completed';
    order.supplierPaidAccount = targetAcc;
    order.supplierPaidDate = txDate;
  } else {
    // Hoàn tác về Chưa trả vốn (Nợ NCC)
    if (order.supplierAccountSynced) {
      if (order.supplierTransactionId) {
        const oldTx = await Transaction.findById(order.supplierTransactionId);
        if (oldTx) {
          if (syncToAccount !== false) {
            await adjustAccountBalance(oldTx.accountName, oldTx.amount);
          }
          await Transaction.findByIdAndDelete(oldTx._id);
        } else if (syncToAccount !== false && costAmt > 0) {
          await adjustAccountBalance(order.supplierPaidAccount || 'Vietcombank', costAmt);
        }
      } else if (syncToAccount !== false && costAmt > 0) {
        await adjustAccountBalance(order.supplierPaidAccount || 'Vietcombank', costAmt);
      }
      order.supplierAccountSynced = false;
      order.supplierTransactionId = null;
      order.supplierPaidDate = '';
    }

    order.supplierPaid = false;
    order.supplierPaidAmount = 0;
    order.supplierRemainingAmount = costAmt;
    order.supplierPaymentStatus = 'pending';
    if (supplierPaidAccount) order.supplierPaidAccount = targetAcc;
  }
}

app.post('/api/service-orders', authenticateToken, requireAnyPermission('manageDebts', 'manageTransactions'), async (req, res) => {
  try {
    const {
      customerName, serviceName, costPrice, salePrice,
      supplierName, customerPaid, supplierPaid,
      date, note, receivedAccount, supplierPaidAccount,
      syncCustomerAccount, syncSupplierAccount
    } = req.body;
    if (!customerName || !customerName.trim()) {
      return res.status(400).json({ success: false, message: 'Vui lòng nhập tên khách hàng' });
    }

    const sName = (supplierName || '').trim();
    const sKey = sName ? normalizeKey(sName) : '';
    const cPrice = Math.max(0, Number(costPrice) || 0);
    const sPrice = Math.max(0, Number(salePrice) || 0);
    const cPaid = Boolean(customerPaid);
    const sPaid = Boolean(supplierPaid);
    const orderDate = date || new Date().toISOString().slice(0, 10);

    const order = new ServiceOrder({
      customerName: customerName.trim(),
      serviceName: (serviceName || 'Bán dấu / Khắc dấu').trim(),
      costPrice: cPrice,
      salePrice: sPrice,
      supplierName: sName,
      supplierKey: sKey,
      receivedAccount: receivedAccount || 'Vietcombank',
      supplierPaidAccount: supplierPaidAccount || receivedAccount || 'Vietcombank',
      date: orderDate,
      note: (note || '').trim(),
      customerPaid: false,
      supplierPaid: false
    });

    if (cPaid) {
      await applyOrderCustomerPaymentState(order, {
        customerPaid: true,
        receivedAccount: receivedAccount || 'Vietcombank',
        syncToAccount: syncCustomerAccount !== false,
        dateStr: orderDate
      });
    }

    if (sPaid) {
      await applyOrderSupplierPaymentState(order, {
        supplierPaid: true,
        supplierPaidAccount: supplierPaidAccount || receivedAccount || 'Vietcombank',
        syncToAccount: syncSupplierAccount !== false,
        dateStr: orderDate
      });
    }

    await order.save();

    // Nếu chưa thanh toán cho NCC và có giá vốn > 0 -> tự động cộng vào Hũ tiền nợ NCC (gộp đúng NCC)
    if (!sPaid && cPrice > 0 && sKey) {
      await adjustSupplierDebtPot(sName, sKey, cPrice);
    }

    res.json({ success: true, order, message: 'Đã lưu đơn hàng thành công' });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

app.put('/api/service-orders/:id', authenticateToken, requireAnyPermission('manageDebts', 'manageTransactions'), async (req, res) => {
  try {
    const {
      customerName, serviceName, costPrice, salePrice,
      supplierName, customerPaid, supplierPaid,
      date, note, receivedAccount, supplierPaidAccount,
      syncCustomerAccount, syncSupplierAccount
    } = req.body;
    const oldOrder = await ServiceOrder.findById(req.params.id);
    if (!oldOrder) return res.status(404).json({ success: false, message: 'Không tìm thấy đơn hàng' });

    const newSName = (supplierName !== undefined ? supplierName : oldOrder.supplierName || '').trim();
    const newSKey = newSName ? normalizeKey(newSName) : '';
    const newCPrice = costPrice !== undefined ? Math.max(0, Number(costPrice) || 0) : oldOrder.costPrice;
    const newSPrice = salePrice !== undefined ? Math.max(0, Number(salePrice) || 0) : oldOrder.salePrice;
    const newCPaid = customerPaid !== undefined ? Boolean(customerPaid) : Boolean(oldOrder.customerPaid);
    const newSPaid = supplierPaid !== undefined ? Boolean(supplierPaid) : Boolean(oldOrder.supplierPaid);

    const prevSName = oldOrder.supplierName;
    const prevSKey = oldOrder.supplierKey || (prevSName ? normalizeKey(prevSName) : '');

    // Cập nhật thông tin cơ bản
    oldOrder.customerName = (customerName || oldOrder.customerName || '').trim();
    oldOrder.serviceName = (serviceName || oldOrder.serviceName || 'Bán dấu / Khắc dấu').trim();
    oldOrder.costPrice = newCPrice;
    oldOrder.salePrice = newSPrice;
    oldOrder.supplierName = newSName;
    oldOrder.supplierKey = newSKey;
    if (date) oldOrder.date = date;
    if (note !== undefined) oldOrder.note = (note || '').trim();

    await applyOrderCustomerPaymentState(oldOrder, {
      customerPaid: newCPaid,
      receivedAccount: receivedAccount || oldOrder.receivedAccount || 'Vietcombank',
      syncToAccount: syncCustomerAccount !== false,
      dateStr: oldOrder.date
    });

    await applyOrderSupplierPaymentState(oldOrder, {
      supplierPaid: newSPaid,
      supplierPaidAccount: supplierPaidAccount || oldOrder.supplierPaidAccount || receivedAccount || 'Vietcombank',
      syncToAccount: syncSupplierAccount !== false,
      dateStr: oldOrder.date
    });

    await oldOrder.save();

    if (prevSKey && prevSKey !== newSKey) {
      await reconcileSupplierDebtFromOrders(prevSName, prevSKey, { allowZeroWhenNoOrders: true });
    }
    if (newSKey) {
      await reconcileSupplierDebtFromOrders(newSName, newSKey);
    }

    res.json({ success: true, order: oldOrder, message: 'Đã cập nhật đơn hàng thành công' });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

// Chuyển đổi trạng thái: Khách đã trả / Chưa trả (kèm chọn tài khoản ngân hàng cộng tiền)
app.patch('/api/service-orders/:id/toggle-customer-paid', authenticateToken, requireAnyPermission('manageDebts', 'manageTransactions'), async (req, res) => {
  try {
    const order = await ServiceOrder.findById(req.params.id);
    if (!order) return res.status(404).json({ success: false, message: 'Không tìm thấy đơn hàng' });

    const { accountName, syncToAccount, date, customerPaid } = req.body || {};
    const nextCustomerPaid = customerPaid !== undefined ? Boolean(customerPaid) : !order.customerPaid;

    await applyOrderCustomerPaymentState(order, {
      customerPaid: nextCustomerPaid,
      receivedAccount: accountName || order.receivedAccount || 'Vietcombank',
      syncToAccount: syncToAccount !== false,
      dateStr: date || new Date().toISOString().slice(0, 10)
    });

    await order.save();
    res.json({
      success: true,
      order,
      message: order.customerPaid
        ? `✓ Đã thu ${order.salePrice.toLocaleString('vi-VN')}đ từ ${order.customerName} vào ${order.receivedAccount}!`
        : `↩️ Đã chuyển đơn của ${order.customerName} sang Chưa thu tiền!`
    });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

// Chuyển đổi trạng thái: Đã trả vốn NCC / Nợ NCC (kèm chọn tài khoản ngân hàng trừ tiền)
app.patch('/api/service-orders/:id/toggle-supplier-paid', authenticateToken, requireAnyPermission('manageDebts', 'manageTransactions'), async (req, res) => {
  try {
    const order = await ServiceOrder.findById(req.params.id);
    if (!order) return res.status(404).json({ success: false, message: 'Không tìm thấy đơn hàng' });

    const { accountName, syncToAccount, date, supplierPaid } = req.body || {};
    const wasSupplierPaid = Boolean(order.supplierPaid);
    const nextSupplierPaid = supplierPaid !== undefined ? Boolean(supplierPaid) : !wasSupplierPaid;
    const sKey = order.supplierKey || (order.supplierName ? normalizeKey(order.supplierName) : '');

    await applyOrderSupplierPaymentState(order, {
      supplierPaid: nextSupplierPaid,
      supplierPaidAccount: accountName || order.supplierPaidAccount || order.receivedAccount || 'Vietcombank',
      syncToAccount: syncToAccount !== false,
      dateStr: date || new Date().toISOString().slice(0, 10)
    });

    await order.save();

    if (sKey) {
      await reconcileSupplierDebtFromOrders(order.supplierName, sKey);
    }

    res.json({
      success: true,
      order,
      message: order.supplierPaid
        ? `✓ Đã trả vốn ${order.costPrice.toLocaleString('vi-VN')}đ cho ${order.supplierName || 'NCC'} từ ${order.supplierPaidAccount}!`
        : `↩️ Đã chuyển đơn của ${order.customerName} sang Chưa trả vốn NCC!`
    });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

// Chuyển trạng thái hàng loạt cho nhiều đơn hàng cùng lúc (Thu khách / Trả vốn NCC / Hoàn tác)
app.post('/api/service-orders/batch-settle', authenticateToken, requireAnyPermission('manageDebts', 'manageTransactions'), async (req, res) => {
  try {
    const {
      orderIds,
      action, // 'customer_paid' | 'customer_unpaid' | 'supplier_paid' | 'supplier_unpaid' | 'both_paid'
      accountName,
      supplierAccountName,
      syncToAccount,
      date
    } = req.body;

    if (!Array.isArray(orderIds) || orderIds.length === 0) {
      return res.status(400).json({ success: false, message: 'Vui lòng chọn ít nhất 1 đơn hàng để thực hiện' });
    }

    const targetAcc = (accountName || 'Vietcombank').trim();
    const targetSupAcc = (supplierAccountName || accountName || 'Vietcombank').trim();
    const shouldSync = syncToAccount !== false;
    const txDate = date || new Date().toISOString().slice(0, 10);

    const orders = await ServiceOrder.find({ _id: { $in: orderIds } });
    let customerCount = 0;
    let supplierCount = 0;
    let totalCustomerAmt = 0;
    let totalSupplierAmt = 0;
    const affectedSuppliers = new Map();

    for (const order of orders) {
      let modified = false;
      const sKey = order.supplierKey || (order.supplierName ? normalizeKey(order.supplierName) : '');

      if (action === 'customer_paid' || action === 'both_paid') {
        if (!order.customerPaid) {
          await applyOrderCustomerPaymentState(order, {
            customerPaid: true,
            receivedAccount: targetAcc,
            syncToAccount: shouldSync,
            dateStr: txDate
          });
          customerCount++;
          totalCustomerAmt += (order.salePrice || 0);
          modified = true;
        }
      } else if (action === 'customer_unpaid') {
        if (order.customerPaid) {
          await applyOrderCustomerPaymentState(order, {
            customerPaid: false,
            syncToAccount: shouldSync,
            dateStr: txDate
          });
          customerCount++;
          totalCustomerAmt += (order.salePrice || 0);
          modified = true;
        }
      }

      if (action === 'supplier_paid' || action === 'both_paid') {
        if (!order.supplierPaid && (order.costPrice || 0) > 0) {
          await applyOrderSupplierPaymentState(order, {
            supplierPaid: true,
            supplierPaidAccount: targetSupAcc,
            syncToAccount: shouldSync,
            dateStr: txDate
          });
          if (sKey) affectedSuppliers.set(sKey, order.supplierName);
          supplierCount++;
          totalSupplierAmt += (order.costPrice || 0);
          modified = true;
        }
      } else if (action === 'supplier_unpaid') {
        if (order.supplierPaid) {
          await applyOrderSupplierPaymentState(order, {
            supplierPaid: false,
            syncToAccount: shouldSync,
            dateStr: txDate
          });
          if (sKey) affectedSuppliers.set(sKey, order.supplierName);
          supplierCount++;
          totalSupplierAmt += (order.costPrice || 0);
          modified = true;
        }
      }

      if (modified) {
        await order.save();
      }
    }

    for (const [sKey, sName] of affectedSuppliers.entries()) {
      await reconcileSupplierDebtFromOrders(sName, sKey);
    }

    let msg = '✓ Đã cập nhật trạng thái đơn hàng thành công!';
    if (action === 'customer_paid') {
      msg = `✓ Đã thu khách ${customerCount} đơn (+${totalCustomerAmt.toLocaleString('vi-VN')}đ vào ${targetAcc})!`;
    } else if (action === 'supplier_paid') {
      msg = `✓ Đã trả vốn NCC ${supplierCount} đơn (-${totalSupplierAmt.toLocaleString('vi-VN')}đ từ ${targetSupAcc})!`;
    } else if (action === 'both_paid') {
      msg = `✓ Đã tất toán xong (Thu khách ${customerCount} đơn, Trả vốn ${supplierCount} đơn)!`;
    } else if (action === 'customer_unpaid') {
      msg = `↩️ Đã hoàn tác ${customerCount} đơn về Chưa thu tiền khách!`;
    } else if (action === 'supplier_unpaid') {
      msg = `↩️ Đã hoàn tác ${supplierCount} đơn về Chưa trả vốn NCC!`;
    }

    res.json({
      success: true,
      customerCount,
      supplierCount,
      totalCustomerAmt,
      totalSupplierAmt,
      message: msg
    });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

app.delete('/api/service-orders/:id', authenticateToken, requireAnyPermission('manageDebts', 'manageTransactions'), async (req, res) => {
  try {
    const order = await ServiceOrder.findById(req.params.id);
    if (!order) return res.status(404).json({ success: false, message: 'Không tìm thấy' });

    const sName = order.supplierName;
    const sKey = order.supplierKey || (sName ? normalizeKey(sName) : '');

    // Nếu đơn này đã từng cộng/trừ thực tế vào số dư ngân hàng, hoàn tác số dư & xóa giao dịch liên kết
    if (order.customerPaid && order.customerAccountSynced) {
      await applyOrderCustomerPaymentState(order, { customerPaid: false, syncToAccount: true });
    }
    if (order.supplierPaid && order.supplierAccountSynced) {
      await applyOrderSupplierPaymentState(order, { supplierPaid: false, syncToAccount: true });
    }

    await ServiceOrder.findByIdAndDelete(req.params.id);

    if (sKey) {
      await reconcileSupplierDebtFromOrders(sName, sKey, { allowZeroWhenNoOrders: true });
    }

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

    // ISSUE 3: Chuẩn hóa gán memberId cho từng người trong split nếu có
    let formattedSplits = Array.isArray(splits) ? [...splits] : [];
    for (const sp of formattedSplits) {
      if (!sp.memberId && sp.personName) {
        const m = await DiningMember.findOne({ group: targetCat, personKey: normalizeKey(sp.personName) }).lean();
        if (m) sp.memberId = m._id;
      }
    }

    const bill = await DiningLedger.create({
      date: date || new Date().toISOString().slice(0, 10),
      mealTitle: mealTitle || 'Bữa ăn nhóm',
      category: targetCat,
      totalBill: numTotal,
      myShare: Number(myShare) || 0,
      splitMode: splitMode || 'equal',
      splits: formattedSplits,
      paidAccount: paidAccount || 'Vietcombank',
      deductFromAccount: shouldDeduct,
      deductWeeklyLimit: deductWeeklyLimit !== false,
      notes: notes || ''
    });

    // Trừ số tiền vào ngân hàng thời gian thực nếu được bật (Atomic $inc)
    if (shouldDeduct && bill.paidAccount && numTotal > 0) {
      await adjustAccountBalance(bill.paidAccount, -numTotal);
    }

    res.json({ success: true, bill });
  } catch (err) {
    res.status(err.statusCode || 400).json({ success: false, error: err.message, message: err.message });
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

    // ISSUE 3: Chuẩn hóa gán memberId
    let formattedSplits = Array.isArray(splits) ? [...splits] : (oldBill.splits || []);
    for (const sp of formattedSplits) {
      if (!sp.memberId && sp.personName) {
        const m = await DiningMember.findOne({ group: targetCat, personKey: normalizeKey(sp.personName) }).lean();
        if (m) sp.memberId = m._id;
      }
    }

    oldBill.date = date || oldBill.date;
    oldBill.mealTitle = mealTitle || oldBill.mealTitle;
    oldBill.category = category === 'family' ? 'family' : 'work';
    oldBill.totalBill = numTotal;
    oldBill.myShare = Number(myShare) || 0;
    oldBill.splitMode = splitMode || oldBill.splitMode;
    oldBill.splits = formattedSplits;
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
    res.status(err.statusCode || 400).json({ success: false, error: err.message, message: err.message });
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

    // ISSUE 3: Tra cứu memberId chính xác cho thành viên
    let mId = req.body.memberId || null;
    if (!mId && personName) {
      const m = await DiningMember.findOne({ group: targetCat, personKey: pKey }).lean();
      if (m) mId = m._id;
    }

    const settlement = await DiningSettlement.create({
      personKey: pKey,
      personName,
      memberId: mId,
      category: targetCat,
      amount: numAmount,
      direction: direction === 'out' ? 'out' : 'in',
      topupKind: topupKind || (direction === 'out' ? 'borrow' : 'prepaid'),
      accountName: accountName || 'Vietcombank',
      addToAccount: shouldAdd,
      note: note || '',
      date: date || new Date().toISOString().slice(0, 10)
    });

    // Cộng hoặc trừ tiền vào ngân hàng thời gian thực (Atomic $inc)
    if (shouldAdd && settlement.accountName && numAmount > 0) {
      const delta = settlement.direction === 'in' ? numAmount : -numAmount;
      await adjustAccountBalance(settlement.accountName, delta);
    }

    res.json({ success: true, settlement });
  } catch (err) {
    res.status(err.statusCode || 400).json({ success: false, error: err.message, message: err.message });
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

    // Hoàn tác tiền cũ (Atomic $inc)
    if (oldS.addToAccount && oldS.accountName && oldS.amount > 0) {
      const revertDelta = oldS.direction === 'in' ? -oldS.amount : oldS.amount;
      await adjustAccountBalance(oldS.accountName, revertDelta);
    }

    const { personName, amount, direction, category, note, date, topupKind, accountName, addToAccount, memberId } = req.body;
    const pKey = normalizeKey(personName);
    const numAmount = Number(amount) || 0;
    const shouldAdd = addToAccount !== false;

    // ISSUE 3: Tra cứu memberId
    let finalMemberId = memberId || oldS.memberId || null;
    if (!finalMemberId && personName) {
      const m = await DiningMember.findOne({ group: targetCat, personKey: pKey }).lean();
      if (m) finalMemberId = m._id;
    }

    oldS.personKey = pKey || oldS.personKey;
    oldS.personName = personName || oldS.personName;
    oldS.memberId = finalMemberId;
    oldS.category = category === 'family' ? 'family' : 'work';
    oldS.amount = numAmount;
    oldS.direction = direction === 'out' ? 'out' : 'in';
    oldS.topupKind = topupKind || oldS.topupKind;
    oldS.accountName = accountName || oldS.accountName;
    oldS.addToAccount = shouldAdd;
    oldS.note = note !== undefined ? note : oldS.note;
    oldS.date = date || oldS.date;

    await oldS.save();

    // Áp dụng tiền mới (Atomic $inc)
    if (shouldAdd && oldS.accountName && numAmount > 0) {
      const delta = oldS.direction === 'in' ? numAmount : -numAmount;
      await adjustAccountBalance(oldS.accountName, delta);
    }

    res.json({ success: true, settlement: oldS });
  } catch (err) {
    res.status(err.statusCode || 400).json({ success: false, error: err.message, message: err.message });
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

    // ISSUE 5: Xóa giao dịch cấn trừ liên quỹ bảo đảm ACID Transaction
    if (s.transferRef) {
      const session = await mongoose.startSession();
      try {
        await session.withTransaction(async () => {
          const linkedList = await DiningSettlement.find({ transferRef: s.transferRef }).session(session);
          for (const item of linkedList) {
            if (item.addToAccount && item.accountName && item.amount > 0) {
              const revertDelta = item.direction === 'in' ? -item.amount : item.amount;
              await adjustAccountBalance(item.accountName, revertDelta, session);
            }
          }
          await DiningSettlement.deleteMany({ transferRef: s.transferRef }, { session });
        });
      } finally {
        await session.endSession();
      }
      return res.json({ success: true, message: 'Đã hoàn tác và xóa an toàn cả 2 vế giao dịch cấn trừ liên quỹ (ACID Transaction)' });
    }

    // Hoàn tác tiền ngân hàng đơn lẻ (Atomic $inc)
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

// ==================== CẤN TRỪ SỐ DƯ LIÊN QUỸ (KHÔNG CẦN CHUYỂN KHOẢN) ====================
// ISSUE 5: Dual-fund Reconciliation with MongoDB ACID Transactions
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

    const session = await mongoose.startSession();
    let debit, credit;

    try {
      await session.withTransaction(async () => {
        // ISSUE 3: Tra cứu memberId cho từng nhóm
        let mIdFrom = null;
        let mIdTo = null;

        const mFrom = await DiningMember.findOne({ group: fromCategory, personKey: pKey }).session(session).lean();
        if (mFrom) mIdFrom = mFrom._id;

        const mTo = await DiningMember.findOne({ group: toCategory, personKey: pKey }).session(session).lean();
        if (mTo) mIdTo = mTo._id;

        // 1. Tạo vế xuất từ quỹ nguồn (direction: 'out')
        const [d] = await DiningSettlement.create([
          {
            monthKey: transferDate.slice(0, 7),
            personKey: pKey,
            personName: personName.trim(),
            memberId: mIdFrom,
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
          }
        ], { session });

        // 2. Tạo vế nhập vào quỹ đích (direction: 'in')
        const [c] = await DiningSettlement.create([
          {
            monthKey: transferDate.slice(0, 7),
            personKey: pKey,
            personName: personName.trim(),
            memberId: mIdTo,
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
          }
        ], { session });

        debit = d;
        credit = c;
      });
    } finally {
      await session.endSession();
    }

    res.json({
      success: true,
      message: `Đã cấn trừ chuyển thành công ${numAmount.toLocaleString('vi-VN')}đ từ ${sourceName} sang ${targetName} cho ${personName.trim()} (ACID Transaction)`,
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
    const { name, openingBalance, group, phone, note, isBadDebt } = req.body;
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
      isBadDebt: Boolean(isBadDebt),
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
    const { name, openingBalance, group, phone, note, isBadDebt } = req.body;
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
    if (isBadDebt !== undefined) member.isBadDebt = Boolean(isBadDebt);
    if (phone !== undefined) member.phone = phone;
    if (note !== undefined) member.note = note;

    await member.save();
    res.json({ success: true, member });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

// Endpoint nhanh để đánh dấu / bỏ đánh dấu nợ dài hạn, khó đòi
app.patch('/api/dining/member/:id/toggle-bad-debt', authenticateToken, async (req, res) => {
  try {
    const member = await DiningMember.findById(req.params.id);
    if (!member) return res.status(404).json({ success: false, message: 'Không tìm thấy thành viên' });

    const reqPerm = member.group === 'family' ? 'manageDiningFamily' : 'manageDiningWork';
    if (!req.user.isAdmin && !(req.user.permissions && req.user.permissions[reqPerm])) {
      return res.status(403).json({ success: false, message: 'Bạn không có quyền quản lý thành viên này' });
    }

    member.isBadDebt = !member.isBadDebt;
    await member.save();

    res.json({
      success: true,
      member,
      isBadDebt: member.isBadDebt,
      message: member.isBadDebt
        ? `Đã đánh dấu "${member.name}" là nợ dài hạn/khó đòi (loại trừ khỏi dòng tiền ngắn hạn 7/30 ngày)`
        : `Đã bỏ đánh dấu nợ khó đòi cho "${member.name}" (thu hồi vào dòng tiền ngắn hạn)`
    });
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
    const canManageWork = req.user.isAdmin || Boolean(req.user.permissions?.manageDiningWork);
    const canManageFamily = req.user.isAdmin || Boolean(req.user.permissions?.manageDiningFamily);
    const isManager = canManageWork || canManageFamily;

    if (!isManager) {
      return res.status(403).json({ success: false, message: 'Chỉ người có quyền chỉnh sửa sổ ăn uống mới được duyệt hoặc từ chối yêu cầu' });
    }

    const { status, adminNote } = req.body;
    if (!['approved', 'rejected', 'pending'].includes(status)) {
      return res.status(400).json({ success: false, message: 'Trạng thái không hợp lệ' });
    }

    const item = await CorrectionRequest.findById(req.params.id);
    if (!item) return res.status(404).json({ success: false, message: 'Không tìm thấy yêu cầu' });

    // Kiểm tra phân quyền chi tiết theo danh mục sổ
    if (!req.user.isAdmin) {
      if (item.category === 'family' && !canManageFamily) {
        return res.status(403).json({ success: false, message: 'Bạn không có quyền quản lý Sổ Gia Đình (Hub 3)' });
      }
      if (item.category === 'work' && !canManageWork) {
        return res.status(403).json({ success: false, message: 'Bạn không có quyền quản lý Sổ Ăn Đồng Nghiệp (Hub 2)' });
      }
    }

    item.status = status;
    if (adminNote !== undefined) item.adminNote = adminNote.trim();
    item.handledBy = req.user.fullName || req.user.username;
    item.handledAt = new Date();
    await item.save();

    res.json({
      success: true,
      message: `Đã cập nhật trạng thái yêu cầu thành [${status === 'approved' ? 'Đã duyệt' : (status === 'rejected' ? 'Từ chối' : 'Chờ xử lý')}]`,
      request: item
    });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

// Xóa yêu cầu chỉnh sửa (Dành cho Quản lý hoặc chính người gửi)
app.delete('/api/dining/requests/:id', authenticateToken, async (req, res) => {
  try {
    const isManager = req.user.isAdmin || (req.user.permissions && (req.user.permissions.manageDiningWork || req.user.permissions.manageDiningFamily));
    const item = await CorrectionRequest.findById(req.params.id);
    if (!item) return res.status(404).json({ success: false, message: 'Không tìm thấy yêu cầu' });

    const isOwner = String(item.creatorId) === String(req.user._id);
    if (!isManager && !isOwner) {
      return res.status(403).json({ success: false, message: 'Bạn không có quyền xóa yêu cầu này' });
    }

    await item.deleteOne();
    res.json({ success: true, message: 'Đã xóa yêu cầu chỉnh sửa' });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

// ==================== 8.5. SỔ CHI TIÊU CÁ NHÂN & TIẾT KIỆM (HUB 4 CRUD) ====================
async function syncPersonalExpenseAccountBalance(item, prevState = null) {
  const wasDeducted = Boolean(
    prevState &&
    prevState.status === 'paid' &&
    (prevState.accountSynced || prevState.deductFromAccount) &&
    prevState.paidAccount &&
    Number(prevState.amount) > 0
  );

  const shouldDeduct = Boolean(
    item.status === 'paid' &&
    item.deductFromAccount !== false &&
    item.paidAccount &&
    Number(item.amount) > 0
  );

  if (wasDeducted) {
    await adjustAccountBalance(prevState.paidAccount, Number(prevState.amount));
  }

  if (shouldDeduct) {
    await adjustAccountBalance(item.paidAccount, -Number(item.amount));
    item.deductFromAccount = true;
    item.accountSynced = true;
    if (!item.paidDate) {
      item.paidDate = new Date().toISOString().slice(0, 10);
    }
  } else {
    item.accountSynced = false;
    if (item.status !== 'paid') {
      item.paidDate = '';
    }
  }
}

app.post('/api/personal/expense', authenticateToken, requirePermission('managePersonalHub'), async (req, res) => {
  try {
    const { title, category, type, amount, cycle, dueDay, status, paidAccount, deductFromAccount, notes, paidDate } = req.body;
    if (!title || !title.trim()) return res.status(400).json({ success: false, message: 'Thiếu tên khoản chi / hóa đơn' });
    const numAmount = Number(amount);
    if (!numAmount || numAmount <= 0) return res.status(400).json({ success: false, message: 'Số tiền phải lớn hơn 0đ' });

    const resolvedStatus = status || 'pending';
    const shouldDeduct = deductFromAccount !== undefined ? Boolean(deductFromAccount) : true;

    const item = new PersonalExpense({
      title: title.trim(),
      category: category || 'streaming_tech',
      type: type || 'fixed_bill',
      amount: numAmount,
      cycle: cycle || 'monthly',
      dueDay: Number(dueDay) || 5,
      status: resolvedStatus,
      paidAccount: paidAccount || 'Vietcombank',
      deductFromAccount: shouldDeduct,
      paidDate: resolvedStatus === 'paid' ? (paidDate || new Date().toISOString().slice(0, 10)) : '',
      notes: notes || ''
    });

    await syncPersonalExpenseAccountBalance(item, null);
    await item.save();

    res.json({ success: true, item });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

app.put('/api/personal/expense/:id', authenticateToken, requirePermission('managePersonalHub'), async (req, res) => {
  try {
    const item = await PersonalExpense.findById(req.params.id);
    if (!item) return res.status(404).json({ success: false, message: 'Không tìm thấy khoản chi cá nhân' });

    const prevState = {
      status: item.status,
      amount: item.amount,
      paidAccount: item.paidAccount,
      deductFromAccount: item.deductFromAccount,
      accountSynced: item.accountSynced
    };

    const { title, category, type, amount, cycle, dueDay, status, paidAccount, deductFromAccount, notes, paidDate } = req.body;
    if (title !== undefined) item.title = title.trim();
    if (category !== undefined) item.category = category;
    if (type !== undefined) item.type = type;
    if (amount !== undefined) item.amount = Number(amount) || item.amount;
    if (cycle !== undefined) item.cycle = cycle;
    if (dueDay !== undefined) item.dueDay = Number(dueDay) || item.dueDay;
    if (paidAccount !== undefined) item.paidAccount = paidAccount;
    if (notes !== undefined) item.notes = notes;
    if (deductFromAccount !== undefined) item.deductFromAccount = Boolean(deductFromAccount);

    if (status !== undefined) {
      item.status = status;
      if (status === 'paid') {
        if (!item.paidDate) item.paidDate = paidDate || new Date().toISOString().slice(0, 10);
        if (deductFromAccount === undefined) item.deductFromAccount = true;
      } else if (status === 'pending') {
        item.paidDate = '';
      }
    }

    await syncPersonalExpenseAccountBalance(item, prevState);
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

    const prevState = {
      status: item.status,
      amount: item.amount,
      paidAccount: item.paidAccount,
      deductFromAccount: item.deductFromAccount,
      accountSynced: item.accountSynced
    };

    const newStatus = item.status === 'paid' ? 'pending' : 'paid';
    item.status = newStatus;
    if (req.body && req.body.paidAccount) {
      item.paidAccount = req.body.paidAccount;
    }

    if (newStatus === 'paid') {
      item.paidDate = new Date().toISOString().slice(0, 10);
      item.deductFromAccount = req.body?.deductFromAccount !== undefined ? Boolean(req.body.deductFromAccount) : true;
    } else {
      item.paidDate = '';
    }

    await syncPersonalExpenseAccountBalance(item, prevState);
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

    if (item.status === 'paid' && (item.accountSynced || item.deductFromAccount) && item.paidAccount) {
      await adjustAccountBalance(item.paidAccount, Number(item.amount) || 0);
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
const https = require('https');

function startKeepAliveCron() {
  const urls = [
    'https://tracymillence.xyz/api/health',
    process.env.RENDER_EXTERNAL_URL ? `${process.env.RENDER_EXTERNAL_URL.replace(/\/$/, '')}/api/health` : 'https://cfo-flow.onrender.com/api/health'
  ];

  // Ping mỗi 10 phút (600,000 ms) để ngăn Render Free Tier ngủ đông sau 15 phút
  setInterval(() => {
    urls.forEach(url => {
      try {
        const req = https.get(url, { timeout: 10000 }, (res) => {
          res.resume(); // Tiêu thụ dữ liệu để giải phóng bộ nhớ
        });
        req.on('error', () => {});
        req.on('timeout', () => req.destroy());
      } catch (_) {}
    });
  }, 10 * 60 * 1000);
}

app.listen(PORT, async () => {
  console.log(`===============================================`);
  console.log(`🚀 CFO Flow Server running on http://localhost:${PORT}`);
  console.log(`===============================================`);
  await ensureMongoConnected();
  startKeepAliveCron();
});
