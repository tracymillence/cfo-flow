/**
 * services/speedometer.service.js
 * 
 * Aggregation pipeline for calculating Weekly Speedometer spending in Vietnam Local Time (Asia/Ho_Chi_Minh).
 * Eliminates timezone skew where Monday 01:00 AM VN was incorrectly evaluated as Sunday UTC.
 */

const Transaction = require('../models/Transaction');

const VIETNAM_TZ = 'Asia/Ho_Chi_Minh';

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
        // Outgoing expenses flagged to impact the weekly limit
        grossWeeklySpent: {
          $sum: {
            $cond: [
              {
                $and: [
                  { $eq: ['$type', 'expense'] },
                  { $eq: ['$impactsWeeklyLimit', true] }
                ]
              },
              '$amount',
              0
            ]
          }
        },
        // Inflows, refunds or cashbacks credited to Hub 4 in the current week
        hub4WeeklyRefunds: {
          $sum: {
            $cond: [
              {
                $and: [
                  { $eq: ['$type', 'income'] },
                  { $eq: ['$hubRole', 'hub4_personal'] }
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

module.exports = { calculateWeeklySpeedometerAgg };

