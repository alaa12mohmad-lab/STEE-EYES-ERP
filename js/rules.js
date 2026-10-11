/* قواعد شاشة الحسابات — تطابق قيود جدول accounts في قاعدة البيانات (001 + 006).
   الحماية الحقيقية في قاعدة البيانات؛ هذا الملف فقط يمنع الخطأ قبل الإرسال ويشرحه بالعربي. */
(function (root) {
  'use strict';

  var LABELS = {
    type: { asset: 'أصل', liability: 'التزام', equity: 'حقوق ملكية', revenue: 'إيراد', expense: 'مصروف' },
    bs: {
      current_assets: 'أصول متداولة', non_current_assets: 'أصول غير متداولة',
      current_liabilities: 'التزامات متداولة', non_current_liabilities: 'التزامات غير متداولة', equity: 'حقوق الملكية'
    },
    income: {
      revenue: 'إيرادات', direct_cost: 'تكاليف مباشرة', admin_general: 'إدارية وعمومية',
      other_income: 'إيرادات أخرى', finance_cost: 'مصروفات تمويلية', tax: 'زكاة وضريبة دخل'
    },
    cfClass: { operating: 'تشغيلي', investing: 'استثماري', financing: 'تمويلي', cash: 'نقدية' },
    cfLine: {
      cf_receipts_customers: 'المقبوض من العملاء', cf_payments_suppliers: 'المدفوع للموردين وللمصروفات',
      cf_payments_employees: 'المدفوع للعاملين', cf_operating_other: 'تدفقات تشغيلية أخرى',
      cf_investing_ppe: 'شراء وبيع الأصول الثابتة', cf_investing_other: 'استثمارات أخرى',
      cf_financing_equity: 'مساهمات الملاك والمسحوبات', cf_financing_loans: 'القروض', cf_financing_other: 'تمويل آخر'
    },
    rule: { forbidden: 'ممنوع', optional: 'اختياري', required: 'إجباري' },
    partyKind: { any: 'أي نوع', customer: 'عميل', supplier: 'مورد', employee: 'موظف', partner: 'شريك' },
    vat: { none: 'لا', input: 'ضريبة مدخلات', output: 'ضريبة مخرجات' }
  };

  var BS_BY_TYPE = {
    asset: ['current_assets', 'non_current_assets'],
    liability: ['current_liabilities', 'non_current_liabilities'],
    equity: ['equity']
  };
  var LINE_CLASS = {
    cf_receipts_customers: 'operating', cf_payments_suppliers: 'operating', cf_payments_employees: 'operating',
    cf_operating_other: 'operating', cf_investing_ppe: 'investing', cf_investing_other: 'investing',
    cf_financing_equity: 'financing', cf_financing_loans: 'financing', cf_financing_other: 'financing'
  };

  function isPL(type) { return type === 'revenue' || type === 'expense'; }
  function blank(s) { return s === null || s === undefined || String(s).trim() === ''; }

  /* الخيارات المتاحة لبند التدفق حسب نوع الحساب وتصنيفه */
  function lineOptions(type, cfClass) {
    var out = [];
    Object.keys(LINE_CLASS).forEach(function (k) {
      if (isPL(type)) { if (LINE_CLASS[k] === 'operating') out.push(k); }
      else if (cfClass && LINE_CLASS[k] === cfClass) out.push(k);
    });
    return out;
  }

  /* يجعل القيم متسقة (يُستدعى عند كل تغيير في النموذج) */
  function normalize(a) {
    var x = Object.assign({}, a);
    ['manara_code', 'income_level', 'bs_section', 'cashflow_class', 'cashflow_line'].forEach(function (k) {
      if (blank(x[k])) x[k] = null;
    });
    if (blank(x.manara_code)) x.manara_code = null; else x.manara_code = String(x.manara_code).trim();
    if (!x.is_postable) {
      x.income_level = null; x.bs_section = null; x.cashflow_class = null; x.cashflow_line = null;
      x.is_cash_account = x.is_control_account = x.is_advance_account = x.is_noncash_adjustment = false;
      x.is_internal_only = false; x.manara_code = x.manara_code || null;
      x.party_rule = 'forbidden'; x.party_kind = 'any'; x.project_rule = 'forbidden';
      x.cost_center_rule = 'forbidden'; x.equipment_rule = 'forbidden'; x.vat_role = 'none';
      return x;
    }
    if (isPL(x.account_type)) {
      x.bs_section = null; x.cashflow_class = null;
      x.is_cash_account = x.is_control_account = x.is_advance_account = x.is_noncash_adjustment = false;
      if (x.income_level && x.account_type === 'revenue' && ['direct_cost', 'admin_general', 'finance_cost', 'tax'].indexOf(x.income_level) >= 0) {
        /* السماح بالتصنيف الحر؛ التنبيه فقط في الواجهة */
      }
    } else {
      x.income_level = null;
      if (BS_BY_TYPE[x.account_type] && BS_BY_TYPE[x.account_type].indexOf(x.bs_section) < 0) x.bs_section = null;
      if (x.account_type === 'equity') { x.is_cash_account = false; x.is_control_account = false; x.is_advance_account = false; x.is_noncash_adjustment = false; }
      if (x.account_type !== 'asset') x.is_cash_account = false;
      if (x.is_cash_account) { x.cashflow_class = 'cash'; x.is_control_account = false; x.is_advance_account = false; x.is_noncash_adjustment = false; }
      if (x.is_control_account) { x.party_rule = 'required'; x.is_advance_account = false; }
      if (x.is_advance_account && x.party_rule === 'forbidden') x.party_rule = 'optional';
      if (x.is_noncash_adjustment) { x.cashflow_class = 'operating'; }
    }
    if (x.is_internal_only) x.manara_code = x.manara_code; /* يُسمح بالاثنين */
    if (x.cashflow_line && lineOptions(x.account_type, x.cashflow_class).indexOf(x.cashflow_line) < 0) x.cashflow_line = null;
    return x;
  }

  /* يرجع قائمة أخطاء بالعربي (فارغة = صالح). parent: كائن الحساب الأب أو null */
  function validate(a, parent) {
    var e = [];
    if (blank(a.code)) e.push('الكود مطلوب');
    if (blank(a.name)) e.push('اسم الحساب مطلوب');
    if (!LABELS.type[a.account_type]) e.push('نوع الحساب مطلوب');
    if (parent) {
      if (parent.is_postable) e.push('الحساب الأب يقبل الإدخال المباشر؛ اختر حسابًا مجمّعًا');
      if (parent.account_type !== a.account_type) e.push('نوع الحساب يجب أن يطابق نوع الحساب الأب');
    }
    var pl = isPL(a.account_type);
    if (a.is_postable) {
      if (blank(a.manara_code) && !a.is_internal_only) e.push('كود المنارة مطلوب، أو علّم الحساب «تحليلي داخلي»');
      if (pl && !a.income_level) e.push('مستوى قائمة الدخل مطلوب');
      if (!pl) {
        if (!a.bs_section) e.push('تبويب الميزانية مطلوب (متداول / غير متداول)');
        if (!a.cashflow_class) e.push('تصنيف التدفق النقدي مطلوب');
      }
    }
    if (a.income_level && !pl) e.push('مستوى قائمة الدخل للإيرادات والمصروفات فقط');
    if (a.bs_section) {
      var okBs = BS_BY_TYPE[a.account_type];
      if (!okBs || okBs.indexOf(a.bs_section) < 0) e.push('تبويب الميزانية لا يطابق نوع الحساب');
    }
    if (a.is_cash_account && a.cashflow_class !== 'cash') e.push('حساب النقدية تصنيفه «نقدية»');
    if (a.is_control_account && a.party_rule !== 'required') e.push('حساب الرقابة يشترط الطرف (إجباري)');
    if (a.is_advance_account && a.party_rule === 'forbidden') e.push('حساب الدفعات المقدمة لا يكون الطرف فيه ممنوعًا');
    if (a.is_control_account && a.is_advance_account) e.push('الحساب لا يكون رقابة ودفعات مقدمة معًا');
    if (a.is_noncash_adjustment) {
      if (a.account_type !== 'asset' && a.account_type !== 'liability') e.push('التسوية غير النقدية لأصل أو التزام فقط');
      if (a.is_cash_account) e.push('التسوية غير النقدية لا تكون حساب نقدية');
      if (a.cashflow_class !== 'operating') e.push('التسوية غير النقدية تصنيفها «تشغيلي»');
    }
    if (a.cashflow_line) {
      var lc = LINE_CLASS[a.cashflow_line];
      if (lc === 'operating') { if (!(a.cashflow_class === 'operating' || a.cashflow_class === null || a.cashflow_class === undefined)) e.push('بند التدفق لا يطابق تصنيف التدفق'); }
      else if (a.cashflow_class !== lc) e.push('بند التدفق لا يطابق تصنيف التدفق');
    }
    return e;
  }

  /* ترجمة أخطاء قاعدة البيانات */
  function translateDbError(err) {
    var m = (err && err.message) ? String(err.message) : String(err || '');
    if (/P0001|لا يمكن|القيد|الحساب/.test(m) && /[؀-ۿ]/.test(m)) return m.replace(/^.*?P0001:\s*/, '');
    if (/duplicate key|unique constraint/i.test(m)) return 'الكود مستخدم من قبل في هذه الشركة';
    if (/row-level security|permission denied/i.test(m)) return 'لا تملك صلاحية تنفيذ هذا الإجراء';
    if (/check constraint/i.test(m)) return 'بيانات الحساب لا تحقق قواعد النظام. راجع التبويب والتصنيف وقواعد الطرف.';
    if (/Invalid login credentials/i.test(m)) return 'الإيميل أو كلمة السر غير صحيحة';
    if (/Email not confirmed/i.test(m)) return 'الحساب غير مؤكَّد. فعّل «Auto Confirm User» من لوحة Supabase';
    if (/Failed to fetch|NetworkError/i.test(m)) return 'تعذّر الاتصال بالخادم. راجع الإنترنت ورابط المشروع في config.js';
    return m;
  }

  var api = { LABELS: LABELS, validate: validate, normalize: normalize, lineOptions: lineOptions, translateDbError: translateDbError, isPL: isPL, BS_BY_TYPE: BS_BY_TYPE };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.AccRules = api;
})(typeof window !== 'undefined' ? window : globalThis);
