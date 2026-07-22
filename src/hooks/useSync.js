import { db } from '../db/db';

const DEFAULT_FIREBASE_BASE = 'https://yupana-117f2-default-rtdb.firebaseio.com';
const FIREBASE_BASE_URL = (import.meta.env.VITE_FIREBASE_DB_URL || DEFAULT_FIREBASE_BASE).replace(/\/$/, '');
const FIREBASE_DB_URL = `${FIREBASE_BASE_URL}/groups`;

const SPANISH_WORDS = [
  'ASADO', 'MATE', 'FERNET', 'TRUCO', 'EMPANADA', 'CHORIPAN', 'MILANESA', 'ALMUERZO', 
  'CENA', 'FIESTA', 'VIAJE', 'AMIGOS', 'PLAYA', 'MONTAÑA', 'PIZZA', 'CERVEZA', 
  'CAMPING', 'VACACIONES', 'REUNION', 'CUMPLE', 'EQUIPO', 'FAMILIA', 'FUTBOL', 'CINE',
  'JUNTADA', 'ASADITO', 'PICADA', 'MERIENDA', 'DESAYUNO', 'BOLICHE', 'BANDA', 'SALIDA'
];

/**
 * Generates a memorable sync code in Argentine license plate + word format:
 * NNN + MM + YY + PALABRA (e.g. KTM0726ASADO)
 */
export function generateMemorableSyncCode() {
  const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  let prefix = '';
  for (let i = 0; i < 3; i++) {
    prefix += letters.charAt(Math.floor(Math.random() * letters.length));
  }
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const year = String(now.getFullYear()).slice(-2);
  const word = SPANISH_WORDS[Math.floor(Math.random() * SPANISH_WORDS.length)];

  return `${prefix}${month}${year}${word}`;
}

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
      if (!existingExp) {
        if (!exp.deleted) {
          await db.expenses.put(exp);
        }
      } else if (exp.updatedAt && exp.updatedAt > (existingExp.updatedAt || 0)) {
        await db.expenses.update(exp.id, exp);
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
    expenses: data.expenses.map(e => e.deleted ? { id: e.id, deleted: 1, updatedAt: e.updatedAt } : e)
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
  
  // Ensure group has a memorable syncCode if it doesn't already have one
  let syncCode = payload.group.syncCode;
  if (!syncCode) {
    syncCode = generateMemorableSyncCode();
    payload.group.syncCode = syncCode;
  }

  // Set syncedAt to now
  payload.group.syncedAt = Date.now();

  const response = await fetch(`${FIREBASE_DB_URL}/${syncCode}.json`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    let errDetail = response.statusText;
    try {
      const errJson = await response.json();
      if (errJson && errJson.error) errDetail = errJson.error;
    } catch (_) {}
    throw new Error(`Error al subir los datos a la nube (${response.status}: ${errDetail}).`);
  }

  await db.groups.update(groupId, {
    syncedAt: payload.group.syncedAt,
    syncCode: syncCode
  });

  return syncCode;
}

/**
 * Downloads group state from the KV store and merges it.
 * Validates the 14-day (2 weeks) expiration date.
 */
export async function downloadGroupFromCloud(codeOrId) {
  const cleanCode = codeOrId.trim().toUpperCase();
  let response = await fetch(`${FIREBASE_DB_URL}/${cleanCode}.json`);
  
  if (!response.ok) {
    let errDetail = response.statusText;
    try {
      const errJson = await response.json();
      if (errJson && errJson.error) errDetail = errJson.error;
    } catch (_) {}
    throw new Error(`Error al descargar los datos de la nube (${response.status}: ${errDetail}).`);
  }

  let data = await response.json();

  // Fallback try original exact string if uppercase yielded no result
  if (!data && cleanCode !== codeOrId.trim()) {
    response = await fetch(`${FIREBASE_DB_URL}/${codeOrId.trim()}.json`);
    if (response.ok) {
      data = await response.json();
    }
  }

  if (!data) {
    throw new Error('Grupo no encontrado o ha sido eliminado de la nube.');
  }
  
  // Check expiration (14 days = 1,209,600,000 milliseconds)
  const TWO_WEEKS_MS = 14 * 24 * 60 * 60 * 1000;
  const elapsed = Date.now() - (data.uploadedAt || 0);
  
  if (elapsed > TWO_WEEKS_MS) {
    throw new Error('El enlace de sincronización ha caducado (más de 14 días).');
  }

  return await mergeGroupData(data);
}
