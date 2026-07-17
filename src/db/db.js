import Dexie from 'dexie';

export const db = new Dexie('YupanaDB');

// Define database schema
db.version(1).stores({
  groups: 'id, name, createdAt, updatedAt, syncedAt, syncCode',
  members: 'id, groupId, name, joinedAt',
  expenses: 'id, groupId, paidById, date, createdAt, updatedAt, deleted'
});

// Helper functions for seeding mock/demo data if database is empty
export async function seedDemoData() {
  const groupCount = await db.groups.count();
  if (groupCount > 0) return;

  const groupId = 'demo-group-viaje-bariloche';
  
  await db.groups.add({
    id: groupId,
    name: 'Viaje a Bariloche 🏔️',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    syncedAt: null,
    syncCode: null
  });

  const members = [
    { id: 'm1', groupId, name: 'Franco', joinedAt: Date.now() },
    { id: 'm2', groupId, name: 'Sofía', joinedAt: Date.now() + 10 },
    { id: 'm3', groupId, name: 'Mateo', joinedAt: Date.now() + 20 },
    { id: 'm4', groupId, name: 'Clara', joinedAt: Date.now() + 30 }
  ];

  await db.members.bulkAdd(members);

  const expenses = [
    {
      id: 'e1',
      groupId,
      description: 'Alquiler de Cabaña',
      amount: 120000,
      paidById: 'm1', // Franco
      splitType: 'equal',
      splits: [], // Equal split among all members automatically
      date: Date.now() - 3 * 24 * 60 * 60 * 1000, // 3 days ago
      createdAt: Date.now() - 3 * 24 * 60 * 60 * 1000,
      updatedAt: Date.now() - 3 * 24 * 60 * 60 * 1000,
      deleted: 0
    },
    {
      id: 'e2',
      groupId,
      description: 'Cena Asado',
      amount: 45000,
      paidById: 'm2', // Sofia
      splitType: 'equal',
      splits: [],
      date: Date.now() - 2 * 24 * 60 * 60 * 1000,
      createdAt: Date.now() - 2 * 24 * 60 * 60 * 1000,
      updatedAt: Date.now() - 2 * 24 * 60 * 60 * 1000,
      deleted: 0
    },
    {
      id: 'e3',
      groupId,
      description: 'Combustible auto (Solo Franco y Mateo)',
      amount: 30000,
      paidById: 'm3', // Mateo
      splitType: 'custom',
      splits: [
        { memberId: 'm1', amount: 15000 },
        { memberId: 'm3', amount: 15000 }
      ],
      date: Date.now() - 1 * 24 * 60 * 60 * 1000,
      createdAt: Date.now() - 1 * 24 * 60 * 60 * 1000,
      updatedAt: Date.now() - 1 * 24 * 60 * 60 * 1000,
      deleted: 0
    },
    {
      id: 'e4',
      groupId,
      description: 'Entradas Parque Nacional',
      amount: 16000,
      paidById: 'm4', // Clara
      splitType: 'equal',
      splits: [],
      date: Date.now() - 12 * 60 * 60 * 1000, // 12 hours ago
      createdAt: Date.now() - 12 * 60 * 60 * 1000,
      updatedAt: Date.now() - 12 * 60 * 60 * 1000,
      deleted: 0
    }
  ];

  await db.expenses.bulkAdd(expenses);
}
