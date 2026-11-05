const { z } = require('zod');
const mongoose = require('mongoose');

const objectIdValidator = z.string().refine(
  val => mongoose.Types.ObjectId.isValid(val),
  { message: 'Mã ObjectId không hợp lệ' }
);

const transactionSchema = z.object({
  title: z.string({ required_error: 'Vui lòng nhập tên giao dịch' })
    .trim()
    .min(1, 'Tên giao dịch không được để trống')
    .max(255, 'Tên giao dịch không quá 255 ký tự'),

  // Bắt buộc số dương (ngăn chặn số âm, NaN, vô cực)
  amount: z.coerce.number({ required_error: 'Vui lòng nhập số tiền', invalid_type_error: 'Số tiền phải là số' })
    .positive('Số tiền phải lớn hơn 0đ')
    .finite('Số tiền phải là số hữu hạn'),

  type: z.enum(['income', 'expense', 'transfer'], {
    errorMap: () => ({ message: "Loại giao dịch phải là 'income', 'expense' hoặc 'transfer'" })
  }),

  // Kiểm soát nghiêm ngặt 4 Hub
  hubRole: z.enum(['hub1_income', 'hub2_dining', 'hub3_family', 'hub4_personal'], {
    errorMap: () => ({ message: "hubRole phải thuộc 1 trong 4 Hub: 'hub1_income', 'hub2_dining', 'hub3_family', 'hub4_personal'" })
  }),

  // Hỗ trợ cả accountId (nếu truyền) và accountName
  accountId: objectIdValidator.optional().nullable(),
  toAccountId: objectIdValidator.optional().nullable(),
  accountName: z.string().trim().optional().default('Vietcombank'),
  toAccountName: z.string().trim().optional().default(''),

  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Ngày phải theo định dạng YYYY-MM-DD').optional(),
  category: z.string().max(100).optional().default('Chi tiêu'),
  impactsWeeklyLimit: z.boolean().optional().default(false),
  notes: z.string().max(1000).optional().default('')
}).refine(data => {
  if (data.type === 'transfer') {
    // Nếu là chuyển khoản: tài khoản nhận không được trùng tài khoản xuất
    const nameDiff = data.accountName && data.toAccountName ? data.accountName !== data.toAccountName : true;
    const idDiff = data.accountId && data.toAccountId ? data.accountId !== data.toAccountId : true;
    return nameDiff && idDiff;
  }
  return true;
}, {
  message: 'Tài khoản nhận không được trùng với tài khoản nguồn',
  path: ['toAccountName']
});

/**
 * Express middleware để validate payload tạo/sửa giao dịch
 */
function validateTransaction(req, res, next) {
  try {
    const validatedData = transactionSchema.parse(req.body);
    req.body = validatedData; // Gán dữ liệu đã chuẩn hóa
    next();
  } catch (err) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({
        success: false,
        message: err.errors.map(e => e.message).join('; '),
        errors: err.errors.map(e => ({
          field: e.path.join('.'),
          message: e.message
        }))
      });
    }
    return res.status(500).json({ success: false, message: 'Lỗi xác thực dữ liệu: ' + err.message });
  }
}

module.exports = {
  transactionSchema,
  validateTransaction
};

