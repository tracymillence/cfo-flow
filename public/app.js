function cashFlowApp() {
  return {
    loading: true,
    error: null,
    dashboard: {
      card1_cash: { totalCash: 0, spendableCash: 0, supplierPot: 0 },
      card2_weekly: { limit: 1500000, spent: 0, percent: 0, isWarning: false, isBrake: false },
      card3_supplierPot: { totalAmount: 0, pendingCount: 0, orders: [] },
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
      card5_timeline: [],
      allOrders: [],
      allDebts: []
    },

    // Tabs & Filters
    diningTab: 'members', // 'members' | 'bills' | 'settlements'
    memberFilter: 'all',  // 'all' | 'surplus' | 'debt'

    // Forms
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

    debtForm: {
      type: 'receivable',
      personName: '',
      amount: '',
      dueDate: new Date().toISOString().slice(0, 10),
      note: ''
    },

    configForm: {
      initialCash: 3341742,
      weeklyLimit: 1500000
    },

    // Modals
    modals: {
      service: false,
      diningBill: false,
      settlement: false,
      member: false,
      debt: false,
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
      if (this.memberFilter === 'surplus') {
        return list.filter(m => m.currentBalance >= 0);
      }
      if (this.memberFilter === 'debt') {
        return list.filter(m => m.currentBalance < 0);
      }
      return list;
    },

    async fetchDashboard() {
      try {
        const res = await fetch('/api/dashboard');
        const data = await res.json();
        if (data.success) {
          this.dashboard = data;
          this.configForm.initialCash = data.config.initialCash;
          this.configForm.weeklyLimit = data.config.weeklyLimit;
        }
      } catch (err) {
        console.error('Lỗi nạp dashboard:', err);
      } finally {
        this.loading = false;
      }
    },

    // --- SERVICE ORDERS ---
    async submitServiceOrder() {
      try {
        const res = await fetch('/api/service-orders', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(this.serviceForm)
        });
        const data = await res.json();
        if (data.success) {
          this.notify('✓ Đã lưu đơn hàng dịch vụ & cập nhật dòng tiền!');
          this.modals.service = false;
          this.serviceForm.customerName = '';
          this.fetchDashboard();
        }
      } catch (err) {
        alert('Lỗi: ' + err.message);
      }
    },

    async batchPaySupplier() {
      if (!confirm('Xác nhận thanh toán toàn bộ công nợ cho nhà cung cấp (Reset Hũ NCC về 0đ)?')) return;
      try {
        const res = await fetch('/api/service-orders/batch-pay-supplier', { method: 'POST' });
        const data = await res.json();
        if (data.success) {
          this.notify(`✓ Đã thanh toán gom thành công ${data.updatedCount} đơn hàng cho NCC!`);
          this.fetchDashboard();
        }
      } catch (err) {
        alert('Lỗi: ' + err.message);
      }
    },

    // --- DINING BILLS ---
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

        const res = await fetch('/api/dining/bill', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
        const data = await res.json();
        if (data.success) {
          this.notify('✓ Đã ghi nhận bữa ăn vào sổ nhóm!');
          this.modals.diningBill = false;
          this.fetchDashboard();
        }
      } catch (err) {
        alert('Lỗi: ' + err.message);
      }
    },

    // --- SETTLEMENTS (NẠP / MƯỢN) ---
    openSettlementModal(personName = '', direction = 'in') {
      this.settlementForm.personName = personName;
      this.settlementForm.direction = direction;
      this.settlementForm.amount = '';
      this.settlementForm.note = direction === 'in' ? 'CK nạp quỹ' : 'Mượn tiền quỹ';
      this.modals.settlement = true;
    },

    async submitSettlement() {
      try {
        if (!this.settlementForm.personName || !this.settlementForm.amount) {
          alert('Vui lòng nhập tên người và số tiền!');
          return;
        }
        const res = await fetch('/api/dining/settlement', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(this.settlementForm)
        });
        const data = await res.json();
        if (data.success) {
          this.notify(this.settlementForm.direction === 'in' ? '✓ Đã ghi nhận nạp tiền quỹ!' : '✓ Đã ghi nhận mượn tiền quỹ!');
          this.modals.settlement = false;
          this.fetchDashboard();
        }
      } catch (err) {
        alert('Lỗi: ' + err.message);
      }
    },

    // --- MEMBERS (SỬA ĐẦU KỲ) ---
    openMemberModal(member = null) {
      if (member) {
        this.memberForm.name = member.name;
        this.memberForm.openingBalance = member.openingBalance;
      } else {
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

    // --- DEBTS ---
    async submitDebt() {
      try {
        const res = await fetch('/api/debts', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(this.debtForm)
        });
        const data = await res.json();
        if (data.success) {
          this.notify('✓ Đã thêm khoản nợ vào sổ!');
          this.modals.debt = false;
          this.debtForm.personName = '';
          this.debtForm.amount = '';
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

    // --- CONFIG ---
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
    },

    // --- RESEED ---
    async reseedData() {
      if (!confirm('Khôi phục toàn bộ dữ liệu mẫu ban đầu (156k trưa, 182k tối, Yến 300k, 14 thành viên)?')) return;
      try {
        const res = await fetch('/api/seed', { method: 'POST' });
        const data = await res.json();
        if (data.success) {
          this.notify('✓ ' + data.message);
          this.fetchDashboard();
        }
      } catch (err) {
        alert('Lỗi: ' + err.message);
      }
    }
  };
}
