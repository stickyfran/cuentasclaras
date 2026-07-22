import Dexie from 'dexie';

export const db = new Dexie('YupanaDB');

// Define database schema
db.version(1).stores({
  groups: 'id, name, createdAt, updatedAt, syncedAt, syncCode',
  members: 'id, groupId, name, joinedAt',
  expenses: 'id, groupId, paidById, date, createdAt, updatedAt, deleted',
  auditLogs: 'id, groupId, expenseId, action, timestamp'
});

// Helper functions for seeding mock/demo data if database is empty
export async function seedDemoData() {
  // Empty - no local seeding as requested
  return;
}
