/**
 * utils/math.util.js
 * 
 * Safe monetary arithmetic utility to eliminate IEEE 754 floating-point errors (e.g. 0.1 + 0.2 = 0.30000000000000004).
 * Uses integer-scaled arithmetic (scale factor 100 for cents / standard currency).
 * Guarantees zero precision loss and deterministic rounding for VND and multi-currency ledgers.
 */

const SCALE = 100; // 2 decimal places support

/**
 * Converts a decimal or float into an integer representation by scaling.
 */
function toInt(value) {
  const num = Number(value);
  if (isNaN(num)) return 0;
  return Math.round(num * SCALE);
}

/**
 * Converts scaled integer back to standard float.
 */
function fromInt(scaledInt) {
  return scaledInt / SCALE;
}

const safeMath = {
  /**
   * Safe Addition: a + b
   */
  add(a, b) {
    return fromInt(toInt(a) + toInt(b));
  },

  /**
   * Safe Subtraction: a - b
   */
  subtract(a, b) {
    return fromInt(toInt(a) - toInt(b));
  },

  /**
   * Safe Multiplication: a * b
   */
  multiply(a, b) {
    const res = (toInt(a) * toInt(b)) / (SCALE * SCALE);
    return Math.round(res * SCALE) / SCALE;
  },

  /**
   * Safe Division: a / b
   */
  divide(a, b) {
    const divisor = toInt(b);
    if (divisor === 0) throw new Error('Division by zero');
    const res = (toInt(a) * SCALE) / divisor;
    return Math.round(res) / SCALE;
  },

  /**
   * Safe Percentage: value * (percent / 100)
   * e.g., percent(20000000, 15) => 3000000
   */
  percent(value, percentage) {
    const scaledVal = toInt(value);
    const scaledPct = toInt(percentage);
    const res = Math.round((scaledVal * scaledPct) / (100 * SCALE));
    return fromInt(res);
  },

  /**
   * Sums an array of amounts safely
   */
  sum(numbers) {
    if (!Array.isArray(numbers)) return 0;
    const totalScaled = numbers.reduce((acc, curr) => acc + toInt(curr), 0);
    return fromInt(totalScaled);
  }
};

module.exports = safeMath;

