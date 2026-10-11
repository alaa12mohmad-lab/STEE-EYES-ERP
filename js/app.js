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
    var NAV = [['accounts', 'الحسابات'], ['roles', 'ربط الأدوار'], ['projects', 'المشاريع'], ['cost_centers', 'مراكز التكلفة'], ['parties', 'الأطراف']];
    var S = { view: 'accounts', rows: [], roleMap: {}, gform: null, user: null, companies: null, company: null, accounts: [], moved: {}, open: {}, q: '', form: null, formId: null, formErrs: [], busy: false, err: '' };

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
        (S.company ? NAV.map(function (n) { return '<button class="sm' + (S.view === n[0] ? ' pri' : '') + '" data-act="nav" data-id="' + n[0] + '">' + n[1] + '</button>'; }).join('') : '') +
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
      S.view = 'accounts';
      return loadAccounts().then(viewAccounts, function (e) { fail(e); viewAccounts(); });
    }

    function route() {
      if (!S.user) return viewLogin();
      if (!S.company) return viewCompanies();
      return render();
    }
    function render() {
      return ({ accounts: viewAccounts, roles: viewRoles, projects: viewList, cost_centers: viewList, parties: viewList }[S.view] || viewAccounts)();
    }
    function go(v) {
      S.view = v; S.q = ''; S.err = ''; S.form = null; S.gform = null;
      return loadView().then(render, function (e) { fail(e); render(); });
    }
    function loadView() {
      var id = S.company.id;
      if (S.view === 'accounts') return loadAccounts();
      if (S.view === 'roles') return Promise.all([loadAccounts(), sb.from('account_roles').select('role_code,account_id').eq('company_id', id)]).then(function (r) {
        if (r[1].error) throw r[1].error;
        S.roleMap = {}; (r[1].data || []).forEach(function (x) { S.roleMap[x.role_code] = x.account_id; });
      });
      if (S.view === 'projects' || S.view === 'cost_centers') return sb.from(S.view).select('*').eq('company_id', id).order('code').then(function (r) {
        if (r.error) throw r.error; S.rows = r.data || [];
      });
      if (S.view === 'parties') return Promise.all([
        sb.from('party_companies').select('party_id,manara_account_code,active,parties(*)').eq('company_id', id),
        sb.from('parties').select('id,name,kind')
      ]).then(function (r) {
        if (r[0].error) throw r[0].error; if (r[1].error) throw r[1].error;
        S.rows = (r[0].data || []).filter(function (x) { return x.parties; }).map(function (x) {
          return Object.assign({}, x.parties, { manara_account_code: x.manara_account_code, pc_active: x.active });
        }).sort(function (a, b) { return a.name.localeCompare(b.name, 'ar'); });
        var linked = {}; S.rows.forEach(function (x) { linked[x.id] = true; });
        S.unlinked = (r[1].data || []).filter(function (x) { return !linked[x.id]; });
      });
      return Promise.resolve();
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
      if (act === 'nav') return go(id);
      if (act === 'gadd') return openG(null);
      if (act === 'gedit') return openG(id);
      if (act === 'gcancel') { S.gform = null; return render(); }
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
      if (kind === 'gen') return submitG(form);
      if (kind === 'roles') return saveRoles(form);
      if (kind === 'link') return linkParty(form);
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
      if (ev.target.id === 'q') { S.q = ev.target.value; var pos = ev.target.selectionStart; render(); var q = $('#q'); if (q) { q.focus(); try { q.setSelectionRange(pos, pos); } catch (e) { } } }
    }

    /* ---------- ربط الأدوار ---------- */
    var ROLES = [
      ['ar_control', 'العملاء (رقابة)', function (a) { return a.is_control_account; }],
      ['ap_control', 'الموردون (رقابة)', function (a) { return a.is_control_account; }],
      ['cash', 'الصندوق', function (a) { return a.is_cash_account; }],
      ['bank', 'البنك', function (a) { return a.is_cash_account; }],
      ['custody', 'العهد', function (a) { return a.account_type === 'asset'; }],
      ['vat_input', 'ضريبة المدخلات', function (a) { return a.vat_role === 'input'; }],
      ['vat_output', 'ضريبة المخرجات', function (a) { return a.vat_role === 'output'; }],
      ['vat_payable', 'ضريبة القيمة المضافة المستحقة', function (a) { return a.account_type === 'liability'; }],
      ['payroll_payable', 'رواتب مستحقة', function (a) { return a.account_type === 'liability'; }],
      ['customer_advance', 'فلوس واصلة من العميل (دفعات مقدمة)', function (a) { return a.is_advance_account; }],
      ['supplier_advance_unregistered', 'دفعات مقدمة لغير المسجلين', function (a) { return a.is_advance_account; }],
      ['depreciation_expense', 'مصروف الإهلاك', function (a) { return a.account_type === 'expense'; }],
      ['accumulated_depreciation', 'مجمع الإهلاك', function (a) { return a.account_type === 'asset'; }]
    ];
    function viewRoles() {
      var post = S.accounts.filter(function (a) { return a.is_postable && a.is_active; }).sort(natCmp);
      var h = topbar() + '<div class="wrap"><h2>ربط الأدوار بالحسابات</h2><p class="mut">الأدوار دي بتستخدمها القوالب السريعة (فاتورة، سند صرف…) لتعرف تقيّد على أي حساب. الحسابات المقترحة بتظهر أولًا.</p>';
      if (S.err) h += '<div class="err">' + esc(S.err) + '</div>';
      h += '<form data-form="roles" class="card">';
      ROLES.forEach(function (r) {
        var cur = S.roleMap[r[0]] || '', sug = post.filter(r[2]), rest = post.filter(function (a) { return !r[2](a); });
        function o(a) { return '<option value="' + esc(a.id) + '"' + (a.id === cur ? ' selected' : '') + '>' + esc(a.code + ' ' + a.name) + '</option>'; }
        h += '<label>' + esc(r[1]) + '</label><select name="' + r[0] + '"' + (canWrite() ? '' : ' disabled') + '><option value="">— غير مربوط —</option>' +
          (sug.length ? '<optgroup label="مقترحة">' + sug.map(o).join('') + '</optgroup>' : '') +
          '<optgroup label="باقي الحسابات">' + rest.map(o).join('') + '</optgroup></select>';
      });
      if (canWrite()) h += '<div class="mf"><button class="pri" type="submit">حفظ الربط</button></div>';
      rootEl.innerHTML = h + '</form></div>';
    }
    function saveRoles(form) {
      var rows = [], clear = [];
      ROLES.forEach(function (r) {
        var v = form.elements[r[0]].value;
        if (v) rows.push({ company_id: S.company.id, role_code: r[0], account_id: v }); else if (S.roleMap[r[0]]) clear.push(r[0]);
      });
      var ops = [];
      if (rows.length) ops.push(sb.from('account_roles').upsert(rows, { onConflict: 'company_id,role_code' }));
      clear.forEach(function (c) { ops.push(sb.from('account_roles').delete().eq('company_id', S.company.id).eq('role_code', c)); });
      return Promise.all(ops).then(function (rs) {
        var bad = rs.filter(function (x) { return x.error; })[0];
        if (bad) { fail(bad.error); return viewRoles(); }
        S.err = ''; toast('تم حفظ الربط'); return loadView().then(viewRoles);
      }, function (e) { fail(e); viewRoles(); });
    }

    /* ---------- قوائم بسيطة: مشاريع / مراكز تكلفة / أطراف ---------- */
    var PARTY_KIND = { customer: 'عميل', supplier: 'مورد', employee: 'موظف', partner: 'شريك' };
    var CFG = {
      projects: {
        title: 'المشاريع', one: 'مشروع', table: 'projects',
        fields: [
          { k: 'code', l: 'الكود', req: 1, dir: 'ltr' }, { k: 'name', l: 'الاسم', req: 1 },
          { k: 'status', l: 'الحالة', sel: { active: 'نشط', closed: 'مغلق' }, def: 'active' },
          { k: 'budget_amount', l: 'الميزانية التقديرية (اختياري)', num: 1 }],
        line: function (x) { return '<span class="chip' + (x.status === 'active' ? ' g' : '') + '">' + (x.status === 'active' ? 'نشط' : 'مغلق') + '</span>' + (x.budget_amount !== null && x.budget_amount !== undefined ? '<span class="chip">ميزانية ' + esc(Number(x.budget_amount).toLocaleString('en')) + '</span>' : ''); },
        off: function (x) { return x.status === 'closed'; }
      },
      cost_centers: {
        title: 'مراكز التكلفة', one: 'مركز تكلفة', table: 'cost_centers',
        fields: [{ k: 'code', l: 'الكود', req: 1, dir: 'ltr' }, { k: 'name', l: 'الاسم', req: 1 }, { k: 'active', l: 'نشط', bool: 1, def: true }],
        line: function (x) { return x.active ? '' : '<span class="chip w">معطّل</span>'; },
        off: function (x) { return !x.active; }
      },
      parties: {
        title: 'الأطراف (عملاء، موردون، موظفون، شركاء)', one: 'طرف', table: 'parties', shared: 1,
        fields: [
          { k: 'name', l: 'الاسم', req: 1 }, { k: 'kind', l: 'النوع', sel: PARTY_KIND, def: 'customer', req: 1 },
          { k: 'vat_number', l: 'الرقم الضريبي (15 رقم، اختياري)', dir: 'ltr' }, { k: 'cr_number', l: 'السجل التجاري (اختياري)', dir: 'ltr' },
          { k: 'address', l: 'العنوان (اختياري)' },
          { k: 'manara_account_code', l: 'كود الطرف في المنارة (لهذه الشركة)', dir: 'ltr', pc: 1 },
          { k: 'pc_active', l: 'نشط في هذه الشركة', bool: 1, def: true, pc: 1 }],
        line: function (x) { return '<span class="chip">' + esc(PARTY_KIND[x.kind] || x.kind) + '</span>' + (x.vat_number ? '<span class="chip">ض ' + esc(x.vat_number) + '</span>' : '') + (x.manara_account_code ? '<span class="chip">منارة ' + esc(x.manara_account_code) + '</span>' : '') + (x.pc_active ? '' : '<span class="chip w">معطّل</span>'); },
        off: function (x) { return !x.pc_active; }
      }
    };
    function viewList() {
      var c = CFG[S.view], q = S.q.trim().toLowerCase(), w = canWrite();
      var rows = S.rows.filter(function (x) { return !q || ((x.code || '') + ' ' + x.name + ' ' + (x.vat_number || '')).toLowerCase().indexOf(q) >= 0; });
      if (c.table !== 'parties') rows = rows.slice().sort(natCmp);
      var h = topbar() + '<div class="wrap"><div class="bar"><h2 style="margin:0">' + esc(c.title) + '</h2><span class="sp"></span>' +
        '<input type="search" id="q" placeholder="بحث" value="' + esc(S.q) + '">' + (w ? '<button class="pri" data-act="gadd">+ ' + esc(c.one) + ' جديد</button>' : '<span class="chip">عرض فقط</span>') + '</div>';
      if (S.err) h += '<div class="err">' + esc(S.err) + '</div>';
      if (c.shared && w && S.unlinked && S.unlinked.length) {
        h += '<form data-form="link" class="bar"><select name="pid" style="max-width:320px"><option value="">ربط طرف موجود في شركة أخرى…</option>' +
          S.unlinked.map(function (x) { return '<option value="' + esc(x.id) + '">' + esc(x.name + ' — ' + (PARTY_KIND[x.kind] || x.kind)) + '</option>'; }).join('') + '</select><button class="sm" type="submit">ربط</button></form>';
      }
      h += '<div class="tree">' + (rows.length ? rows.map(function (x) {
        return '<div class="row' + (c.off(x) ? ' off' : '') + '">' + (x.code !== undefined ? '<span class="code">' + esc(x.code) + '</span>' : '') +
          '<span class="nm">' + esc(x.name) + ' ' + c.line(x) + '</span>' +
          (w ? '<span class="act"><button class="sm" data-act="gedit" data-id="' + esc(x.id) + '">تعديل</button></span>' : '') + '</div>';
      }).join('') : '<div class="empty">لا يوجد بيانات بعد.</div>') + '</div></div>';
      rootEl.innerHTML = h;
      if (S.gform) renderGModal();
    }
    function renderGModal() {
      var c = CFG[S.view], f = S.gform, h = '<div class="modal"><form class="card" data-form="gen"><h2>' + (f.id ? 'تعديل ' : 'جديد: ') + esc(c.one) + '</h2>';
      if (c.shared && f.id) h += '<div class="mut" style="font-size:.85rem">بيانات الاسم والنوع والرقم الضريبي مشتركة بين الشركات.</div>';
      c.fields.forEach(function (fd) {
        var v = f.data[fd.k];
        if (fd.bool) h += '<div class="chk"><input type="checkbox" name="' + fd.k + '" id="g_' + fd.k + '"' + (v ? ' checked' : '') + '><label for="g_' + fd.k + '" style="margin:0">' + esc(fd.l) + '</label></div>';
        else if (fd.sel) h += '<label>' + esc(fd.l) + '</label><select name="' + fd.k + '">' + opts(fd.sel, v) + '</select>';
        else h += '<label>' + esc(fd.l) + '</label><input name="' + fd.k + '" value="' + esc(v === null || v === undefined ? '' : v) + '"' + (fd.num ? ' inputmode="decimal"' : '') + (fd.dir ? ' dir="' + fd.dir + '"' : '') + '>';
      });
      if (f.errs.length) h += '<div class="errs"><ul>' + f.errs.map(function (e) { return '<li>' + esc(e) + '</li>'; }).join('') + '</ul></div>';
      h += '<div class="mf"><button type="button" data-act="gcancel">إلغاء</button><button class="pri" type="submit"' + (S.busy ? ' disabled' : '') + '>حفظ</button></div></form></div>';
      var old = $('.modal'); if (old) old.remove();
      rootEl.insertAdjacentHTML('beforeend', h);
    }
    function openG(id) {
      var c = CFG[S.view], d = {};
      c.fields.forEach(function (fd) { d[fd.k] = fd.def !== undefined ? fd.def : ''; });
      if (id) { var r = S.rows.filter(function (x) { return x.id === id; })[0]; c.fields.forEach(function (fd) { d[fd.k] = r[fd.k] === null || r[fd.k] === undefined ? '' : r[fd.k]; }); }
      S.gform = { id: id || null, data: d, errs: [] }; renderGModal();
    }
    function submitG(form) {
      var c = CFG[S.view], d = {}, errs = [];
      c.fields.forEach(function (fd) {
        var el = form.elements[fd.k]; if (!el) return;
        var v = fd.bool ? el.checked : String(el.value).trim();
        d[fd.k] = v;
        if (fd.req && !v) errs.push(fd.l + ' مطلوب');
      });
      if (c.table === 'projects') {
        if (d.budget_amount !== '' && (isNaN(Number(d.budget_amount)) || Number(d.budget_amount) < 0)) errs.push('الميزانية يجب أن تكون رقمًا صفرًا أو أكثر');
      }
      if (c.table === 'parties' && d.vat_number && !/^3[0-9]{13}3$/.test(d.vat_number)) errs.push('الرقم الضريبي 15 رقمًا يبدأ وينتهي بـ 3');
      if (d.code !== undefined && S.rows.some(function (x) { return x.id !== S.gform.id && x.code === d.code; })) errs.push('الكود مستخدم من قبل');
      S.gform.data = d; S.gform.errs = errs;
      if (errs.length) return renderGModal();
      var id = S.gform.id, cid = S.company.id, main = {}, pc = {};
      c.fields.forEach(function (fd) { var v = d[fd.k]; if (!fd.bool && v === '') v = null; if (fd.num && v !== null) v = Number(v); (fd.pc ? pc : main)[fd.k] = v; });
      var p;
      if (c.table === 'parties') {
        var pcRow = { manara_account_code: pc.manara_account_code, active: pc.pc_active };
        if (id) p = sb.from('parties').update(main).eq('id', id).then(function (r) {
          if (r.error) return r; return sb.from('party_companies').update(pcRow).eq('party_id', id).eq('company_id', cid);
        });
        else p = sb.from('parties').insert(main).select().single().then(function (r) {
          if (r.error) return r; return sb.from('party_companies').insert(Object.assign({ party_id: r.data.id, company_id: cid }, pcRow));
        });
      } else if (c.table === 'cost_centers') {
        p = id ? sb.from('cost_centers').update(main).eq('id', id).eq('company_id', cid) : sb.from('cost_centers').insert(Object.assign({ company_id: cid }, main));
      } else {
        p = id ? sb.from(c.table).update(main).eq('id', id).eq('company_id', cid) : sb.from(c.table).insert(Object.assign({ company_id: cid }, main));
      }
      S.busy = true; renderGModal();
      return Promise.resolve(p).then(function (r) {
        S.busy = false;
        if (r.error) { S.gform.errs = [R.translateDbError(r.error)]; return renderGModal(); }
        S.gform = null; toast('تم الحفظ'); return loadView().then(render);
      }, function (e) { S.busy = false; S.gform.errs = [R.translateDbError(e)]; renderGModal(); });
    }
    function linkParty(form) {
      var pid = form.elements.pid.value; if (!pid) return;
      return sb.from('party_companies').insert({ party_id: pid, company_id: S.company.id }).then(function (r) {
        if (r.error) { fail(r.error); return render(); }
        S.err = ''; toast('تم الربط'); return loadView().then(render);
      });
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
