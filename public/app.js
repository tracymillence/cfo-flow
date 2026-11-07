// Order of dining members requested by user
const WORK_MEMBER_SORT_ORDER = [
  'yến',
  'thịnh',
  'long',
  'hải',
  'tuyết ngân',
  'như ý',
  'dương',
  'thu ngân',
  'hoài',
  'ngọc tuyền',
  'quỳnh',
  'phụng',
  'nguyên',
  'hp'
];

const FAMILY_MEMBER_SORT_ORDER = [
  'yến',
  'thịnh',
  'long',
  'hải',
  'thuý (tôi)',
  'thúy (tôi)',
  'thuý',
  'thúy',
  'bảo (người yêu tôi)',
  'bảo'
];

function normalizeMemberName(name) {
  if (!name) return '';
  return name.trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ');
}

function getMemberLookupKeysClient(group, personKey, name) {
  const keys = new Set();
  const g = group || 'work';
  if (personKey) {
    const pk = normalizeMemberName(personKey);
    if (pk) {
      keys.add(`${g}_${pk}`);
      keys.add(`${g}_${normalizeMemberName(personKey.replace(/\(.*?\)/g, ''))}`);
    }
  }
  if (name) {
    const nk = normalizeMemberName(name);
    if (nk) {
      keys.add(`${g}_${nk}`);
      keys.add(`${g}_${normalizeMemberName(name.replace(/\(.*?\)/g, ''))}`);
    }
  }
  return Array.from(keys).filter(k => !k.endsWith('_'));
}

function getMemberSortIndex(name, group = 'work') {
  if (!name) return 999;
  const norm = normalizeMemberName(name);
  if (group === 'family') {
    const idx = FAMILY_MEMBER_SORT_ORDER.findIndex(o => normalizeMemberName(o) === norm);
    return idx !== -1 ? idx : 999;
  }
  const idx = WORK_MEMBER_SORT_ORDER.findIndex(o => normalizeMemberName(o) === norm);
  return idx !== -1 ? idx : 999;
}

function cashFlowApp() {
  return {
    loading: true,
    error: null,

    // ==================== AUTH & CURRENT USER STATE ====================
    authToken: localStorage.getItem('cfo_token') || '',
    currentUser: null,
    isLoggedIn: false,
    userDropdownOpen: false,
    loginForm: {
      username: '',
      password: '',
      error: '',
      loading: false,
      showPassword: false,
      theme: localStorage.getItem('cfo_login_theme') || 'light'
    },

    // ==================== RBAC USER MANAGEMENT STATE ====================
    usersList: [],
    loadingUsers: false,
    editingUserId: null,
    userModalForm: {
      username: '',
      password: '12345678',
      fullName: '',
      phone: '',
      role: 'member',
      isActive: true,
      permissions: {
        viewOverview: true,
        manageAccounts: false,
        manageTransactions: false,
        manageDiningWork: true,
        manageDiningFamily: false,
        viewDining: false,
        managePersonalHub: false,
        manageDebts: false,
        manageUsers: false,
        manageConfig: false
      }
    },

    dashboard: {
      accounts: { totalCash: 0, list: [], hubs: {} },
      supplierPot: { totalAmount: 0, suppliers: [] },
      card1_cash: { totalCash: 0, spendableCash: 0, supplierPot: 0 },
      card2_weekly: { limit: 1500000, spent: 0, percent: 0, isWarning: false, isBrake: false, breakdown: {} },
      card4_dining: {
        billPaidTotal: 0,
        billCount: 0,
        totalTopups: 0,
        topupCount: 0,
        totalBorrowed: 0,
        colleaguesEatenTotal: 0,
        myShareTotal: 0,
        totalSurplusFund: 0,
        surplusCount: 0,
        totalDebtReceivable: 0,
        debtCount: 0,
        members: [],
        bills: [],
        settlements: [],
        work: null,
        family: null,
        combined: null,
        allMembers: []
      },
      card4_personal_hub: {
        monthlyBudget: 6000000,
        savingsRate: 15,
        targetSavings: 900000,
        actualSavings: 0,
        savingsList: [],
        totalFixedBills: 0,
        paidFixedBills: 0,
        pendingFixedBills: 0,
        fixedBillsList: [],
        spendableFlexibleMonthly: 0,
        currentMonthFlexibleSpent: 0,
        remainingFlexibleMonthly: 0,
        weeklyLimit: 1500000,
        weeklySpent: 0,
        weeklyRemaining: 0,
        weeklyPercent: 0,
        allExpenses: []
      },
      transactions: [],
      reminders: [],
      allDebts: [],
      debtSummary: { totalReceivable: 0, totalPayable: 0 },
      allOrders: []
    },

    // View tabs
    activeTab: 'overview',
    diningCategory: 'work', // 'work' (Ăn nhóm đồng nghiệp) | 'family' (Quỹ gia đình) | 'all' (Tất cả)
    diningTab: 'members',   // 'members' | 'bills' | 'settlements'
    diningMemberView: (typeof window !== 'undefined' && window.innerWidth < 640) ? 'cards' : 'excel', // 'excel' (Bảng Excel) | 'cards' (Dạng Thẻ)
    memberFilter: 'all',    // 'all' | 'surplus' | 'debt'
    personalTab: 'fixed',   // 'fixed' (Hóa đơn cố định) | 'savings' (Sổ tiết kiệm) | 'spending' (Ăn ngoài & Mua sắm)
    debtFilter: 'all',      // 'all' | 'receivable' | 'payable' | 'pending' | 'paid'
    txFilter: {
      type: 'all',
      accountName: 'all',
      hubRole: 'all'
    },

    // Editing Trackers
    editingAccountId: null,
    editingSupplierId: null,
    editingReminderId: null,
    editingDebtId: null,
    editingOrderId: null,
    editingDiningId: null,
    editingSettlementId: null,
    editingMemberId: null,
    editingTransactionId: null,
    editingPersonalId: null,

    // ==================== FORMS ====================
    accountForm: {
      name: '',
      type: 'bank',
      balance: '',
      accountNumber: '',
      hubRole: 'hub1_income',
      note: ''
    },

    supplierForm: {
      supplierName: '',
      remainingAmount: '',
      dueDate: '',
      phone: '',
      bankInfo: '',
      notes: ''
    },

    reminderForm: {
      date: new Date().toISOString().slice(0, 10),
      title: '',
      amount: '',
      type: 'expense',
      hubRole: 'hub1_income',
      notes: ''
    },

    // ==================== DỰ BÁO DÒNG TIỀN TƯƠNG LAI (UPCOMING CASH FLOW) ====================
    upcomingList: [],
    upcomingLoading: false,
    upcomingFilterRange: 'all', // 'all' | '7days' | '30days' | 'custom'
    upcomingCustomStart: '',
    upcomingCustomEnd: '',
    projectionHealth: null,
    upcomingFilterHub: 'all',   // 'all' | 'hub1_income' | 'hub2_dining' | 'hub3_family' | 'hub4_personal'
    upcomingForm: {
      type: 'expense',          // 'income' (Dự Thu) | 'expense' (Dự Chi)
      amount: '',
      title: '',
      date: new Date().toISOString().slice(0, 10),
      hubRole: 'hub1_income',   // Dropdown chọn 1 trong 4 Hub hiện tại
      notes: ''
    },

    debtForm: {
      type: 'receivable',
      personName: '',
      amount: '',
      dueDate: new Date().toISOString().slice(0, 10),
      note: ''
    },

    serviceOrderForm: {
      _id: null,
      customerName: '',
      serviceName: 'Bán dấu / Khắc dấu',
      salePrice: '',
      costPrice: '',
      supplierName: '',
      customerPaid: false,
      supplierPaid: false,
      date: new Date().toISOString().slice(0, 10),
      note: ''
    },
    serviceOrderFilter: 'all', // 'all' | 'unpaid_customer' | 'unpaid_supplier' | 'completed'
    serviceOrderSearch: '',

    // Sổ Giao Dịch Thu / Chi (Request 1)
    transactionForm: {
      date: new Date().toISOString().slice(0, 10),
      title: '',
      amount: '',
      type: 'expense', // 'expense' | 'income' | 'transfer'
      accountName: 'Vietcombank',
      toAccountName: '',
      category: 'Ăn uống cá nhân',
      hubRole: 'hub4_personal',
      impactsWeeklyLimit: true,
      notes: ''
    },

    // Sổ Ăn & Quỹ Nhóm / Gia Đình (Request 2)
    diningBillForm: {
      category: 'work', // 'work' | 'family'
      mealTitle: 'Cơm trưa văn phòng',
      date: new Date().toISOString().slice(0, 10),
      totalBill: 150000,
      paidAccount: 'Vietcombank',
      deductFromAccount: true,
      deductWeeklyLimit: true,
      splitMode: 'equal', // 'equal' | 'custom'
      includeMe: true,
      myShare: 0,
      participants: [], // [{ personKey, name, selected, customAmount }]
      notes: ''
    },

    settlementForm: {
      category: 'work',
      personName: '',
      amount: '',
      direction: 'in', // 'in' = nạp tiền/trả nợ, 'out' = mượn quỹ
      topupKind: 'prepaid',
      accountName: 'Vietcombank',
      addToAccount: true,
      note: '',
      date: new Date().toISOString().slice(0, 10)
    },

    memberForm: {
      name: '',
      group: 'work', // 'work' | 'family'
      openingBalance: 0,
      phone: '',
      note: ''
    },

    // Cấn trừ / chuyển số dư giữa 2 sổ (Ăn nhóm & Gia đình)
    diningTransferForm: {
      memberName: '',
      fromCategory: 'work',
      toCategory: 'family',
      amount: '',
      date: new Date().toISOString().slice(0, 10),
      note: ''
    },

    // Chi phí cá nhân & Hóa đơn cố định (Hub 4)
    personalExpenseForm: {
      title: '',
      category: 'streaming_tech', // health_fitness | streaming_tech | living_utility | savings | flexible_spending
      type: 'fixed_bill', // fixed_bill | savings_deposit | flexible
      amount: '',
      cycle: 'monthly',
      dueDay: 5,
      status: 'pending',
      paidAccount: 'Vietcombank',
      deductFromAccount: false,
      notes: ''
    },

    personalConfigForm: {
      hub4MonthlyBudget: 6000000,
      savingsRate: 15,
      weeklyLimit: 1500000
    },

    configForm: {
      initialCash: 3741742,
      weeklyLimit: 1500000
    },

    // Modals visibility state
    modals: {
      account: false,
      supplier: false,
      reminder: false,
      debt: false,
      service: false,
      diningBill: false,
      settlement: false,
      member: false,
      transaction: false,
      config: false,
      transfer: false,
      personalExpense: false,
      personalConfig: false,
      userManagement: false,
      userEdit: false,
      changePassword: false,
      correctionRequest: false,
      correctionList: false,
      memberStatement: false,
      supplierHistory: false
    },

    selectedSupplierForHistory: null,

    // Sao kê & lịch sử thu chi từng thành viên (Member Statements)
    selectedMemberStatement: null,
    memberStatementHistory: [],
    memberStatementFilter: 'all',

    // Quản lý yêu cầu chỉnh sửa sổ quỹ (Correction Requests)
    correctionRequests: {
      list: [],
      pendingCount: 0,
      loading: false,
      filter: 'all'
    },
    newCorrectionForm: {
      category: 'work',
      targetType: 'bill',
      targetTitle: '',
      amount: '',
      reason: '',
      loading: false,
      error: ''
    },

    // Form đổi mật khẩu
    changePasswordForm: {
      oldPassword: '',
      newPassword: '',
      confirmPassword: '',
      showOld: false,
      showNew: false,
      loading: false,
      error: ''
    },

    // Toast
    toast: { show: false, message: '' },

    async init() {
      if (this.authToken) {
        try {
          const res = await fetch('/api/auth/me', {
            headers: { 'Authorization': `Bearer ${this.authToken}` }
          });
          const data = await res.json();
          if (data.success && data.user) {
            this.currentUser = data.user;
            this.isLoggedIn = true;
            this.ensureValidActiveTab();
            await this.fetchDashboard();
          } else {
            this.logout(false);
          }
        } catch (e) {
          this.logout(false);
        }
      } else {
        this.isLoggedIn = false;
        this.loading = false;
      }
    },

    ensureValidActiveTab() {
      if (!this.currentUser) return;
      const p = this.currentUser.permissions || {};
      const isAdmin = Boolean(this.currentUser.isAdmin);

      if (isAdmin) return;

      const isAllowed = {
        overview: Boolean(p.viewOverview),
        transactions: Boolean(p.manageTransactions),
        dining: Boolean(p.manageDiningWork || p.manageDiningFamily || p.viewDining),
        personal: Boolean(p.managePersonalHub),
        debts: Boolean(p.manageDebts)
      };

      // Nếu tab hiện tại không được phép xem -> tự động chuyển sang tab đầu tiên được phép
      if (!isAllowed[this.activeTab]) {
        if (isAllowed.dining) {
          this.activeTab = 'dining';
        } else if (isAllowed.transactions) {
          this.activeTab = 'transactions';
        } else if (isAllowed.personal) {
          this.activeTab = 'personal';
        } else if (isAllowed.debts) {
          this.activeTab = 'debts';
        } else if (isAllowed.overview) {
          this.activeTab = 'overview';
        }
      }

      // Tự động chọn đúng phân hệ trong sổ ăn nếu chỉ có quyền 1 bên
      if (this.activeTab === 'dining') {
        if (p.manageDiningFamily && !p.manageDiningWork) {
          this.diningCategory = 'family';
        } else if (p.manageDiningWork && !p.manageDiningFamily) {
          this.diningCategory = 'work';
        }
      }
    },

    hasPermission(perm) {
      if (!this.currentUser) return false;
      if (this.currentUser.isAdmin) return true;
      if (this.currentUser.permissions && this.currentUser.permissions[perm]) return true;
      return false;
    },

    get canManageDining() {
      if (!this.currentUser) return false;
      if (this.currentUser.isAdmin) return true;
      return Boolean(this.currentUser.permissions?.manageDiningWork || this.currentUser.permissions?.manageDiningFamily);
    },

    canManageRequest(req) {
      if (!this.currentUser) return false;
      if (this.currentUser.isAdmin) return true;
      if (!req) return this.canManageDining;
      if (req.category === 'family') {
        return Boolean(this.currentUser.permissions?.manageDiningFamily);
      }
      if (req.category === 'work') {
        return Boolean(this.currentUser.permissions?.manageDiningWork);
      }
      return this.canManageDining;
    },

    async authFetch(url, options = {}) {
      const headers = options.headers ? { ...options.headers } : {};
      if (!headers['Content-Type'] && options.body && typeof options.body === 'string') {
        headers['Content-Type'] = 'application/json';
      }
      if (this.authToken) {
        headers['Authorization'] = `Bearer ${this.authToken}`;
      }
      const res = await fetch(url, { ...options, headers });
      if (res.status === 401) {
        this.logout(false);
        throw new Error('Phiên đăng nhập đã hết hạn hoặc tài khoản bị khóa. Vui lòng đăng nhập lại.');
      }
      return res;
    },

    async submitLogin() {
      if (!this.loginForm.username.trim() || !this.loginForm.password.trim()) {
        this.loginForm.error = 'Vui lòng điền đầy đủ tên đăng nhập và mật khẩu!';
        return;
      }
      this.loginForm.loading = true;
      this.loginForm.error = '';
      try {
        const res = await fetch('/api/auth/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            username: this.loginForm.username.trim(),
            password: this.loginForm.password.trim()
          })
        });
        const data = await res.json();
        if (data.success) {
          this.authToken = data.token;
          localStorage.setItem('cfo_token', data.token);
          this.currentUser = data.user;
          this.isLoggedIn = true;
          this.ensureValidActiveTab();
          this.loginForm.password = '';
          this.loginForm.error = '';
          this.notify(`Xin chào, ${data.user.fullName}!`);
          await this.fetchDashboard();
        } else {
          this.loginForm.error = data.error || 'Tên đăng nhập hoặc mật khẩu không chính xác';
        }
      } catch (err) {
        this.loginForm.error = 'Lỗi kết nối máy chủ: ' + err.message;
      } finally {
        this.loginForm.loading = false;
      }
    },

    toggleLoginTheme() {
      this.loginForm.theme = this.loginForm.theme === 'light' ? 'dark' : 'light';
      localStorage.setItem('cfo_login_theme', this.loginForm.theme);
    },

    async logout(callApi = true) {
      if (callApi && this.authToken) {
        try {
          await fetch('/api/auth/logout', {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${this.authToken}` }
          });
        } catch (e) {}
      }
      this.authToken = '';
      this.currentUser = null;
      this.isLoggedIn = false;
      localStorage.removeItem('cfo_token');
      this.notify('Đã đăng xuất tài khoản.');
    },

    // ==================== RBAC & USER MANAGEMENT METHODS ====================
    async fetchUsersList() {
      this.loadingUsers = true;
      try {
        const res = await this.authFetch('/api/admin/users');
        const data = await res.json();
        if (data.success) {
          this.usersList = data.users || [];
        } else {
          this.notify(data.error || 'Không thể tải danh sách người dùng');
        }
      } catch (err) {
        this.notify(err.message);
      } finally {
        this.loadingUsers = false;
      }
    },

    openUserManagementModal() {
      this.fetchUsersList();
      this.modals.userManagement = true;
    },

    openAddUserModal() {
      this.editingUserId = null;
      this.userModalForm = {
        username: '',
        password: '12345678',
        fullName: '',
        phone: '',
        role: 'member',
        isActive: true,
        permissions: {
          viewOverview: true,
          manageAccounts: false,
          manageTransactions: false,
          manageDiningWork: true,
          manageDiningFamily: false,
          viewDining: false,
          managePersonalHub: false,
          manageDebts: false,
          manageUsers: false,
          manageConfig: false
        }
      };
      this.modals.userEdit = true;
    },

    openEditUserModal(user) {
      this.editingUserId = user._id || user.id;
      this.userModalForm = {
        username: user.username,
        password: '',
        fullName: user.fullName || '',
        phone: user.phone || '',
        role: user.role || 'custom',
        isActive: user.isActive !== false,
        permissions: {
          viewOverview: user.permissions?.viewOverview !== false,
          manageAccounts: Boolean(user.permissions?.manageAccounts),
          manageTransactions: Boolean(user.permissions?.manageTransactions),
          manageDiningWork: user.permissions?.manageDiningWork !== false,
          manageDiningFamily: Boolean(user.permissions?.manageDiningFamily),
          viewDining: Boolean(user.permissions?.viewDining),
          managePersonalHub: Boolean(user.permissions?.managePersonalHub),
          manageDebts: Boolean(user.permissions?.manageDebts),
          manageUsers: Boolean(user.permissions?.manageUsers),
          manageConfig: Boolean(user.permissions?.manageConfig)
        }
      };
      this.modals.userEdit = true;
    },

    applyRolePreset(roleType) {
      this.userModalForm.role = roleType;
      const p = this.userModalForm.permissions;
      p.viewDining = false;
      if (roleType === 'admin') {
        p.viewOverview = true;
        p.manageAccounts = true;
        p.manageTransactions = true;
        p.manageDiningWork = true;
        p.manageDiningFamily = true;
        p.viewDining = true;
        p.managePersonalHub = true;
        p.manageDebts = true;
        p.manageUsers = true;
        p.manageConfig = true;
      } else if (roleType === 'manager') {
        p.viewOverview = true;
        p.manageAccounts = true;
        p.manageTransactions = true;
        p.manageDiningWork = true;
        p.manageDiningFamily = true;
        p.managePersonalHub = true;
        p.manageDebts = true;
        p.manageUsers = false;
        p.manageConfig = false;
      } else if (roleType === 'colleague') {
        p.viewOverview = false;
        p.manageAccounts = false;
        p.manageTransactions = false;
        p.manageDiningWork = true;
        p.manageDiningFamily = false;
        p.managePersonalHub = false;
        p.manageDebts = false;
        p.manageUsers = false;
        p.manageConfig = false;
      } else if (roleType === 'family') {
        p.viewOverview = false;
        p.manageAccounts = false;
        p.manageTransactions = false;
        p.manageDiningWork = false;
        p.manageDiningFamily = true;
        p.managePersonalHub = false;
        p.manageDebts = false;
        p.manageUsers = false;
        p.manageConfig = false;
      } else if (roleType === 'partner') {
        p.viewOverview = false;
        p.manageAccounts = false;
        p.manageTransactions = false;
        p.manageDiningWork = false;
        p.manageDiningFamily = true;
        p.managePersonalHub = true;
        p.manageDebts = false;
        p.manageUsers = false;
        p.manageConfig = false;
      } else if (roleType === 'guest') {
        p.viewOverview = false;
        p.manageAccounts = false;
        p.manageTransactions = false;
        p.manageDiningWork = false;
        p.manageDiningFamily = false;
        p.viewDining = true;
        p.managePersonalHub = false;
        p.manageDebts = false;
        p.manageUsers = false;
        p.manageConfig = false;
      } else if (roleType === 'viewer') {
        p.viewOverview = true;
        p.manageAccounts = false;
        p.manageTransactions = false;
        p.manageDiningWork = false;
        p.manageDiningFamily = false;
        p.managePersonalHub = false;
        p.manageDebts = false;
        p.manageUsers = false;
        p.manageConfig = false;
      }
    },

    async submitUserModal() {
      try {
        const payload = {
          fullName: this.userModalForm.fullName,
          phone: this.userModalForm.phone,
          role: this.userModalForm.role,
          isActive: this.userModalForm.isActive,
          permissions: this.userModalForm.permissions
        };

        if (!this.editingUserId) {
          if (!this.userModalForm.username.trim() || !this.userModalForm.fullName.trim()) {
            this.notify('Vui lòng nhập Tên đăng nhập và Họ tên cho người dùng mới');
            return;
          }
          payload.username = this.userModalForm.username.trim();
          payload.password = this.userModalForm.password.trim() || '12345678';

          const res = await this.authFetch('/api/admin/users', {
            method: 'POST',
            body: JSON.stringify(payload)
          });
          const data = await res.json();
          if (data.success) {
            this.notify(data.message || 'Đã tạo người dùng mới thành công (Mật khẩu mặc định: 12345678)');
            this.modals.userEdit = false;
            await this.fetchUsersList();
          } else {
            this.notify(data.error || 'Lỗi tạo người dùng');
          }
        } else {
          if (this.userModalForm.password.trim()) {
            payload.password = this.userModalForm.password.trim();
          }
          const res = await this.authFetch(`/api/admin/users/${this.editingUserId}`, {
            method: 'PUT',
            body: JSON.stringify(payload)
          });
          const data = await res.json();
          if (data.success) {
            this.notify(data.message || 'Đã cập nhật phân quyền người dùng thành công');
            this.modals.userEdit = false;
            if (this.currentUser && (this.currentUser.id === this.editingUserId || this.currentUser._id === this.editingUserId)) {
              this.currentUser.fullName = data.user.fullName;
              this.currentUser.role = data.user.role;
              this.currentUser.permissions = data.user.permissions;
            }
            await this.fetchUsersList();
          } else {
            this.notify(data.error || 'Lỗi cập nhật người dùng');
          }
        }
      } catch (err) {
        this.notify(err.message);
      }
    },

    async toggleUserStatus(u) {
      try {
        const nextStatus = !u.isActive;
        const res = await this.authFetch(`/api/admin/users/${u._id}`, {
          method: 'PUT',
          body: JSON.stringify({ isActive: nextStatus })
        });
        const data = await res.json();
        if (data.success) {
          u.isActive = nextStatus;
          this.notify(`Đã ${nextStatus ? 'mở khóa' : 'tạm khóa'} tài khoản ${u.fullName}`);
        } else {
          this.notify(data.error || 'Lỗi thay đổi trạng thái');
        }
      } catch (err) {
        this.notify(err.message);
      }
    },

    async deleteUser(u) {
      if (!confirm(`Bạn có chắc chắn muốn xóa tài khoản "${u.fullName}" (@${u.username})?`)) return;
      try {
        const res = await this.authFetch(`/api/admin/users/${u._id}`, {
          method: 'DELETE'
        });
        const data = await res.json();
        if (data.success) {
          this.notify(data.message || 'Đã xóa người dùng thành công');
          await this.fetchUsersList();
        } else {
          this.notify(data.error || 'Lỗi khi xóa người dùng');
        }
      } catch (err) {
        this.notify(err.message);
      }
    },

    // ==================== CHANGE PASSWORD METHODS ====================
    openChangePasswordModal() {
      this.changePasswordForm = {
        oldPassword: '',
        newPassword: '',
        confirmPassword: '',
        showOld: false,
        showNew: false,
        loading: false,
        error: ''
      };
      this.modals.changePassword = true;
    },

    async submitChangePassword() {
      if (!this.changePasswordForm.newPassword || this.changePasswordForm.newPassword.trim().length < 6) {
        this.changePasswordForm.error = 'Mật khẩu mới phải có tối thiểu 6 ký tự!';
        return;
      }
      if (this.changePasswordForm.newPassword !== this.changePasswordForm.confirmPassword) {
        this.changePasswordForm.error = 'Mật khẩu xác nhận không khớp nhau!';
        return;
      }
      this.changePasswordForm.loading = true;
      this.changePasswordForm.error = '';
      try {
        const res = await this.authFetch('/api/auth/change-password', {
          method: 'POST',
          body: JSON.stringify({
            oldPassword: this.changePasswordForm.oldPassword.trim(),
            newPassword: this.changePasswordForm.newPassword.trim()
          })
        });
        const data = await res.json();
        if (data.success) {
          if (this.currentUser) {
            this.currentUser.isDefaultPassword = false;
          }
          this.modals.changePassword = false;
          this.notify('🎉 Đổi mật khẩu thành công! Mật khẩu mới đã được lưu vào database.');
        } else {
          this.changePasswordForm.error = data.error || 'Lỗi khi đổi mật khẩu';
        }
      } catch (err) {
        this.changePasswordForm.error = err.message || 'Lỗi kết nối máy chủ';
      } finally {
        this.changePasswordForm.loading = false;
      }
    },

    // ==================== CORRECTION REQUESTS (YÊU CẦU CHỈNH SỬA SỔ QUỸ) ====================
    async fetchCorrectionRequests() {
      try {
        this.correctionRequests.loading = true;
        const res = await this.authFetch('/api/dining/requests');
        const data = await res.json();
        if (data.success) {
          this.correctionRequests.list = data.requests || [];
          this.correctionRequests.pendingCount = data.pendingCount || 0;
        }
      } catch (err) {
        console.error('Lỗi tải yêu cầu chỉnh sửa:', err);
      } finally {
        this.correctionRequests.loading = false;
      }
    },

    openNewCorrectionModal(category = 'work', targetTitle = '', amount = 0) {
      this.newCorrectionForm = {
        category: category || 'work',
        targetType: 'bill',
        targetTitle: targetTitle || '',
        amount: amount || '',
        reason: '',
        loading: false,
        error: ''
      };
      this.modals.correctionRequest = true;
    },

    async submitCorrectionRequest() {
      if (!this.newCorrectionForm.reason.trim()) {
        this.newCorrectionForm.error = 'Vui lòng nhập chi tiết sai sót hoặc nội dung cần chỉnh sửa!';
        return;
      }
      this.newCorrectionForm.loading = true;
      this.newCorrectionForm.error = '';
      try {
        const res = await this.authFetch('/api/dining/requests', {
          method: 'POST',
          body: JSON.stringify({
            category: this.newCorrectionForm.category,
            targetType: this.newCorrectionForm.targetType,
            targetTitle: this.newCorrectionForm.targetTitle,
            amount: this.newCorrectionForm.amount ? Number(this.newCorrectionForm.amount) : 0,
            reason: this.newCorrectionForm.reason
          })
        });
        const data = await res.json();
        if (data.success) {
          this.modals.correctionRequest = false;
          this.notify('📨 ' + (data.message || 'Đã gửi yêu cầu chỉnh sửa tới người quản lý!'));
          await this.fetchCorrectionRequests();
        } else {
          this.newCorrectionForm.error = data.message || 'Lỗi khi gửi yêu cầu';
        }
      } catch (err) {
        this.newCorrectionForm.error = err.message || 'Lỗi kết nối máy chủ';
      } finally {
        this.newCorrectionForm.loading = false;
      }
    },

    async updateCorrectionStatus(reqItem, status) {
      const isApproved = status === 'approved';
      const defaultNote = isApproved ? 'Đã kiểm tra và cập nhật sổ đúng thực tế' : 'Số liệu đã đối chiếu chính xác, không cần sửa đổi';
      const promptTitle = isApproved
        ? `Xác nhận DUYỆT yêu cầu báo sai của "${reqItem.creatorName}"?\nNhập ghi chú phản hồi người gửi (Tùy chọn):`
        : `Xác nhận TỪ CHỐI yêu cầu báo sai của "${reqItem.creatorName}"?\nNhập lý do từ chối phản hồi người gửi (Tùy chọn):`;

      const note = prompt(promptTitle, defaultNote);
      if (note === null) return;

      try {
        const res = await this.authFetch(`/api/dining/requests/${reqItem._id}/status`, {
          method: 'PATCH',
          body: JSON.stringify({ status, adminNote: note })
        });
        const data = await res.json();
        if (data.success) {
          reqItem.status = status;
          reqItem.adminNote = note;
          reqItem.handledBy = this.currentUser?.fullName || 'Quản lý';
          reqItem.handledAt = new Date().toISOString();
          this.notify(`✓ Đã ${isApproved ? 'duyệt' : 'từ chối'} yêu cầu của ${reqItem.creatorName}!`);
          await this.fetchCorrectionRequests();
        } else {
          alert('Lỗi: ' + (data.message || data.error));
        }
      } catch (err) {
        alert('Lỗi hệ thống: ' + err.message);
      }
    },

    async deleteCorrectionRequest(reqItem) {
      if (!confirm(`Xóa yêu cầu chỉnh sửa "${reqItem.targetTitle || reqItem.reason}"?`)) return;
      try {
        const res = await this.authFetch(`/api/dining/requests/${reqItem._id}`, {
          method: 'DELETE'
        });
        const data = await res.json();
        if (data.success) {
          this.notify('🗑️ ' + (data.message || 'Đã xóa yêu cầu!'));
          await this.fetchCorrectionRequests();
        } else {
          alert('Lỗi: ' + (data.message || data.error));
        }
      } catch (err) {
        alert('Lỗi hệ thống: ' + err.message);
      }
    },

    notify(msg) {
      this.toast.message = msg;
      this.toast.show = true;
      setTimeout(() => { this.toast.show = false; }, 3200);
    },

    formatVND(num) {
      if (num === undefined || num === null || isNaN(num)) return '0đ';
      return Math.round(num).toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.') + 'đ';
    },

    parseVND(input) {
      if (input === null || input === undefined) return 0;
      let s = String(input).trim().toLowerCase();
      let multiplier = 1;
      if (s.endsWith('tr') || s.endsWith('m') || s.endsWith('triệu')) {
        multiplier = 1000000;
        s = s.replace(/(tr|m|triệu)/g, '').trim();
      } else if (s.endsWith('k') || s.endsWith('nghìn') || s.endsWith('ngàn')) {
        multiplier = 1000;
        s = s.replace(/(k|nghìn|ngàn)/g, '').trim();
      }
      s = s.replace(/[đ\s]/g, '');
      if (multiplier === 1) {
        s = s.replace(/[.,]/g, '');
      } else {
        s = s.replace(',', '.');
      }
      const val = parseFloat(s) * multiplier;
      return isNaN(val) ? 0 : Math.round(val);
    },

    formatDate(str) {
      if (!str) return '';
      try {
        if (typeof str === 'string') {
          const m = str.match(/^(\d{4})-(\d{2})-(\d{2})/);
          if (m) {
            return `${m[3]}/${m[2]}/${m[1]}`;
          }
        }
        const d = (str instanceof Date) ? str : new Date(str);
        if (isNaN(d.getTime())) return String(str);
        const pad = (n) => String(n).padStart(2, '0');
        return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`;
      } catch (e) {
        return String(str);
      }
    },

    formatDateTime(str) {
      if (!str) return '';
      try {
        const d = new Date(str);
        if (isNaN(d.getTime())) return str;
        const pad = (n) => String(n).padStart(2, '0');
        return `${pad(d.getHours())}:${pad(d.getMinutes())} ${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`;
      } catch (e) {
        return str;
      }
    },

    // Current Dining Scope Data (Work vs Family vs Combined)
    get currentDiningData() {
      const d = this.dashboard.card4_dining;
      if (this.diningCategory === 'family' && d.family) return d.family;
      if (this.diningCategory === 'all' && d.combined) return d.combined;
      if (d.work) return d.work;
      return d;
    },

    get filteredMembers() {
      let list = [...(this.currentDiningData.members || [])];
      list.sort((a, b) => {
        const oA = getMemberSortIndex(a.name, a.group);
        const oB = getMemberSortIndex(b.name, b.group);
        if (oA !== oB) return oA - oB;
        return (a.name || '').localeCompare(b.name || '', 'vi');
      });
      if (this.memberFilter === 'surplus') return list.filter(m => m.currentBalance >= 0);
      if (this.memberFilter === 'debt') return list.filter(m => m.currentBalance < 0);
      return list;
    },

    get diningTotalOpening() {
      return (this.filteredMembers || []).reduce((sum, m) => sum + (m.openingBalance || 0), 0);
    },
    get diningTotalTopups() {
      return (this.filteredMembers || []).reduce((sum, m) => sum + (m.topups || 0), 0);
    },
    get diningTotalBorrowed() {
      return (this.filteredMembers || []).reduce((sum, m) => sum + (m.borrowed || 0), 0);
    },
    get diningTotalEaten() {
      return (this.filteredMembers || []).reduce((sum, m) => sum + (m.eaten || 0), 0);
    },
    get diningTotalCurrentBalance() {
      return (this.filteredMembers || []).reduce((sum, m) => sum + (m.currentBalance || 0), 0);
    },

    // Danh sách thành viên xuất hiện ở cả 2 sổ (Ăn nhóm & Gia đình)
    get dualGroupMembers() {
      const workMembers = this.dashboard.card4_dining?.work?.members || [];
      const familyMembers = this.dashboard.card4_dining?.family?.members || [];
      const result = [];
      workMembers.forEach(wm => {
        const norm = normalizeMemberName(wm.name);
        const fm = familyMembers.find(f => normalizeMemberName(f.name) === norm);
        if (fm) {
          result.push({
            name: wm.name,
            personKey: wm.personKey,
            workBalance: wm.currentBalance || 0,
            familyBalance: fm.currentBalance || 0,
            workMemberId: wm.id,
            familyMemberId: fm.id
          });
        }
      });
      return result;
    },

    isDualMember(name) {
      if (!name) return false;
      const norm = normalizeMemberName(name);
      return (this.dualGroupMembers || []).some(m => normalizeMemberName(m.name) === norm);
    },

    get selectedTransferMember() {
      const name = this.diningTransferForm.memberName;
      if (!name) return null;
      const norm = normalizeMemberName(name);
      return (this.dualGroupMembers || []).find(m => normalizeMemberName(m.name) === norm) || null;
    },

    get transferSourceBalance() {
      const m = this.selectedTransferMember;
      if (!m) return 0;
      return this.diningTransferForm.fromCategory === 'family' ? m.familyBalance : m.workBalance;
    },

    get transferTargetBalance() {
      const m = this.selectedTransferMember;
      if (!m) return 0;
      return this.diningTransferForm.toCategory === 'family' ? m.familyBalance : m.workBalance;
    },

    get filteredDebts() {
      const list = this.dashboard.allDebts || [];
      if (this.debtFilter === 'receivable') return list.filter(d => d.type === 'receivable');
      if (this.debtFilter === 'payable') return list.filter(d => d.type === 'payable');
      if (this.debtFilter === 'pending') return list.filter(d => d.status === 'pending');
      if (this.debtFilter === 'paid') return list.filter(d => d.status === 'paid');
      return list;
    },

    get filteredTransactions() {
      const list = this.dashboard.transactions || [];
      return list.filter(t => {
        if (this.txFilter.type !== 'all' && t.type !== this.txFilter.type) return false;
        if (this.txFilter.accountName !== 'all') {
          const acc = (this.txFilter.accountName || '').toLowerCase().trim();
          const matchFrom = (t.accountName || '').toLowerCase().trim() === acc;
          const matchTo = (t.toAccountName || '').toLowerCase().trim() === acc;
          if (!matchFrom && !matchTo) return false;
        }
        if (this.txFilter.hubRole !== 'all' && t.hubRole !== this.txFilter.hubRole) return false;
        return true;
      });
    },

    get totalIncomeTransactions() {
      return (this.filteredTransactions || [])
        .filter(t => t.type === 'income')
        .reduce((sum, t) => sum + (t.amount || 0), 0);
    },

    get totalExpenseTransactions() {
      return (this.filteredTransactions || [])
        .filter(t => t.type === 'expense')
        .reduce((sum, t) => sum + (t.amount || 0), 0);
    },

    get personalHub() {
      return this.dashboard.card4_personal_hub || {
        monthlyBudget: 6000000,
        savingsRate: 15,
        targetSavings: 900000,
        actualSavings: 0,
        savingsList: [],
        totalFixedBills: 0,
        paidFixedBills: 0,
        pendingFixedBills: 0,
        fixedBillsList: [],
        spendableFlexibleMonthly: 0,
        currentMonthFlexibleSpent: 0,
        remainingFlexibleMonthly: 0,
        weeklyLimit: 1500000,
        weeklySpent: 0,
        weeklyRemaining: 0,
        weeklyPercent: 0,
        allExpenses: []
      };
    },

    get fixedBills() {
      return this.personalHub.fixedBillsList || [];
    },

    get savingsList() {
      return this.personalHub.savingsList || [];
    },

    isTransactionWeeklyImpact(t) {
      if (!t || t.type !== 'expense') return false;
      if (t.impactsWeeklyLimit) return true;
      if (t.hubRole === 'hub4_personal') {
        const isDebt = /trả nợ|công nợ|tiền xưởng|nhà cung cấp/i.test(t.title || '');
        const isLiving = /ăn uống|chi tiêu|sinh hoạt|ăn ngoài|cafe|cà phê|tiêu dùng/i.test(t.category || '');
        return isLiving && !isDebt;
      }
      return false;
    },

    get personalFlexibleExpenses() {
      return (this.dashboard.transactions || []).filter(t => t.hubRole === 'hub4_personal' && t.type === 'expense');
    },

    async fetchDashboard() {
      try {
        const res = await this.authFetch('/api/dashboard');
        const data = await res.json();
        if (data.success) {
          this.error = null;
          this.dashboard = data;
          if (data.currentUser) {
            this.currentUser = data.currentUser;
          }
          this.ensureValidActiveTab();
          this.configForm.weeklyLimit = data.config.weeklyLimit;
          if (data.card4_personal_hub) {
            this.personalConfigForm.hub4MonthlyBudget = data.card4_personal_hub.monthlyBudget || 6000000;
            this.personalConfigForm.savingsRate = data.card4_personal_hub.savingsRate || 15;
            this.personalConfigForm.weeklyLimit = data.card4_personal_hub.weeklyLimit || 1500000;
          }
          if (data.projectionHealth) {
            this.projectionHealth = data.projectionHealth;
          }
          this.fetchCorrectionRequests();
          this.fetchUpcomingTransactions();
        } else {
          this.error = data.error || 'Chưa thể kết nối tới cơ sở dữ liệu MongoDB Atlas.';
        }
      } catch (err) {
        console.error('Lỗi nạp dashboard:', err);
        this.error = err.message;
      } finally {
        this.loading = false;
      }
    },

    // ==================== 1. SỔ GIAO DỊCH THU / CHI / CHUYỂN KHOẢN (REQUEST 1) ====================
    openTransactionModal(tx = null, defaultCategory = null, defaultHub = null) {
      if (tx && typeof tx === 'object' && tx._id) {
        this.editingTransactionId = tx._id;
        this.transactionForm = {
          date: tx.date || new Date().toISOString().slice(0, 10),
          title: tx.title || '',
          amount: tx.amount || '',
          type: tx.type || 'expense',
          accountName: tx.accountName || 'Vietcombank',
          toAccountName: tx.toAccountName || '',
          category: tx.category || 'Chi tiêu',
          hubRole: tx.hubRole || 'hub4_personal',
          impactsWeeklyLimit: tx.impactsWeeklyLimit !== undefined ? Boolean(tx.impactsWeeklyLimit) : (tx.hubRole === 'hub4_personal' && tx.type === 'expense'),
          notes: tx.notes || ''
        };
      } else {
        this.editingTransactionId = null;
        const defaultAcc = (this.dashboard.accounts.list && this.dashboard.accounts.list[0]?.name) || 'Vietcombank';
        const initialType = (typeof tx === 'string') ? tx : 'expense';
        const initialCategory = defaultCategory || 'Ăn uống cá nhân';
        const initialHub = defaultHub || 'hub4_personal';
        this.transactionForm = {
          date: new Date().toISOString().slice(0, 10),
          title: '',
          amount: '',
          type: initialType,
          accountName: defaultAcc,
          toAccountName: '',
          category: initialCategory,
          hubRole: initialHub,
          impactsWeeklyLimit: initialType === 'expense' && initialHub === 'hub4_personal',
          notes: ''
        };
      }
      this.modals.transaction = true;
    },

    copyTransaction(tx) {
      this.editingTransactionId = null;
      this.transactionForm = {
        date: new Date().toISOString().slice(0, 10),
        title: tx.title ? tx.title + ' (Bản sao)' : '',
        amount: tx.amount,
        type: tx.type || 'expense',
        accountName: tx.accountName || 'Vietcombank',
        toAccountName: tx.toAccountName || '',
        category: tx.category || 'Chi tiêu',
        hubRole: tx.hubRole || 'hub4_personal',
        impactsWeeklyLimit: tx.impactsWeeklyLimit !== undefined ? Boolean(tx.impactsWeeklyLimit) : (tx.hubRole === 'hub4_personal' && tx.type === 'expense'),
        notes: tx.notes || ''
      };
      this.modals.transaction = true;
      this.notify('📋 Đã sao chép giao dịch!');
    },

    async submitTransaction() {
      try {
        if (this.transactionForm.hubRole !== 'hub4_personal') {
          this.transactionForm.impactsWeeklyLimit = false;
        }

        const url = this.editingTransactionId ? `/api/transactions/${this.editingTransactionId}` : '/api/transactions';
        const method = this.editingTransactionId ? 'PUT' : 'POST';

        const res = await this.authFetch(url, {
          method,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(this.transactionForm)
        });
        const data = await res.json();
        if (data.success) {
          this.notify(this.editingTransactionId ? '✓ Đã cập nhật giao dịch & số dư ngân hàng!' : '✓ Đã lưu giao dịch & cập nhật số dư ngân hàng!');
          this.modals.transaction = false;
          this.fetchDashboard();
        } else {
          alert('Lỗi: ' + (data.message || data.error));
        }
      } catch (err) {
        alert('Lỗi hệ thống: ' + err.message);
      }
    },

    async deleteTransaction(id, title) {
      if (!confirm(`Xóa giao dịch "${title}"?\nSố dư tài khoản ngân hàng liên quan sẽ được tự động hoàn tác.`)) return;
      try {
        const res = await this.authFetch(`/api/transactions/${id}`, { method: 'DELETE' });
        const data = await res.json();
        if (data.success) {
          this.notify('🗑️ Đã xóa giao dịch & hoàn lại số dư!');
          this.fetchDashboard();
        } else {
          alert('Lỗi: ' + (data.message || data.error));
        }
      } catch (err) {
        alert('Lỗi hệ thống: ' + err.message);
      }
    },

    // Xóa bất kỳ giao dịch nào từ Unified Transaction Feed (tự động điều hướng đúng sổ dữ liệu)
    async deleteUnifiedTransaction(t) {
      if (!t) return;
      const src = t.source || 'direct';
      const id = t.sourceId || t._id;
      const title = t.title || 'giao dịch';

      if (src === 'dining_ledger' || src === 'dining_bill') {
        return this.deleteDiningBill(id, title);
      }
      if (src === 'dining_settlement') {
        return this.deleteSettlement(id, title);
      }
      if (src === 'personal_expense') {
        return this.deletePersonalExpense(id, title);
      }
      return this.deleteTransaction(id, title);
    },

    // ==================== 2. TÀI KHOẢN NGÂN HÀNG & TIỀN MẶT (CRUD) ====================
    openAccountModal(acc = null) {
      if (acc) {
        this.editingAccountId = acc._id;
        this.accountForm = {
          name: acc.name,
          type: acc.type || 'bank',
          balance: acc.balance,
          accountNumber: acc.accountNumber || '',
          hubRole: acc.hubRole || 'hub1_income',
          note: acc.note || ''
        };
      } else {
        this.editingAccountId = null;
        this.accountForm = {
          name: '',
          type: 'bank',
          balance: '',
          accountNumber: '',
          hubRole: 'hub1_income',
          note: ''
        };
      }
      this.modals.account = true;
    },

    async submitAccount() {
      try {
        const url = this.editingAccountId ? `/api/accounts/${this.editingAccountId}` : '/api/accounts';
        const method = this.editingAccountId ? 'PUT' : 'POST';

        const res = await this.authFetch(url, {
          method,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(this.accountForm)
        });
        const data = await res.json();
        if (data.success) {
          this.notify(this.editingAccountId ? '✓ Đã cập nhật tài khoản!' : '✓ Đã thêm tài khoản mới!');
          this.modals.account = false;
          this.fetchDashboard();
        } else {
          alert('Lỗi: ' + (data.message || data.error));
        }
      } catch (err) {
        alert('Lỗi: ' + err.message);
      }
    },

    async quickUpdateBalance(acc) {
      const input = prompt(`Cập nhật số tiền thực tế cho ${acc.name}:`, acc.balance);
      if (input === null) return;
      const newBal = parseFloat(input.replace(/[^\d.-]/g, ''));
      if (isNaN(newBal)) {
        alert('Vui lòng nhập số hợp lệ!');
        return;
      }
      try {
        const res = await this.authFetch(`/api/accounts/${acc._id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ balance: newBal })
        });
        const data = await res.json();
        if (data.success) {
          this.notify(`✓ Đã cập nhật ${acc.name}: ${this.formatVND(newBal)}`);
          this.fetchDashboard();
        }
      } catch (err) {
        alert('Lỗi: ' + err.message);
      }
    },

    async deleteAccount(id, name) {
      if (!confirm(`Xóa tài khoản/ví "${name}"?`)) return;
      try {
        const res = await this.authFetch(`/api/accounts/${id}`, { method: 'DELETE' });
        const data = await res.json();
        if (data.success) {
          this.notify(`🗑️ Đã xóa ${name}!`);
          this.fetchDashboard();
        }
      } catch (err) {
        alert('Lỗi: ' + err.message);
      }
    },

    // ==================== 3. HŨ TIỀN HÀNG NỢ TỪNG NCC (CRUD) ====================
    openSupplierModal(sup = null) {
      if (sup) {
        this.editingSupplierId = sup._id;
        this.supplierForm = {
          supplierName: sup.supplierName,
          remainingAmount: sup.remainingAmount,
          dueDate: sup.dueDate ? new Date(sup.dueDate).toISOString().slice(0, 10) : '',
          phone: sup.phone || '',
          bankInfo: sup.bankInfo || '',
          notes: sup.notes || ''
        };
      } else {
        this.editingSupplierId = null;
        this.supplierForm = {
          supplierName: '',
          remainingAmount: '',
          dueDate: '',
          phone: '',
          bankInfo: '',
          notes: ''
        };
      }
      this.formData = this.supplierForm;
      this.modals.supplier = true;
    },

    async submitSupplier() {
      try {
        const url = this.editingSupplierId ? `/api/supplier-debts/${this.editingSupplierId}` : '/api/supplier-debts';
        const method = this.editingSupplierId ? 'PUT' : 'POST';

        const res = await this.authFetch(url, {
          method,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(this.supplierForm)
        });
        const data = await res.json();
        if (data.success) {
          this.notify(this.editingSupplierId ? '✓ Đã cập nhật nhà cung cấp!' : '✓ Đã thêm nhà cung cấp mới!');
          this.modals.supplier = false;
          this.fetchDashboard();
        } else {
          alert('Lỗi: ' + (data.message || data.error));
        }
      } catch (err) {
        alert('Lỗi: ' + err.message);
      }
    },

    async paySupplierPrompt(sup) {
      const input = prompt(
        `Nhập số tiền muốn trả cho NCC "${sup.supplierName}":\n(Nợ hiện tại: ${this.formatVND(sup.remainingAmount)})\n\n💡 Bạn có thể trả một phần (VD: gõ 480k, 480000 hoặc 480.000):`,
        sup.remainingAmount
      );
      if (input === null) return;
      const payAmount = this.parseVND(input);
      if (payAmount <= 0) {
        alert('Vui lòng nhập số tiền hợp lệ lớn hơn 0đ!');
        return;
      }
      try {
        const res = await this.authFetch(`/api/supplier-debts/${sup._id}/pay`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ amount: payAmount })
        });
        const data = await res.json();
        if (data.success) {
          this.notify(`✓ Đã thanh toán ${this.formatVND(payAmount)} cho ${sup.supplierName}!`);
          this.fetchDashboard();
        }
      } catch (err) {
        alert('Lỗi: ' + err.message);
      }
    },

    async batchPayAllSuppliers() {
      if (!confirm(`Xác nhận thanh toán gom toàn bộ tiền hàng cho TẤT CẢ nhà cung cấp?\nTổng tiền: ${this.formatVND(this.dashboard.supplierPot.totalAmount)}\nHũ tiền hàng sẽ được reset về 0đ.`)) return;
      try {
        const res = await this.authFetch('/api/supplier-debts/batch-pay-all', { method: 'POST' });
        const data = await res.json();
        if (data.success) {
          this.notify('🎉 Đã thanh toán gom toàn bộ NCC! Hũ tiền hàng về 0đ.');
          this.fetchDashboard();
        }
      } catch (err) {
        alert('Lỗi: ' + err.message);
      }
    },

    async deleteSupplier(id, name) {
      if (!confirm(`Xóa NCC "${name}"?`)) return;
      try {
        const res = await this.authFetch(`/api/supplier-debts/${id}`, { method: 'DELETE' });
        const data = await res.json();
        if (data.success) {
          this.notify(`🗑️ Đã xóa NCC ${name}!`);
          this.fetchDashboard();
        }
      } catch (err) {
        alert('Lỗi: ' + err.message);
      }
    },

    openSupplierHistoryModal(sup) {
      this.selectedSupplierForHistory = sup;
      this.modals.supplierHistory = true;
    },

    normalizeKey(str) {
      if (!str) return '';
      return String(str).trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ');
    },

    getSupplierOrders(sup) {
      if (!sup || !this.dashboard?.allOrders) return [];
      const supKey = this.normalizeKey(sup.supplierName);
      return (this.dashboard.allOrders || []).filter(o => {
        const oKey = this.normalizeKey(o.supplierName || o.supplierKey || '');
        return oKey && (oKey === supKey || oKey.includes(supKey) || supKey.includes(oKey));
      });
    },

    getSupplierOrdersSummary(sup) {
      const orders = this.getSupplierOrders(sup);
      const unpaid = orders.filter(o => !o.supplierPaid && (Number(o.costPrice) || 0) > 0);
      const paid = orders.filter(o => o.supplierPaid);
      const totalCost = orders.reduce((sum, o) => sum + (Number(o.costPrice) || 0), 0);
      const totalUnpaidCost = unpaid.reduce((sum, o) => sum + (Number(o.costPrice) || 0), 0);
      const totalPaidCost = paid.reduce((sum, o) => sum + (Number(o.costPrice) || 0), 0);

      return {
        totalOrders: orders.length,
        totalCost,
        unpaidCount: unpaid.length,
        totalUnpaidCost,
        paidCount: paid.length,
        totalPaidCost
      };
    },

    createOrderForSupplier(sup) {
      this.openServiceOrderModal();
      if (sup) {
        this.serviceOrderForm.supplierName = sup.supplierName;
        this.serviceOrderForm.supplierPaid = false;
      }
      this.modals.supplierHistory = false;
    },

    // ==================== 3B. ĐƠN DỊCH VỤ / BÁN HÀNG & CÔNG NỢ KHÁCH - NCC ====================
    openServiceOrderModal(order = null) {
      if (order) {
        this.serviceOrderForm = {
          _id: order._id,
          customerName: order.customerName || '',
          serviceName: order.serviceName || 'Bán dấu / Khắc dấu',
          salePrice: order.salePrice || '',
          costPrice: order.costPrice || '',
          supplierName: order.supplierName || '',
          customerPaid: Boolean(order.customerPaid),
          supplierPaid: Boolean(order.supplierPaid),
          date: order.date || new Date().toISOString().slice(0, 10),
          note: order.note || ''
        };
      } else {
        this.serviceOrderForm = {
          _id: null,
          customerName: '',
          serviceName: 'Bán dấu / Khắc dấu',
          salePrice: '',
          costPrice: '',
          supplierName: '',
          customerPaid: false,
          supplierPaid: false,
          date: new Date().toISOString().slice(0, 10),
          note: ''
        };
      }
      this.modals.service = true;
    },

    async saveServiceOrder() {
      if (!this.serviceOrderForm.customerName || !this.serviceOrderForm.customerName.trim()) {
        alert('Vui lòng nhập tên khách hàng!');
        return;
      }
      const saleAmt = this.parseVND(this.serviceOrderForm.salePrice);
      if (saleAmt <= 0) {
        alert('Vui lòng nhập giá bán thu khách hợp lệ (> 0đ)!');
        return;
      }
      const costAmt = this.parseVND(this.serviceOrderForm.costPrice);

      const payload = {
        customerName: this.serviceOrderForm.customerName.trim(),
        serviceName: (this.serviceOrderForm.serviceName || 'Bán dấu / Khắc dấu').trim(),
        salePrice: saleAmt,
        costPrice: costAmt,
        supplierName: (this.serviceOrderForm.supplierName || '').trim(),
        customerPaid: Boolean(this.serviceOrderForm.customerPaid),
        supplierPaid: Boolean(this.serviceOrderForm.supplierPaid),
        date: this.serviceOrderForm.date || new Date().toISOString().slice(0, 10),
        note: (this.serviceOrderForm.note || '').trim()
      };

      try {
        const url = this.serviceOrderForm._id 
          ? `/api/service-orders/${this.serviceOrderForm._id}`
          : '/api/service-orders';
        const method = this.serviceOrderForm._id ? 'PUT' : 'POST';

        const res = await this.authFetch(url, {
          method,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
        const data = await res.json();
        if (data.success) {
          this.notify(this.serviceOrderForm._id ? '✓ Đã cập nhật đơn hàng!' : '✓ Đã ghi nhận đơn hàng mới!');
          this.modals.service = false;
          await this.fetchDashboard();
        } else {
          alert('Lỗi: ' + (data.message || data.error));
        }
      } catch (err) {
        alert('Lỗi: ' + err.message);
      }
    },

    async toggleCustomerPaid(order) {
      try {
        const res = await this.authFetch(`/api/service-orders/${order._id}/toggle-customer-paid`, {
          method: 'PATCH'
        });
        const data = await res.json();
        if (data.success) {
          this.notify(data.message || '✓ Đã cập nhật trạng thái thu tiền khách!');
          await this.fetchDashboard();
        } else {
          alert('Lỗi: ' + (data.message || data.error));
        }
      } catch (err) {
        alert('Lỗi: ' + err.message);
      }
    },

    async toggleSupplierPaid(order) {
      try {
        const res = await this.authFetch(`/api/service-orders/${order._id}/toggle-supplier-paid`, {
          method: 'PATCH'
        });
        const data = await res.json();
        if (data.success) {
          this.notify(data.message || '✓ Đã cập nhật trạng thái trả vốn NCC!');
          await this.fetchDashboard();
        } else {
          alert('Lỗi: ' + (data.message || data.error));
        }
      } catch (err) {
        alert('Lỗi: ' + err.message);
      }
    },

    async deleteServiceOrder(order) {
      if (!confirm(`Xác nhận xóa đơn hàng của khách "${order.customerName}" (${this.formatVND(order.salePrice)})?`)) return;
      try {
        const res = await this.authFetch(`/api/service-orders/${order._id}`, {
          method: 'DELETE'
        });
        const data = await res.json();
        if (data.success) {
          this.notify('🗑️ Đã xóa đơn hàng!');
          await this.fetchDashboard();
        } else {
          alert('Lỗi: ' + (data.message || data.error));
        }
      } catch (err) {
        alert('Lỗi: ' + err.message);
      }
    },

    // ==================== 4. LỊCH NHẮC DÒNG TIỀN (TIMELINE CRUD) ====================
    openReminderModal(rem = null) {
      if (rem) {
        this.editingReminderId = rem._id;
        this.reminderForm = {
          date: rem.date,
          title: rem.title,
          amount: rem.amount,
          type: rem.type || 'expense',
          hubRole: rem.hubRole || 'hub1_income',
          notes: rem.notes || ''
        };
      } else {
        this.editingReminderId = null;
        this.reminderForm = {
          date: new Date().toISOString().slice(0, 10),
          title: '',
          amount: '',
          type: 'expense',
          hubRole: 'hub1_income',
          notes: ''
        };
      }
      this.modals.reminder = true;
    },

    copyReminder(rem) {
      this.editingReminderId = null;
      this.reminderForm = {
        date: rem.date,
        title: rem.title + ' (Bản sao)',
        amount: rem.amount,
        type: rem.type || 'expense',
        hubRole: rem.hubRole || 'hub1_income',
        notes: rem.notes || ''
      };
      this.modals.reminder = true;
      this.notify('📋 Đã sao chép dòng nhắc!');
    },

    async submitReminder() {
      try {
        const url = this.editingReminderId ? `/api/reminders/${this.editingReminderId}` : '/api/reminders';
        const method = this.editingReminderId ? 'PUT' : 'POST';

        const res = await this.authFetch(url, {
          method,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(this.reminderForm)
        });
        const data = await res.json();
        if (data.success) {
          this.notify(this.editingReminderId ? '✓ Đã cập nhật dòng nhắc!' : '✓ Đã thêm lịch nhắc mới!');
          this.modals.reminder = false;
          this.fetchDashboard();
        } else {
          alert('Lỗi: ' + (data.message || data.error));
        }
      } catch (err) {
        alert('Lỗi: ' + err.message);
      }
    },

    async toggleReminderStatus(id) {
      try {
        const res = await this.authFetch(`/api/reminders/${id}/toggle-status`, { method: 'PATCH' });
        const data = await res.json();
        if (data.success) {
          this.notify('✓ Đã cập nhật trạng thái nhắc nhở!');
          this.fetchDashboard();
        }
      } catch (err) {
        alert('Lỗi: ' + err.message);
      }
    },

    async deleteReminder(id, title) {
      if (!confirm(`Xóa dòng nhắc "${title}"?`)) return;
      try {
        const res = await this.authFetch(`/api/reminders/${id}`, { method: 'DELETE' });
        const data = await res.json();
        if (data.success) {
          this.notify('🗑️ Đã xóa dòng nhắc!');
          this.fetchDashboard();
        }
      } catch (err) {
        alert('Lỗi: ' + err.message);
      }
    },

    // ==================== 5. SỔ NỢ 2 CHIỀU (CRUD) ====================
    openDebtModal(debt = null) {
      if (debt) {
        this.editingDebtId = debt._id;
        this.debtForm = {
          type: debt.type,
          personName: debt.personName,
          amount: debt.amount,
          dueDate: debt.dueDate || new Date().toISOString().slice(0, 10),
          note: debt.note || ''
        };
      } else {
        this.editingDebtId = null;
        this.debtForm = {
          type: 'receivable',
          personName: '',
          amount: '',
          dueDate: new Date().toISOString().slice(0, 10),
          note: ''
        };
      }
      this.modals.debt = true;
    },

    copyDebt(debt) {
      this.editingDebtId = null;
      this.debtForm = {
        type: debt.type,
        personName: debt.personName + ' (Bản sao)',
        amount: debt.amount,
        dueDate: new Date().toISOString().slice(0, 10),
        note: debt.note || ''
      };
      this.modals.debt = true;
      this.notify('📋 Đã sao chép khoản nợ!');
    },

    async submitDebt() {
      try {
        const url = this.editingDebtId ? `/api/debts/${this.editingDebtId}` : '/api/debts';
        const method = this.editingDebtId ? 'PUT' : 'POST';

        const res = await this.authFetch(url, {
          method,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(this.debtForm)
        });
        const data = await res.json();
        if (data.success) {
          this.notify(this.editingDebtId ? '✓ Đã cập nhật khoản nợ!' : '✓ Đã thêm khoản nợ mới!');
          this.modals.debt = false;
          this.fetchDashboard();
        } else {
          alert('Lỗi: ' + (data.message || data.error));
        }
      } catch (err) {
        alert('Lỗi: ' + err.message);
      }
    },

    async toggleDebtStatus(id) {
      try {
        const res = await this.authFetch(`/api/debts/${id}/toggle-status`, { method: 'PATCH' });
        const data = await res.json();
        if (data.success) {
          this.notify('✓ Đã cập nhật trạng thái thanh toán nợ!');
          this.fetchDashboard();
        }
      } catch (err) {
        alert('Lỗi: ' + err.message);
      }
    },

    async deleteDebt(id, name) {
      if (!confirm(`Xóa khoản nợ của "${name}"?`)) return;
      try {
        const res = await this.authFetch(`/api/debts/${id}`, { method: 'DELETE' });
        const data = await res.json();
        if (data.success) {
          this.notify('🗑️ Đã xóa khoản nợ!');
          this.fetchDashboard();
        }
      } catch (err) {
        alert('Lỗi: ' + err.message);
      }
    },

    // ==================== 6. BỮA ĂN NHÓM & QUỸ GIA ĐÌNH (REQUEST 2 ENGINE) ====================
    openNewDiningBillModal() {
      this.editingDiningId = null;
      const cat = this.diningCategory === 'family' ? 'family' : 'work';
      const defaultAcc = (this.dashboard.accounts.list && this.dashboard.accounts.list[0]?.name) || 'Vietcombank';

      this.diningBillForm = {
        category: cat,
        mealTitle: cat === 'family' ? 'Chi tiêu / Ăn uống gia đình' : 'Cơm trưa văn phòng',
        date: new Date().toISOString().slice(0, 10),
        totalBill: 150000,
        paidAccount: defaultAcc,
        deductFromAccount: true,
        deductWeeklyLimit: cat === 'work',
        splitMode: 'equal',
        includeMe: true,
        myShare: 0,
        participants: [],
        notes: ''
      };

      this.populateBillParticipants();
      this.recalculateBillSplits();
      this.modals.diningBill = true;
    },

    populateBillParticipants(existingSplits = null) {
      const cat = this.diningBillForm.category;
      const allMembers = [...(this.dashboard.card4_dining.allMembers || [])];
      allMembers.sort((a, b) => {
        const oA = getMemberSortIndex(a.name, a.group);
        const oB = getMemberSortIndex(b.name, b.group);
        if (oA !== oB) return oA - oB;
        return (a.name || '').localeCompare(b.name || '', 'vi');
      });
      const relevantMembers = allMembers.filter(m => cat === 'family' ? m.group === 'family' : m.group !== 'family');

      this.diningBillForm.participants = relevantMembers.map(m => {
        let selected = true;
        let customAmount = 0;

        if (existingSplits && existingSplits.length > 0) {
          const match = existingSplits.find(sp => sp.personKey === m.personKey || sp.personName.toLowerCase() === m.name.toLowerCase());
          if (match) {
            selected = true;
            customAmount = match.amount || 0;
          } else {
            selected = false;
          }
        }

        return {
          personKey: m.personKey,
          name: m.name,
          selected,
          customAmount
        };
      });
    },

    onBillCategoryChange() {
      this.diningBillForm.deductWeeklyLimit = this.diningBillForm.category === 'work';
      this.populateBillParticipants();
      this.recalculateBillSplits();
    },

    selectAllParticipants(state) {
      this.diningBillForm.participants.forEach(p => p.selected = state);
      this.recalculateBillSplits();
    },

    recalculateBillSplits() {
      const total = Number(this.diningBillForm.totalBill) || 0;
      const selected = this.diningBillForm.participants.filter(p => p.selected);
      const totalCount = selected.length + (this.diningBillForm.includeMe ? 1 : 0);

      if (this.diningBillForm.splitMode === 'equal') {
        if (totalCount > 0) {
          const share = Math.round(total / totalCount);
          selected.forEach(p => p.customAmount = share);
          this.diningBillForm.myShare = this.diningBillForm.includeMe ? (total - share * selected.length) : 0;
        } else {
          this.diningBillForm.myShare = 0;
        }
      } else {
        // Custom split: My share is remainder of total - sum(selected participants)
        const othersSum = selected.reduce((sum, p) => sum + (Number(p.customAmount) || 0), 0);
        this.diningBillForm.myShare = Math.max(0, total - othersSum);
      }
    },

    editDiningBill(bill) {
      this.editingDiningId = bill._id;
      const cat = bill.category || 'work';

      this.diningBillForm = {
        category: cat,
        mealTitle: bill.mealTitle,
        date: bill.date,
        totalBill: bill.totalBill,
        paidAccount: bill.paidAccount || 'Vietcombank',
        deductFromAccount: bill.deductFromAccount !== false,
        deductWeeklyLimit: bill.deductWeeklyLimit !== false,
        splitMode: bill.splitMode || 'equal',
        includeMe: (bill.splits || []).some(sp => sp.isMe),
        myShare: bill.myShare || 0,
        participants: [],
        notes: bill.notes || ''
      };

      this.populateBillParticipants(bill.splits);
      this.recalculateBillSplits();
      this.modals.diningBill = true;
    },

    copyDiningBill(bill) {
      this.editingDiningId = null;
      const cat = bill.category || 'work';

      this.diningBillForm = {
        category: cat,
        mealTitle: bill.mealTitle + ' (Mới)',
        date: new Date().toISOString().slice(0, 10),
        totalBill: bill.totalBill,
        paidAccount: bill.paidAccount || 'Vietcombank',
        deductFromAccount: true,
        deductWeeklyLimit: bill.deductWeeklyLimit !== false,
        splitMode: bill.splitMode || 'equal',
        includeMe: (bill.splits || []).some(sp => sp.isMe),
        myShare: bill.myShare || 0,
        participants: [],
        notes: bill.notes || ''
      };

      this.populateBillParticipants(bill.splits);
      this.recalculateBillSplits();
      this.modals.diningBill = true;
      this.notify('📋 Đã sao chép cấu hình chia tiền bữa ăn!');
    },

    async submitDiningBill() {
      try {
        const splits = [];
        const cat = this.diningBillForm.category;

        if (this.diningBillForm.includeMe) {
          splits.push({
            personKey: 'toi',
            personName: 'Tôi',
            amount: Number(this.diningBillForm.myShare) || 0,
            paid: true,
            isMe: true,
            group: cat
          });
        }

        this.diningBillForm.participants
          .filter(p => p.selected)
          .forEach(p => {
            splits.push({
              personKey: p.personKey,
              personName: p.name,
              amount: Number(p.customAmount) || 0,
              paid: false,
              isMe: false,
              group: cat
            });
          });

        const payload = {
          date: this.diningBillForm.date,
          mealTitle: this.diningBillForm.mealTitle,
          category: cat,
          totalBill: Number(this.diningBillForm.totalBill) || 0,
          myShare: Number(this.diningBillForm.myShare) || 0,
          splitMode: this.diningBillForm.splitMode,
          splits,
          paidAccount: this.diningBillForm.paidAccount,
          deductFromAccount: this.diningBillForm.deductFromAccount,
          deductWeeklyLimit: this.diningBillForm.deductWeeklyLimit,
          notes: this.diningBillForm.notes
        };

        const url = this.editingDiningId ? `/api/dining/bill/${this.editingDiningId}` : '/api/dining/bill';
        const method = this.editingDiningId ? 'PUT' : 'POST';

        const res = await this.authFetch(url, {
          method,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
        const data = await res.json();
        if (data.success) {
          this.notify(this.editingDiningId ? '✓ Đã cập nhật hóa đơn & tự động cân đối tài khoản!' : '✓ Đã ghi nhận bữa ăn & trừ số tiền ngân hàng thành công!');
          this.modals.diningBill = false;
          this.fetchDashboard();
        } else {
          alert('Lỗi: ' + (data.message || data.error));
        }
      } catch (err) {
        alert('Lỗi hệ thống: ' + err.message);
      }
    },

    async deleteDiningBill(id, title) {
      if (!confirm(`Xóa hóa đơn "${title}"?\nSố tiền đã trừ trong ngân hàng sẽ được tự động hoàn lại.`)) return;
      try {
        const res = await this.authFetch(`/api/dining/bill/${id}`, { method: 'DELETE' });
        const data = await res.json();
        if (data.success) {
          this.notify('🗑️ Đã xóa bữa ăn & hoàn trả số dư ngân hàng!');
          this.fetchDashboard();
        } else {
          alert('Lỗi: ' + (data.message || data.error));
        }
      } catch (err) {
        alert('Lỗi hệ thống: ' + err.message);
      }
    },

    // ==================== 7. NẠP / TRẢ TIỀN ĂN (SETTLEMENTS) ====================
    openSettlementModal(s = null) {
      const defaultAcc = (this.dashboard.accounts.list && this.dashboard.accounts.list[0]?.name) || 'Vietcombank';
      if (s) {
        this.editingSettlementId = s._id;
        this.settlementForm = {
          category: s.category || 'work',
          personName: s.personName,
          amount: s.amount,
          direction: s.direction || 'in',
          topupKind: s.topupKind || 'prepaid',
          accountName: s.accountName || defaultAcc,
          addToAccount: s.addToAccount !== false,
          note: s.note || '',
          date: s.date || new Date().toISOString().slice(0, 10)
        };
      } else {
        this.editingSettlementId = null;
        this.settlementForm = {
          category: this.diningCategory === 'family' ? 'family' : 'work',
          personName: '',
          amount: '',
          direction: 'in',
          topupKind: 'prepaid',
          accountName: defaultAcc,
          addToAccount: true,
          note: '',
          date: new Date().toISOString().slice(0, 10)
        };
      }
      this.modals.settlement = true;
    },

    copySettlement(s) {
      this.editingSettlementId = null;
      this.settlementForm = {
        category: s.category || 'work',
        personName: s.personName,
        amount: s.amount,
        direction: s.direction || 'in',
        topupKind: s.topupKind || 'prepaid',
        accountName: s.accountName || 'Vietcombank',
        addToAccount: true,
        note: s.note ? s.note + ' (Bản sao)' : '',
        date: new Date().toISOString().slice(0, 10)
      };
      this.modals.settlement = true;
      this.notify('📋 Đã sao chép giao dịch nạp / mượn!');
    },

    async submitSettlement() {
      try {
        const url = this.editingSettlementId ? `/api/dining/settlement/${this.editingSettlementId}` : '/api/dining/settlement';
        const method = this.editingSettlementId ? 'PUT' : 'POST';

        const res = await this.authFetch(url, {
          method,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(this.settlementForm)
        });
        const data = await res.json();
        if (data.success) {
          this.notify(this.editingSettlementId ? '✓ Đã cập nhật giao dịch & số dư ngân hàng!' : '✓ Đã lưu thu/nạp tiền & cộng vào tài khoản ngân hàng!');
          this.modals.settlement = false;
          this.fetchDashboard();
        } else {
          alert('Lỗi: ' + (data.message || data.error));
        }
      } catch (err) {
        alert('Lỗi hệ thống: ' + err.message);
      }
    },

    async deleteSettlement(id, name) {
      if (!confirm(`Xóa giao dịch của "${name}"?\nNếu là giao dịch liên quan đến ngân hàng hoặc cấn trừ 2 sổ, hệ thống sẽ tự động hoàn tác số liệu.`)) return;
      try {
        const res = await this.authFetch(`/api/dining/settlement/${id}`, { method: 'DELETE' });
        const data = await res.json();
        if (data.success) {
          this.notify('🗑️ ' + (data.message || 'Đã xóa giao dịch nạp / mượn!'));
          this.fetchDashboard();
        } else {
          alert('Lỗi: ' + (data.message || data.error));
        }
      } catch (err) {
        alert('Lỗi hệ thống: ' + err.message);
      }
    },

    // ==================== CẤN TRỪ SỐ DƯ LIÊN QUỸ (KHÔNG CHUYỂN KHOẢN) ====================
    openTransferModal(memberName = null, currentGroup = null) {
      const duals = this.dualGroupMembers;
      if (!duals || duals.length === 0) {
        alert('Chưa có thành viên nào xuất hiện ở cả 2 sổ (Ăn nhóm & Gia đình).');
        return;
      }

      let selected = duals[0];
      if (memberName) {
        const norm = normalizeMemberName(memberName);
        const found = duals.find(d => normalizeMemberName(d.name) === norm);
        if (found) selected = found;
      }

      // Quyết định hướng chuyển: mặc định lấy bên đang có số dư dương làm nguồn
      let fromCat = currentGroup === 'family' ? 'family' : 'work';
      let toCat = fromCat === 'work' ? 'family' : 'work';

      if (fromCat === 'work' && selected.workBalance <= 0 && selected.familyBalance > 0) {
        fromCat = 'family';
        toCat = 'work';
      } else if (fromCat === 'family' && selected.familyBalance <= 0 && selected.workBalance > 0) {
        fromCat = 'work';
        toCat = 'family';
      }

      const sourceBal = fromCat === 'family' ? selected.familyBalance : selected.workBalance;
      const defaultAmount = sourceBal > 0 ? sourceBal : '';

      this.diningTransferForm = {
        memberName: selected.name,
        fromCategory: fromCat,
        toCategory: toCat,
        amount: defaultAmount,
        date: new Date().toISOString().slice(0, 10),
        note: ''
      };

      this.modals.transfer = true;
    },

    onTransferMemberChange() {
      const m = this.selectedTransferMember;
      if (!m) return;
      const sourceBal = this.diningTransferForm.fromCategory === 'family' ? m.familyBalance : m.workBalance;
      if (sourceBal > 0) {
        this.diningTransferForm.amount = sourceBal;
      }
    },

    swapTransferDirection() {
      const oldFrom = this.diningTransferForm.fromCategory;
      this.diningTransferForm.fromCategory = this.diningTransferForm.toCategory;
      this.diningTransferForm.toCategory = oldFrom;
      const m = this.selectedTransferMember;
      if (m) {
        const newSourceBal = this.diningTransferForm.fromCategory === 'family' ? m.familyBalance : m.workBalance;
        if (newSourceBal > 0) {
          this.diningTransferForm.amount = newSourceBal;
        }
      }
    },

    async submitDiningTransfer() {
      try {
        if (!this.diningTransferForm.memberName) {
          alert('Vui lòng chọn thành viên cần cấn trừ số dư.');
          return;
        }
        const amt = Number(this.diningTransferForm.amount);
        if (!amt || amt <= 0) {
          alert('Vui lòng nhập số tiền cấn trừ lớn hơn 0đ.');
          return;
        }

        const payload = {
          personName: this.diningTransferForm.memberName,
          fromCategory: this.diningTransferForm.fromCategory,
          toCategory: this.diningTransferForm.toCategory,
          amount: amt,
          date: this.diningTransferForm.date,
          note: this.diningTransferForm.note
        };

        const res = await this.authFetch('/api/dining/transfer-balance', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
        const data = await res.json();
        if (!data.success) throw new Error(data.message || data.error);

        this.notify('⚡ ' + (data.message || 'Cấn trừ số dư 2 sổ thành công!'));
        this.modals.transfer = false;
        await this.fetchDashboard();
      } catch (err) {
        console.error('Lỗi cấn trừ liên quỹ:', err);
        alert('Lỗi: ' + err.message);
      }
    },

    // ==================== 8. THÀNH VIÊN SỔ ĂN & GIA ĐÌNH ====================
    openMemberModal(m = null) {
      if (m) {
        this.editingMemberId = m._id || m.id;
        this.memberForm = {
          name: m.name,
          group: m.group || 'work',
          openingBalance: m.openingBalance || 0,
          isBadDebt: Boolean(m.isBadDebt),
          phone: m.phone || '',
          note: m.note || ''
        };
      } else {
        this.editingMemberId = null;
        this.memberForm = {
          name: '',
          group: this.diningCategory === 'family' ? 'family' : 'work',
          openingBalance: 0,
          isBadDebt: false,
          phone: '',
          note: ''
        };
      }
      this.modals.member = true;
    },

    async submitMember() {
      try {
        const url = this.editingMemberId ? `/api/dining/member/${this.editingMemberId}` : '/api/dining/member';
        const method = this.editingMemberId ? 'PUT' : 'POST';

        const res = await this.authFetch(url, {
          method,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(this.memberForm)
        });
        const data = await res.json();
        if (data.success) {
          this.notify(this.editingMemberId ? '✓ Đã cập nhật thành viên!' : '✓ Đã thêm thành viên mới!');
          this.modals.member = false;
          await this.fetchDashboard();
          await this.fetchProjectionHealth();
        } else {
          alert('Lỗi: ' + (data.message || data.error));
        }
      } catch (err) {
        alert('Lỗi: ' + err.message);
      }
    },

    // Đánh dấu / Bỏ đánh dấu nợ dài hạn, khó đòi cho thành viên
    async toggleBadDebt(member) {
      const memberId = member.id || member._id;
      if (!memberId) return;

      const willBeBadDebt = !member.isBadDebt;
      const confirmMsg = willBeBadDebt
        ? `Đánh dấu khoản nợ của "${member.name}" là nợ dài hạn / khó đòi?\n\nKhoản nợ này sẽ bị loại trừ (trừ ra) khỏi phương trình Sức khỏe tài chính tổng thể trong bộ lọc 7 ngày và 30 ngày!`
        : `Bỏ đánh dấu nợ khó đòi cho "${member.name}"?\n\nKhoản nợ này sẽ được tính lại vào dòng tiền thu hồi ngắn hạn.`;

      if (!confirm(confirmMsg)) return;

      try {
        const res = await this.authFetch(`/api/dining/member/${memberId}/toggle-bad-debt`, {
          method: 'PATCH'
        });
        const data = await res.json();
        if (data.success) {
          this.notify(data.message || '✓ Đã cập nhật trạng thái nợ thành viên!');
          await this.fetchDashboard();
          await this.fetchProjectionHealth();
        } else {
          alert('Lỗi: ' + (data.message || data.error));
        }
      } catch (err) {
        alert('Lỗi: ' + err.message);
      }
    },

    async deleteMember(id, name) {
      if (!confirm(`Xóa thành viên "${name}" khỏi sổ?`)) return;
      try {
        const res = await this.authFetch(`/api/dining/member/${id}`, { method: 'DELETE' });
        const data = await res.json();
        if (data.success) {
          this.notify(`🗑️ Đã xóa ${name}!`);
          this.fetchDashboard();
        } else {
          alert('Lỗi: ' + (data.message || data.error));
        }
      } catch (err) {
        alert('Lỗi: ' + err.message);
      }
    },

    // ==================== LỊCH SỬ THU CHI & SAO KÊ CHI TIẾT TỪNG NGƯỜI ====================
    openMemberStatement(member) {
      if (!member) return;
      this.selectedMemberStatement = member;
      this.memberStatementFilter = 'all';

      const targetGroup = member.group || this.diningCategory || 'work';
      const mKeys = new Set(getMemberLookupKeysClient(targetGroup, member.personKey, member.name));
      if (targetGroup === 'all') {
        getMemberLookupKeysClient('work', member.personKey, member.name).forEach(k => mKeys.add(k));
        getMemberLookupKeysClient('family', member.personKey, member.name).forEach(k => mKeys.add(k));
      }

      // Lấy danh sách hóa đơn và nạp tiền
      let allBills = [];
      let allSettlements = [];
      if (targetGroup === 'work') {
        allBills = this.dashboard.card4_dining?.work?.bills || [];
        allSettlements = this.dashboard.card4_dining?.work?.settlements || [];
      } else if (targetGroup === 'family') {
        allBills = this.dashboard.card4_dining?.family?.bills || [];
        allSettlements = this.dashboard.card4_dining?.family?.settlements || [];
      } else {
        const wBills = this.dashboard.card4_dining?.work?.bills || [];
        const fBills = this.dashboard.card4_dining?.family?.bills || [];
        allBills = [...wBills, ...fBills];
        const wSet = this.dashboard.card4_dining?.work?.settlements || [];
        const fSet = this.dashboard.card4_dining?.family?.settlements || [];
        allSettlements = [...wSet, ...fSet];
      }

      const events = [];

      // 1. Số dư đầu kỳ
      events.push({
        id: 'opening_' + (member.id || member._id || member.name),
        date: 'Đầu kỳ',
        isoDate: '1970-01-01',
        type: 'opening',
        typeLabel: '🏁 Số dư đầu kỳ',
        title: 'Số dư chốt bàn giao ban đầu',
        amount: member.openingBalance || 0,
        direction: (member.openingBalance || 0) >= 0 ? 'in' : 'out',
        note: 'Số dư bàn giao sổ',
        accountName: ''
      });

      // 2. Các giao dịch Nạp (+) / Mượn (-) / Cấn trừ (⇄)
      allSettlements.forEach(s => {
        const sKeys = getMemberLookupKeysClient(s.category || 'work', s.personKey, s.personName);
        const isMatch = sKeys.some(k => mKeys.has(k)) ||
          (targetGroup === 'all' && (normalizeMemberName(s.personName) === normalizeMemberName(member.name)));
        if (isMatch) {
          const isTopup = s.direction === 'in';
          const isTransfer = Boolean(s.transferRef);
          events.push({
            id: s._id,
            date: s.date,
            isoDate: s.date || s.createdAt || '1970-01-01',
            type: isTransfer ? 'transfer' : (isTopup ? 'topup' : 'borrow'),
            typeLabel: isTransfer ? '⇄ Cấn trừ 2 sổ' : (isTopup ? '💰 Nạp tiền vào quỹ' : '💸 Mượn tiền quỹ'),
            title: isTransfer ? (s.note || 'Cấn trừ số dư 2 sổ') : (isTopup ? 'Nạp tiền vào quỹ' : 'Mượn tiền từ quỹ'),
            amount: s.amount || 0,
            direction: isTopup ? 'in' : 'out',
            note: s.note || '',
            accountName: s.accountName || ''
          });
        }
      });

      // 3. Các bữa ăn đã tham gia (Ăn -)
      allBills.forEach(b => {
        (b.splits || []).forEach(sp => {
          if (sp.isMe || normalizeMemberName(sp.personName) === 'toi') return;
          const spKeys = getMemberLookupKeysClient(b.category || 'work', sp.personKey, sp.personName);
          const isMatch = spKeys.some(k => mKeys.has(k)) ||
            (targetGroup === 'all' && (normalizeMemberName(sp.personName) === normalizeMemberName(member.name)));
          if (isMatch && (sp.amount || 0) > 0) {
            events.push({
              id: b._id + '_' + (sp.personKey || sp.personName),
              billId: b._id,
              date: b.date,
              isoDate: b.date || b.createdAt || '1970-01-01',
              type: 'meal',
              typeLabel: '🍜 Tiền ăn bữa trưa',
              title: b.mealTitle || 'Bữa ăn chung',
              amount: sp.amount || 0,
              direction: 'out',
              note: b.notes || (b.category === 'family' ? 'Quỹ Gia Đình' : 'Quỹ Ăn Nhóm'),
              accountName: b.paidAccount || ''
            });
          }
        });
      });

      // Sắp xếp thời gian tăng dần để tính số dư lũy kế
      events.sort((a, b) => {
        if (a.type === 'opening') return -1;
        if (b.type === 'opening') return 1;
        return (a.isoDate || '').localeCompare(b.isoDate || '');
      });

      // Tính số dư lũy kế (Running Balance) sau mỗi giao dịch
      let running = 0;
      events.forEach((ev) => {
        if (ev.type === 'opening') {
          running = ev.amount;
        } else if (ev.direction === 'in') {
          running += ev.amount;
        } else {
          running -= ev.amount;
        }
        ev.balanceAfter = running;
      });

      // Đảo ngược danh sách để hiển thị giao dịch mới nhất lên đầu (cho tiện theo dõi)
      this.memberStatementHistory = [...events].reverse();
      this.modals.memberStatement = true;
    },

    get filteredMemberStatementHistory() {
      if (this.memberStatementFilter === 'all') return this.memberStatementHistory;
      if (this.memberStatementFilter === 'meals') return this.memberStatementHistory.filter(e => e.type === 'meal');
      if (this.memberStatementFilter === 'topups') return this.memberStatementHistory.filter(e => e.type === 'topup');
      if (this.memberStatementFilter === 'borrow') return this.memberStatementHistory.filter(e => e.type === 'borrow');
      if (this.memberStatementFilter === 'transfer') return this.memberStatementHistory.filter(e => e.type === 'transfer');
      return this.memberStatementHistory;
    },

    // ==================== 9. CẤU HÌNH HỆ THỐNG ====================
    openConfigModal() {
      this.configForm = {
        initialCash: this.dashboard.config?.initialCash || 3741742,
        weeklyLimit: this.dashboard.config?.weeklyLimit || 1500000
      };
      this.modals.config = true;
    },

    async submitConfig() {
      try {
        const res = await this.authFetch('/api/config', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(this.configForm)
        });
        const data = await res.json();
        if (data.success) {
          this.notify('✓ Đã cập nhật hạn mức và số dư đầu kỳ!');
          this.modals.config = false;
          this.fetchDashboard();
        }
      } catch (err) {
        alert('Lỗi: ' + err.message);
      }
    },
    // ==================== 10. SỔ CHI TIÊU CÁ NHÂN & TIẾT KIỆM (HUB 4) ====================
    openPersonalExpenseModal(item = null, defaultType = 'fixed_bill') {
      if (item) {
        this.editingPersonalId = item._id || item.id;
        this.personalExpenseForm = {
          title: item.title,
          category: item.category || 'streaming_tech',
          type: item.type || defaultType,
          amount: item.amount,
          cycle: item.cycle || 'monthly',
          dueDay: item.dueDay || 5,
          status: item.status || 'pending',
          paidAccount: item.paidAccount || 'Vietcombank',
          deductFromAccount: item.deductFromAccount === true,
          notes: item.notes || ''
        };
      } else {
        this.editingPersonalId = null;
        this.personalExpenseForm = {
          title: defaultType === 'savings_deposit' ? 'Trích Tiết Kiệm Tháng mới' : '',
          category: defaultType === 'savings_deposit' ? 'savings' : 'health_fitness',
          type: defaultType,
          amount: defaultType === 'savings_deposit' ? (this.personalHub.targetSavings || 900000) : '',
          cycle: 'monthly',
          dueDay: 5,
          status: defaultType === 'savings_deposit' ? 'paid' : 'pending',
          paidAccount: 'Vietcombank',
          deductFromAccount: false,
          notes: ''
        };
      }
      this.modals.personalExpense = true;
    },

    async submitPersonalExpense() {
      try {
        if (!this.personalExpenseForm.title || !this.personalExpenseForm.title.trim()) {
          alert('Vui lòng nhập tên khoản chi / hóa đơn.');
          return;
        }
        const amt = Number(this.personalExpenseForm.amount);
        if (!amt || amt <= 0) {
          alert('Vui lòng nhập số tiền lớn hơn 0đ.');
          return;
        }

        const url = this.editingPersonalId ? `/api/personal/expense/${this.editingPersonalId}` : '/api/personal/expense';
        const method = this.editingPersonalId ? 'PUT' : 'POST';

        const res = await this.authFetch(url, {
          method,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(this.personalExpenseForm)
        });
        const data = await res.json();
        if (!data.success) throw new Error(data.message || data.error);

        this.notify('✓ ' + (this.editingPersonalId ? 'Đã cập nhật khoản chi!' : 'Đã thêm khoản chi cá nhân mới!'));
        this.modals.personalExpense = false;
        await this.fetchDashboard();
      } catch (err) {
        console.error('Lỗi lưu chi phí cá nhân:', err);
        alert('Lỗi: ' + err.message);
      }
    },

    async togglePersonalExpenseStatus(item) {
      try {
        const res = await this.authFetch(`/api/personal/expense/${item._id || item.id}/toggle`, {
          method: 'PUT'
        });
        const data = await res.json();
        if (!data.success) throw new Error(data.message || data.error);

        this.notify(`✓ Đã đổi trạng thái "${item.title}" sang: ${data.item.status === 'paid' ? 'Đã Thanh Toán' : 'Chờ Thanh Toán'}`);
        await this.fetchDashboard();
      } catch (err) {
        alert('Lỗi: ' + err.message);
      }
    },

    async deletePersonalExpense(id, title) {
      if (!confirm(`Xóa khoản chi "${title}" khỏi Sổ Cá Nhân?`)) return;
      try {
        const res = await this.authFetch(`/api/personal/expense/${id}`, { method: 'DELETE' });
        const data = await res.json();
        if (data.success) {
          this.notify('🗑️ ' + (data.message || 'Đã xóa khoản chi cá nhân!'));
          await this.fetchDashboard();
        } else {
          alert('Lỗi: ' + (data.message || data.error));
        }
      } catch (err) {
        alert('Lỗi hệ thống: ' + err.message);
      }
    },

    openPersonalConfigModal() {
      this.personalConfigForm = {
        hub4MonthlyBudget: this.personalHub.monthlyBudget || 6000000,
        savingsRate: this.personalHub.savingsRate || 15,
        weeklyLimit: this.personalHub.weeklyLimit || 1500000
      };
      this.modals.personalConfig = true;
    },

    async submitPersonalConfig() {
      try {
        const res = await this.authFetch('/api/personal/config', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(this.personalConfigForm)
        });
        const data = await res.json();
        if (!data.success) throw new Error(data.message || data.error);

        this.notify('⚙️ Đã cập nhật hạn mức phân bổ Hub 4 thành công!');
        this.modals.personalConfig = false;
        await this.fetchDashboard();
      } catch (err) {
        alert('Lỗi: ' + err.message);
      }
    },

    // ==================== DỰ BÁO DÒNG TIỀN TƯƠNG LAI (UPCOMING CASH FLOW) ====================
    async fetchUpcomingTransactions() {
      try {
        this.upcomingLoading = true;
        const res = await this.authFetch('/api/upcoming');
        const data = await res.json();
        if (data.success) {
          this.upcomingList = data.upcoming || [];
        }
      } catch (err) {
        console.error('Lỗi nạp dự báo dòng tiền:', err);
      } finally {
        this.upcomingLoading = false;
      }
    },

    // BUG 1 & BUG 2: Nạp dữ liệu Sức khỏe tài chính & toán hạng dự báo đồng bộ từ Backend
    async fetchProjectionHealth(range = null, customStart = null, customEnd = null) {
      try {
        const chosenRange = range || this.upcomingFilterRange || 'all';
        let url = `/api/projection-health?range=${chosenRange}`;
        if (chosenRange === 'custom') {
          const s = customStart || this.upcomingCustomStart;
          const e = customEnd || this.upcomingCustomEnd;
          if (s) url += `&startDate=${encodeURIComponent(s)}`;
          if (e) url += `&endDate=${encodeURIComponent(e)}`;
        }
        const res = await this.authFetch(url);
        const data = await res.json();
        if (data.success) {
          this.projectionHealth = data;
        }
      } catch (err) {
        console.error('Lỗi nạp dự báo sức khỏe tài chính:', err);
      }
    },

    // Bộ lọc thời gian đồng bộ lập tức cho Banner, 4 Hubs và danh sách
    async setTimeFilter(range) {
      this.upcomingFilterRange = range;
      if (range === 'custom') {
        if (!this.upcomingCustomStart) {
          this.upcomingCustomStart = new Date().toISOString().slice(0, 10);
        }
        if (!this.upcomingCustomEnd) {
          const d = new Date();
          d.setDate(d.getDate() + 14);
          this.upcomingCustomEnd = d.toISOString().slice(0, 10);
        }
      }
      await this.fetchProjectionHealth(range, this.upcomingCustomStart, this.upcomingCustomEnd);
    },

    async applyCustomDateFilter() {
      if (!this.upcomingCustomStart && !this.upcomingCustomEnd) {
        this.notify('⚠️ Vui lòng chọn mốc ngày cần lọc');
        return;
      }
      if (this.upcomingCustomStart && this.upcomingCustomEnd && this.upcomingCustomStart > this.upcomingCustomEnd) {
        this.notify('⚠️ Ngày bắt đầu không thể sau ngày kết thúc');
        return;
      }
      this.upcomingFilterRange = 'custom';
      await this.fetchProjectionHealth('custom', this.upcomingCustomStart, this.upcomingCustomEnd);
    },

    async submitUpcomingTransaction() {
      if (!this.upcomingForm.title || !this.upcomingForm.title.trim()) {
        this.notify('⚠️ Vui lòng nhập tên khoản mục dự kiến');
        return;
      }
      const amount = Number(this.upcomingForm.amount);
      if (!amount || amount <= 0) {
        this.notify('⚠️ Vui lòng nhập số tiền dự kiến hợp lệ (> 0)');
        return;
      }
      if (!this.upcomingForm.date) {
        this.notify('⚠️ Vui lòng chọn ngày dự kiến thực hiện');
        return;
      }

      try {
        const res = await this.authFetch('/api/upcoming', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            title: this.upcomingForm.title.trim(),
            amount: amount,
            type: this.upcomingForm.type,
            date: this.upcomingForm.date,
            hubRole: this.upcomingForm.hubRole,
            notes: this.upcomingForm.notes ? this.upcomingForm.notes.trim() : ''
          })
        });
        const data = await res.json();
        if (data.success) {
          this.notify('✓ Đã ghi nhận khoản ' + (this.upcomingForm.type === 'income' ? 'Dự Thu' : 'Dự Chi') + ' vào bảng dự báo!');
          this.upcomingForm.title = '';
          this.upcomingForm.amount = '';
          this.upcomingForm.notes = '';
          await this.fetchUpcomingTransactions();
          await this.fetchProjectionHealth();
        } else {
          this.notify('❌ ' + (data.message || data.error || 'Lỗi lưu dự báo'));
        }
      } catch (err) {
        this.notify('❌ Lỗi hệ thống: ' + err.message);
      }
    },

    async deleteUpcomingTransaction(id, isMarkAsDone = true) {
      if (String(id).startsWith('supplier_debt_')) {
        alert('Khoản nợ NCC này được đồng bộ tự động từ danh sách Nhà Cung Cấp theo ngày đến hạn (dueDate).\n\nĐể tất toán hoặc điều chỉnh, vui lòng sử dụng nút "Trả nợ" hoặc "Sửa" trong mục Hũ Tiền Hàng Nợ Từng NCC.');
        return;
      }
      const confirmText = isMarkAsDone
        ? 'Xác nhận khoản này "Đã hoàn tất"?\n\nKhoản mục sẽ được xóa khỏi danh sách dự kiến (Bạn có thể tự ghi nhận vào sổ giao dịch thực tế nếu cần).'
        : 'Bạn có chắc chắn muốn xóa khoản dự kiến này khỏi danh sách?';
      if (!confirm(confirmText)) return;

      try {
        const res = await this.authFetch(`/api/upcoming/${id}`, {
          method: 'DELETE'
        });
        const data = await res.json();
        if (data.success) {
          this.notify(isMarkAsDone ? '✓ Đã hoàn tất khoản dự kiến và gỡ khỏi danh sách!' : '🗑️ Đã xóa khoản dự kiến!');
          await this.fetchUpcomingTransactions();
          await this.fetchProjectionHealth();
        } else {
          this.notify('❌ ' + (data.message || data.error || 'Lỗi'));
        }
      } catch (err) {
        this.notify('❌ Lỗi hệ thống: ' + err.message);
      }
    },

    paySupplierDebtFromTimeline(item) {
      const sup = (this.dashboard?.supplierPot?.suppliers || []).find(s => String(s._id) === String(item.supplierDebtId));
      if (sup) {
        this.paySupplierPrompt(sup);
      } else {
        alert('Không tìm thấy NCC này trong bộ nhớ tạm, hệ thống đang đồng bộ lại dữ liệu...');
        this.fetchDashboard();
      }
    },

    // ==================== CÔNG THỨC CHUẨN: SỨC KHỎE TÀI CHÍNH DỰ KIẾN (COMPUTED REAL-TIME) ====================
    // BUG 1 & BUG 2: Đồng bộ 100% từ Backend Projection Health Engine
    // [Sức khỏe tài chính tổng thể] = [Tiền mặt thực tế] - [Hũ NCC] + [Quỹ nợ tôi] - [Dư quỹ ăn tôi nợ] + [Dự thu] - [Dự chi]
    get overallFinancialHealth() {
      if (this.projectionHealth) {
        return {
          totalActualCash: this.projectionHealth.operands?.actualCash || 0,
          supplierDebt: this.projectionHealth.operands?.supplierDebt || 0,
          diningReceivable: this.projectionHealth.operands?.diningReceivable || 0,
          diningPayable: this.projectionHealth.operands?.diningPayable || 0,
          totalUpcomingIncome: this.projectionHealth.operands?.upcomingIncome || 0,
          totalUpcomingExpense: this.projectionHealth.operands?.upcomingExpense || 0,
          badDebtExcluded: this.projectionHealth.operands?.badDebtExcluded || 0,
          totalDebtReceivable: this.projectionHealth.operands?.totalDebtReceivable || 0,
          collectibleDebtReceivable: this.projectionHealth.operands?.collectibleDebtReceivable || 0,
          badDebtCount: this.projectionHealth.operands?.badDebtCount || 0,
          projectedBalance: this.projectionHealth.totalHealth ?? this.projectionHealth.projectedBalance ?? 0,
          totalHealth: this.projectionHealth.totalHealth ?? 0,
          isDeficit: Boolean(this.projectionHealth.isDeficit),
          earliestDeficitDate: this.projectionHealth.earliestDeficitDate,
          earliestDeficitAmount: this.projectionHealth.earliestDeficitAmount || 0,
          range: this.projectionHealth.range || 'all',
          rangeLabel: this.projectionHealth.rangeLabel || ''
        };
      }

      const totalActualCash = Number(this.dashboard?.card1_cash?.totalCash || 0);
      const supplierDebt = Number(this.dashboard?.supplierPot?.totalAmount || 0);
      const diningReceivable = Number(this.dashboard?.card4_dining?.combined?.totalDebtReceivable || 0);
      const diningPayable = Number(this.dashboard?.card4_dining?.combined?.totalSurplusFund || 0);
      const projectedBalance = totalActualCash - supplierDebt + diningReceivable - diningPayable;

      return {
        totalActualCash,
        supplierDebt,
        diningReceivable,
        diningPayable,
        totalUpcomingIncome: 0,
        totalUpcomingExpense: 0,
        projectedBalance,
        totalHealth: projectedBalance,
        isDeficit: projectedBalance < 0,
        earliestDeficitDate: null,
        earliestDeficitAmount: 0,
        range: 'all',
        rangeLabel: 'Toàn bộ thời gian'
      };
    },

    get serviceOrdersSummary() {
      const orders = this.dashboard?.allOrders || [];
      const unpaidCustomers = orders.filter(o => !o.customerPaid);
      const unpaidSuppliers = orders.filter(o => !o.supplierPaid && (Number(o.costPrice) || 0) > 0);
      
      const totalCustomerUnpaid = unpaidCustomers.reduce((sum, o) => sum + (Number(o.salePrice) || 0), 0);
      const totalSupplierUnpaid = unpaidSuppliers.reduce((sum, o) => sum + (Number(o.costPrice) || 0), 0);
      const totalProfit = orders.reduce((sum, o) => sum + ((Number(o.salePrice) || 0) - (Number(o.costPrice) || 0)), 0);

      return {
        totalCustomerUnpaid,
        countCustomerUnpaid: unpaidCustomers.length,
        totalSupplierUnpaid,
        countSupplierUnpaid: unpaidSuppliers.length,
        totalProfit,
        totalOrders: orders.length
      };
    },

    get filteredServiceOrders() {
      let list = [...(this.dashboard?.allOrders || [])];
      
      if (this.serviceOrderFilter === 'unpaid_customer') {
        list = list.filter(o => !o.customerPaid);
      } else if (this.serviceOrderFilter === 'unpaid_supplier') {
        list = list.filter(o => !o.supplierPaid && (Number(o.costPrice) || 0) > 0);
      } else if (this.serviceOrderFilter === 'completed') {
        list = list.filter(o => o.customerPaid && (o.supplierPaid || (Number(o.costPrice) || 0) === 0));
      }

      if (this.serviceOrderSearch && this.serviceOrderSearch.trim()) {
        const q = this.serviceOrderSearch.trim().toLowerCase();
        list = list.filter(o => 
          (o.customerName && o.customerName.toLowerCase().includes(q)) ||
          (o.serviceName && o.serviceName.toLowerCase().includes(q)) ||
          (o.supplierName && o.supplierName.toLowerCase().includes(q)) ||
          (o.note && o.note.toLowerCase().includes(q))
        );
      }

      return list;
    },

    getHubDisplayName(hubRole) {
      const map = {
        hub1_income: 'Hub 1: Thu Nhập & Kinh Doanh',
        hub2_dining: 'Hub 2: Quỹ Ứng Ăn Nhóm',
        hub3_family: 'Hub 3: Quỹ Gia Đình (6 người)',
        hub4_personal: 'Hub 4: Cá Nhân & Tiết Kiệm'
      };
      return map[hubRole] || hubRole;
    },

    getHubCurrentAvailableBalance(hubRole, forProjection = false) {
      if (hubRole === 'hub1_income') {
        if (forProjection) {
          // Khi chạy Timeline Dự báo Dòng tiền tương lai (Accounts Payable Aging):
          // Khởi đầu từ số dư tiền thực tế hiện tại của Hub 1.
          // Các khoản nợ NCC sẽ tự động được trừ đi khi mốc thời gian trượt qua ngày dueDate!
          return this.dashboard?.accounts?.hubs?.hub1_income?.balance || 0;
        }
        // Tiền thật sự khả dụng của Hub 1 (đã trừ nợ NCC tức thì)
        return (this.dashboard?.card1_cash?.spendableCash !== undefined)
          ? this.dashboard.card1_cash.spendableCash
          : (this.dashboard?.accounts?.hubs?.hub1_income?.balance || 0);
      }
      return this.dashboard?.accounts?.hubs?.[hubRole]?.balance || 0;
    },

    // BUG 1 & BUG 2: Đọc trực tiếp từ Backend Projection Engine (đồng bộ 100% với mốc thời gian lọc)
    getProjectedBalanceForHub(hubRole) {
      if (this.projectionHealth?.hubs?.[hubRole]) {
        return this.projectionHealth.hubs[hubRole];
      }
      const rawCash = this.dashboard?.accounts?.hubs?.[hubRole]?.balance || 0;
      const supplierDebt = (hubRole === 'hub1_income') ? Number(this.dashboard?.supplierPot?.totalAmount || 0) : 0;
      const currentBalance = (hubRole === 'hub1_income') ? (rawCash - supplierDebt) : rawCash;
      return {
        hubRole,
        hubName: this.getHubDisplayName(hubRole),
        rawCash,
        supplierDebt,
        currentBalance,
        totalIncome: 0,
        totalExpense: 0,
        projectedBalance: currentBalance,
        isDeficit: currentBalance < 0,
        earliestDeficitDate: null,
        earliestDeficitAmount: 0,
        itemCount: 0
      };
    },

    // Trả về danh sách cảnh báo thiếu hụt thanh khoản cho các Hub bị âm
    getProjectedAlerts() {
      if (this.projectionHealth?.alerts) {
        return this.projectionHealth.alerts;
      }
      const hubs = ['hub1_income', 'hub2_dining', 'hub3_family', 'hub4_personal'];
      return hubs
        .map(h => this.getProjectedBalanceForHub(h))
        .filter(s => s.isDeficit);
    },

    // Danh sách dự kiến có lọc theo khoảng thời gian và Hub
    getFilteredUpcomingTransactions() {
      let list = [...(this.upcomingList || [])];

      if (this.upcomingFilterHub && this.upcomingFilterHub !== 'all') {
        list = list.filter(it => it.hubRole === this.upcomingFilterHub);
      }

      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const todayStr = today.toISOString().slice(0, 10);

      if (this.upcomingFilterRange === '7days') {
        const d7 = new Date(today);
        d7.setDate(d7.getDate() + 7);
        const d7Str = d7.toISOString().slice(0, 10);
        list = list.filter(it => it.date >= todayStr && it.date <= d7Str);
      } else if (this.upcomingFilterRange === '30days') {
        const d30 = new Date(today);
        d30.setDate(d30.getDate() + 30);
        const d30Str = d30.toISOString().slice(0, 10);
        list = list.filter(it => it.date >= todayStr && it.date <= d30Str);
      } else if (this.upcomingFilterRange === 'custom') {
        const s = this.upcomingCustomStart;
        const e = this.upcomingCustomEnd;
        if (s && e) {
          list = list.filter(it => it.date >= s && it.date <= e);
        } else if (s) {
          list = list.filter(it => it.date >= s);
        } else if (e) {
          list = list.filter(it => it.date <= e);
        }
      }

      return list.sort((a, b) => (a.date || '').localeCompare(b.date || ''));
    }
  };
}
