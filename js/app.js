/* واجهة النظام — الدخول، اختيار الشركة، شجرة الحسابات.
   كل الكتابة تمر بقاعدة البيانات (RLS + القيود)؛ الواجهة تمنع الخطأ مبكرًا وتشرحه بالعربي. */
(function (root) {
  'use strict';
  var R = root.AccRules;
  var L = R.LABELS;

  var COLS = ['code', 'name', 'parent_id', 'account_type', 'is_postable', 'is_active', 'manara_code', 'is_internal_only',
    'income_level', 'bs_section', 'cashflow_class', 'cashflow_line', 'party_rule', 'party_kind', 'project_rule',
    'cost_center_rule', 'equipment_rule', 'is_cash_account', 'is_control_account', 'is_advance_account',
    'is_noncash_adjustment', 'vat_role'];

  function esc(s) {
    return String(s === null || s === undefined ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function opts(map, sel, withBlank) {
    var h = withBlank ? '<option value="">— اختر —</option>' : '';
    Object.keys(map).forEach(function (k) { h += '<option value="' + esc(k) + '"' + (k === sel ? ' selected' : '') + '>' + esc(map[k]) + '</option>'; });
    return h;
  }
  function natCmp(a, b) { return String(a.code).localeCompare(String(b.code), 'en', { numeric: true }); }
  function store(k, v) { try { if (v === undefined) return localStorage.getItem(k); localStorage.setItem(k, v); } catch (e) { return null; } }

  function blankAccount(parent) {
    return {
      code: '', name: '', parent_id: parent ? parent.id : null, account_type: parent ? parent.account_type : 'asset',
      is_postable: true, is_active: true, manara_code: null, is_internal_only: false, income_level: null, bs_section: null,
      cashflow_class: null, cashflow_line: null, party_rule: 'forbidden', party_kind: 'any', project_rule: 'forbidden',
      cost_center_rule: 'forbidden', equipment_rule: 'forbidden', is_cash_account: false, is_control_account: false,
      is_advance_account: false, is_noncash_adjustment: false, vat_role: 'none'
    };
  }

  function create(sb, rootEl, doc) {
    doc = doc || root.document;
    var S = { user: null, companies: null, company: null, accounts: [], moved: {}, open: {}, q: '', form: null, formId: null, formErrs: [], busy: false, err: '' };

    function $(sel) { return rootEl.querySelector(sel); }
    function toast(msg) {
      var t = doc.getElementById('toast'); if (!t) return;
      t.textContent = msg; t.hidden = false;
      clearTimeout(toast._t); toast._t = setTimeout(function () { t.hidden = true; }, 3500);
    }
    function theme() {
      var cur = doc.documentElement.getAttribute('data-theme') || 'auto';
      var nx = cur === 'dark' ? 'light' : 'dark';
      doc.documentElement.setAttribute('data-theme', nx); store('theme', nx);
    }
    var saved = store('theme'); if (saved) doc.documentElement.setAttribute('data-theme', saved);

    /* ---------- شاشات ---------- */
    function topbar() {
      return '<div class="top"><h1>نظام الحسابات</h1>' +
        (S.company ? '<span class="chip">' + esc(S.company.name) + '</span><span class="chip">' + esc(S.company.role === 'admin' ? 'مدير' : S.company.role === 'accountant' ? 'محاسب' : S.company.role === 'entry' ? 'مدخل بيانات' : 'مشاهدة') + '</span>' : '') +
        '<span class="sp"></span>' +
        (S.company ? '<button data-act="switch" class="sm">تغيير الشركة</button>' : '') +
        '<button data-act="theme" class="sm" title="الوضع الداكن/الفاتح">◐</button>' +
        (S.user ? '<button data-act="logout" class="sm">خروج</button>' : '') + '</div>';
    }

    function viewLogin() {
      rootEl.innerHTML = topbar() + '<div class="wrap"><form class="card center" data-form="login"><h2>تسجيل الدخول</h2>' +
        '<label for="em">الإيميل</label><input id="em" name="email" type="email" autocomplete="username" required dir="ltr">' +
        '<label for="pw">كلمة السر</label><input id="pw" name="password" type="password" autocomplete="current-password" required dir="ltr">' +
        (S.err ? '<div class="err">' + esc(S.err) + '</div>' : '') +
        '<div class="mf"><button class="pri" type="submit"' + (S.busy ? ' disabled' : '') + '>' + (S.busy ? 'جارٍ الدخول…' : 'دخول') + '</button></div></form></div>';
    }

    function viewCompanies() {
      var h = topbar() + '<div class="wrap"><h2>اختر الشركة</h2>';
      if (S.err) h += '<div class="err">' + esc(S.err) + '</div>';
      if (!S.companies.length) {
        h += '<div class="card"><p>حسابك مسجَّل لكن مفيش شركة مربوطة بيه. شغّل الكود ده مرة واحدة في Supabase ← SQL Editor (غيّر اسم الشركة):</p>' +
          '<div class="box">' + esc(
            "do $$ declare c uuid; u uuid;\nbegin\n  select id into u from auth.users where email = '" + (S.user ? S.user.email : 'YOUR@EMAIL') + "';\n" +
            "  insert into companies(name, tax_regime) values ('اسم الشركة','zakat') returning id into c;\n" +
            "  insert into user_company_roles(user_id, company_id, role) values (u, c, 'admin');\nend $$;") +
          '</div><p class="mut">tax_regime: zakat أو income_tax. بعدها اضغط تحديث.</p><button data-act="reload" class="pri">تحديث</button></div>';
      } else {
        h += '<div class="list">' + S.companies.map(function (c) {
          return '<button class="co card" data-act="pick" data-id="' + esc(c.id) + '"><strong>' + esc(c.name) + '</strong><span class="chip">' +
            esc(c.role === 'admin' ? 'مدير' : c.role === 'accountant' ? 'محاسب' : c.role === 'entry' ? 'مدخل بيانات' : 'مشاهدة') + '</span></button>';
        }).join('') + '</div>';
      }
      rootEl.innerHTML = h + '</div>';
    }

    function flags(a) {
      var f = [];
      if (a.is_cash_account) f.push('نقدية'); if (a.is_control_account) f.push('رقابة'); if (a.is_advance_account) f.push('دفعات مقدمة');
      if (a.is_noncash_adjustment) f.push('تسوية غير نقدية'); if (a.is_internal_only) f.push('داخلي');
      if (a.party_rule !== 'forbidden') f.push('طرف: ' + L.rule[a.party_rule]);
      if (a.project_rule !== 'forbidden') f.push('مشروع: ' + L.rule[a.project_rule]);
      if (a.cost_center_rule !== 'forbidden') f.push('مركز: ' + L.rule[a.cost_center_rule]);
      if (a.equipment_rule !== 'forbidden') f.push('معدة: ' + L.rule[a.equipment_rule]);
      return f.map(function (x) { return '<span class="chip">' + esc(x) + '</span>'; }).join('');
    }

    function childrenMap() {
      var m = {};
      S.accounts.forEach(function (a) { (m[a.parent_id || 'root'] = m[a.parent_id || 'root'] || []).push(a); });
      Object.keys(m).forEach(function (k) { m[k].sort(natCmp); });
      return m;
    }

    function treeRows() {
      var m = childrenMap(), q = S.q.trim().toLowerCase(), out = [], canW = canWrite();
      var match = {};
      if (q) {
        S.accounts.forEach(function (a) {
          if ((a.code + ' ' + a.name + ' ' + (a.manara_code || '')).toLowerCase().indexOf(q) >= 0) {
            var x = a; while (x) { match[x.id] = true; x = x.parent_id ? S.accounts.filter(function (p) { return p.id === x.parent_id; })[0] : null; }
          }
        });
      }
      function walk(pid, depth) {
        (m[pid] || []).forEach(function (a) {
          if (q && !match[a.id]) return;
          var kids = m[a.id] || [], isOpen = q ? true : S.open[a.id] !== false;
          var grp = !a.is_postable;
          out.push('<div class="row' + (grp ? ' grp' : '') + (a.is_active ? '' : ' off') + '" style="padding-inline-start:' + (0.75 + depth * 1.4) + 'rem">' +
            '<span class="tg" data-act="tog" data-id="' + esc(a.id) + '">' + (kids.length ? (isOpen ? '▾' : '◂') : '') + '</span>' +
            '<span class="code">' + esc(a.code) + '</span><span class="nm">' + esc(a.name) +
            ' <span class="chip">' + esc(L.type[a.account_type]) + '</span>' +
            (grp ? '<span class="chip">مجمّع</span>' : '') + (a.is_active ? '' : '<span class="chip w">معطّل</span>') +
            (a.manara_code ? '<span class="chip">منارة ' + esc(a.manara_code) + '</span>' : '') + flags(a) + '</span>' +
            (canW ? '<span class="act">' +
              (grp ? '<button class="sm" data-act="add" data-id="' + esc(a.id) + '">+ فرعي</button>' : '') +
              '<button class="sm" data-act="edit" data-id="' + esc(a.id) + '">تعديل</button>' +
              '<button class="sm" data-act="active" data-id="' + esc(a.id) + '">' + (a.is_active ? 'تعطيل' : 'تفعيل') + '</button>' +
              (!kids.length && !S.moved[a.id] ? '<button class="sm danger" data-act="del" data-id="' + esc(a.id) + '">حذف</button>' : '') +
              '</span>' : '') + '</div>');
          if (kids.length && isOpen) walk(a.id, depth + 1);
        });
      }
      walk('root', 0);
      return out;
    }

    function canWrite() { return S.company && (S.company.role === 'admin' || S.company.role === 'accountant'); }

    function viewAccounts() {
      var rows = treeRows();
      rootEl.innerHTML = topbar() + '<div class="wrap"><div class="bar"><h2 style="margin:0">شجرة الحسابات</h2><span class="sp"></span>' +
        '<input type="search" id="q" placeholder="بحث بالكود أو الاسم" value="' + esc(S.q) + '">' +
        (canWrite() ? '<button class="pri" data-act="add" data-id="">+ حساب جديد</button>' : '<span class="chip">عرض فقط</span>') + '</div>' +
        (S.err ? '<div class="err">' + esc(S.err) + '</div>' : '') +
        '<div class="tree">' + (rows.length ? rows.join('') : '<div class="empty">' + (S.accounts.length ? 'لا نتائج' : 'الشجرة فاضية. ابدأ بإضافة حساب مجمّع (مثل: الأصول) ثم الحسابات الفرعية تحته.') + '</div>') + '</div></div>';
      if (S.form) renderModal();
    }

    function renderModal() {
      var f = S.form, parent = f.parent_id ? byId(f.parent_id) : null, locked = S.formId && S.moved[S.formId];
      var pl = R.isPL(f.account_type);
      var groups = S.accounts.filter(function (a) { return !a.is_postable && a.id !== S.formId; }).sort(natCmp);
      var lines = R.lineOptions(f.account_type, f.cashflow_class);
      var lineMap = {}; lines.forEach(function (k) { lineMap[k] = L.cfLine[k]; });
      var typeMap = {}; Object.keys(L.type).forEach(function (k) { typeMap[k] = L.type[k]; });
      var bsMap = {}; (R.BS_BY_TYPE[f.account_type] || []).forEach(function (k) { bsMap[k] = L.bs[k]; });
      var cfcMap = { operating: L.cfClass.operating, investing: L.cfClass.investing, financing: L.cfClass.financing };
      if (f.is_cash_account) cfcMap = { cash: L.cfClass.cash };
      var post = f.is_postable, bal = post && !pl;
      var h = '<div class="modal"><form class="card" data-form="acc"><h2>' + (S.formId ? 'تعديل حساب' : 'حساب جديد') + '</h2>';
      if (locked) h += '<div class="mut" style="font-size:.85rem">الحساب عليه حركات: الكود والنوع ونوع التجميع مقفولين.</div>';
      h += '<div class="g2"><div><label>الكود</label><input name="code" value="' + esc(f.code) + '" dir="ltr"' + (locked ? ' disabled' : '') + '></div>' +
        '<div><label>الاسم</label><input name="name" value="' + esc(f.name) + '"></div>' +
        '<div><label>الحساب الأب</label><select name="parent_id"' + (locked ? ' disabled' : '') + '><option value="">— بدون (مستوى أعلى) —</option>' +
        groups.map(function (g) { return '<option value="' + esc(g.id) + '"' + (g.id === f.parent_id ? ' selected' : '') + '>' + esc(g.code + ' ' + g.name) + '</option>'; }).join('') + '</select></div>' +
        '<div><label>النوع</label><select name="account_type"' + (locked || parent ? ' disabled' : '') + '>' + opts(typeMap, f.account_type) + '</select></div></div>';
      h += '<div class="chk"><input type="checkbox" name="is_postable" id="f_post"' + (post ? ' checked' : '') + (locked ? ' disabled' : '') + '><label for="f_post" style="margin:0">يقبل الإدخال المباشر (حساب تفصيلي). لو مش متعلّم = حساب مجمّع</label></div>';
      if (post) {
        h += '<fieldset><legend>المنارة</legend><div class="g2"><div><label>كود المنارة</label><input name="manara_code" value="' + esc(f.manara_code || '') + '" dir="ltr"></div>' +
          '<div class="chk" style="align-self:end"><input type="checkbox" name="is_internal_only" id="f_int"' + (f.is_internal_only ? ' checked' : '') + '><label for="f_int" style="margin:0">تحليلي داخلي (ليس له كود في المنارة)</label></div></div></fieldset>';
        h += '<fieldset><legend>القوائم المالية</legend><div class="g2">';
        if (pl) h += '<div><label>مستوى قائمة الدخل</label><select name="income_level">' + opts(L.income, f.income_level, true) + '</select></div>';
        else h += '<div><label>تبويب الميزانية</label><select name="bs_section">' + opts(bsMap, f.bs_section, true) + '</select></div>' +
          '<div><label>تصنيف التدفق النقدي</label><select name="cashflow_class"' + (f.is_cash_account ? ' disabled' : '') + '>' + opts(cfcMap, f.cashflow_class, true) + '</select></div>';
        h += '<div><label>بند التدفق (للطريقة المباشرة)</label><select name="cashflow_line">' + opts(lineMap, f.cashflow_line, true) + '</select></div></div></fieldset>';
        h += '<fieldset><legend>قواعد الإدخال على هذا الحساب</legend><div class="g2">' +
          '<div><label>الطرف (عميل/مورد…)</label><select name="party_rule"' + (f.is_control_account ? ' disabled' : '') + '>' + opts(L.rule, f.party_rule) + '</select></div>' +
          '<div><label>نوع الطرف</label><select name="party_kind">' + opts(L.partyKind, f.party_kind) + '</select></div>' +
          '<div><label>المشروع</label><select name="project_rule">' + opts(L.rule, f.project_rule) + '</select></div>' +
          '<div><label>مركز التكلفة</label><select name="cost_center_rule">' + opts(L.rule, f.cost_center_rule) + '</select></div>' +
          '<div><label>المعدة</label><select name="equipment_rule">' + opts(L.rule, f.equipment_rule) + '</select></div>' +
          '<div><label>ضريبة القيمة المضافة</label><select name="vat_role">' + opts(L.vat, f.vat_role) + '</select></div></div></fieldset>';
        if (bal) {
          h += '<fieldset><legend>خصائص خاصة</legend>' +
            (f.account_type === 'asset' ? chk('is_cash_account', 'حساب نقدية (صندوق/بنك)', f) : '') +
            (f.account_type !== 'equity' ? chk('is_control_account', 'حساب رقابة (عملاء/موردين) — يشترط طرفًا', f) + chk('is_advance_account', 'حساب دفعات مقدمة', f) +
              ((f.account_type === 'asset' || f.account_type === 'liability') ? chk('is_noncash_adjustment', 'تسوية غير نقدية (إهلاك/مخصص…)', f) : '') : '') + '</fieldset>';
        }
      }
      h += '<div class="chk"><input type="checkbox" name="is_active" id="f_act"' + (f.is_active ? ' checked' : '') + '><label for="f_act" style="margin:0">الحساب نشط</label></div>';
      if (S.formErrs.length) h += '<div class="errs"><ul>' + S.formErrs.map(function (e) { return '<li>' + esc(e) + '</li>'; }).join('') + '</ul></div>';
      h += '<div class="mf"><button type="button" data-act="cancel">إلغاء</button><button class="pri" type="submit"' + (S.busy ? ' disabled' : '') + '>' + (S.busy ? 'جارٍ الحفظ…' : 'حفظ') + '</button></div></form></div>';
      var old = $('.modal'); if (old) old.remove();
      rootEl.insertAdjacentHTML('beforeend', h);
    }
    function chk(n, t, f) { return '<div class="chk"><input type="checkbox" name="' + n + '" id="f_' + n + '"' + (f[n] ? ' checked' : '') + '><label for="f_' + n + '" style="margin:0">' + esc(t) + '</label></div>'; }
    function byId(id) { return S.accounts.filter(function (a) { return a.id === id; })[0] || null; }

    /* ---------- بيانات ---------- */
    function fail(e) { S.err = R.translateDbError(e); }

    function loadCompanies() {
      S.err = '';
      return sb.from('user_company_roles').select('company_id,role').eq('user_id', S.user.id).eq('active', true).then(function (r) {
        if (r.error) throw r.error;
        var roles = r.data || [];
        if (!roles.length) { S.companies = []; return; }
        return sb.from('companies').select('id,name').in('id', roles.map(function (x) { return x.company_id; })).then(function (c) {
          if (c.error) throw c.error;
          var rm = {}; roles.forEach(function (x) { rm[x.company_id] = x.role; });
          S.companies = (c.data || []).map(function (x) { return { id: x.id, name: x.name, role: rm[x.id] }; }).sort(function (a, b) { return a.name.localeCompare(b.name, 'ar'); });
        });
      });
    }

    function loadAccounts() {
      var id = S.company.id;
      return Promise.all([
        sb.from('accounts').select('*').eq('company_id', id).order('code'),
        sb.from('v_trial_balance').select('account_id,total_debit,total_credit').eq('company_id', id)
      ]).then(function (rs) {
        if (rs[0].error) throw rs[0].error;
        S.accounts = rs[0].data || [];
        S.moved = {};
        ((rs[1].data) || []).forEach(function (x) { if (Number(x.total_debit) !== 0 || Number(x.total_credit) !== 0) S.moved[x.account_id] = true; });
        /* الأب يحمل «حركات» إن كان أحد أبنائه كذلك — لا حاجة؛ الأب المجمّع لا يقبل حركات */
      });
    }

    function enterCompany(id) {
      S.company = S.companies.filter(function (c) { return c.id === id; })[0]; if (!S.company) return Promise.resolve();
      store('company', id); S.q = ''; S.form = null; S.err = '';
      return loadAccounts().then(viewAccounts, function (e) { fail(e); viewAccounts(); });
    }

    function route() {
      if (!S.user) return viewLogin();
      if (!S.company) return viewCompanies();
      return viewAccounts();
    }

    function afterLogin(user) {
      S.user = user; S.company = null; S.err = '';
      return loadCompanies().then(function () {
        var last = store('company');
        if (last && S.companies.some(function (c) { return c.id === last; })) return enterCompany(last);
        if (S.companies.length === 1) return enterCompany(S.companies[0].id);
        route();
      }, function (e) { fail(e); S.companies = S.companies || []; route(); });
    }

    function start() {
      return sb.auth.getSession().then(function (r) {
        var s = r.data && r.data.session;
        if (s) return afterLogin(s.user);
        route();
      }, function () { route(); });
    }

    /* ---------- أحداث ---------- */
    function readForm(form) {
      var f = Object.assign({}, S.form);
      Array.prototype.forEach.call(form.elements, function (el) {
        if (!el.name || el.disabled) return;
        if (el.type === 'checkbox') f[el.name] = el.checked;
        else f[el.name] = el.value === '' ? (el.tagName === 'SELECT' ? null : el.value) : el.value;
      });
      return f;
    }

    function submitAccount(form) {
      var f = R.normalize(readForm(form));
      if (S.formId && S.moved[S.formId]) { var o = byId(S.formId); f.code = o.code; f.account_type = o.account_type; f.is_postable = o.is_postable; f.parent_id = o.parent_id; }
      var parent = f.parent_id ? byId(f.parent_id) : null;
      if (parent) f.account_type = parent.account_type;
      f.code = (f.code || '').trim(); f.name = (f.name || '').trim();
      S.form = f; S.formErrs = R.validate(f, parent);
      var dup = S.accounts.some(function (a) { return a.id !== S.formId && a.code === f.code; });
      if (dup) S.formErrs.push('الكود مستخدم من قبل في هذه الشركة');
      if (S.formErrs.length) return renderModal();
      var payload = {}; COLS.forEach(function (k) { payload[k] = f[k] === undefined ? null : f[k]; });
      S.busy = true; renderModal();
      var q = S.formId ? sb.from('accounts').update(payload).eq('id', S.formId).eq('company_id', S.company.id)
        : sb.from('accounts').insert(Object.assign({ company_id: S.company.id }, payload));
      return q.then(function (r) {
        S.busy = false;
        if (r.error) { S.formErrs = [R.translateDbError(r.error)]; return renderModal(); }
        S.form = null; toast('تم الحفظ');
        return loadAccounts().then(viewAccounts);
      }, function (e) { S.busy = false; S.formErrs = [R.translateDbError(e)]; renderModal(); });
    }

    function onClick(ev) {
      var t = ev.target.closest('[data-act]'); if (!t) return;
      var act = t.getAttribute('data-act'), id = t.getAttribute('data-id');
      if (act === 'theme') return theme();
      if (act === 'logout') return sb.auth.signOut().then(function () { S.user = null; S.company = null; store('company', ''); S.err = ''; route(); });
      if (act === 'switch') { S.company = null; S.form = null; store('company', ''); return route(); }
      if (act === 'reload') return loadCompanies().then(route, function (e) { fail(e); route(); });
      if (act === 'pick') return enterCompany(id);
      if (act === 'tog') { S.open[id] = S.open[id] === false; return viewAccounts(); }
      if (act === 'cancel') { S.form = null; S.formErrs = []; return viewAccounts(); }
      if (act === 'add') { var p = id ? byId(id) : null; S.formId = null; S.form = blankAccount(p); S.formErrs = []; return renderModal(); }
      if (act === 'edit') { var a = byId(id); S.formId = id; S.form = Object.assign({}, a); S.formErrs = []; return renderModal(); }
      if (act === 'active') {
        var ac = byId(id);
        return sb.from('accounts').update({ is_active: !ac.is_active }).eq('id', id).eq('company_id', S.company.id).then(function (r) {
          if (r.error) { fail(r.error); return viewAccounts(); }
          S.err = ''; return loadAccounts().then(viewAccounts);
        });
      }
      if (act === 'del') {
        var d = byId(id);
        if (!root.confirm || !root.confirm('حذف الحساب ' + d.code + ' ' + d.name + '؟')) return;
        return sb.from('accounts').delete().eq('id', id).eq('company_id', S.company.id).then(function (r) {
          if (r.error) { fail(r.error); return viewAccounts(); }
          S.err = ''; toast('تم الحذف'); return loadAccounts().then(viewAccounts);
        });
      }
    }

    function onChange(ev) {
      var el = ev.target, form = el.form; if (!form || form.getAttribute('data-form') !== 'acc') return;
      var f = readForm(form), prevType = S.form.account_type;
      var parent = f.parent_id ? byId(f.parent_id) : null;
      if (parent) f.account_type = parent.account_type;
      if (el.name === 'account_type' && f.account_type !== prevType) { f.bs_section = null; f.cashflow_class = null; f.cashflow_line = null; f.income_level = null; }
      S.form = R.normalize(f); S.formErrs = [];
      renderModal();
    }

    function onSubmit(ev) {
      var form = ev.target, kind = form.getAttribute('data-form'); if (!kind) return;
      ev.preventDefault();
      if (kind === 'acc') return submitAccount(form);
      if (kind === 'login') {
        if (S.busy) return;
        var email = form.elements.email.value.trim(), pw = form.elements.password.value;
        S.busy = true; S.err = '';
        return sb.auth.signInWithPassword({ email: email, password: pw }).then(function (r) {
          S.busy = false;
          if (r.error) { fail(r.error); return viewLogin(); }
          return afterLogin(r.data.user);
        }, function (e) { S.busy = false; fail(e); viewLogin(); });
      }
    }

    function onInput(ev) {
      if (ev.target.id === 'q') { S.q = ev.target.value; var pos = ev.target.selectionStart; viewAccounts(); var q = $('#q'); if (q) { q.focus(); try { q.setSelectionRange(pos, pos); } catch (e) { } } }
    }

    rootEl.addEventListener('click', onClick);
    rootEl.addEventListener('change', onChange);
    rootEl.addEventListener('submit', onSubmit);
    rootEl.addEventListener('input', onInput);
    return { start: start, state: S };
  }

  var api = { create: create, esc: esc };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.AccApp = api;

  /* تشغيل تلقائي في المتصفح */
  if (typeof document !== 'undefined' && root.document && root.APP_CONFIG && !root.__NO_AUTOSTART__) {
    var cfg = root.APP_CONFIG, el = document.getElementById('app');
    if (!root.supabase || !cfg || /YOUR-/.test(cfg.SUPABASE_URL + cfg.SUPABASE_ANON_KEY)) {
      el.innerHTML = '<div class="wrap"><div class="card center"><h2>الإعداد ناقص</h2><p>افتح ملف <b>js/config.js</b> وضع رابط المشروع ومفتاح anon (publishable) من Supabase، ثم ارفعه من جديد.</p></div></div>';
    } else {
      var client = root.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY);
      create(client, el, document).start();
    }
  }
})(typeof window !== 'undefined' ? window : globalThis);
