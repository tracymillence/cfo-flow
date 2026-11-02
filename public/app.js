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

    // Editing IDs (null = creating new, ID = updating existing)
    editingOrderId: null,
    editingDiningId: null,
    editingSettlementId: null,
    editingMemberId: null,
    editingDebtId: null,

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

    copyText(text, label = 'thông tin') {
      if (navigator && navigator.clipboard) {
        navigator.clipboard.writeText(text);
        this.notify(`✓ Đã sao chép ${label} vào bộ nhớ tạm!`);
      }
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

    // ==================== SERVICE ORDERS (CRUD & COPY) ====================
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
      this.notify(`✏️ Đang chỉnh sửa đơn: ${order.customerName}`);
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
      this.notify('📋 Đã sao chép đơn dịch vụ vào form tạo mới!');
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
          this.notify(this.editingOrderId ? '✓ Đã cập nhật đơn hàng thành công!' : '✓ Đã lưu đơn hàng dịch vụ mới!');
          this.cancelEditServiceOrder();
          this.fetchDashboard();
        }
      } catch (err) {
        alert('Lỗi: ' + err.message);
      }
    },

    async deleteServiceOrder(id, name) {
      if (!confirm(`Bạn có chắc chắn muốn xóa đơn dịch vụ "${name || 'này'}"?`)) return;
      try {
        const res = await fetch(`/api/service-orders/${id}`, { method: 'DELETE' });
        const data = await res.json();
        if (data.success) {
          this.notify('🗑️ Đã xóa đơn dịch vụ!');
          if (this.editingOrderId === id) this.cancelEditServiceOrder();
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

    // ==================== DINING BILLS (CRUD & COPY) ====================
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
      this.notify(`✏️ Sửa bữa ăn: ${bill.mealTitle}`);
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
      this.notify('📋 Đã sao chép danh sách chia tiền! Sẵn sàng lưu bữa mới.');
    },

    async deleteDiningBill(id, title) {
      if (!confirm(`Xóa bữa ăn "${title || 'này'}" khỏi sổ?`)) return;
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
          this.notify(this.editingDiningId ? '✓ Đã cập nhật bữa ăn!' : '✓ Đã ghi nhận bữa ăn mới vào sổ!');
          this.modals.diningBill = false;
          this.editingDiningId = null;
          this.fetchDashboard();
        }
      } catch (err) {
        alert('Lỗi: ' + err.message);
      }
    },

    // ==================== SETTLEMENTS (NẠP / MƯỢN CRUD & COPY) ====================
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
      this.notify(`✏️ Sửa giao dịch của ${s.personName}`);
    },

    copySettlement(s) {
      this.editingSettlementId = null;
      this.settlementForm = {
        personName: s.personName,
        amount: s.amount,
        direction: s.direction,
        topupKind: s.topupKind,
        note: (s.note || '') + ' (Lặp lại)',
        date: new Date().toISOString().slice(0, 10)
      };
      this.modals.settlement = true;
      this.notify('📋 Đã sao chép thông tin nạp / mượn!');
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
          this.editingSettlementId = null;
          this.fetchDashboard();
        }
      } catch (err) {
        alert('Lỗi: ' + err.message);
      }
    },

    // ==================== MEMBERS (CRUD & SỐ ĐẦU KỲ) ====================
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

    // ==================== DEBTS (CRUD & COPY) ====================
    openNewDebtModal() {
      this.editingDebtId = null;
      this.debtForm = {
        type: 'receivable',
        personName: '',
        amount: '',
        dueDate: new Date().toISOString().slice(0, 10),
        note: ''
      };
      this.modals.debt = true;
    },

    editDebt(d) {
      this.editingDebtId = d._id;
      this.debtForm = {
        type: d.type,
        personName: d.personName,
        amount: d.amount,
        dueDate: d.dueDate,
        note: d.note || ''
      };
      this.notify(`✏️ Sửa khoản nợ: ${d.personName}`);
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
      this.notify('📋 Đã sao chép khoản nợ vào form tạo mới!');
    },

    cancelEditDebt() {
      this.editingDebtId = null;
      this.debtForm = {
        type: 'receivable',
        personName: '',
        amount: '',
        dueDate: new Date().toISOString().slice(0, 10),
        note: ''
      };
    },

    async submitDebt() {
      try {
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
          this.cancelEditDebt();
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
          if (this.editingDebtId === id) this.cancelEditDebt();
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

    // ==================== CONFIG & RESEED ====================
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
