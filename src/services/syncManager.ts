import { collection, query, where, getDocs, doc, writeBatch, getDoc, setDoc, runTransaction, deleteDoc } from 'firebase/firestore';
import { db, auth } from '../firebase';
import { Note, SyncLedger, OperationType } from '../types';
import { computeHash, handleFirestoreError, removeUndefined } from '../lib/utils';
import * as dbManager from './dbManager';

export const syncNotes = async (projectId: string, onProgress?: (notes: Note[]) => void, uid?: string) => {
  if (!db) return;
  const currentUid = uid || auth?.currentUser?.uid;
  if (!currentUid) return;

  const lastSyncedAtKey = `lastSyncedAt_${projectId}`;
  const lastSyncedAtStr = localStorage.getItem(lastSyncedAtKey);
  const lastSyncedAt = lastSyncedAtStr ? new Date(lastSyncedAtStr) : new Date(0);
  const syncStartTime = new Date().toISOString();

  // 1. Fetch Manifest Document from Firestore
  const manifestRef = doc(db, 'sync_manifests', projectId);
  let manifestData: Record<string, string> = {};
  try {
    const manifestSnap = await getDoc(manifestRef);
    if (manifestSnap.exists()) {
      manifestData = manifestSnap.data().fileShaMap || {};
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, `sync_manifests/${projectId}`);
  }

  // 2. Get Local Data
  const allLocalNotes = await dbManager.getAllNotes();
  const localNotes = allLocalNotes.filter(n => n.projectId === projectId);

  // 3. Compare
  const toFetch: string[] = [];
  const toUpload: Note[] = [];

  // Find local notes that need uploading
  localNotes.forEach(local => {
    const localUpdated = typeof local.lastUpdated === 'string' ? new Date(local.lastUpdated) : new Date(0);
    if (localUpdated > lastSyncedAt) {
      toUpload.push(local);
    }
  });

  // Find remote notes that need fetching
  Object.entries(manifestData).forEach(([id, value]) => {
    // value could be a hash (old format) or an ISO string (new format)
    const remoteUpdated = new Date(value);
    const isOldFormat = isNaN(remoteUpdated.getTime());
    
    let isNewer = false;
    if (isOldFormat) {
      // Old format: value is a hash. Compare with local hash.
      const localNote = localNotes.find(n => n.id === id);
      if (!localNote || localNote.contentHash !== value) {
        isNewer = true;
      }
    } else {
      isNewer = remoteUpdated > lastSyncedAt;
    }
    
    if (isNewer) {
      // If we are already uploading this note, compare timestamps if possible
      const uploadingNote = toUpload.find(n => n.id === id);
      if (uploadingNote) {
        if (!isOldFormat) {
          const localUpdated = typeof uploadingNote.lastUpdated === 'string' ? new Date(uploadingNote.lastUpdated) : new Date(0);
          if (remoteUpdated > localUpdated) {
            // Remote wins
            toUpload.splice(toUpload.indexOf(uploadingNote), 1);
            toFetch.push(id);
          }
        } else {
          // Old format (hash). If we are uploading it, local wins. Do not fetch.
          // It will be uploaded and the manifest will be updated to the new format.
        }
      } else {
        toFetch.push(id);
      }
    }
  });

  // 4. Upload local notes to Firebase
  if (toUpload.length > 0) {
    for (let i = 0; i < toUpload.length; i += 400) {
      const batch = writeBatch(db);
      const chunk = toUpload.slice(i, i + 400);
      
      for (const note of chunk) {
        const noteRef = doc(db, 'notes', note.id);
        const cleanNote = removeUndefined({ 
          ...note,
          projectId: String(projectId),
          title: String(note.title || ''),
          summary: String(note.summary || ''),
          body: String(note.body || ''),
          folder: String(note.folder || '/'),
          noteType: note.noteType || 'Domain',
          status: note.status || 'Planned',
          priority: note.priority || 'C',
          parentNoteIds: Array.isArray(note.parentNoteIds) ? note.parentNoteIds : [],
          childNoteIds: Array.isArray(note.childNoteIds) ? note.childNoteIds : [],
          relatedNoteIds: Array.isArray(note.relatedNoteIds) ? note.relatedNoteIds : [],
          uid: String(currentUid),
          lastUpdated: typeof note.lastUpdated === 'string' 
            ? note.lastUpdated 
            : new Date().toISOString()
        });

        if ('createdAt' in cleanNote) {
          delete cleanNote.createdAt;
        }
        
        batch.set(noteRef, cleanNote, { merge: true });
        
        // Update manifestData locally to be saved later
        manifestData[note.id] = cleanNote.lastUpdated;
      }
      
      try {
        await batch.commit();
      } catch (error) {
        console.error('Error uploading batch of notes:', error);
        // Fallback to individual uploads
        for (const note of chunk) {
          const noteRef = doc(db, 'notes', note.id);
          const cleanNote = removeUndefined({ 
            ...note,
            projectId: String(projectId),
            title: String(note.title || ''),
            summary: String(note.summary || ''),
            body: String(note.body || ''),
            folder: String(note.folder || '/'),
            noteType: note.noteType || 'Domain',
            status: note.status || 'Planned',
            priority: note.priority || 'C',
            parentNoteIds: Array.isArray(note.parentNoteIds) ? note.parentNoteIds : [],
            childNoteIds: Array.isArray(note.childNoteIds) ? note.childNoteIds : [],
            relatedNoteIds: Array.isArray(note.relatedNoteIds) ? note.relatedNoteIds : [],
            uid: String(currentUid),
            lastUpdated: typeof note.lastUpdated === 'string' 
              ? note.lastUpdated 
              : new Date().toISOString()
          });
          
          if ('createdAt' in cleanNote) {
            delete cleanNote.createdAt;
          }
          try {
            await setDoc(noteRef, cleanNote, { merge: true });
            manifestData[note.id] = cleanNote.lastUpdated;
          } catch (err) {
            console.error('Failed to upload note:', note.id, err);
            handleFirestoreError(err, OperationType.WRITE, 'notes/' + note.id);
          }
        }
      }
    }
    
    // Save updated manifest
    try {
      await setDoc(manifestRef, { fileShaMap: manifestData }, { merge: true });
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, `sync_manifests/${projectId}`);
    }
  }

  // 5. Fetch remote notes
  if (toFetch.length > 0) {
    const fetchedNotes: Note[] = [];
    const BATCH_SIZE = 30;
    for (let i = 0; i < toFetch.length; i += BATCH_SIZE) {
      const batchIds = toFetch.slice(i, i + BATCH_SIZE);
      const promises = batchIds.map(async (id) => {
        try {
          const docSnap = await getDoc(doc(db, 'notes', id));
          if (docSnap.exists()) {
            return { id: docSnap.id, ...docSnap.data() } as Note;
          }
        } catch (error) {
          handleFirestoreError(error, OperationType.GET, `notes/${id}`);
        }
        return null;
      });
      const results = await Promise.all(promises);
      fetchedNotes.push(...results.filter((n): n is Note => n !== null));
    }
    if (fetchedNotes.length > 0) {
      await dbManager.bulkSaveNotes(fetchedNotes);
      if (onProgress) {
        const updatedLocalNotes = await dbManager.getAllNotes();
        onProgress(updatedLocalNotes.filter(n => n.projectId === projectId));
      }
    }
  }

  // 6. Update lastSyncedAt
  localStorage.setItem(lastSyncedAtKey, syncStartTime);

  const finalLocalNotes = await dbManager.getAllNotes();
  return finalLocalNotes.filter(n => n.projectId === projectId);
};

export const deleteNoteFromSync = async (noteId: string, projectId: string, uid?: string) => {
  // Delete Local
  await dbManager.deleteNote(noteId);

  if (!db) return;
  const currentUid = uid || auth?.currentUser?.uid;
  if (!currentUid) return;

  // Delete Remote
  const noteRef = doc(db, 'notes', noteId);
  try {
    await deleteDoc(noteRef);
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, 'notes/' + noteId);
  }

  // Delete from Manifest
  const manifestRef = doc(db, 'sync_manifests', projectId);
  try {
    await runTransaction(db, async (transaction) => {
      const manifestDoc = await transaction.get(manifestRef);
      if (manifestDoc.exists()) {
        const manifestData = manifestDoc.data().fileShaMap || {};
        if (manifestData[noteId]) {
          delete manifestData[noteId];
          transaction.set(manifestRef, { fileShaMap: manifestData }, { merge: false });
        }
      }
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, 'sync_manifests/' + projectId);
  }
};

export const saveNoteToSync = async (note: Note, uid?: string) => {
  // Calculate hash
  const content = note.body || '';
  const contentHash = await computeHash(content);
  const noteWithHash = { ...note, contentHash };

  // Save Local
  await dbManager.saveNote(noteWithHash);

  if (!db) return;
  const currentUid = uid || auth?.currentUser?.uid;
  if (!currentUid) return;

  // Save Remote
  const noteRef = doc(db, 'notes', note.id);
  try {
    // Ensure all required fields are included for security rules validation
    // and remove undefined values which Firestore doesn't support
    const cleanNote = removeUndefined({ 
      ...noteWithHash, 
      projectId: String(noteWithHash.projectId),
      title: String(noteWithHash.title || ''),
      summary: String(noteWithHash.summary || ''),
      body: String(noteWithHash.body || ''),
      folder: String(noteWithHash.folder || '/'),
      noteType: noteWithHash.noteType || 'Domain',
      status: noteWithHash.status || 'Planned',
      priority: noteWithHash.priority || 'C',
      parentNoteIds: Array.isArray(noteWithHash.parentNoteIds) ? noteWithHash.parentNoteIds : [],
      childNoteIds: Array.isArray(noteWithHash.childNoteIds) ? noteWithHash.childNoteIds : [],
      relatedNoteIds: Array.isArray(noteWithHash.relatedNoteIds) ? noteWithHash.relatedNoteIds : [],
      uid: String(currentUid),
      lastUpdated: typeof noteWithHash.lastUpdated === 'string' 
        ? noteWithHash.lastUpdated 
        : (noteWithHash.lastUpdated && typeof noteWithHash.lastUpdated === 'object' && 'seconds' in noteWithHash.lastUpdated)
          ? new Date(noteWithHash.lastUpdated.seconds * 1000).toISOString()
          : new Date().toISOString()
    });

    // Remove createdAt to avoid Timestamp vs Map comparison issues in security rules
    if ('createdAt' in cleanNote) {
      delete cleanNote.createdAt;
    }

    await setDoc(noteRef, cleanNote, { merge: true });
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, 'notes/' + note.id);
  }

  // Save Metadata to Manifest using Transaction to prevent write contention
  const manifestRef = doc(db, 'sync_manifests', note.projectId);
  try {
    await runTransaction(db, async (transaction) => {
      const manifestDoc = await transaction.get(manifestRef);
      const manifestData = manifestDoc.exists() ? manifestDoc.data().fileShaMap : {};
      manifestData[note.id] = typeof noteWithHash.lastUpdated === 'string' 
        ? noteWithHash.lastUpdated 
        : (noteWithHash.lastUpdated && typeof noteWithHash.lastUpdated === 'object' && 'seconds' in noteWithHash.lastUpdated)
          ? new Date(noteWithHash.lastUpdated.seconds * 1000).toISOString()
          : new Date().toISOString();
      transaction.set(manifestRef, { fileShaMap: manifestData }, { merge: true });
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, 'sync_manifests/' + note.projectId);
  }
};
