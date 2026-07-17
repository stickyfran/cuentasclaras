import { db } from '../db/db';

const FIREBASE_DB_URL = 'https://yupana-sync-default-rtdb.firebaseio.com/groups';

/**
 * Serializes a group and all its members and expenses to a single object.
 */
export async function serializeGroup(groupId) {
  const group = await db.groups.get(groupId);
  if (!group) throw new Error('Grupo no encontrado');

  const members = await db.members.where('groupId').equals(groupId).toArray();
  const expenses = await db.expenses.where('groupId').equals(groupId).toArray();

  return {
    version: 1,
    uploadedAt: Date.now(),
    group,
    members,
    expenses
  };
}

/**
 * Merges imported group data into the local Dexie IndexedDB.
 * Implements merge logic (Last-Write-Wins and unique merging).
 */
export async function mergeGroupData(importedData) {
  const { group, members, expenses } = importedData;
  if (!group || !group.id) throw new Error('Datos de grupo inválidos');

  await db.transaction('rw', [db.groups, db.members, db.expenses], async () => {
    // 1. Merge Group details
    const existingGroup = await db.groups.get(group.id);
    if (!existingGroup || (group.updatedAt && group.updatedAt > (existingGroup.updatedAt || 0))) {
      await db.groups.put(group);
    }

    // 2. Merge Members (uniquely by ID)
    for (const member of members) {
      const existingMember = await db.members.get(member.id);
      if (!existingMember) {
        await db.members.put(member);
      }
    }

    // 3. Merge Expenses (Last-Write-Wins by updatedAt)
    for (const exp of expenses) {
      const existingExp = await db.expenses.get(exp.id);
      if (!existingExp || (exp.updatedAt && exp.updatedAt > (existingExp.updatedAt || 0))) {
        await db.expenses.put(exp);
      }
    }
  });

  return group.id;
}

/**
 * Generates a base64 string from group data for QR codes.
 */
export async function generateQRString(groupId) {
  const data = await serializeGroup(groupId);
  // Compress or omit redundant info to keep QR small
  // For QR, we only keep non-deleted expenses to save space
  const qrData = {
    ...data,
    expenses: data.expenses.filter(e => !e.deleted)
  };
  const jsonStr = JSON.stringify(qrData);
  // Simple Base64 encoding (supporting unicode characters safely)
  return btoa(unescape(encodeURIComponent(jsonStr)));
}

/**
 * Imports group data from a base64 QR string.
 */
export async function importFromQRString(qrString) {
  try {
    const jsonStr = decodeURIComponent(escape(atob(qrString)));
    const data = JSON.parse(jsonStr);
    return await mergeGroupData(data);
  } catch (err) {
    console.error('Error importing QR:', err);
    throw new Error('El código QR no contiene datos de Yupana válidos.');
  }
}

/**
 * Uploads group state to the serverless KV store and returns a link/code.
 */
export async function uploadGroupToCloud(groupId) {
  const payload = await serializeGroup(groupId);
  
  // Set syncedAt to now
  payload.group.syncedAt = Date.now();
  payload.group.syncCode = groupId; // use groupId as sync code / URL key
  
  await db.groups.update(groupId, {
    syncedAt: payload.group.syncedAt,
    syncCode: payload.group.syncCode
  });

  const response = await fetch(`${FIREBASE_DB_URL}/${groupId}.json`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    throw new Error('Error al subir los datos a la nube.');
  }

  return groupId;
}

/**
 * Downloads group state from the KV store and merges it.
 * Validates the 14-day (2 weeks) expiration date.
 */
export async function downloadGroupFromCloud(groupId) {
  const response = await fetch(`${FIREBASE_DB_URL}/${groupId}.json`);
  if (!response.ok) {
    throw new Error('Error al descargar los datos de la nube.');
  }

  const data = await response.json();
  if (!data) {
    throw new Error('Grupo no encontrado o ha sido eliminado de la nube.');
  }
  
  // Check expiration (14 days = 1,209,600,000 milliseconds)
  const TWO_WEEES_MS = 14 * 24 * 60 * 60 * 1000;
  const elapsed = Date.now() - (data.uploadedAt || 0);
  
  if (elapsed > TWO_WEEES_MS) {
    throw new Error('El enlace de sincronización ha caducado (más de 14 días).');
  }

  return await mergeGroupData(data);
}
