/**
 * Calculate net balances and generate simplified transactions to clear all debts.
 * 
 * @param {Array} members - List of group members
 * @param {Array} expenses - List of group expenses (non-deleted)
 * @returns {Object} { memberBalances, transactions, totalSpent }
 */
export function calculateBalances(members, expenses) {
  const memberBalances = {};
  let totalSpent = 0;

  // Initialize balances for each member
  members.forEach(m => {
    memberBalances[m.id] = {
      id: m.id,
      name: m.name,
      paid: 0,
      spent: 0,
      net: 0
    };
  });

  // Calculate paid and spent amounts for each member
  expenses.forEach(exp => {
    if (exp.deleted) return;

    const amount = Number(exp.amount) || 0;
    totalSpent += amount;

    // Credit the payer
    if (memberBalances[exp.paidById]) {
      memberBalances[exp.paidById].paid += amount;
    }

    // Debit the participants
    if (exp.splitType === 'equal') {
      // Split equally among all members
      const splitAmount = amount / members.length;
      members.forEach(m => {
        if (memberBalances[m.id]) {
          memberBalances[m.id].spent += splitAmount;
        }
      });
    } else if (exp.splitType === 'custom') {
      // Split as specified in custom splits array
      // e.g. splits = [{ memberId: 'm1', amount: 100 }, ...]
      const splits = exp.splits || [];
      splits.forEach(s => {
        if (memberBalances[s.memberId]) {
          memberBalances[s.memberId].spent += Number(s.amount) || 0;
        }
      });
      // For any member not included in splits, spent remains unchanged
    } else if (exp.splitType === 'percentage') {
      // Split as percentage of total amount
      // e.g. splits = [{ memberId: 'm1', percentage: 25 }, ...]
      const splits = exp.splits || [];
      splits.forEach(s => {
        if (memberBalances[s.memberId]) {
          const pct = Number(s.percentage) || 0;
          memberBalances[s.memberId].spent += (pct / 100) * amount;
        }
      });
    }
  });

  // Compute net balance (paid - spent)
  Object.keys(memberBalances).forEach(id => {
    const mb = memberBalances[id];
    mb.net = mb.paid - mb.spent;
  });

  // Simplify debts using a greedy algorithm
  const balanceArray = Object.values(memberBalances).map(mb => ({
    id: mb.id,
    name: mb.name,
    net: mb.net
  }));

  const debtors = balanceArray.filter(x => x.net < -0.01).sort((a, b) => a.net - b.net); // most negative first
  const creditors = balanceArray.filter(x => x.net > 0.01).sort((a, b) => b.net - a.net); // most positive first

  const transactions = [];

  let dIdx = 0;
  let cIdx = 0;

  // Clone balances to modify them in-place during matching
  const debtorsCopy = debtors.map(d => ({ ...d }));
  const creditorsCopy = creditors.map(c => ({ ...c }));

  while (dIdx < debtorsCopy.length && cIdx < creditorsCopy.length) {
    const debtor = debtorsCopy[dIdx];
    const creditor = creditorsCopy[cIdx];

    const oweAmount = Math.abs(debtor.net);
    const creditAmount = creditor.net;

    const settledAmount = Math.min(oweAmount, creditAmount);

    transactions.push({
      from: debtor.id,
      fromName: debtor.name,
      to: creditor.id,
      toName: creditor.name,
      amount: Math.round(settledAmount * 100) / 100
    });

    debtor.net += settledAmount;
    creditor.net -= settledAmount;

    if (Math.abs(debtor.net) < 0.01) {
      dIdx++;
    }
    if (Math.abs(creditor.net) < 0.01) {
      cIdx++;
    }
  }

  return {
    memberBalances: Object.values(memberBalances),
    transactions,
    totalSpent
  };
}
