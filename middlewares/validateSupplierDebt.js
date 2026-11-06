const { z } = require('zod');

// Schema cho dueDate: chấp nhận string ngày (YYYY-MM-DD hoặc ISO), Date object, hoặc null/rỗng
const dueDateValidator = z.preprocess((val) => {
  if (val === '' || val === null || val === undefined) return null;
  const d = new Date(val);
  return isNaN(d.getTime()) ? val : d;
}, z.date({ invalid_type_error: 'Ngày đến hạn thanh toán (dueDate) không hợp lệ' }).nullable().optional());

const supplierDebtSchema = z.object({
  supplierName: z.string({ required_error: 'Vui lòng nhập tên nhà cung cấp' })
    .trim()
    .min(1, 'Tên nhà cung cấp không được để trống')
    .max(255, 'Tên nhà cung cấp không được quá 255 ký tự'),

  totalAmount: z.coerce.number({ invalid_type_error: 'Tổng tiền phải là số' })
    .min(0, 'Tổng tiền không được âm')
    .optional(),

  paidAmount: z.coerce.number({ invalid_type_error: 'Tiền đã trả phải là số' })
    .min(0, 'Tiền đã trả không được âm')
    .optional(),

  remainingAmount: z.coerce.number({ invalid_type_error: 'Số tiền nợ phải là số' })
    .min(0, 'Số tiền nợ không được âm')
    .optional(),

  dueDate: dueDateValidator,

  phone: z.string().trim().max(50).optional().default(''),
  bankInfo: z.string().trim().max(500).optional().default(''),
  notes: z.string().trim().max(1000).optional().default('')
});

const supplierDebtUpdateSchema = supplierDebtSchema.partial();

/**
 * Express middleware xác thực dữ liệu đầu vào cho SupplierDebt
 */
function validateSupplierDebt(req, res, next) {
  try {
    const isUpdate = req.method === 'PUT' || req.method === 'PATCH';
    const schema = isUpdate ? supplierDebtUpdateSchema : supplierDebtSchema;
    const validatedData = schema.parse(req.body);
    req.body = validatedData;
    next();
  } catch (err) {
    if (err instanceof z.ZodError) {
      const issueList = err.issues || err.errors || [];
      return res.status(400).json({
        success: false,
        message: issueList.map(e => e.message).join('; '),
        errors: issueList.map(e => ({
          field: e.path.join('.'),
          message: e.message
        }))
      });
    }
    return res.status(500).json({ success: false, message: 'Lỗi xác thực dữ liệu NCC: ' + err.message });
  }
}

module.exports = {
  supplierDebtSchema,
  supplierDebtUpdateSchema,
  validateSupplierDebt
};

