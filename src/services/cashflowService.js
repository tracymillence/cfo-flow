const Account = require('../models/Account');
const ServiceOrder = require('../models/ServiceOrder');
const SupplierDebt = require('../models/SupplierDebt');
const { calculateMemberLedger } = require('./diningService');

async function getCashflowKPIs() {
  const accounts = await Account.find().lean();
  const totalCash = accounts.reduce((sum, a) => sum + (Number(a.balance) || 0), 0);

  // Nợ NCC từ đơn dịch vụ chưa thanh toán
  const unpaidOrders = await ServiceOrder.find({ customerPaid: true, supplierPaid: false }).lean();
  const ordersPayable = unpaidOrders.reduce((sum, o) => sum + (Number(o.costPrice) || 0), 0);

  // Nợ NCC tồn đầu kỳ
  const supplierDebts = await SupplierDebt.find().lean();
  const initialDebts = supplierDebts.reduce((sum, d) => sum + (Number(d.remainingAmount) || 0), 0);
  const totalSupplierPayable = ordersPayable + initialDebts;

  // Quỹ đồng nghiệp nạp dư (Prepaid liability)
  const { totalPrepaid, totalOwing } = await calculateMemberLedger();

  // Tiền thực sự khả dụng
  const spendableCash = totalCash - totalSupplierPayable - totalPrepaid;

  return {
    totalCash,
    spendableCash,
    totalSupplierPayable,
    diningPrepaidLiability: totalPrepaid,
    diningReceivable: totalOwing,
    accounts
  };
}

module.exports = { getCashflowKPIs };
