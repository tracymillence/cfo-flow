const DiningMember = require('../models/DiningMember');
const DiningBill = require('../models/DiningBill');
const DiningSettlement = require('../models/DiningSettlement');

async function calculateMemberLedger(monthKey = null) {
  const members = await DiningMember.find().lean();
  const bills = await DiningBill.find().lean();
  const settlements = await DiningSettlement.find().lean();

  const map = new Map();
  for (const m of members) {
    map.set(m.personKey, {
      id: m.id,
      personKey: m.personKey,
      name: m.name,
      openingBalance: Number(m.openingBalance) || 0,
      totalTopups: 0,
      totalBorrowed: 0,
      totalEaten: 0,
      monthMealCount: 0,
      currentBalance: 0
    });
  }

  // Cộng dồn các bữa ăn
  for (const b of bills) {
    const isCurrentMonth = !monthKey || b.monthKey === monthKey;
    for (const sp of (b.splits || [])) {
      if (sp.isMe) continue;
      if (map.has(sp.personKey)) {
        const item = map.get(sp.personKey);
        const amt = Number(sp.amount) || 0;
        item.totalEaten += amt;
        if (isCurrentMonth) {
          item.monthMealCount += 1;
        }
      }
    }
  }

  // Cộng dồn nạp quỹ và mượn quỹ
  for (const st of settlements) {
    if (!map.has(st.personKey)) continue;
    const item = map.get(st.personKey);
    const amt = Number(st.amount) || 0;
    if (st.direction === 'out' || st.topupKind === 'borrow') {
      item.totalBorrowed += amt;
    } else {
      item.totalTopups += amt;
    }
  }

  let totalPrepaid = 0;
  let totalOwing = 0;
  let prepaidCount = 0;
  let owingCount = 0;
  const result = [];

  for (const item of map.values()) {
    item.currentBalance = item.openingBalance + item.totalTopups - item.totalBorrowed - item.totalEaten;
    if (item.currentBalance > 0) {
      totalPrepaid += item.currentBalance;
      prepaidCount++;
    } else if (item.currentBalance < 0) {
      totalOwing += Math.abs(item.currentBalance);
      owingCount++;
    }
    result.push(item);
  }

  return {
    members: result,
    totalPrepaid,
    totalOwing,
    prepaidCount,
    owingCount
  };
}

module.exports = { calculateMemberLedger };
