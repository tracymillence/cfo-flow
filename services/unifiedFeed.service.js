/**
 * services/unifiedFeed.service.js
 * 
 * Database-level Unified Transaction Feed using MongoDB $unionWith.
 * Streams, projects, and paginates across 4 financial collections directly in MongoDB,
 * preventing Node.js process Out-of-Memory (OOM) crashes.
 */

const Transaction = require('../models/Transaction');

/**
 * Fetches a paginated, unified transaction feed across 4 financial collections.
 * 
 * @param {number} page Page number (1-indexed)
 * @param {number} limit Number of documents per page
 * @param {Object} filters Optional query filters (hubRole, type, accountName)
 * @returns {Promise<{ transactions: Array, pagination: Object }>}
 */
async function getUnifiedFeed(page = 1, limit = 50, filters = {}) {
  const p = Math.max(1, parseInt(page, 10) || 1);
  const l = Math.min(200, Math.max(1, parseInt(limit, 10) || 50));
  const skip = (p - 1) * l;

  // Base match conditions for main transactions
  const txMatch = {};
  if (filters.hubRole && filters.hubRole !== 'all') txMatch.hubRole = filters.hubRole;
  if (filters.type && filters.type !== 'all') txMatch.type = filters.type;
  if (filters.accountName && filters.accountName !== 'all') txMatch.accountName = filters.accountName;

  const pipeline = [
    // 1. Initial stage on 'transactions' collection
    { $match: txMatch },
    {
      $project: {
        _id: 1,
        date: 1,
        title: 1,
        amount: 1,
        type: 1,
        accountName: 1,
        toAccountName: 1,
        category: 1,
        hubRole: 1,
        impactsWeeklyLimit: 1,
        usingSupplierFloat: {
          $cond: [
            { $and: [{ $eq: ['$hubRole', 'hub1_income'] }, { $eq: ['$usingSupplierFloat', true] }] },
            true,
            false
          ]
        },
        notes: 1,
        source: { $literal: 'direct' },
        sourceId: '$_id',
        createdAt: 1
      }
    },

    // 2. Union with 'diningledgers' (Hub 2 Dining & Hub 3 Family meal bills)
    {
      $unionWith: {
        coll: 'diningledgers',
        pipeline: [
          { $match: { deductFromAccount: { $ne: false } } },
          {
            $project: {
              _id: 1,
              date: 1,
              title: { $concat: ['[Bữa ăn] ', '$mealTitle'] },
              amount: '$totalBill',
              type: { $literal: 'expense' },
              accountName: { $ifNull: ['$paidAccount', 'Vietcombank'] },
              toAccountName: { $literal: '' },
              category: {
                $cond: [{ $eq: ['$category', 'family'] }, 'Quỹ Gia Đình', 'Quỹ Ăn Nhóm']
              },
              hubRole: {
                $cond: [{ $eq: ['$category', 'family'] }, 'hub3_family', 'hub2_dining']
              },
              impactsWeeklyLimit: '$deductWeeklyLimit',
              notes: { $ifNull: ['$notes', ''] },
              source: { $literal: 'dining_ledger' },
              sourceId: '$_id',
              createdAt: 1
            }
          }
        ]
      }
    },

    // 3. Union with 'diningsettlements' (Topups & Member debts)
    {
      $unionWith: {
        coll: 'diningsettlements',
        pipeline: [
          // Exclude internal dual-fund transfers without physical account impact
          { $match: { transferRef: { $in: [null, ''] } } },
          {
            $project: {
              _id: 1,
              date: 1,
              title: {
                $concat: [
                  '$personName',
                  ': ',
                  { $cond: [{ $eq: ['$direction', 'in'] }, 'Nạp quỹ', 'Mượn quỹ'] },
                  { $cond: [{ $gt: [{ $strLenCP: { $ifNull: ['$note', ''] } }, 0] }, { $concat: [' (', '$note', ')'] }, ''] }
                ]
              },
              amount: '$amount',
              type: {
                $cond: [{ $eq: ['$direction', 'in'] }, 'income', 'expense']
              },
              accountName: { $ifNull: ['$accountName', 'Vietcombank'] },
              toAccountName: { $literal: '' },
              category: {
                $cond: [{ $eq: ['$category', 'family'] }, 'Quỹ Gia Đình', 'Quỹ Ăn Nhóm']
              },
              hubRole: {
                $cond: [{ $eq: ['$category', 'family'] }, 'hub3_family', 'hub2_dining']
              },
              impactsWeeklyLimit: { $literal: false },
              notes: { $literal: '[Đồng bộ Nạp/Mượn Quỹ]' },
              source: { $literal: 'dining_settlement' },
              sourceId: '$_id',
              createdAt: 1
            }
          }
        ]
      }
    },

    // 4. Union with 'personalexpenses' (Hub 4 Paid Bills)
    {
      $unionWith: {
        coll: 'personalexpenses',
        pipeline: [
          { $match: { status: 'paid', deductFromAccount: true } },
          {
            $project: {
              _id: 1,
              date: { $ifNull: ['$paidDate', '$date'] },
              title: '$title',
              amount: '$amount',
              type: { $literal: 'expense' },
              accountName: { $ifNull: ['$paidAccount', 'Timo tiền lời'] },
              toAccountName: { $literal: '' },
              category: { $ifNull: ['$category', 'Chi phí cá nhân'] },
              hubRole: { $literal: 'hub4_personal' },
              impactsWeeklyLimit: { $ifNull: ['$impactsWeeklyLimit', false] },
              notes: {
                $cond: [
                  { $gt: [{ $strLenCP: { $ifNull: ['$note', ''] } }, 0] },
                  { $concat: ['$note', ' • [Đồng bộ Sổ Cá Nhân]'] },
                  '[Đồng bộ Sổ Cá Nhân]'
                ]
              },
              source: { $literal: 'personal_expense' },
              sourceId: '$_id',
              createdAt: 1
            }
          }
        ]
      }
    },

    // 5. Global facet sorting and memory-efficient pagination
    { $sort: { date: -1, createdAt: -1 } },
    {
      $facet: {
        metadata: [{ $count: 'total' }],
        data: [{ $skip: skip }, { $limit: l }]
      }
    }
  ];

  const [result] = await Transaction.aggregate(pipeline);
  const total = result && result.metadata && result.metadata[0] ? result.metadata[0].total : 0;
  const transactions = result && result.data ? result.data : [];

  return {
    transactions,
    pagination: {
      total,
      page: p,
      limit: l,
      totalPages: Math.ceil(total / l)
    }
  };
}

module.exports = { getUnifiedFeed };

