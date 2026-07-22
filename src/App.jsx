import React, { useState, useEffect } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from './db/db';
import { calculateBalances } from './utils/balances';
import { uploadGroupToCloud, downloadGroupFromCloud, generateMemorableSyncCode } from './hooks/useSync';
import ClaimUserModal from './components/ClaimUserModal';
import QRShareModal from './components/QRShareModal';
import confetti from 'canvas-confetti';
import { 
  Users, Plus, Trash2, Share2, QrCode, RefreshCw, LogIn, 
  DollarSign, ArrowRight, UserPlus, Calendar, Info, CheckCircle2, AlertTriangle, ChevronDown, Moon, Sun, Copy, History, Edit3
} from 'lucide-react';

export default function App() {
  const [activeGroupId, setActiveGroupId] = useState(null);
  const [claimedUserId, setClaimedUserId] = useState(null);
  
  // UI Modals
  const [showClaimModal, setShowClaimModal] = useState(false);
  const [showQRModal, setShowQRModal] = useState(false);
  const [showAddGroupModal, setShowAddGroupModal] = useState(false);
  const [showAddExpenseModal, setShowAddExpenseModal] = useState(false);
  const [showImportModal, setShowImportModal] = useState(false);
  const [showDeleteGroupModal, setShowDeleteGroupModal] = useState(false);
  const [showAuditModal, setShowAuditModal] = useState(false);

  // Edit Expense State
  const [editingExpenseId, setEditingExpenseId] = useState(null);

  // Form states
  const [newGroupName, setNewGroupName] = useState('');
  const [newGroupMembers, setNewGroupMembers] = useState('');
  const [deleteConfirmName, setDeleteConfirmName] = useState('');
  
  const [expenseDesc, setExpenseDesc] = useState('');
  const [expenseAmount, setExpenseAmount] = useState('');
  const [expensePayer, setExpensePayer] = useState('');
  const [expenseSplitType, setExpenseSplitType] = useState('equal');
  const [expenseCustomSplits, setExpenseCustomSplits] = useState({}); // { memberId: amount }
  
  const [importCode, setImportCode] = useState('');
  const [syncStatus, setSyncStatus] = useState({ loading: false, error: '', success: '' });

  // Query database using Dexie hooks
  const groups = useLiveQuery(() => db.groups.toArray()) || [];
  const members = useLiveQuery(() => 
    activeGroupId ? db.members.where('groupId').equals(activeGroupId).toArray() : Promise.resolve([])
  , [activeGroupId]) || [];
  const expenses = useLiveQuery(() => 
    activeGroupId ? db.expenses.where('groupId').equals(activeGroupId).toArray() : Promise.resolve([])
  , [activeGroupId]) || [];
  const auditLogs = useLiveQuery(() => 
    activeGroupId ? db.auditLogs.where('groupId').equals(activeGroupId).toArray() : Promise.resolve([])
  , [activeGroupId]) || [];

  // Automatically select first group on start if none selected
  useEffect(() => {
    if (groups.length > 0 && !activeGroupId) {
      setActiveGroupId(groups[0].id);
    }
  }, [groups, activeGroupId]);

  // Load claimed user for the active group
  useEffect(() => {
    if (activeGroupId) {
      const stored = localStorage.getItem(`yupana_claimed_${activeGroupId}`);
      setClaimedUserId(stored);
      setExpensePayer(stored || '');
    } else {
      setClaimedUserId(null);
    }
  }, [activeGroupId]);

  // Update default payer when claimed user changes
  useEffect(() => {
    if (claimedUserId && !editingExpenseId) {
      setExpensePayer(claimedUserId);
    }
  }, [claimedUserId, editingExpenseId]);

  const activeGroup = groups.find(g => g.id === activeGroupId);
  const claimedMember = members.find(m => m.id === claimedUserId);

  // Calculate balances & simplified transactions
  const activeExpenses = expenses.filter(e => !e.deleted);
  const { memberBalances, transactions, totalSpent } = calculateBalances(members, activeExpenses);

  // Handlers
  const handleClaimUser = (memberId) => {
    if (activeGroupId) {
      localStorage.setItem(`yupana_claimed_${activeGroupId}`, memberId);
      setClaimedUserId(memberId);
    }
  };

  const handleCreateGroup = async (e) => {
    e.preventDefault();
    if (!newGroupName.trim()) return;

    const memberNames = newGroupMembers
      .split(',')
      .map(name => name.trim())
      .filter(name => name.length > 0);

    if (memberNames.length === 0) {
      alert('Debes ingresar al menos un miembro.');
      return;
    }

    const groupId = 'group-' + crypto.randomUUID();
    const now = Date.now();
    const syncCode = generateMemorableSyncCode();

    await db.groups.add({
      id: groupId,
      name: newGroupName.trim(),
      createdAt: now,
      updatedAt: now,
      syncedAt: null,
      syncCode
    });

    const memberRecords = memberNames.map((name, i) => ({
      id: `member-${crypto.randomUUID()}`,
      groupId,
      name,
      joinedAt: now + i
    }));

    await db.members.bulkAdd(memberRecords);

    // Reset and select
    setNewGroupName('');
    setNewGroupMembers('');
    setShowAddGroupModal(false);
    setActiveGroupId(groupId);
    
    // Auto prompt to claim identity in the new group
    setTimeout(() => setShowClaimModal(true), 300);
  };

  const openAddExpenseModal = () => {
    setEditingExpenseId(null);
    setExpenseDesc('');
    setExpenseAmount('');
    setExpensePayer(claimedUserId || '');
    setExpenseSplitType('equal');
    setExpenseCustomSplits({});
    setShowAddExpenseModal(true);
  };

  const openEditExpenseModal = (exp) => {
    setEditingExpenseId(exp.id);
    setExpenseDesc(exp.description);
    setExpenseAmount(exp.amount.toString());
    setExpensePayer(exp.paidById);
    setExpenseSplitType(exp.splitType || 'equal');

    const splitMap = {};
    if (exp.splits && Array.isArray(exp.splits)) {
      exp.splits.forEach(s => {
        splitMap[s.memberId] = exp.splitType === 'percentage' ? s.percentage : s.amount;
      });
    }
    setExpenseCustomSplits(splitMap);
    setShowAddExpenseModal(true);
  };

  const handleSaveExpense = async (e) => {
    e.preventDefault();
    if (!expenseDesc.trim() || !expenseAmount || !expensePayer) return;

    if (!claimedUserId) {
      setShowClaimModal(true);
      return;
    }

    const amountNum = parseFloat(expenseAmount);
    if (isNaN(amountNum) || amountNum <= 0) return;

    const now = Date.now();
    const authorName = claimedMember?.name || 'Desconocido';

    let splits = [];
    if (expenseSplitType === 'custom') {
      splits = members.map(m => ({
        memberId: m.id,
        amount: parseFloat(expenseCustomSplits[m.id] || 0)
      }));

      const sum = splits.reduce((acc, curr) => acc + curr.amount, 0);
      if (Math.abs(sum - amountNum) > 0.05) {
        alert(`La suma de las partes (${sum.toFixed(2)}) debe coincidir con el monto total (${amountNum.toFixed(2)}).`);
        return;
      }
    } else if (expenseSplitType === 'percentage') {
      splits = members.map(m => ({
        memberId: m.id,
        percentage: parseFloat(expenseCustomSplits[m.id] || 0)
      }));

      const sum = splits.reduce((acc, curr) => acc + curr.percentage, 0);
      if (Math.abs(sum - 100) > 0.1) {
        alert(`La suma de los porcentajes (${sum.toFixed(2)}%) debe ser exactamente 100%.`);
        return;
      }
    }

    if (editingExpenseId) {
      // EDIT EXISTING EXPENSE
      const prevExpense = await db.expenses.get(editingExpenseId);
      const prevPayer = members.find(m => m.id === prevExpense?.paidById)?.name || 'Desconocido';
      const newPayer = members.find(m => m.id === expensePayer)?.name || 'Desconocido';

      const updatedFields = {
        description: expenseDesc.trim(),
        amount: amountNum,
        paidById: expensePayer,
        splitType: expenseSplitType,
        splits,
        updatedAt: now
      };

      await db.expenses.update(editingExpenseId, updatedFields);
      await db.groups.update(activeGroupId, { updatedAt: now });

      // Audit Log for UPDATE
      const auditLogId = 'audit-' + crypto.randomUUID();
      await db.auditLogs.add({
        id: auditLogId,
        groupId: activeGroupId,
        expenseId: editingExpenseId,
        action: 'UPDATE',
        authorId: claimedUserId,
        authorName,
        timestamp: now,
        previousState: {
          description: prevExpense.description,
          amount: prevExpense.amount,
          paidById: prevExpense.paidById,
          payerName: prevPayer,
          splitType: prevExpense.splitType
        },
        newState: {
          description: expenseDesc.trim(),
          amount: amountNum,
          paidById: expensePayer,
          payerName: newPayer,
          splitType: expenseSplitType
        }
      });
    } else {
      // CREATE NEW EXPENSE
      const expenseId = 'expense-' + crypto.randomUUID();
      await db.expenses.add({
        id: expenseId,
        groupId: activeGroupId,
        description: expenseDesc.trim(),
        amount: amountNum,
        paidById: expensePayer,
        splitType: expenseSplitType,
        splits,
        date: now,
        createdAt: now,
        updatedAt: now,
        deleted: 0
      });

      await db.groups.update(activeGroupId, { updatedAt: now });

      // Audit Log for CREATE
      const auditLogId = 'audit-' + crypto.randomUUID();
      const payerName = members.find(m => m.id === expensePayer)?.name || 'Desconocido';
      await db.auditLogs.add({
        id: auditLogId,
        groupId: activeGroupId,
        expenseId,
        action: 'CREATE',
        authorId: claimedUserId,
        authorName,
        timestamp: now,
        previousState: null,
        newState: {
          description: expenseDesc.trim(),
          amount: amountNum,
          paidById: expensePayer,
          payerName,
          splitType: expenseSplitType
        }
      });

      confetti({ particleCount: 50, spread: 60, origin: { y: 0.8 } });
    }

    // Reset Form
    setExpenseDesc('');
    setExpenseAmount('');
    setExpenseSplitType('equal');
    setExpenseCustomSplits({});
    setEditingExpenseId(null);
    setShowAddExpenseModal(false);
  };

  const handleDeleteExpense = async (expenseId, e) => {
    if (e) e.stopPropagation();
    if (!confirm('¿Estás seguro de que deseas eliminar este gasto?')) return;
    
    const now = Date.now();
    const exp = await db.expenses.get(expenseId);
    const authorName = claimedMember?.name || 'Desconocido';
    const payerName = members.find(m => m.id === exp?.paidById)?.name || 'Desconocido';

    await db.expenses.update(expenseId, { deleted: 1, updatedAt: now });
    await db.groups.update(activeGroupId, { updatedAt: now });

    // Audit Log for DELETE
    const auditLogId = 'audit-' + crypto.randomUUID();
    await db.auditLogs.add({
      id: auditLogId,
      groupId: activeGroupId,
      expenseId,
      action: 'DELETE',
      authorId: claimedUserId,
      authorName,
      timestamp: now,
      previousState: {
        description: exp.description,
        amount: exp.amount,
        payerName
      },
      newState: null
    });
  };

  const handleConfirmDeleteGroup = async (e) => {
    e.preventDefault();
    if (!activeGroup) return;

    if (deleteConfirmName.trim() !== activeGroup.name.trim()) {
      alert('El nombre ingresado no coincide con el nombre del grupo.');
      return;
    }

    await db.transaction('rw', [db.groups, db.members, db.expenses, db.auditLogs], async () => {
      await db.groups.delete(activeGroupId);
      await db.members.where('groupId').equals(activeGroupId).delete();
      await db.expenses.where('groupId').equals(activeGroupId).delete();
      await db.auditLogs.where('groupId').equals(activeGroupId).delete();
    });

    localStorage.removeItem(`yupana_claimed_${activeGroupId}`);
    setActiveGroupId(null);
    setShowDeleteGroupModal(false);
    setDeleteConfirmName('');
  };

  const handleCloudSync = async () => {
    if (!activeGroupId) return;
    setSyncStatus({ loading: true, error: '', success: '' });
    try {
      await uploadGroupToCloud(activeGroupId);
      setSyncStatus({
        loading: false,
        error: '',
        success: '¡Sincronizado! Código de invitación copiado al portapapeles.'
      });
      if (navigator.clipboard && navigator.clipboard.writeText) {
        try {
          await navigator.clipboard.writeText(activeGroupId);
        } catch (_) {}
      }
      setTimeout(() => setSyncStatus(prev => ({ ...prev, success: '' })), 4000);
    } catch (err) {
      console.error('Error en handleCloudSync:', err);
      setSyncStatus({ loading: false, error: err.message || 'Error desconocido al subir los datos.', success: '' });
    }
  };

  const handleCloudImport = async (e) => {
    e.preventDefault();
    if (!importCode.trim()) return;
    setSyncStatus({ loading: true, error: '', success: '' });
    try {
      const importedId = await downloadGroupFromCloud(importCode.trim());
      setActiveGroupId(importedId);
      setImportCode('');
      setShowImportModal(false);
      setSyncStatus({ loading: false, error: '', success: '¡Grupo importado con éxito!' });
      confetti({ particleCount: 100, spread: 80 });
      setTimeout(() => setSyncStatus(prev => ({ ...prev, success: '' })), 4000);
    } catch (err) {
      console.error('Error en handleCloudImport:', err);
      setSyncStatus({ loading: false, error: err.message || 'Error desconocido al importar.', success: '' });
    }
  };

  const handleSettleUpTransaction = async (tx) => {
    const now = Date.now();
    const expenseId = 'expense-' + crypto.randomUUID();
    const authorName = claimedMember?.name || 'Sistema';

    await db.expenses.add({
      id: expenseId,
      groupId: activeGroupId,
      description: `Liquidación: ${tx.fromName} ➔ ${tx.toName}`,
      amount: tx.amount,
      paidById: tx.from,
      splitType: 'custom',
      splits: [{ memberId: tx.to, amount: tx.amount }],
      date: now,
      createdAt: now,
      updatedAt: now,
      deleted: 0
    });

    await db.groups.update(activeGroupId, { updatedAt: now });

    // Audit log
    const auditLogId = 'audit-' + crypto.randomUUID();
    await db.auditLogs.add({
      id: auditLogId,
      groupId: activeGroupId,
      expenseId,
      action: 'CREATE',
      authorId: claimedUserId || 'system',
      authorName,
      timestamp: now,
      previousState: null,
      newState: {
        description: `Liquidación: ${tx.fromName} ➔ ${tx.toName}`,
        amount: tx.amount,
        payerName: tx.fromName,
        splitType: 'custom'
      }
    });

    confetti({
      particleCount: 150,
      spread: 80,
      origin: { y: 0.6 },
      colors: ['#22c55e', '#10b981', '#34d399']
    });
  };

  const handleSplitTypeChange = (type) => {
    setExpenseSplitType(type);
    if (type === 'custom' && expenseAmount) {
      const share = parseFloat(expenseAmount) / members.length;
      const initialSplits = {};
      members.forEach(m => {
        initialSplits[m.id] = share.toFixed(2);
      });
      setExpenseCustomSplits(initialSplits);
    } else if (type === 'percentage') {
      const share = 100 / members.length;
      const initialSplits = {};
      members.forEach(m => {
        initialSplits[m.id] = share.toFixed(1);
      });
      setExpenseCustomSplits(initialSplits);
    }
  };

  const handleForceReload = async () => {
    try {
      if ('serviceWorker' in navigator) {
        const registrations = await navigator.serviceWorker.getRegistrations();
        for (let registration of registrations) {
          await registration.unregister();
        }
      }
      if ('caches' in window) {
        const keys = await caches.keys();
        for (let key of keys) {
          await caches.delete(key);
        }
      }
    } catch (e) {
      console.error('Error clearing cache:', e);
    }
    window.location.reload(true);
  };

  return (
    <div className="max-w-6xl mx-auto px-4 py-4 md:py-8 flex flex-col min-h-screen pb-24">
      {/* Compact Top Header (Logo removed to save space as requested) */}
      <header className="glass-premium rounded-2xl p-4 mb-6 relative overflow-hidden">
        <div className="absolute top-0 right-0 w-64 h-64 bg-brand-500/5 rounded-full blur-3xl pointer-events-none"></div>

        {activeGroup ? (
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
            {/* Left: Group Selector & Actions + Identity */}
            <div className="space-y-1.5 flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                {/* Group Selector */}
                <div className="relative group inline-flex items-center">
                  <select
                    value={activeGroupId || ''}
                    onChange={e => setActiveGroupId(e.target.value)}
                    className="bg-transparent hover:bg-slate-900/60 text-2xl md:text-3xl font-extrabold text-white tracking-tight pr-8 py-0.5 rounded-xl focus:outline-none cursor-pointer transition-all border border-transparent hover:border-slate-800/80 appearance-none max-w-[260px] sm:max-w-xs md:max-w-md truncate"
                  >
                    {groups.map(g => (
                      <option key={g.id} value={g.id} className="bg-slate-950 text-base font-semibold text-slate-200">
                        {g.name}
                      </option>
                    ))}
                  </select>
                  <ChevronDown className="w-5 h-5 text-slate-400 absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none group-hover:text-white transition-colors" />
                </div>

                {/* Quick Actions: Add & Delete Group */}
                <div className="flex items-center gap-1 shrink-0">
                  <button
                    onClick={() => setShowAddGroupModal(true)}
                    className="text-slate-400 hover:text-brand-400 p-1.5 hover:bg-brand-500/10 rounded-xl transition-all"
                    title="Crear nuevo grupo"
                  >
                    <Plus className="w-5 h-5" />
                  </button>
                  <button
                    onClick={() => {
                      setDeleteConfirmName('');
                      setShowDeleteGroupModal(true);
                    }}
                    className="text-slate-500 hover:text-red-400 p-1.5 hover:bg-slate-900/60 rounded-xl transition-all"
                    title="Eliminar este grupo"
                  >
                    <Trash2 className="w-5 h-5" />
                  </button>
                </div>

                {/* User Identity Pill */}
                <div className="flex items-center ml-1">
                  {claimedUserId ? (
                    <button
                      onClick={() => setShowClaimModal(true)}
                      className="flex items-center gap-1.5 px-2.5 py-1 bg-brand-500/10 border border-brand-500/20 text-brand-400 text-xs font-semibold rounded-full hover:bg-brand-500/20 transition-all"
                      title="Cambiar perfil activo"
                    >
                      <span className="w-1.5 h-1.5 rounded-full bg-brand-400 animate-pulse"></span>
                      <span className="truncate max-w-[90px]">{claimedMember?.name || 'Cargando...'}</span>
                    </button>
                  ) : (
                    <button
                      onClick={() => setShowClaimModal(true)}
                      className="flex items-center gap-1 px-2.5 py-1 bg-yellow-500/10 border border-yellow-500/20 text-yellow-400 text-xs font-bold rounded-full hover:bg-yellow-500/20 transition-all"
                    >
                      <LogIn className="w-3 h-3" />
                      ¿Quién eres?
                    </button>
                  )}
                </div>
              </div>

              {/* Group Metadata & Sync Code */}
              <div className="flex items-center flex-wrap gap-x-3 gap-y-1 text-xs text-slate-400">
                <span className="flex items-center gap-1">
                  <Calendar className="w-3.5 h-3.5 text-slate-500 shrink-0" />
                  Creado {new Date(activeGroup.createdAt).toLocaleDateString()}
                </span>

                {activeGroup.syncCode && (
                  <div className="flex items-center gap-1 bg-slate-900/70 px-2 py-0.5 rounded-md border border-slate-800/60">
                    <span className="text-[10px] text-slate-400 font-mono">Código: {activeGroup.syncCode}</span>
                    <button
                      onClick={async () => {
                        if (navigator.clipboard && navigator.clipboard.writeText) {
                          try {
                            await navigator.clipboard.writeText(activeGroup.syncCode);
                          } catch (_) {}
                        }
                        setSyncStatus({ loading: false, error: '', success: 'Código copiado al portapapeles.' });
                        setTimeout(() => setSyncStatus(prev => ({ ...prev, success: '' })), 3000);
                      }}
                      className="text-slate-500 hover:text-brand-400 transition-colors p-0.5 rounded"
                      title="Copiar código de sincronización"
                    >
                      <Copy className="w-3 h-3" />
                    </button>
                  </div>
                )}
              </div>
            </div>

            {/* Right: Actions (QR, Nube, Importar) & Total Spent */}
            <div className="flex items-center justify-between md:justify-end gap-3 shrink-0">
              <div className="flex items-center gap-1.5 flex-wrap">
                <button
                  onClick={() => setShowQRModal(true)}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-900/80 border border-slate-800 hover:border-slate-700 text-slate-300 rounded-xl text-xs font-semibold transition-all hover:bg-slate-850"
                  title="QR P2P"
                >
                  <QrCode className="w-3.5 h-3.5 text-slate-450" />
                  <span className="hidden sm:inline">QR</span>
                </button>

                <button
                  onClick={handleCloudSync}
                  disabled={syncStatus.loading}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-900/80 border border-slate-800 hover:border-slate-700 text-slate-300 rounded-xl text-xs font-semibold transition-all hover:bg-slate-850"
                  title="Guardar en la nube"
                >
                  <Share2 className={`w-3.5 h-3.5 text-slate-450 ${syncStatus.loading ? 'animate-spin' : ''}`} />
                  <span className="hidden sm:inline">Nube</span>
                </button>

                <button
                  onClick={() => setShowImportModal(true)}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-900/80 border border-slate-800 hover:border-slate-700 text-slate-300 rounded-xl text-xs font-semibold transition-all hover:bg-slate-850"
                >
                  <RefreshCw className="w-3.5 h-3.5 text-slate-450" />
                  <span className="hidden sm:inline">Importar</span>
                </button>
              </div>

              {/* Total Spent Badge */}
              <div className="bg-slate-900/60 border border-slate-800 px-3.5 py-1.5 rounded-xl text-right">
                <p className="text-[9px] text-slate-400 font-bold uppercase tracking-wider">Total Gastado</p>
                <p className="text-lg md:text-xl font-black text-white tracking-tight">
                  ${totalSpent.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </p>
              </div>
            </div>
          </div>
        ) : (
          <div className="flex items-center justify-between">
            <p className="text-sm text-slate-400 font-semibold">No hay ningún grupo seleccionado.</p>
            <button
              onClick={() => setShowAddGroupModal(true)}
              className="flex items-center gap-2 px-3 py-1.5 bg-brand-500 hover:bg-brand-400 text-slate-950 rounded-xl text-xs font-bold transition-all"
            >
              <Plus className="w-4 h-4" />
              <span>Crear Grupo</span>
            </button>
          </div>
        )}
      </header>

      {/* Sync notices */}
      {syncStatus.success && (
        <div className="mb-4 p-3 bg-brand-500/10 border border-brand-500/20 text-brand-300 text-sm rounded-xl flex items-center gap-2 animate-fade-in">
          <CheckCircle2 className="w-4 h-4 text-brand-400 shrink-0" />
          <span>{syncStatus.success}</span>
        </div>
      )}
      {syncStatus.error && (
        <div className="mb-4 p-3 bg-red-500/10 border border-red-500/20 text-red-400 text-sm rounded-xl flex items-center gap-2 animate-fade-in">
          <AlertTriangle className="w-4 h-4 shrink-0" />
          <span>{syncStatus.error}</span>
        </div>
      )}

      {/* Main Single Column Content */}
      <main className="space-y-6">
        {activeGroup ? (
          <>
            {/* Group Overview Card */}
            <section className="glass-premium rounded-2xl p-6 relative overflow-hidden">
              <div className="absolute top-0 right-0 w-64 h-64 bg-brand-500/5 rounded-full blur-3xl pointer-events-none"></div>

              {/* Balances Grid */}
              <div>
                <h3 className="text-sm font-bold text-slate-400 uppercase tracking-wider mb-3">Balances del Grupo</h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                  {memberBalances.map(mb => {
                    const isNegative = mb.net < -0.01;
                    const isPositive = mb.net > 0.01;
                    return (
                      <div key={mb.id} className="p-4 bg-slate-900/40 border border-slate-800/60 rounded-xl flex flex-col justify-between gap-2">
                        <div className="flex items-center gap-2">
                          <div className="w-7 h-7 rounded-lg bg-slate-800 flex items-center justify-center font-bold text-xs text-slate-300">
                            {mb.name.charAt(0).toUpperCase()}
                          </div>
                          <span className="font-semibold text-slate-200 text-sm truncate">{mb.name}</span>
                        </div>

                        <div className="mt-2">
                          <span className="text-[10px] text-slate-500 font-bold block uppercase">Balance Neto</span>
                          <span className={`text-lg font-bold tracking-tight ${
                            isPositive ? 'text-brand-400' : isNegative ? 'text-orange-400' : 'text-slate-400'
                          }`}>
                            {isPositive ? '+' : ''}${mb.net.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                          </span>
                        </div>
                        
                        <div className="text-[10px] text-slate-500 flex justify-between">
                          <span>Pagó: ${mb.paid.toLocaleString('es-AR', { maximumFractionDigits: 0 })}</span>
                          <span>Consumo: ${mb.spent.toLocaleString('es-AR', { maximumFractionDigits: 0 })}</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </section>

            {/* Split Grid for simplified debts & expense list */}
            <div className="grid grid-cols-1 md:grid-cols-12 gap-6">
              {/* Simplified Debts Box */}
              <section className="md:col-span-5 glass-premium rounded-2xl p-5 flex flex-col">
                <div className="flex items-center justify-between mb-4 border-b border-slate-800 pb-2.5">
                  <h3 className="font-bold text-slate-200 text-sm tracking-wider uppercase">Deudas Simplificadas</h3>
                  <span className="text-xs bg-slate-800 text-slate-400 px-2 py-0.5 rounded-full font-medium">
                    {transactions.length} transferencias
                  </span>
                </div>

                {transactions.length === 0 ? (
                  <div className="flex-1 flex flex-col items-center justify-center py-10 text-center">
                    <CheckCircle2 className="w-10 h-10 text-brand-400 mb-2 opacity-60" />
                    <p className="text-slate-300 font-bold text-sm">¡Todos están al día!</p>
                    <p className="text-slate-500 text-xs mt-1">No hay saldos pendientes de pago.</p>
                  </div>
                ) : (
                  <div className="space-y-2.5 flex-1 overflow-y-auto">
                    {transactions.map((tx, idx) => (
                      <div 
                        key={idx} 
                        className="p-3.5 bg-slate-900/60 border border-slate-800/80 rounded-xl flex items-center justify-between gap-2"
                      >
                        <div className="flex items-center gap-2 min-w-0">
                          <span className="font-bold text-slate-200 text-sm truncate max-w-[80px]">{tx.fromName}</span>
                          <ArrowRight className="w-3.5 h-3.5 text-slate-500 shrink-0" />
                          <span className="font-bold text-slate-200 text-sm truncate max-w-[80px]">{tx.toName}</span>
                        </div>
                        
                        <div className="flex items-center gap-3">
                          <span className="font-extrabold text-brand-400 text-sm">
                            ${tx.amount.toLocaleString('es-AR', { minimumFractionDigits: 2 })}
                          </span>
                          <button
                            onClick={() => handleSettleUpTransaction(tx)}
                            className="px-2.5 py-1.5 bg-brand-500 text-slate-950 hover:bg-brand-400 font-bold text-xs rounded-lg transition-all"
                          >
                            Liquidar
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </section>

              {/* Expenses History List (Clickable to Edit) */}
              <section className="md:col-span-7 glass-premium rounded-2xl p-5">
                <div className="flex items-center justify-between mb-4 border-b border-slate-800 pb-2.5">
                  <h3 className="font-bold text-slate-200 text-sm tracking-wider uppercase">
                    Historial de Gastos
                  </h3>
                  <span className="text-[10px] text-slate-500 font-semibold">Haz clic en un gasto para editar</span>
                </div>

                {activeExpenses.length === 0 ? (
                  <div className="text-center py-12 text-slate-500 text-xs">
                    No hay gastos registrados en este grupo todavía.
                  </div>
                ) : (
                  <div className="space-y-3 max-h-[500px] overflow-y-auto pr-1">
                    {activeExpenses.slice().reverse().map(exp => {
                      const payerName = members.find(m => m.id === exp.paidById)?.name || 'Miembro eliminado';
                      const isSettlement = exp.description.startsWith('Liquidación:');
                      return (
                        <div 
                          key={exp.id} 
                          onClick={() => openEditExpenseModal(exp)}
                          className={`p-3.5 rounded-xl border flex items-center justify-between gap-4 transition-all cursor-pointer group ${
                            isSettlement 
                              ? 'bg-emerald-950/20 border-emerald-900/40 hover:border-emerald-700'
                              : 'bg-slate-900/30 border-slate-800 hover:border-brand-500/40 hover:bg-slate-900/60'
                          }`}
                        >
                          <div className="min-w-0">
                            <div className="flex items-center gap-1.5">
                              <h4 className="font-bold text-slate-200 text-sm truncate group-hover:text-brand-300 transition-colors">{exp.description}</h4>
                              <Edit3 className="w-3.5 h-3.5 text-slate-600 opacity-0 group-hover:opacity-100 transition-opacity" />
                            </div>
                            <p className="text-xs text-slate-500 mt-1">
                              Pagado por <span className="text-slate-400 font-medium">{payerName}</span> • {new Date(exp.date).toLocaleDateString()}
                            </p>
                            {exp.splitType === 'custom' && !isSettlement && (
                              <span className="inline-block mt-1 text-[9px] bg-slate-800 text-slate-400 px-1.5 py-0.5 rounded font-mono">
                                División Personalizada
                              </span>
                            )}
                          </div>

                          <div className="flex items-center gap-3 shrink-0">
                            <span className="font-bold text-slate-100 text-base">
                              ${exp.amount.toLocaleString('es-AR', { minimumFractionDigits: 2 })}
                            </span>
                            <button
                              onClick={(e) => handleDeleteExpense(exp.id, e)}
                              className="text-slate-500 hover:text-red-400 p-1.5 hover:bg-slate-800/80 rounded-lg transition-all"
                              title="Eliminar gasto"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </section>
            </div>
          </>
        ) : (
          <div className="glass-premium rounded-2xl p-10 text-center flex flex-col items-center justify-center">
            <Users className="w-16 h-16 text-slate-600 mb-4 opacity-50" />
            <h2 className="text-2xl font-bold text-slate-300">¡Bienvenido!</h2>
            <p className="text-slate-400 text-sm max-w-md mt-2">
              Para empezar a registrar gastos y dividir cuentas offline, crea un grupo en el menú superior o importa uno ya existente.
            </p>
            <button
              onClick={() => setShowAddGroupModal(true)}
              className="mt-6 px-6 py-3 bg-brand-600 hover:bg-brand-500 text-slate-950 font-bold rounded-xl shadow-lg transition-all flex items-center gap-2"
            >
              <Plus className="w-5 h-5" />
              Crear mi Primer Grupo
            </button>
          </div>
        )}
      </main>

      {/* Floating Action Bar at the Bottom */}
      {activeGroupId && (
        <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-40 flex items-center gap-3 bg-slate-950/90 border border-slate-800 backdrop-blur-xl px-4 py-2.5 rounded-full shadow-2xl">
          {/* ORANGE AUDIT BUTTON */}
          <button
            onClick={() => setShowAuditModal(true)}
            className="flex items-center gap-2 px-4 py-2 bg-orange-500 hover:bg-orange-400 text-slate-950 font-black text-xs uppercase tracking-wider rounded-full transition-all hover:scale-105 active:scale-95 shadow-lg shadow-orange-500/20 border border-orange-400/40 cursor-pointer"
            title="Ver trazabilidad completa de cambios y eliminaciones"
          >
            <History className="w-4 h-4 stroke-[2.5px]" />
            <span>Auditar</span>
          </button>

          <div className="w-px h-6 bg-slate-800"></div>

          {/* ADD EXPENSE BUTTON */}
          <button
            onClick={openAddExpenseModal}
            className="flex items-center gap-2 px-4 py-2 bg-brand-500 hover:bg-brand-400 text-slate-950 font-black text-xs uppercase tracking-wider rounded-full transition-all hover:scale-105 active:scale-95 shadow-lg shadow-brand-500/20 border border-brand-400/40 cursor-pointer"
            title="Registrar nuevo gasto"
          >
            <Plus className="w-4 h-4 stroke-[3px]" />
            <span>Agregar Gasto</span>
          </button>
        </div>
      )}

      {/* FOOTER */}
      <footer className="mt-auto pt-10 pb-4 text-center text-[10px] text-slate-600 flex flex-col items-center gap-2">
        <p>© {new Date().getFullYear()} CuentasClaras. 100% Offline-First.</p>
        <button
          onClick={handleForceReload}
          className="inline-flex items-center gap-1.5 px-3 py-1 bg-slate-900/80 hover:bg-slate-850 text-slate-400 hover:text-brand-400 border border-slate-800 hover:border-brand-500/30 rounded-lg transition-all font-semibold cursor-pointer"
          title="Borrar memoria caché de la app y recargar la versión más reciente"
        >
          <RefreshCw className="w-3 h-3" />
          <span>Recargar (Limpiar caché)</span>
        </button>
      </footer>

      {/* MODAL: AUDIT LOGS */}
      {showAuditModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-md animate-fade-in">
          <div className="w-full max-w-xl bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-2xl relative max-h-[85vh] flex flex-col">
            <div className="flex items-center justify-between mb-4 border-b border-slate-800 pb-3">
              <div className="flex items-center gap-2 text-orange-400">
                <History className="w-5 h-5" />
                <h3 className="text-lg font-extrabold text-slate-100">Historial de Auditoría</h3>
              </div>
              <span className="text-xs bg-orange-500/10 border border-orange-500/20 text-orange-400 px-2.5 py-0.5 rounded-full font-bold">
                {auditLogs.length} Registros
              </span>
            </div>

            {auditLogs.length === 0 ? (
              <div className="flex-1 flex flex-col items-center justify-center py-12 text-center text-slate-500 text-xs">
                <Info className="w-8 h-8 mb-2 opacity-50 text-orange-400" />
                No hay modificaciones ni eventos registrados aún en este grupo.
              </div>
            ) : (
              <div className="flex-1 overflow-y-auto space-y-3 pr-1">
                {auditLogs.slice().reverse().map(log => {
                  const dateStr = new Date(log.timestamp).toLocaleString('es-AR', {
                    day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit'
                  });

                  return (
                    <div key={log.id} className="p-3.5 bg-slate-955 border border-slate-850 rounded-xl space-y-2">
                      <div className="flex items-center justify-between text-xs">
                        <div className="flex items-center gap-2">
                          <span className={`px-2 py-0.5 rounded font-black text-[10px] ${
                            log.action === 'CREATE' ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30' :
                            log.action === 'UPDATE' ? 'bg-orange-500/20 text-orange-400 border border-orange-500/30' :
                            'bg-red-500/20 text-red-400 border border-red-500/30'
                          }`}>
                            {log.action === 'CREATE' ? 'CREADO' : log.action === 'UPDATE' ? 'MODIFICADO' : 'ELIMINADO'}
                          </span>
                          <span className="font-semibold text-slate-300">Por: <strong className="text-white">{log.authorName}</strong></span>
                        </div>
                        <span className="text-[10px] text-slate-500">{dateStr}</span>
                      </div>

                      {/* Log details */}
                      {log.action === 'CREATE' && log.newState && (
                        <div className="text-xs text-slate-400 bg-slate-900/60 p-2.5 rounded-lg border border-slate-800">
                          Se registró <strong>"{log.newState.description}"</strong> por <strong>${log.newState.amount}</strong> (Pagado por {log.newState.payerName}).
                        </div>
                      )}

                      {log.action === 'UPDATE' && log.previousState && log.newState && (
                        <div className="text-xs space-y-1.5 bg-slate-900/60 p-2.5 rounded-lg border border-slate-800">
                          {log.previousState.description !== log.newState.description && (
                            <p className="text-slate-300">
                              Descripción: <span className="line-through text-slate-500">{log.previousState.description}</span> ➔ <strong className="text-orange-300">{log.newState.description}</strong>
                            </p>
                          )}
                          {log.previousState.amount !== log.newState.amount && (
                            <p className="text-slate-300">
                              Monto: <span className="line-through text-slate-500">${log.previousState.amount}</span> ➔ <strong className="text-orange-300">${log.newState.amount}</strong>
                            </p>
                          )}
                          {log.previousState.paidById !== log.newState.paidById && (
                            <p className="text-slate-300">
                              Pagador: <span className="line-through text-slate-500">{log.previousState.payerName}</span> ➔ <strong className="text-orange-300">{log.newState.payerName}</strong>
                            </p>
                          )}
                          {log.previousState.splitType !== log.newState.splitType && (
                            <p className="text-slate-300">
                              División: <span className="line-through text-slate-500">{log.previousState.splitType}</span> ➔ <strong className="text-orange-300">{log.newState.splitType}</strong>
                            </p>
                          )}
                        </div>
                      )}

                      {log.action === 'DELETE' && log.previousState && (
                        <div className="text-xs text-red-300/80 bg-red-950/20 p-2.5 rounded-lg border border-red-900/40">
                          Se eliminó el gasto <strong>"{log.previousState.description}"</strong> por <strong>${log.previousState.amount}</strong>.
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}

            <button
              onClick={() => setShowAuditModal(false)}
              className="mt-4 w-full py-2.5 bg-slate-800 hover:bg-slate-700 text-slate-200 font-bold rounded-xl text-sm transition-all border border-slate-700"
            >
              Cerrar
            </button>
          </div>
        </div>
      )}

      {/* MODAL: CLAIM USER */}
      {showClaimModal && (
        <ClaimUserModal
          members={members}
          groupId={activeGroupId}
          claimedUserId={claimedUserId}
          onClaimUser={handleClaimUser}
          onClose={() => setShowClaimModal(false)}
        />
      )}

      {/* MODAL: QR SHARE / CAMERA READER */}
      {showQRModal && (
        <QRShareModal
          groupId={activeGroupId}
          onImportSuccess={(newId) => {
            setActiveGroupId(newId);
            setShowQRModal(false);
            setSyncStatus({ loading: false, error: '', success: '¡Grupo sincronizado mediante QR con éxito!' });
            confetti({ particleCount: 100, spread: 80 });
          }}
          onClose={() => setShowQRModal(false)}
        />
      )}

      {/* MODAL: DELETE GROUP CONFIRMATION BY NAME */}
      {showDeleteGroupModal && activeGroup && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-md animate-fade-in">
          <form onSubmit={handleConfirmDeleteGroup} className="w-full max-w-md bg-slate-900 border border-red-900/50 rounded-2xl p-6 shadow-2xl relative">
            <h3 className="text-xl font-bold text-red-400 mb-2 flex items-center gap-2">
              <AlertTriangle className="w-5 h-5 text-red-400" />
              Eliminar Grupo
            </h3>
            <p className="text-slate-300 text-xs mb-4">
              Esta acción eliminará el grupo <strong className="text-white">"{activeGroup.name}"</strong> y todos sus gastos de forma permanente.
            </p>

            <div className="space-y-3">
              <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider">
                Para confirmar, escribe <span className="text-white select-all font-bold">"{activeGroup.name}"</span> abajo:
              </label>
              <input
                type="text"
                required
                placeholder={activeGroup.name}
                value={deleteConfirmName}
                onChange={e => setDeleteConfirmName(e.target.value)}
                className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-2.5 text-sm text-slate-100 focus:outline-none focus:border-red-500 transition-all font-semibold"
              />
            </div>

            <div className="flex items-center gap-2 mt-6">
              <button
                type="button"
                onClick={() => {
                  setShowDeleteGroupModal(false);
                  setDeleteConfirmName('');
                }}
                className="flex-1 py-2.5 bg-slate-800 hover:bg-slate-700 text-slate-300 font-semibold rounded-xl transition-all border border-slate-700 text-sm"
              >
                Cancelar
              </button>
              <button
                type="submit"
                disabled={deleteConfirmName.trim() !== activeGroup.name.trim()}
                className={`flex-1 py-2.5 font-bold rounded-xl transition-all text-sm ${
                  deleteConfirmName.trim() === activeGroup.name.trim()
                    ? 'bg-red-600 hover:bg-red-500 text-white cursor-pointer'
                    : 'bg-slate-800 text-slate-500 cursor-not-allowed opacity-50'
                }`}
              >
                Eliminar Grupo
              </button>
            </div>
          </form>
        </div>
      )}

      {/* MODAL: ADD GROUP */}
      {showAddGroupModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-md animate-fade-in">
          <form onSubmit={handleCreateGroup} className="w-full max-w-md bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-2xl relative">
            <h3 className="text-xl font-bold text-slate-100 mb-4 flex items-center gap-2">
              <UserPlus className="w-5 h-5 text-brand-400" />
              Crear Nuevo Grupo
            </h3>
            
            <div className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1.5">
                  Nombre del Grupo
                </label>
                <input
                  type="text"
                  required
                  placeholder="ej. Fin de semana en la playa 🏖️"
                  value={newGroupName}
                  onChange={e => setNewGroupName(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-2.5 text-sm text-slate-100 focus:outline-none focus:border-brand-500 transition-all"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1.5">
                  Miembros (separados por coma)
                </label>
                <textarea
                  required
                  rows="3"
                  placeholder="ej. Franco, Sofía, Mateo, Clara"
                  value={newGroupMembers}
                  onChange={e => setNewGroupMembers(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-2.5 text-sm text-slate-100 focus:outline-none focus:border-brand-500 transition-all"
                />
                <span className="text-[10px] text-slate-500 mt-1 block">
                  Escribe los nombres de todos los que participarán del grupo de gastos.
                </span>
              </div>
            </div>

            <div className="flex items-center gap-2 mt-6">
              <button
                type="button"
                onClick={() => setShowAddGroupModal(false)}
                className="flex-1 py-2.5 bg-slate-800 hover:bg-slate-700 text-slate-300 font-semibold rounded-xl transition-all border border-slate-700 text-sm"
              >
                Cancelar
              </button>
              <button
                type="submit"
                className="flex-1 py-2.5 bg-brand-600 hover:bg-brand-500 text-slate-950 font-bold rounded-xl transition-all text-sm"
              >
                Crear Grupo
              </button>
            </div>
          </form>
        </div>
      )}

      {/* MODAL: ADD / EDIT EXPENSE */}
      {showAddExpenseModal && (
        <div className="fixed inset-0 z-50 flex items-start sm:items-center justify-center p-2 sm:p-4 pt-2 sm:pt-6 bg-slate-950/80 backdrop-blur-md animate-fade-in overflow-y-auto">
          <form onSubmit={handleSaveExpense} className="w-full max-w-md bg-slate-900 border border-slate-800 rounded-2xl p-4 sm:p-6 shadow-2xl max-h-[88vh] sm:max-h-[90vh] overflow-y-auto mt-1 sm:my-auto">
            <h3 className="text-xl font-bold text-slate-100 mb-4 flex items-center gap-2">
              <DollarSign className="w-5 h-5 text-brand-400" />
              {editingExpenseId ? 'Editar Gasto' : 'Registrar Gasto'}
            </h3>

            <div className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1.5">
                  Descripción
                </label>
                <input
                  type="text"
                  required
                  placeholder="ej. Supermercado o Cena"
                  value={expenseDesc}
                  onChange={e => setExpenseDesc(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-2.5 text-sm text-slate-100 focus:outline-none focus:border-brand-500/50 transition-all"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1.5">
                  Monto ($)
                </label>
                <input
                  type="number"
                  step="0.01"
                  required
                  min="0.01"
                  placeholder="0.00"
                  value={expenseAmount}
                  onChange={e => {
                    setExpenseAmount(e.target.value);
                    if (expenseSplitType === 'custom') {
                      const share = parseFloat(e.target.value || 0) / members.length;
                      const initialSplits = {};
                      members.forEach(m => {
                        initialSplits[m.id] = share.toFixed(2);
                      });
                      setExpenseCustomSplits(initialSplits);
                    }
                  }}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-2.5 text-sm text-slate-100 focus:outline-none focus:border-brand-500/50 transition-all"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1.5">
                  ¿Quién pagó?
                </label>
                {members.length <= 6 ? (
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                    {members.map(m => {
                      const isSelected = expensePayer === m.id;
                      return (
                        <button
                          key={m.id}
                          type="button"
                          onClick={() => setExpensePayer(m.id)}
                          className={`flex items-center gap-2 p-2 rounded-xl border text-left text-xs font-semibold transition-all cursor-pointer ${
                            isSelected
                              ? 'bg-brand-500/15 border-brand-500 text-white shadow-sm shadow-brand-500/20'
                              : 'bg-slate-955 border-slate-800 text-slate-300 hover:bg-slate-850 hover:border-slate-700'
                          }`}
                        >
                          <div className={`w-6 h-6 rounded-lg flex items-center justify-center font-bold text-[10px] shrink-0 ${
                            isSelected ? 'bg-brand-400 text-slate-950' : 'bg-slate-800 text-slate-300'
                          }`}>
                            {m.name.charAt(0).toUpperCase()}
                          </div>
                          <span className="truncate">{m.name}</span>
                        </button>
                      );
                    })}
                  </div>
                ) : (
                  <select
                    value={expensePayer}
                    onChange={e => setExpensePayer(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-2.5 text-sm text-slate-100 focus:outline-none focus:border-brand-500/50 transition-all cursor-pointer"
                  >
                    <option value="" disabled>Selecciona al pagador</option>
                    {members.map(m => (
                      <option key={m.id} value={m.id}>{m.name}</option>
                    ))}
                  </select>
                )}
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1.5">
                  Tipo de División
                </label>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => handleSplitTypeChange('equal')}
                    className={`flex-1 py-2 text-[11px] font-bold rounded-lg border transition-all ${
                      expenseSplitType === 'equal'
                        ? 'bg-brand-500/10 border-brand-500/50 text-brand-400'
                        : 'bg-transparent border-slate-800 text-slate-400 hover:bg-slate-955'
                    }`}
                  >
                    Equitativa
                  </button>
                  <button
                    type="button"
                    onClick={() => handleSplitTypeChange('custom')}
                    className={`flex-1 py-2 text-[11px] font-bold rounded-lg border transition-all ${
                      expenseSplitType === 'custom'
                        ? 'bg-brand-500/10 border-brand-500/50 text-brand-400'
                        : 'bg-transparent border-slate-800 text-slate-400 hover:bg-slate-955'
                    }`}
                  >
                    Personalizada
                  </button>
                  <button
                    type="button"
                    onClick={() => handleSplitTypeChange('percentage')}
                    className={`flex-1 py-2 text-[11px] font-bold rounded-lg border transition-all ${
                      expenseSplitType === 'percentage'
                        ? 'bg-brand-500/10 border-brand-500/50 text-brand-400'
                        : 'bg-transparent border-slate-800 text-slate-400 hover:bg-slate-955'
                    }`}
                  >
                    Porcentaje
                  </button>
                </div>
              </div>

              {expenseSplitType === 'custom' && (
                <div className="space-y-2 border-t border-slate-850 pt-3">
                  <span className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-1">
                    Montos por Miembro
                  </span>
                  {members.map(m => (
                    <div key={m.id} className="flex items-center justify-between gap-3 bg-slate-950/60 p-2 rounded-lg border border-slate-850">
                      <span className="text-xs font-semibold text-slate-300">{m.name}</span>
                      <input
                        type="number"
                        step="0.01"
                        placeholder="0.00"
                        value={expenseCustomSplits[m.id] || ''}
                        onChange={e => {
                          setExpenseCustomSplits(prev => ({
                            ...prev,
                            [m.id]: e.target.value
                          }));
                        }}
                        className="w-24 bg-slate-900 border border-slate-800 rounded-lg px-2.5 py-1 text-xs text-slate-200 text-right focus:outline-none focus:border-brand-500/50"
                      />
                    </div>
                  ))}
                  <div className="text-[10px] text-right text-slate-500 font-bold">
                    Suma total cargada:{' '}
                    {Object.values(expenseCustomSplits)
                      .reduce((acc, curr) => acc + (parseFloat(curr) || 0), 0)
                      .toFixed(2)}{' '}
                    de {expenseAmount ? parseFloat(expenseAmount).toFixed(2) : '0.00'}
                  </div>
                </div>
              )}

              {expenseSplitType === 'percentage' && (
                <div className="space-y-3 border-t border-slate-850 pt-3">
                  <span className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-1">
                    Porcentajes por Miembro
                  </span>
                  {members.map(m => {
                    const percentage = parseFloat(expenseCustomSplits[m.id] || 0);
                    const calculatedVal = expenseAmount ? (percentage / 100) * parseFloat(expenseAmount) : 0;
                    return (
                      <div key={m.id} className="bg-slate-950/60 p-3 rounded-xl border border-slate-850 space-y-2">
                        <div className="flex items-center justify-between text-xs">
                          <span className="font-semibold text-slate-200">{m.name}</span>
                          <div className="flex items-center gap-1.5">
                            <span className="text-slate-400 text-[11px] font-mono">(${calculatedVal.toFixed(2)})</span>
                            <input
                              type="number"
                              step="1"
                              min="0"
                              max="100"
                              placeholder="0"
                              value={expenseCustomSplits[m.id] ?? ''}
                              onChange={e => {
                                const val = e.target.value;
                                setExpenseCustomSplits(prev => ({
                                  ...prev,
                                  [m.id]: val
                                }));
                              }}
                              className="w-14 bg-slate-900 border border-slate-800 rounded-lg px-2 py-0.5 text-xs text-slate-200 text-right focus:outline-none focus:border-brand-500/50"
                            />
                            <span className="text-xs text-slate-400 font-bold">%</span>
                          </div>
                        </div>
                        <input
                          type="range"
                          min="0"
                          max="100"
                          step="1"
                          value={percentage || 0}
                          onChange={e => {
                            const val = e.target.value;
                            setExpenseCustomSplits(prev => ({
                              ...prev,
                              [m.id]: val
                            }));
                          }}
                          className="w-full accent-brand-400 h-1.5 bg-slate-800 rounded-lg appearance-none cursor-pointer"
                        />
                      </div>
                    );
                  })}
                  <div className="text-[10px] text-right text-slate-500 font-bold">
                    Suma de porcentajes:{' '}
                    <span className={Math.abs(Object.values(expenseCustomSplits).reduce((acc, curr) => acc + (parseFloat(curr) || 0), 0) - 100) < 0.5 ? 'text-brand-400' : 'text-orange-400'}>
                      {Object.values(expenseCustomSplits).reduce((acc, curr) => acc + (parseFloat(curr) || 0), 0).toFixed(0)}%
                    </span> / 100%
                  </div>
                </div>
              )}
            </div>

            <div className="flex items-center gap-2 mt-6">
              <button
                type="button"
                onClick={() => {
                  setShowAddExpenseModal(false);
                  setEditingExpenseId(null);
                }}
                className="flex-1 py-2.5 bg-slate-800 hover:bg-slate-700 text-slate-300 font-semibold rounded-xl transition-all border border-slate-700 text-sm"
              >
                Cancelar
              </button>
              <button
                type="submit"
                className="flex-1 py-2.5 bg-brand-600 hover:bg-brand-500 text-slate-950 font-bold rounded-xl transition-all text-sm"
              >
                {editingExpenseId ? 'Guardar Cambios' : 'Registrar'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* MODAL: IMPORT CODE / LINK */}
      {showImportModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-md animate-fade-in">
          <form onSubmit={handleCloudImport} className="w-full max-w-md bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-2xl">
            <h3 className="text-xl font-bold text-slate-100 mb-4 flex items-center gap-2">
              <RefreshCw className="w-5 h-5 text-brand-400" />
              Importar desde la nube
            </h3>
            
            <div className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1.5">
                  Código de Invitación / Sincronización
                </label>
                <input
                  type="text"
                  required
                  placeholder="Pega el código de grupo aquí..."
                  value={importCode}
                  onChange={e => setImportCode(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-2.5 text-sm text-slate-100 focus:outline-none focus:border-brand-500 transition-all"
                />
                <span className="text-[10px] text-slate-500 mt-2 block">
                  Los datos deben haber sido subidos a la nube en los últimos 14 días.
                </span>
              </div>
            </div>

            <div className="flex items-center gap-2 mt-6">
              <button
                type="button"
                onClick={() => {
                  setShowImportModal(false);
                  setImportCode('');
                }}
                className="flex-1 py-2.5 bg-slate-800 hover:bg-slate-700 text-slate-300 font-semibold rounded-xl transition-all border border-slate-700 text-sm"
              >
                Cancelar
              </button>
              <button
                type="submit"
                disabled={syncStatus.loading}
                className="flex-1 py-2.5 bg-brand-600 hover:bg-brand-500 text-slate-950 font-bold rounded-xl transition-all text-sm flex items-center justify-center gap-2"
              >
                {syncStatus.loading && <RefreshCw className="w-4 h-4 animate-spin" />}
                Importar Grupo
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
