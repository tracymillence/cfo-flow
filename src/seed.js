const mongoose = require('mongoose');

const Account = require('./models/Account');
const DiningMember = require('./models/DiningMember');
const DiningBill = require('./models/DiningBill');
const DiningSettlement = require('./models/DiningSettlement');
const WeeklyExpense = require('./models/WeeklyExpense');
const ServiceOrder = require('./models/ServiceOrder');
const SupplierDebt = require('./models/SupplierDebt');

async function seedDatabase(force = false) {
  if (mongoose.connection.readyState !== 1) {
    console.warn('⚠️ MongoDB not connected yet. Skipping seed.');
    return;
  }

  const existingCount = await DiningMember.countDocuments();
  if (existingCount >= 14 && !force) {
    console.log('✓ MongoDB already contains dining members. Seed skipped.');
    return;
  }

  console.log('🌱 Seeding MongoDB with 100% real verified CFO Flow dataset...');

  // 1. Accounts
  await Account.deleteMany({});
  await Account.create([
    { accountId: 'acc_vcb', name: 'Vietcombank', type: 'bank', balance: 3280742 },
    { accountId: 'acc_momo', name: 'MoMo', type: 'ewallet', balance: 61000 },
    { accountId: 'acc_cash', name: 'Tiền mặt', type: 'cash', balance: 400000 }
  ]);

  // 2. 14 Dining Members with Google Sheet opening balances
  await DiningMember.deleteMany({});
  await DiningMember.create([
    { id: 'dmem-yen', personKey: 'yến', name: 'Yến', openingBalance: 1276411 },
    { id: 'dmem-thinh', personKey: 'thịnh', name: 'Thịnh', openingBalance: 20004 },
    { id: 'dmem-long', personKey: 'long', name: 'Long', openingBalance: -8004088 },
    { id: 'dmem-hai', personKey: 'hải', name: 'Hải', openingBalance: -933475 },
    { id: 'dmem-tuyet-ngan', personKey: 'tuyết ngân', name: 'Tuyết Ngân', openingBalance: -473517 },
    { id: 'dmem-nhu-y', personKey: 'như ý', name: 'Như Ý', openingBalance: 943499 },
    { id: 'dmem-duong', personKey: 'dương', name: 'Dương', openingBalance: 301750 },
    { id: 'dmem-thu-ngan', personKey: 'thu ngân', name: 'Thu Ngân', openingBalance: -34913 },
    { id: 'dmem-hoai', personKey: 'hoài', name: 'Hoài', openingBalance: -59597 },
    { id: 'dmem-ngoc-tuyen', personKey: 'ngọc tuyền', name: 'Ngọc Tuyền', openingBalance: 2790663 },
    { id: 'dmem-quynh', personKey: 'quỳnh', name: 'Quỳnh', openingBalance: 0 },
    { id: 'dmem-phung', personKey: 'phụng', name: 'Phụng', openingBalance: 0 },
    { id: 'dmem-nguyen', personKey: 'nguyên', name: 'Nguyên', openingBalance: 0 },
    { id: 'dmem-hp', personKey: 'hp', name: 'HP', openingBalance: 368507 }
  ]);

  // 3. 2 Dining Bills (Cơm trưa 156k chia 5 & Ăn tối với Thịnh 182k)
  await DiningBill.deleteMany({});
  await DiningBill.create([
    {
      id: 'dbill-trua-156k',
      date: '2026-11-02',
      monthKey: '2026-11',
      accountId: 'acc_vcb',
      accountName: 'Vietcombank',
      title: 'Cơm trưa (5 người: Tôi, Hoài, Hải, Yến, HP)',
      totalBill: 156000,
      myShare: 31200,
      splits: [
        { personKey: 'yến', name: 'Yến', amount: 31200, isMe: false },
        { personKey: 'hải', name: 'Hải', amount: 31200, isMe: false },
        { personKey: 'hoài', name: 'Hoài', amount: 31200, isMe: false },
        { personKey: 'hp', name: 'HP', amount: 31200, isMe: false },
        { personKey: 'tôi', name: 'Tôi', amount: 31200, isMe: true }
      ]
    },
    {
      id: 'dbill-toi-thinh-182k',
      date: '2026-11-02',
      monthKey: '2026-11',
      accountId: 'acc_vcb',
      accountName: 'Vietcombank',
      title: 'Ăn tối (Tôi & Thịnh)',
      totalBill: 182000,
      myShare: 122000,
      splits: [
        { personKey: 'thịnh', name: 'Thịnh', amount: 60000, isMe: false },
        { personKey: 'tôi', name: 'Tôi', amount: 122000, isMe: true }
      ]
    }
  ]);

  // 4. 4 Settlements (Yến mượn 300k & 3 bạn nạp MoMo +61k)
  await DiningSettlement.deleteMany({});
  await DiningSettlement.create([
    {
      id: 'dlo-1793625180000-yen300k',
      monthKey: '2026-11',
      personKey: 'yến',
      personName: 'Yến',
      amount: 300000,
      direction: 'out',
      topupKind: 'borrow',
      accountId: 'acc_vcb',
      accountName: 'Vietcombank',
      note: 'Yến mượn tiền quỹ',
      date: '2026-11-02'
    },
    {
      id: 'dset-topup-quynh',
      monthKey: '2026-11',
      personKey: 'quỳnh',
      personName: 'Quỳnh',
      amount: 16000,
      direction: 'in',
      topupKind: 'prepaid',
      accountId: 'acc_momo',
      accountName: 'MoMo',
      note: 'CK MoMo',
      date: '2026-11-02'
    },
    {
      id: 'dset-topup-phung',
      monthKey: '2026-11',
      personKey: 'phụng',
      personName: 'Phụng',
      amount: 29000,
      direction: 'in',
      topupKind: 'prepaid',
      accountId: 'acc_momo',
      accountName: 'MoMo',
      note: 'CK MoMo',
      date: '2026-11-02'
    },
    {
      id: 'dset-topup-nguyen',
      monthKey: '2026-11',
      personKey: 'nguyên',
      personName: 'Nguyên',
      amount: 16000,
      direction: 'in',
      topupKind: 'prepaid',
      accountId: 'acc_momo',
      accountName: 'MoMo',
      note: 'CK MoMo',
      date: '2026-11-02'
    }
  ]);

  // 5. Weekly Expense (Mua đồ ăn tối cho Bảo 45k)
  await WeeklyExpense.deleteMany({});
  await WeeklyExpense.create([
    {
      id: 'exp-bao-toi-45k',
      accountId: 'acc_vcb',
      week: 1,
      category: 'Ăn uống',
      note: 'Mua đồ ăn tối cho Bảo',
      amount: 45000,
      date: '2026-11-02'
    }
  ]);

  // 6. Service Orders & Supplier Debts (Pass thuế & Khắc dấu)
  await ServiceOrder.deleteMany({});
  await ServiceOrder.create([
    {
      id: 'ord-pass-thue-1',
      customerName: 'Chị Vy ChipZB',
      serviceType: 'Reset pass thuế',
      supplierName: 'NCC Pass Thuế',
      costPrice: 420000,
      salePrice: 600000,
      customerPaid: true,
      receivedAccountId: 'acc_vcb',
      supplierPaid: false,
      date: '2026-11-02'
    },
    {
      id: 'ord-khac-dau-1',
      customerName: 'Chị Vân Dấu Tuấn Hương',
      serviceType: 'Bán dấu',
      supplierName: 'Xưởng Khắc Dấu',
      costPrice: 190000,
      salePrice: 200000,
      customerPaid: true,
      receivedAccountId: 'acc_vcb',
      supplierPaid: false,
      date: '2026-11-02'
    }
  ]);

  await SupplierDebt.deleteMany({});
  await SupplierDebt.create([
    { id: 'sdeb-pass', supplierKey: 'ncc pass thuế', supplierName: 'NCC Pass Thuế', remainingAmount: 420000 },
    { id: 'sdeb-dau', supplierKey: 'xưởng khắc dấu', supplierName: 'Xưởng Khắc Dấu', remainingAmount: 190000 }
  ]);

  console.log('✓ Seeding complete! 14 members, 2 bills, 4 settlements, and expenses loaded successfully.');
  return { members: 14, bills: 2, settlements: 4 };
}

module.exports = seedDatabase;

if (require.main === module) {
  require('dotenv').config();
  const connectDB = require('./config/db');
  connectDB().then(() => {
    seedDatabase(true).then(() => {
      console.log('Done!');
      process.exit(0);
    });
  });
}
