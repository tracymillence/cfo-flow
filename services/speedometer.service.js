/**
 * services/speedometer.service.js
 * 
 * Aggregation pipeline for calculating Weekly Speedometer spending in Vietnam Local Time (Asia/Ho_Chi_Minh).
 * Eliminates timezone skew where Monday 01:00 AM VN was incorrectly evaluated as Sunday UTC.
 */

const Transaction = require('../models/Transaction');

const VIETNAM_TZ = 'Asia/Ho_Chi_Minh';

/**
 * Returns { startStr: 'YYYY-MM-DD', endStr: 'YYYY-MM-DD' } for current Vietnam calendar week (Monday to Sunday).
 */
function getVietnamWeekRange(referenceDate = new Date()) {
  const d = new Date(referenceDate);
  const vnDateStr = d.toLocaleDateString('en-CA', { timeZone: VIETNAM_TZ });
  const [year, month, day] = vnDateStr.split('-').map(Number);
  const vnMidday = new Date(Date.UTC(year, month - 1, day, 12, 0, 0));
  const dayOfWeek = vnMidday.getUTCDay();
  const diffToMonday = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
  const mondayDate = new Date(Date.UTC(year, month - 1, day + diffToMonday));
  const sundayDate = new Date(Date.UTC(year, month - 1, day + diffToMonday + 6));
  return {
    startStr: mondayDate.toISOString().slice(0, 10),
    endStr: sundayDate.toISOString().slice(0, 10)
  };
}

/**
 * Calculates current week spend net of Hub 4 inflows/refunds using native MongoDB Timezone operators.
 *
 * @param {Object} options
 * @param {Date} [options.referenceDate=new Date()] Optional reference date for testing/reconciliation
 * @returns {Promise<Object>} Speedometer aggregation metrics
 */
async function calculateWeeklySpeedometerAgg({ referenceDate = new Date() } = {}) {
  const pipeline = [
    // Step 1: Pre-filter transactions with candidate date strings to optimize index scan
    {
      $match: {
        date: { $type: 'string', $regex: '^[0-9]{4}-[0-9]{2}-[0-9]{2}' }
      }
    },

    // Step 2: Parse 'YYYY-MM-DD' string to a Date object in 'Asia/Ho_Chi_Minh'
    {
      $addFields: {
        txDateObj: {
          $dateFromString: {
            dateString: '$date',
            timezone: VIETNAM_TZ,
            onError: null,
            onNull: null
          }
        }
      }
    },

    // Step 3: Match only valid dates
    {
      $match: {
        txDateObj: { $ne: null }
      }
    },

    // Step 4: Truncate dates to Monday 00:00:00 (start of week) under Asia/Ho_Chi_Minh
    {
      $addFields: {
        txWeekStart: {
          $dateTrunc: {
            date: '$txDateObj',
            unit: 'week',
            binSize: 1,
            timezone: VIETNAM_TZ,
            startOfWeek: 'monday'
          }
        },
        currentWeekStart: {
          $dateTrunc: {
            date: referenceDate,
            unit: 'week',
            binSize: 1,
            timezone: VIETNAM_TZ,
            startOfWeek: 'monday'
          }
        }
      }
    },

    // Step 5: Filter transactions that strictly belong to the current Vietnam calendar week
    {
      $match: {
        $expr: {
          $eq: ['$txWeekStart', '$currentWeekStart']
        }
      }
    },

    // Step 6: Group and compute gross weekly spent, refunds/credits, and net spent
    {
      $group: {
        _id: '$txWeekStart',
        // Outgoing personal expenses in Hub 4:
        // Counts transactions flagged with impactsWeeklyLimit: true, OR personal dining/living expenses (excluding debt payments)
        grossWeeklySpent: {
          $sum: {
            $cond: [
              {
                $and: [
                  { $eq: ['$type', 'expense'] },
                  { $eq: ['$hubRole', 'hub4_personal'] },
                  {
                    $or: [
                      { $eq: ['$impactsWeeklyLimit', true] },
                      {
                        $and: [
                          { $ne: ['$impactsWeeklyLimit', false] },
                          { $regexMatch: { input: '$category', regex: /ăn uống|chi tiêu|sinh hoạt|ăn ngoài|cafe|cà phê|tiêu dùng/i } },
                          { $not: { $regexMatch: { input: '$title', regex: /trả nợ|công nợ|tiền xưởng|nhà cung cấp|tiết kiệm/i } } }
                        ]
                      }
                    ]
                  }
                ]
              },
              '$amount',
              0
            ]
          }
        },
        // Inflows: ONLY true refunds, cashbacks, or reimbursements credited back to Hub 4.
        // Salaries, gifts, personal incomes, or debt recoveries are regular income and MUST NOT wipe out spending budget!
        hub4WeeklyRefunds: {
          $sum: {
            $cond: [
              {
                $and: [
                  { $eq: ['$type', 'income'] },
                  { $eq: ['$hubRole', 'hub4_personal'] },
                  {
                    $or: [
                      { $regexMatch: { input: '$category', regex: /hoàn tiền|refund|cashback|bồi hoàn|trả lại/i } },
                      { $regexMatch: { input: '$title', regex: /hoàn tiền|refund|cashback|bồi hoàn|trả lại/i } }
                    ]
                  }
                ]
              },
              '$amount',
              0
            ]
          }
        },
        transactionCount: { $sum: 1 }
      }
    },

    // Step 7: Project net weekly spent
    {
      $project: {
        _id: 0,
        weekStartDate: '$_id',
        grossWeeklySpent: 1,
        hub4WeeklyRefunds: 1,
        transactionCount: 1,
        netWeeklySpent: {
          $max: [
            0,
            { $subtract: ['$grossWeeklySpent', '$hub4WeeklyRefunds'] }
          ]
        }
      }
    }
  ];

  const [result] = await Transaction.aggregate(pipeline);

  return result || {
    weekStartDate: null,
    grossWeeklySpent: 0,
    hub4WeeklyRefunds: 0,
    transactionCount: 0,
    netWeeklySpent: 0
  };
}

module.exports = { calculateWeeklySpeedometerAgg, getVietnamWeekRange };

