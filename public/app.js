function cashFlowApp() {
  return {
    loading: true,
    error: null,
    dashboard: {
      accounts: { totalCash: 0, list: [], hubs: {} },
      supplierPot: { totalAmount: 0, suppliers: [] },
      card1_cash: { totalCash: 0, spendableCash: 0, supplierPot: 0 },
      card2_weekly: { limit: 1500000, spent: 0, percent: 0, isWarning: false, isBrake: false },
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
        settlements: []
      },
      reminders: [],
      allDebts: [],
      debtSummary: { totalReceivable: 0, totalPayable: 0 },
      allOrders: []
    },

    // View tabs
    activeTab: 'overview', // 'overview' | 'accounts' | 'suppliers' | 'timeline' | 'debts'
    diningTab: 'members',  // 'members' | 'bills' | 'settlements'
    memberFilter: 'all',   // 'all' | 'surplus' | 'debt'
    debtFilter: 'all',     // 'all' | 'receivable' | 'payable' | 'pending' | 'paid'

    // Editing State Trackers
    editingAccountId: null,
    editingSupplierId: null,
    editingReminderId: null,
    editingDebtId: null,
    editingOrderId: null,
    editingDiningId: null,
    editingSettlementId: null,
    editingMemberId: null,

    // Forms
    accountForm: {
      name: '',
      type: 'bank', // 'bank' | 'ewallet' | 'cash'
      balance: '',
      accountNumber: '',
      hubRole: 'hub1_income',
      note: ''
    },

    supplierForm: {
      supplierName: '',
      remainingAmount: '',
      phone: '',
      bankInfo: '',
      notes: ''
    },

    reminderForm: {
      date: new Date().toISOString().slice(0, 10),
      title: '',
      amount: '',
      type: 'reminder', // 'income' | 'expense' | 'reminder'
      hubRole: 'hub1_income',
      notes: ''
    },

    debtForm: {
      type: 'receivable', // 'receivable' (Họ nợ tôi) | 'payable' (Tôi nợ họ)
      personName: '',
      amount: '',
      dueDate: new Date().toISOString().slice(0, 10),
      note: ''
    },

    serviceForm: {
      customerName: '',
      serviceType: 'Reset pass thuế',
      costPrice: 420000,
      salePrice: 600000,
      customerPaid: true,
      supplierPaid: false,
      date: new Date().toISOString().slice(0, 10)
    },

    diningBillForm: {
      mealTitle: 'Cơm trưa nhóm',
      totalBill: 156000,
      date: new Date().toISOString().slice(0, 10),
      notes: '',
      splitsText: 'Tôi: 31200\nYến: 31200\nHải: 31200\nHoài: 31200\nHP: 31200'
    },

    settlementForm: {
      personName: '',
      amount: '',
      direction: 'in', // 'in' = nạp tiền, 'out' = mượn tiền
      topupKind: 'prepaid',
      note: '',
      date: new Date().toISOString().slice(0, 10)
    },

    memberForm: {
      name: '',
      openingBalance: 0
    },

    configForm: {
      initialCash: 3741742,
      weeklyLimit: 1500000
    },

    // Modals
    modals: {
      account: false,
      supplier: false,
      reminder: false,
      debt: false,
      service: false,
      diningBill: false,
      settlement: false,
      member: false,
      config: false
    },

    // Toast
    toast: { show: false, message: '' },

    init() {
      this.fetchDashboard();
    },

    notify(msg) {
      this.toast.message = msg;
      this.toast.show = true;
      setTimeout(() => { this.toast.show = false; }, 3000);
    },

    formatVND(num) {
      if (num === undefined || num === null || isNaN(num)) return '0đ';
      return Math.round(num).toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.') + 'đ';
    },

    formatDate(str) {
      if (!str) return '';
      const parts = str.split('-');
      if (parts.length === 3) return `${parts[2]}/${parts[1]}/${parts[0]}`;
      return str;
    },

    get filteredMembers() {
      const list = this.dashboard.card4_dining.members || [];
      if (this.memberFilter === 'surplus') return list.filter(m => m.currentBalance >= 0);
      if (this.memberFilter === 'debt') return list.filter(m => m.currentBalance < 0);
      return list;
    },

    get filteredDebts() {
      const list = this.dashboard.allDebts || [];
      if (this.debtFilter === 'receivable') return list.filter(d => d.type === 'receivable');
      if (this.debtFilter === 'payable') return list.filter(d => d.type === 'payable');
      if (this.debtFilter === 'pending') return list.filter(d => d.status === 'pending');
      if (this.debtFilter === 'paid') return list.filter(d => d.status === 'paid');
      return list;
    },

    async fetchDashboard() {
      try {
        const res = await fetch('/api/dashboard');
        const data = await res.json();
        if (data.success) {
          this.error = null;
          this.dashboard = data;
          this.configForm.weeklyLimit = data.config.weeklyLimit;
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

    // ==================== 1. TÀI KHOẢN NGÂN HÀNG & TIỀN MẶT (CRUD) ====================
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

    async quickUpdateBalance(acc) {
      const newBalanceStr = prompt(`Cập nhật số tiền thực tế đang có tại "${acc.name}":`, acc.balance);
      if (newBalanceStr === null) return;
      const newBalance = parseFloat(newBalanceStr.replace(/[^\d.-]/g, ''));
      if (isNaN(newBalance)) {
        alert('Vui lòng nhập số tiền hợp lệ!');
        return;
      }
      try {
        const res = await fetch(`/api/accounts/${acc._id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...acc, balance: newBalance })
        });
        const data = await res.json();
        if (data.success) {
          this.notify(`✓ Đã cập nhật số dư ${acc.name}: ${this.formatVND(newBalance)}`);
          this.fetchDashboard();
        }
      } catch (err) {
        alert('Lỗi: ' + err.message);
      }
    },

    async submitAccount() {
      try {
        if (!this.accountForm.name) {
          alert('Vui lòng nhập tên ngân hàng / ví / tiền mặt!');
          return;
        }
        const url = this.editingAccountId ? `/api/accounts/${this.editingAccountId}` : '/api/accounts';
        const method = this.editingAccountId ? 'PUT' : 'POST';

        const res = await fetch(url, {
          method,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(this.accountForm)
        });
        const data = await res.json();
        if (data.success) {
          this.notify(this.editingAccountId ? '✓ Đã cập nhật tài khoản!' : '✓ Đã thêm tài khoản mới!');
          this.modals.account = false;
          this.fetchDashboard();
        }
      } catch (err) {
        alert('Lỗi: ' + err.message);
      }
    },

    async deleteAccount(id, name) {
      if (!confirm(`Xác nhận xóa tài khoản "${name}"?`)) return;
      try {
        const res = await fetch(`/api/accounts/${id}`, { method: 'DELETE' });
        const data = await res.json();
        if (data.success) {
          this.notify(`🗑️ Đã xóa tài khoản "${name}"!`);
          this.fetchDashboard();
        }
      } catch (err) {
        alert('Lỗi: ' + err.message);
      }
    },

    // ==================== 2. NỢ TỪNG NHÀ CUNG CẤP (SUPPLIER DEBTS CRUD) ====================
    openSupplierModal(s = null) {
      if (s) {
        this.editingSupplierId = s._id;
        this.supplierForm = {
          supplierName: s.supplierName,
          remainingAmount: s.remainingAmount,
          phone: s.phone || '',
          bankInfo: s.bankInfo || '',
          notes: s.notes || ''
        };
      } else {
        this.editingSupplierId = null;
        this.supplierForm = {
          supplierName: '',
          remainingAmount: '',
          phone: '',
          bankInfo: '',
          notes: ''
        };
      }
      this.modals.supplier = true;
    },

    async submitSupplier() {
      try {
        if (!this.supplierForm.supplierName) {
          alert('Vui lòng nhập tên nhà cung cấp!');
          return;
        }
        const url = this.editingSupplierId ? `/api/supplier-debts/${this.editingSupplierId}` : '/api/supplier-debts';
        const method = this.editingSupplierId ? 'PUT' : 'POST';

        const res = await fetch(url, {
          method,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(this.supplierForm)
        });
        const data = await res.json();
        if (data.success) {
          this.notify(this.editingSupplierId ? '✓ Đã cập nhật công nợ NCC!' : '✓ Đã thêm NCC mới!');
          this.modals.supplier = false;
          this.fetchDashboard();
        }
      } catch (err) {
        alert('Lỗi: ' + err.message);
      }
    },

    async paySupplierPrompt(s) {
      const amountStr = prompt(`Nhập số tiền muốn trả cho NCC "${s.supplierName}" (Nợ hiện tại: ${this.formatVND(s.remainingAmount)}):`, s.remainingAmount);
      if (amountStr === null) return;
      const payAmount = parseFloat(amountStr.replace(/[^\d.-]/g, ''));
      if (isNaN(payAmount) || payAmount <= 0) {
        alert('Vui lòng nhập số tiền hợp lệ!');
        return;
      }
      try {
        const res = await fetch(`/api/supplier-debts/${s._id}/pay`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ payAmount })
        });
        const data = await res.json();
        if (data.success) {
          this.notify(`✓ Đã thanh toán ${this.formatVND(payAmount)} cho ${s.supplierName}!`);
          this.fetchDashboard();
        }
      } catch (err) {
        alert('Lỗi: ' + err.message);
      }
    },

    async batchPayAllSuppliers() {
      if (!confirm(`Xác nhận thanh toán TOÀN BỘ công nợ cho tất cả NCC (${this.formatVND(this.dashboard.supplierPot.totalAmount)}) để reset Hũ NCC về 0đ?`)) return;
      try {
        const res = await fetch('/api/supplier-debts/batch-pay-all', { method: 'POST' });
        const data = await res.json();
        if (data.success) {
          this.notify('✓ Đã thanh toán gom toàn bộ công nợ cho các NCC!');
          this.fetchDashboard();
        }
      } catch (err) {
        alert('Lỗi: ' + err.message);
      }
    },

    async deleteSupplier(id, name) {
      if (!confirm(`Xác nhận xóa nhà cung cấp "${name}"?`)) return;
      try {
        const res = await fetch(`/api/supplier-debts/${id}`, { method: 'DELETE' });
        const data = await res.json();
        if (data.success) {
          this.notify(`🗑️ Đã xóa nhà cung cấp "${name}"!`);
          this.fetchDashboard();
        }
      } catch (err) {
        alert('Lỗi: ' + err.message);
      }
    },

    // ==================== 3. LỊCH NHẮC DÒNG TIỀN (REMINDERS CRUD) ====================
    openReminderModal(r = null) {
      if (r) {
        this.editingReminderId = r._id;
        this.reminderForm = {
          date: r.date,
          title: r.title,
          amount: r.amount || '',
          type: r.type || 'reminder',
          hubRole: r.hubRole || 'hub1_income',
          notes: r.notes || ''
        };
      } else {
        this.editingReminderId = null;
        this.reminderForm = {
          date: new Date().toISOString().slice(0, 10),
          title: '',
          amount: '',
          type: 'reminder',
          hubRole: 'hub1_income',
          notes: ''
        };
      }
      this.modals.reminder = true;
    },

    async submitReminder() {
      try {
        if (!this.reminderForm.title) {
          alert('Vui lòng nhập nội dung nhắc việc!');
          return;
        }
        const url = this.editingReminderId ? `/api/reminders/${this.editingReminderId}` : '/api/reminders';
        const method = this.editingReminderId ? 'PUT' : 'POST';

        const res = await fetch(url, {
          method,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(this.reminderForm)
        });
        const data = await res.json();
        if (data.success) {
          this.notify(this.editingReminderId ? '✓ Đã cập nhật dòng nhắc việc!' : '✓ Đã thêm lịch nhắc mới!');
          this.modals.reminder = false;
          this.fetchDashboard();
        }
      } catch (err) {
        alert('Lỗi: ' + err.message);
      }
    },

    async toggleReminderStatus(id) {
      try {
        const res = await fetch(`/api/reminders/${id}/toggle-status`, { method: 'PATCH' });
        const data = await res.json();
        if (data.success) {
          this.notify('✓ Đã cập nhật trạng thái nhắc việc!');
          this.fetchDashboard();
        }
      } catch (err) {
        alert('Lỗi: ' + err.message);
      }
    },

    async deleteReminder(id, title) {
      if (!confirm(`Xóa lịch nhắc "${title}"?`)) return;
      try {
        const res = await fetch(`/api/reminders/${id}`, { method: 'DELETE' });
        const data = await res.json();
        if (data.success) {
          this.notify('🗑️ Đã xóa dòng nhắc việc!');
          this.fetchDashboard();
        }
      } catch (err) {
        alert('Lỗi: ' + err.message);
      }
    },

    // ==================== 4. SỔ NỢ 2 CHIỀU (DEBTS CRUD & COPY) ====================
    openDebtModal(d = null) {
      if (d) {
        this.editingDebtId = d._id;
        this.debtForm = {
          type: d.type,
          personName: d.personName,
          amount: d.amount,
          dueDate: d.dueDate,
          note: d.note || ''
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

    copyDebt(d) {
      this.editingDebtId = null;
      this.debtForm = {
        type: d.type,
        personName: d.personName + ' (Bản sao)',
        amount: d.amount,
        dueDate: new Date().toISOString().slice(0, 10),
        note: d.note || ''
      };
      this.modals.debt = true;
      this.notify('📋 Đã sao chép khoản nợ vào form tạo mới!');
    },

    async submitDebt() {
      try {
        if (!this.debtForm.personName || !this.debtForm.amount) {
          alert('Vui lòng nhập người liên quan và số tiền!');
          return;
        }
        const url = this.editingDebtId ? `/api/debts/${this.editingDebtId}` : '/api/debts';
        const method = this.editingDebtId ? 'PUT' : 'POST';

        const res = await fetch(url, {
          method,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(this.debtForm)
        });
        const data = await res.json();
        if (data.success) {
          this.notify(this.editingDebtId ? '✓ Đã cập nhật khoản nợ!' : '✓ Đã thêm khoản nợ vào sổ!');
          this.modals.debt = false;
          this.fetchDashboard();
        }
      } catch (err) {
        alert('Lỗi: ' + err.message);
      }
    },

    async toggleDebtStatus(id) {
      try {
        const res = await fetch(`/api/debts/${id}/toggle-status`, { method: 'PATCH' });
        const data = await res.json();
        if (data.success) {
          this.notify('✓ Đã cập nhật trạng thái nợ!');
          this.fetchDashboard();
        }
      } catch (err) {
        alert('Lỗi: ' + err.message);
      }
    },

    async deleteDebt(id, personName) {
      if (!confirm(`Xóa khoản nợ của "${personName}"?`)) return;
      try {
        const res = await fetch(`/api/debts/${id}`, { method: 'DELETE' });
        const data = await res.json();
        if (data.success) {
          this.notify('🗑️ Đã xóa khoản nợ!');
          this.fetchDashboard();
        }
      } catch (err) {
        alert('Lỗi: ' + err.message);
      }
    },

    // ==================== SERVICE ORDERS ====================
    editServiceOrder(order) {
      this.editingOrderId = order._id;
      this.serviceForm = {
        customerName: order.customerName,
        serviceType: order.serviceType,
        costPrice: order.costPrice,
        salePrice: order.salePrice,
        customerPaid: order.customerPaid,
        supplierPaid: order.supplierPaid,
        date: order.date
      };
      window.scrollTo({ top: 0, behavior: 'smooth' });
      this.notify(`✏️ Sửa đơn: ${order.customerName}`);
    },

    copyServiceOrder(order) {
      this.editingOrderId = null;
      this.serviceForm = {
        customerName: order.customerName + ' (Bản sao)',
        serviceType: order.serviceType,
        costPrice: order.costPrice,
        salePrice: order.salePrice,
        customerPaid: true,
        supplierPaid: false,
        date: new Date().toISOString().slice(0, 10)
      };
      window.scrollTo({ top: 0, behavior: 'smooth' });
      this.notify('📋 Đã sao chép đơn vào form!');
    },

    cancelEditServiceOrder() {
      this.editingOrderId = null;
      this.serviceForm = {
        customerName: '',
        serviceType: 'Reset pass thuế',
        costPrice: 420000,
        salePrice: 600000,
        customerPaid: true,
        supplierPaid: false,
        date: new Date().toISOString().slice(0, 10)
      };
    },

    async submitServiceOrder() {
      try {
        const url = this.editingOrderId ? `/api/service-orders/${this.editingOrderId}` : '/api/service-orders';
        const method = this.editingOrderId ? 'PUT' : 'POST';

        const res = await fetch(url, {
          method,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(this.serviceForm)
        });
        const data = await res.json();
        if (data.success) {
          this.notify(this.editingOrderId ? '✓ Đã cập nhật đơn hàng!' : '✓ Đã lưu đơn hàng dịch vụ mới!');
          this.cancelEditServiceOrder();
          this.fetchDashboard();
        }
      } catch (err) {
        alert('Lỗi: ' + err.message);
      }
    },

    async deleteServiceOrder(id, name) {
      if (!confirm(`Xóa đơn dịch vụ "${name}"?`)) return;
      try {
        const res = await fetch(`/api/service-orders/${id}`, { method: 'DELETE' });
        const data = await res.json();
        if (data.success) {
          this.notify('🗑️ Đã xóa đơn dịch vụ!');
          this.fetchDashboard();
        }
      } catch (err) {
        alert('Lỗi: ' + err.message);
      }
    },

    // ==================== BỮA ĂN NHÓM & SETTLEMENTS ====================
    openNewDiningBillModal() {
      this.editingDiningId = null;
      this.diningBillForm = {
        mealTitle: 'Cơm trưa nhóm',
        totalBill: 156000,
        date: new Date().toISOString().slice(0, 10),
        notes: '',
        splitsText: 'Tôi: 31200\nYến: 31200\nHải: 31200\nHoài: 31200\nHP: 31200'
      };
      this.modals.diningBill = true;
    },

    editDiningBill(bill) {
      this.editingDiningId = bill._id;
      const splitsText = (bill.splits || [])
        .map(sp => `${sp.personName}: ${sp.amount}`)
        .join('\n');
      this.diningBillForm = {
        mealTitle: bill.mealTitle,
        totalBill: bill.totalBill,
        date: bill.date,
        notes: bill.notes || '',
        splitsText: splitsText || `Tôi: ${bill.myShare || 0}`
      };
      this.modals.diningBill = true;
    },

    copyDiningBill(bill) {
      this.editingDiningId = null;
      const splitsText = (bill.splits || [])
        .map(sp => `${sp.personName}: ${sp.amount}`)
        .join('\n');
      this.diningBillForm = {
        mealTitle: bill.mealTitle + ' (Mới)',
        totalBill: bill.totalBill,
        date: new Date().toISOString().slice(0, 10),
        notes: bill.notes || '',
        splitsText: splitsText
      };
      this.modals.diningBill = true;
      this.notify('📋 Đã sao chép danh sách chia tiền!');
    },

    async deleteDiningBill(id, title) {
      if (!confirm(`Xóa bữa ăn "${title}"?`)) return;
      try {
        const res = await fetch(`/api/dining/bill/${id}`, { method: 'DELETE' });
        const data = await res.json();
        if (data.success) {
          this.notify('🗑️ Đã xóa bữa ăn!');
          this.fetchDashboard();
        }
      } catch (err) {
        alert('Lỗi: ' + err.message);
      }
    },

    async submitDiningBill() {
      try {
        const splits = [];
        let myShare = 0;
        const lines = this.diningBillForm.splitsText.split('\n');

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;
          const colonIdx = trimmed.indexOf(':');
          if (colonIdx === -1) continue;
          const pName = trimmed.slice(0, colonIdx).trim();
          const amount = parseFloat(trimmed.slice(colonIdx + 1).replace(/[^\d.-]/g, '')) || 0;
          const isMe = pName.toLowerCase() === 'tôi' || pName.toLowerCase() === 'toi';
          if (isMe) myShare = amount;
          splits.push({
            personKey: pName.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim(),
            personName: pName,
            amount,
            paid: isMe,
            isMe
          });
        }

        const payload = {
          date: this.diningBillForm.date,
          mealTitle: this.diningBillForm.mealTitle,
          totalBill: Number(this.diningBillForm.totalBill),
          myShare,
          splits,
          notes: this.diningBillForm.notes
        };

        const url = this.editingDiningId ? `/api/dining/bill/${this.editingDiningId}` : '/api/dining/bill';
        const method = this.editingDiningId ? 'PUT' : 'POST';

        const res = await fetch(url, {
          method,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
        const data = await res.json();
        if (data.success) {
          this.notify(this.editingDiningId ? '✓ Đã cập nhật bữa ăn!' : '✓ Đã ghi nhận bữa ăn mới!');
          this.modals.diningBill = false;
          this.fetchDashboard();
        }
      } catch (err) {
        alert('Lỗi: ' + err.message);
      }
    },

    openSettlementModal(personName = '', direction = 'in') {
      this.editingSettlementId = null;
      this.settlementForm = {
        personName,
        amount: '',
        direction,
        topupKind: direction === 'in' ? 'prepaid' : 'borrow',
        note: direction === 'in' ? 'CK nạp quỹ' : 'Mượn tiền quỹ',
        date: new Date().toISOString().slice(0, 10)
      };
      this.modals.settlement = true;
    },

    editSettlement(s) {
      this.editingSettlementId = s._id;
      this.settlementForm = {
        personName: s.personName,
        amount: s.amount,
        direction: s.direction,
        topupKind: s.topupKind || (s.direction === 'in' ? 'prepaid' : 'borrow'),
        note: s.note || '',
        date: s.date
      };
      this.modals.settlement = true;
    },

    async deleteSettlement(id, personName) {
      if (!confirm(`Xóa giao dịch này của ${personName}?`)) return;
      try {
        const res = await fetch(`/api/dining/settlement/${id}`, { method: 'DELETE' });
        const data = await res.json();
        if (data.success) {
          this.notify('🗑️ Đã xóa giao dịch nạp / mượn!');
          this.fetchDashboard();
        }
      } catch (err) {
        alert('Lỗi: ' + err.message);
      }
    },

    async submitSettlement() {
      try {
        if (!this.settlementForm.personName || !this.settlementForm.amount) {
          alert('Vui lòng nhập tên người và số tiền!');
          return;
        }

        const url = this.editingSettlementId ? `/api/dining/settlement/${this.editingSettlementId}` : '/api/dining/settlement';
        const method = this.editingSettlementId ? 'PUT' : 'POST';

        const res = await fetch(url, {
          method,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(this.settlementForm)
        });
        const data = await res.json();
        if (data.success) {
          this.notify(this.editingSettlementId ? '✓ Đã cập nhật giao dịch!' : (this.settlementForm.direction === 'in' ? '✓ Đã nạp tiền quỹ!' : '✓ Đã ghi mượn tiền quỹ!'));
          this.modals.settlement = false;
          this.fetchDashboard();
        }
      } catch (err) {
        alert('Lỗi: ' + err.message);
      }
    },

    openMemberModal(member = null) {
      if (member) {
        this.editingMemberId = member.id || member._id;
        this.memberForm.name = member.name;
        this.memberForm.openingBalance = member.openingBalance;
      } else {
        this.editingMemberId = null;
        this.memberForm.name = '';
        this.memberForm.openingBalance = 0;
      }
      this.modals.member = true;
    },

    async submitMember() {
      try {
        if (!this.memberForm.name) {
          alert('Vui lòng nhập tên thành viên!');
          return;
        }
        const res = await fetch('/api/dining/member', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(this.memberForm)
        });
        const data = await res.json();
        if (data.success) {
          this.notify('✓ Đã cập nhật số đầu kỳ cho ' + this.memberForm.name);
          this.modals.member = false;
          this.fetchDashboard();
        }
      } catch (err) {
        alert('Lỗi: ' + err.message);
      }
    },

    async deleteMember(id, name) {
      if (!confirm(`Bạn có chắc muốn xóa thành viên "${name}" khỏi sổ nhóm?`)) return;
      try {
        const res = await fetch(`/api/dining/member/${id}`, { method: 'DELETE' });
        const data = await res.json();
        if (data.success) {
          this.notify(`🗑️ Đã xóa thành viên "${name}"!`);
          this.fetchDashboard();
        }
      } catch (err) {
        alert('Lỗi: ' + err.message);
      }
    },

    // ==================== CONFIG ====================
    async submitConfig() {
      try {
        const res = await fetch('/api/config', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(this.configForm)
        });
        const data = await res.json();
        if (data.success) {
          this.notify('✓ Đã cập nhật cấu hình hệ thống!');
          this.modals.config = false;
          this.fetchDashboard();
        }
      } catch (err) {
        alert('Lỗi: ' + err.message);
      }
    }
  };
}
