import { Note } from '../types';
import { computeHash } from '../lib/utils';
import * as dbManager from './dbManager';

export const syncNotes = async (projectId: string, onProgress?: (notes: Note[]) => void, _uid?: string) => {
  // Local-only mode: just return local notes for the project
  const allLocalNotes = await dbManager.getAllNotes();
  const projectNotes = allLocalNotes.filter(n => n.projectId === projectId);
  
  if (onProgress) {
    onProgress(projectNotes);
  }
  
  return projectNotes;
};

export const deleteNoteFromSync = async (noteId: string, _projectId: string, _uid?: string) => {
  // Delete Local
  await dbManager.deleteNote(noteId);
};

export const saveNoteToSync = async (note: Note, _uid?: string) => {
  // Calculate hash
  const content = note.body || '';
  const contentHash = await computeHash(content);
  const noteWithHash = { ...note, contentHash };

  // Save Local
  await dbManager.saveNote(noteWithHash);
};
