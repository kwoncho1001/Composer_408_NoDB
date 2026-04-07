import React, { useState, useEffect } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { Note, NoteType, NoteStatus, NotePriority, OperationType, CSuiteEvaluation } from '../types';
import { handleFirestoreError } from '../lib/utils';
import { Trash2, Save, Eye, Edit3, Sparkles, Loader2, AlertTriangle, CheckCircle2, FileWarning, PanelTop, Users, Code2, Megaphone, DollarSign, Info, Layers, History, Fingerprint } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkBreaks from 'remark-breaks';
import { reformatNote, analyzeLogicUnit, generateFixGuide, translateToBusinessLogic, evaluateWithCSuite } from '../services/gemini';
import { fetchFileContent } from '../services/github';
import * as dbManager from '../services/dbManager';
import { saveNoteToSync, deleteNoteFromSync } from '../services/syncManager';

const getCleanSummary = (summary: string | undefined) => {
  if (!summary) return '';
  // 정규표현식으로 ", "differences": [ ... ] }" 형태의 찌꺼기를 잘라냄
  const match = summary.match(/^(.*?)(?:",\s*"differences"\s*:|$)/s);
  let clean = match ? match[1] : summary;
  // 끝에 남아있는 따옴표나 쉼표 제거
  clean = clean.replace(/["\s,]+$/, '');
  return clean;
};

export const NoteEditor = ({ noteId, projectId, onSaved, onDeleted }: { noteId: string | null, projectId: string | null, onSaved: () => void, onDeleted?: () => void }) => {
  const { user } = useAuth();
  const [note, setNote] = useState<Partial<Note>>({
    title: '', summary: '', body: '', noteType: 'Domain', status: 'Planned', priority: '3rd',
    parentNoteIds: [], childNoteIds: []
  });
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [isDirty, setIsDirty] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isPreview, setIsPreview] = useState(false);
  const [isFormatting, setIsFormatting] = useState(false);
  const [isResolvingConflict, setIsResolvingConflict] = useState(false);
  const [conflictResolutionGuide, setConflictResolutionGuide] = useState<string | null>(null);
  const [isEvaluatingCSuite, setIsEvaluatingCSuite] = useState(false);
  const [cSuiteEval, setCSuiteEval] = useState<CSuiteEvaluation | null>(null);
  const [showMetadata, setShowMetadata] = useState(() => {
    if (typeof window !== 'undefined') {
      return localStorage.getItem('showMetadata') !== 'false';
    }
    return true;
  });

  useEffect(() => {
    localStorage.setItem('showMetadata', showMetadata.toString());
  }, [showMetadata]);

  useEffect(() => {
    setConfirmDelete(false);
    setIsDirty(false);
    setConflictResolutionGuide(null);
    if (!noteId || noteId === 'new') {
      setNote({
        title: '', summary: '', body: '', noteType: 'Domain', status: 'Planned', priority: '3rd',
        parentNoteIds: [], childNoteIds: []
      });
      return;
    }

    const fetchNote = async () => {
      try {
        const allNotes = await dbManager.getAllNotes();
        const data = allNotes.find(n => n.id === noteId) || null;
        if (data && data.status === 'Done' && data.priority !== 'Done') {
          data.priority = 'Done';
          setIsDirty(true);
        }
        if (data) {
          // Ensure string fields are not null
          data.title = data.title || '';
          data.summary = data.summary || '';
          data.body = data.body || '';
          // Ensure array fields are not undefined
          data.parentNoteIds = data.parentNoteIds || [];
          data.childNoteIds = data.childNoteIds || [];

          // Self-healing: remove child IDs that don't exist or don't have this note as parent
          const validChildIds = allNotes
            .filter(n => n.parentNoteIds?.includes(data.id))
            .map(n => n.id);
          
          if (JSON.stringify([...data.childNoteIds].sort()) !== JSON.stringify([...validChildIds].sort())) {
            data.childNoteIds = validChildIds;
            setIsDirty(true); // Trigger auto-save to fix the data
          }

          setNote(data);
          if (data.status === 'Done') setIsPreview(true);
        }
      } catch (error) {
        console.error("Failed to load note from local DB", error);
      }
    };
    fetchNote();
  }, [noteId]);

  // Debounced Auto-save
  useEffect(() => {
    if (!isDirty || noteId === 'new') return;

    const timer = setTimeout(() => {
      handleSave();
    }, 5000);

    return () => clearTimeout(timer);
  }, [note, isDirty]);

  const handleSave = async () => {
    if (!user || !projectId) return;
    setIsSaving(true);
    try {
      let finalNoteId = noteId;
      const allNotes = await dbManager.getAllNotes();
      const oldNote = allNotes.find(n => n.id === note.id);
      const oldParentIds = oldNote?.parentNoteIds || [];

      if (noteId === 'new') {
        finalNoteId = crypto.randomUUID();
        const noteToSave = {
          ...note,
          id: finalNoteId,
          projectId,
          uid: user.uid,
          lastUpdated: new Date().toISOString()
        } as Note;
        await saveNoteToSync(noteToSave);
      } else if (noteId) {
        const noteToSave = {
          ...note,
          id: finalNoteId,
          lastUpdated: new Date().toISOString(),
          uid: user.uid
        } as Note;
        await saveNoteToSync(noteToSave);
      }

      // Mirroring Logic: Update parents' childNoteIds locally and sync
      const newParentIds = note.parentNoteIds || [];
      
      // 1. Add this note to new parents
      const addedParents = newParentIds.filter(id => !oldParentIds.includes(id));
      for (const pId of addedParents) {
        const pNote = allNotes.find(n => n.id === pId);
        if (pNote) {
          const updatedParent = {
            ...pNote,
            childNoteIds: Array.from(new Set([...(pNote.childNoteIds || []), finalNoteId!]))
          };
          await saveNoteToSync(updatedParent);
        }
      }

      // 2. Remove this note from removed parents
      const removedParents = oldParentIds.filter(id => !newParentIds.includes(id));
      for (const pId of removedParents) {
        const pNote = allNotes.find(n => n.id === pId);
        if (pNote) {
          const updatedParent = {
            ...pNote,
            childNoteIds: (pNote.childNoteIds || []).filter(id => id !== finalNoteId)
          };
          await saveNoteToSync(updatedParent);
        }
      }

      setIsDirty(false);
      onSaved();
    } catch (error) {
      console.error("Failed to save note locally", error);
    } finally {
      setIsSaving(false);
    }
  };

  const updateNote = (updates: Partial<Note>) => {
    setNote(prev => {
      const next = { ...prev, ...updates };
      if (next.status === 'Done' && next.priority !== 'Done') {
        next.priority = 'Done';
      }
      return next;
    });
    setIsDirty(true);
  };

  const handleReformat = async () => {
    if (!note || !noteId || noteId === 'new') return;
    setIsFormatting(true);
    try {
      const reformatted = await reformatNote(note);
      
      const nextNote = { 
        ...note, 
        ...reformatted,
        lastUpdated: new Date().toISOString(),
        uid: user?.uid || 'local-guest'
      } as Note;
      if (nextNote.status === 'Done' && nextNote.priority !== 'Done') {
        nextNote.priority = 'Done';
      }
      
      setIsSaving(true);
      await saveNoteToSync(nextNote);
      
      setNote(nextNote);
      setIsDirty(false);
      onSaved();
    } catch (error) {
      console.error("Failed to reformat note", error);
    } finally {
      setIsFormatting(false);
      setIsSaving(false);
    }
  };

  const getFilePathForConflict = async () => {
    let filePath = note?.originPath;
    if (!filePath || filePath === '/') {
      if (note?.childNoteIds && note.childNoteIds.length > 0) {
        const allNotes = await dbManager.getAllNotes();
        const childSnapshots = allNotes.filter(n => note.childNoteIds?.includes(n.id) && n.noteType === 'Snapshot');
        if (childSnapshots.length > 0) {
          filePath = childSnapshots[0].originPath;
        }
      }
    }
    return filePath;
  };

  const handleResolveConflictWithCode = async () => {
    if (!note || !noteId || !projectId) return;
    setIsResolvingConflict(true);
    try {
      const filePath = await getFilePathForConflict();
      if (!filePath || filePath === '/') throw new Error("Could not determine the source file path for this logic.");

      const project = await dbManager.getProject(projectId);
      if (!project) throw new Error("Project not found");
      const repoUrl = project.repoUrl;
      
      const fileContent = await fetchFileContent(repoUrl, filePath);
      const analyzed = await analyzeLogicUnit(note.title || '', fileContent);
      const businessLogic = await translateToBusinessLogic(analyzed);
      
      const nextNote = { 
        ...note, 
        summary: businessLogic.summary,
        components: businessLogic.components,
        flow: businessLogic.flow,
        io: businessLogic.io,
        status: 'Done' as NoteStatus,
        priority: 'Done' as NotePriority,
        conflictDetails: null,
        lastUpdated: new Date().toISOString(),
        uid: user?.uid || 'local-guest'
      } as Note;
      
      setIsSaving(true);
      await saveNoteToSync(nextNote);
      
      setNote(nextNote);
      setIsDirty(false);
      onSaved();
    } catch (error) {
      console.error("Failed to resolve conflict with code", error);
      alert("Failed to resolve conflict: " + (error as Error).message);
    } finally {
      setIsResolvingConflict(false);
      setIsSaving(false);
    }
  };

  const handleResolveConflictWithDesign = async () => {
    if (!note || !noteId || !projectId) return;
    setIsResolvingConflict(true);
    try {
      const filePath = await getFilePathForConflict();
      if (!filePath || filePath === '/') throw new Error("Could not determine the source file path for this logic.");

      const project = await dbManager.getProject(projectId);
      if (!project) throw new Error("Project not found");
      const repoUrl = project.repoUrl;
      
      const fileContent = await fetchFileContent(repoUrl, filePath);
      const guide = await generateFixGuide(note as Note, fileContent);
      
      setConflictResolutionGuide(guide);
    } catch (error) {
      console.error("Failed to resolve conflict with design", error);
      alert("Failed to generate guide: " + (error as Error).message);
    } finally {
      setIsResolvingConflict(false);
    }
  };

  const handleCSuiteEvaluation = async () => {
    if (!note || !noteId || noteId === 'new') return;
    setIsEvaluatingCSuite(true);
    try {
      const evaluation = await evaluateWithCSuite(note.title || '', note.summary || '', note.noteType || 'Logic');
      setCSuiteEval(evaluation);
    } catch (error) {
      console.error("Failed to evaluate with C-Suite", error);
      alert("Failed to evaluate: " + (error as Error).message);
    } finally {
      setIsEvaluatingCSuite(false);
    }
  };

  const handleDelete = async () => {
    if (!noteId || noteId === 'new') return;
    try {
      const allNotes = await dbManager.getAllNotes();
      const currentNote = allNotes.find(n => n.id === noteId);
      
      if (currentNote && currentNote.parentNoteIds) {
        for (const parentId of currentNote.parentNoteIds) {
          const parentNote = allNotes.find(n => n.id === parentId);
          if (parentNote) {
            const updatedParent = {
              ...parentNote,
              childNoteIds: (parentNote.childNoteIds || []).filter(id => id !== noteId)
            };
            await saveNoteToSync(updatedParent);
          }
        }
      }

      await deleteNoteFromSync(noteId, note.projectId);
      if (onDeleted) onDeleted();
      else onSaved();
    } catch (error) {
      console.error("Failed to delete note locally", error);
    }
  };

  const formatTimestamp = (ts: any) => {
    if (!ts) return 'N/A';
    const date = ts.toDate ? ts.toDate() : new Date(ts);
    return date.toLocaleString('ko-KR', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    });
  };

  if (!noteId) return (
    <div className="flex-1 flex flex-col items-center justify-center text-center p-12">
      <div className="w-16 h-16 bg-muted rounded-2xl flex items-center justify-center mb-6 text-muted-foreground/30">
        <Save size={32} />
      </div>
      <h3 className="text-xl font-bold mb-2">No Note Selected</h3>
      <p className="text-muted-foreground max-w-xs">Select a note from the explorer or create a new one to start editing.</p>
    </div>
  );

  return (
    <div className="flex-1 flex flex-col bg-card text-foreground rounded-none sm:rounded-3xl shadow-none sm:shadow-2xl border-0 sm:border border-border overflow-hidden glass h-full">
      <div className="flex-1 overflow-y-auto custom-scrollbar">
        {/* Header */}
        <div className="p-4 sm:p-8 border-b border-border flex flex-col lg:flex-row justify-between items-start lg:items-center gap-4 sm:gap-6 bg-card relative sm:sticky top-0 z-10">
          <div className="flex-1 w-full">
          <input 
            type="text" 
            value={note.title || ''} 
            onChange={e => updateNote({title: e.target.value})}
            placeholder="Note Title..."
            maxLength={200}
            className="text-xl sm:text-3xl font-black bg-transparent border-none outline-none w-full text-foreground placeholder:text-muted-foreground/20 tracking-tighter uppercase italic"
          />
          <div className="flex items-center gap-2 sm:gap-4 mt-2 sm:mt-3 flex-wrap">
            <div className="flex items-center gap-2 px-2 py-1 bg-muted rounded text-[10px] sm:text-xs font-mono font-bold text-muted-foreground border border-border/50 max-w-full overflow-hidden">
              <span className="opacity-60 uppercase tracking-widest text-[8px] sm:text-[9px] shrink-0">UID:</span>
              <span className="truncate">{note.id || 'NEW_ENTRY'}</span>
            </div>
            <div className="flex items-center gap-2 px-2 py-1 bg-primary/10 rounded text-[10px] sm:text-xs font-mono font-bold text-primary border border-primary/20 shrink-0">
              <span className="opacity-60 uppercase tracking-widest text-[8px] sm:text-[9px]">Type:</span>
              <span>{note.noteType || 'Domain'}</span>
            </div>
          </div>
        </div>
        <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-center w-full lg:w-auto mt-2 lg:mt-0">
          {isSaving && (
            <span className="text-[10px] font-bold text-primary animate-pulse uppercase tracking-widest sm:mr-2">
              Syncing...
            </span>
          )}
          <div className="grid grid-cols-2 sm:flex gap-2 w-full sm:w-auto">
            <button
              onClick={() => setShowMetadata(!showMetadata)}
              className={`flex items-center justify-center gap-2 px-3 py-2 text-[9px] sm:text-[10px] font-black uppercase tracking-widest rounded-xl transition-all active:scale-95 border flex-1 sm:flex-none ${
                showMetadata 
                  ? 'bg-primary/10 text-primary border-primary/20' 
                  : 'bg-muted text-muted-foreground hover:bg-accent border-border'
              }`}
              title="Toggle Metadata"
            >
              <PanelTop size={12} />
              <span>Meta</span>
            </button>
            <button
              onClick={handleCSuiteEvaluation}
              disabled={isEvaluatingCSuite || isSaving || noteId === 'new'}
              className="flex items-center justify-center gap-2 px-3 py-2 bg-indigo-500/10 hover:bg-indigo-500/20 text-indigo-500 text-[9px] sm:text-[10px] font-black uppercase tracking-widest rounded-xl transition-all active:scale-95 border border-indigo-500/20 disabled:opacity-50 flex-1 sm:flex-none"
              title="임원진 이사회 소집 (AI C-Suite)"
            >
              {isEvaluatingCSuite ? (
                <Loader2 size={12} className="animate-spin" />
              ) : (
                <Users size={12} />
              )}
              <span>C-Suite</span>
            </button>
            <button
              onClick={handleReformat}
              disabled={isFormatting || isSaving || noteId === 'new'}
              className="flex items-center justify-center gap-2 px-3 py-2 bg-primary/10 hover:bg-primary/20 text-primary text-[9px] sm:text-[10px] font-black uppercase tracking-widest rounded-xl transition-all active:scale-95 border border-primary/20 disabled:opacity-50 flex-1 sm:flex-none"
              title="AI로 가독성 있게 재구성"
            >
              {isFormatting ? (
                <Loader2 size={12} className="animate-spin" />
              ) : (
                <Sparkles size={12} />
              )}
              <span>AI Format</span>
            </button>
            <button 
              onClick={() => setIsPreview(!isPreview)}
              className={`flex items-center justify-center gap-2 px-3 py-2 text-[9px] sm:text-[10px] font-black uppercase tracking-widest rounded-xl transition-all active:scale-95 border flex-1 sm:flex-none ${
                isPreview 
                  ? 'bg-primary/10 text-primary border-primary/20' 
                  : 'bg-muted text-muted-foreground hover:bg-accent border-border'
              }`}
              title={isPreview ? "Switch to Edit Mode" : "Switch to Preview Mode"}
            >
              {isPreview ? <Edit3 size={12} /> : <Eye size={12} />}
              {isPreview ? 'Edit' : 'Preview'}
            </button>
            <button 
              onClick={handleSave} 
              disabled={isSaving || !isDirty}
              className="flex items-center justify-center gap-2 px-3 py-2 bg-primary text-primary-foreground text-[9px] sm:text-[10px] font-black uppercase tracking-widest rounded-xl hover:opacity-90 transition-all shadow-lg shadow-primary/20 active:scale-95 glow-primary disabled:opacity-50 flex-1 sm:flex-none"
            >
              <Save size={12} className={isSaving ? 'animate-spin' : ''} /> {isSaving ? 'Sync' : 'Save'}
            </button>
            {noteId !== 'new' && (
              <button 
                onClick={() => {
                  if (confirmDelete) handleDelete();
                  else setConfirmDelete(true);
                }} 
                className={`flex items-center justify-center gap-2 px-3 py-2 text-[9px] sm:text-[10px] font-black uppercase tracking-widest rounded-xl transition-all active:scale-95 flex-1 sm:flex-none ${
                  confirmDelete 
                    ? 'bg-destructive text-destructive-foreground shadow-lg shadow-destructive/20' 
                    : 'bg-muted text-muted-foreground hover:bg-destructive/10 hover:text-destructive border border-border'
                }`}
              >
                <Trash2 size={12} /> {confirmDelete ? 'Confirm' : 'Delete'}
              </button>
            )}
          </div>
        </div>
      </div>

      <div className="p-4 sm:p-8 space-y-6 sm:space-y-12">
        {showMetadata && (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 sm:gap-8">
            {/* A. 노트 정보 */}
            <section className="bg-transparent sm:bg-muted/10 border-0 sm:border border-border/50 rounded-none sm:rounded-3xl p-0 sm:p-8 pl-4 sm:pl-8 space-y-4 sm:space-y-6 relative overflow-hidden group">
              <div className="absolute top-0 left-0 w-1 h-full bg-green-500/50 group-hover:bg-green-500 transition-colors"></div>
              <h3 className="text-[10px] font-black text-muted-foreground uppercase tracking-[0.3em] flex items-center gap-3">
                <Info size={14} className="text-green-500" />
                A. 노트 정보
              </h3>
              <div className="space-y-4">
                <div>
                  <label className="block text-[10px] sm:text-xs font-black text-muted-foreground/70 uppercase mb-1 sm:mb-2 tracking-widest">Type</label>
                  <select 
                    value={note.noteType} 
                    onChange={e => updateNote({noteType: e.target.value as NoteType})}
                    className="w-full bg-background/50 border border-border rounded-xl p-2 sm:p-3 text-xs font-bold focus:ring-2 focus:ring-primary/20 outline-none transition-all appearance-none cursor-pointer"
                  >
                    <option value="Domain">Domain</option>
                    <option value="Module">Module</option>
                    <option value="Logic">Logic</option>
                    <option value="Snapshot">Snapshot</option>
                  </select>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[10px] sm:text-xs font-black text-muted-foreground/70 uppercase mb-1 sm:mb-2 tracking-widest">Status</label>
                    <select 
                      value={note.status} 
                      onChange={e => {
                        const newStatus = e.target.value as NoteStatus;
                        const updates: any = { status: newStatus };
                        if (newStatus === 'Done') updates.priority = 'Done';
                        updateNote(updates);
                      }}
                      className="w-full bg-background/50 border border-border rounded-xl p-2 sm:p-3 text-xs font-bold focus:ring-2 focus:ring-primary/20 outline-none transition-all appearance-none cursor-pointer"
                    >
                      <option value="Planned">Planned</option>
                      <option value="Done">Done</option>
                      <option value="Conflict">Conflict</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-[10px] sm:text-xs font-black text-muted-foreground/70 uppercase mb-1 sm:mb-2 tracking-widest">Priority</label>
                    <select 
                      value={note.priority || '3rd'} 
                      onChange={e => updateNote({priority: e.target.value as NotePriority})}
                      disabled={note.status === 'Done'}
                      className={`w-full bg-background/50 border border-border rounded-xl p-2 sm:p-3 text-xs font-bold focus:ring-2 focus:ring-primary/20 outline-none transition-all appearance-none cursor-pointer ${note.status === 'Done' ? 'opacity-50 cursor-not-allowed' : ''}`}
                    >
                      <option value="1st">1st Priority</option>
                      <option value="2nd">2nd Priority</option>
                      <option value="3rd">3rd Priority</option>
                      <option value="Done">Done</option>
                    </select>
                  </div>
                </div>
              </div>
            </section>

            {/* B. 노트 계층 */}
            <section className="bg-transparent sm:bg-muted/10 border-0 sm:border border-border/50 rounded-none sm:rounded-3xl p-0 sm:p-8 pl-4 sm:pl-8 space-y-4 sm:space-y-6 relative overflow-hidden group">
              <div className="absolute top-0 left-0 w-1 h-full bg-purple-500/50 group-hover:bg-purple-500 transition-colors"></div>
              <h3 className="text-[10px] font-black text-muted-foreground uppercase tracking-[0.3em] flex items-center gap-3">
                <Layers size={14} className="text-purple-500" />
                B. 노트 계층
              </h3>
              <div className="space-y-4">
                <div>
                  <label className="block text-[10px] sm:text-xs font-black text-muted-foreground/70 uppercase mb-1 sm:mb-2 tracking-widest">Parent Nodes</label>
                  <textarea 
                    value={note.parentNoteIds?.join(', ') || ''} 
                    onChange={e => updateNote({parentNoteIds: e.target.value.split(',').map(s => s.trim()).filter(Boolean)})}
                    className="w-full bg-background/50 border border-border rounded-xl p-2 sm:p-3 text-xs font-mono focus:ring-2 focus:ring-primary/20 outline-none transition-all resize-none min-h-[44px]"
                    placeholder="NODE_ID_1, NODE_ID_2..."
                    rows={1}
                  />
                </div>
                <div>
                  <label className="block text-[10px] sm:text-xs font-black text-muted-foreground/70 uppercase mb-1 sm:mb-2 tracking-widest">Child Nodes</label>
                  <div className="w-full bg-background/30 border border-border border-dashed rounded-xl p-2 sm:p-3 text-[10px] font-mono text-muted-foreground min-h-[44px] flex flex-wrap gap-1">
                    {note.childNoteIds?.length ? note.childNoteIds.map(id => (
                      <span key={id} className="bg-muted px-1.5 py-0.5 rounded border border-border/50 text-foreground font-bold truncate max-w-full">{id}</span>
                    )) : 'NO_CHILDREN'}
                  </div>
                </div>
                <div>
                  <label className="block text-[10px] sm:text-xs font-black text-muted-foreground/70 uppercase mb-1 sm:mb-2 tracking-widest">Origin Path</label>
                  <div className="w-full bg-background/30 border border-border rounded-xl p-2 sm:p-3 text-[10px] font-mono font-bold text-primary truncate">
                    {note.originPath || 'LOCAL_ONLY'}
                  </div>
                </div>
              </div>
            </section>

            {/* C. 노트 버전 */}
            <section className="bg-transparent sm:bg-muted/10 border-0 sm:border border-border/50 rounded-none sm:rounded-3xl p-0 sm:p-8 pl-4 sm:pl-8 space-y-4 sm:space-y-6 relative overflow-hidden group">
              <div className="absolute top-0 left-0 w-1 h-full bg-primary/50 group-hover:bg-primary transition-colors"></div>
              <h3 className="text-[10px] font-black text-muted-foreground uppercase tracking-[0.3em] flex items-center gap-3">
                <History size={14} className="text-primary" />
                C. 노트 버전
              </h3>
              <div className="space-y-3 text-[10px]">
                <div className="flex flex-col gap-1 py-1.5 border-b border-border/30">
                  <span className="font-black text-muted-foreground/70 uppercase tracking-widest">Last Updated</span>
                  <span className="font-bold font-mono text-foreground">{formatTimestamp(note.lastUpdated)}</span>
                </div>
                <div className="flex flex-col gap-1 py-1.5 border-b border-border/30">
                  <span className="font-black text-muted-foreground/70 uppercase tracking-widest flex items-center gap-1">
                    <Fingerprint size={10} /> Commit SHA
                  </span>
                  <span className="font-mono text-muted-foreground break-all">{note.sha || 'UNCOMMITTED'}</span>
                </div>
                <div className="flex flex-col gap-1 py-1.5 border-b border-border/30">
                  <span className="font-black text-muted-foreground/70 uppercase tracking-widest">Content Hash</span>
                  <span className="font-mono text-muted-foreground break-all">{note.contentHash || 'N/A'}</span>
                </div>
                <div className="flex flex-col gap-1 py-1.5">
                  <span className="font-black text-muted-foreground/70 uppercase tracking-widest">Embedding Hash</span>
                  <span className="font-mono text-muted-foreground break-all">{note.embeddingHash || 'N/A'}</span>
                </div>
              </div>
            </section>
          </div>
        )}

        {/* Content Area */}
        <div className="space-y-6 sm:space-y-8">
          {cSuiteEval && (
            <div className="bg-indigo-500/5 border border-indigo-500/20 rounded-2xl sm:rounded-3xl p-4 sm:p-8 space-y-4 sm:space-y-6 relative overflow-hidden group">
              <div className="absolute top-0 left-0 w-1 h-full bg-indigo-500/50 group-hover:bg-indigo-500 transition-colors"></div>
              <div className="flex justify-between items-center">
                <h3 className="text-[10px] sm:text-[12px] font-black text-indigo-500 uppercase tracking-[0.3em] flex items-center gap-2 sm:gap-3">
                  <Users size={16} />
                  AI C-Suite Evaluation
                </h3>
                <button onClick={() => setCSuiteEval(null)} className="text-xs text-muted-foreground hover:text-foreground">Dismiss</button>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {/* CTO */}
                <div className="bg-background/50 border border-border rounded-xl p-4 space-y-3">
                  <div className="flex items-center gap-2 text-blue-500">
                    <Code2 size={16} />
                    <span className="text-xs font-black uppercase tracking-widest">CTO (기술)</span>
                  </div>
                  <p className="text-xs sm:text-sm text-foreground/90 leading-relaxed">{cSuiteEval.cto}</p>
                </div>

                {/* CMO */}
                <div className="bg-background/50 border border-border rounded-xl p-4 space-y-3">
                  <div className="flex items-center gap-2 text-pink-500">
                    <Megaphone size={16} />
                    <span className="text-xs font-black uppercase tracking-widest">CMO (마케팅)</span>
                  </div>
                  <p className="text-xs sm:text-sm text-foreground/90 leading-relaxed">{cSuiteEval.cmo}</p>
                </div>

                {/* CFO */}
                <div className="bg-background/50 border border-border rounded-xl p-4 space-y-3">
                  <div className="flex items-center gap-2 text-green-500">
                    <DollarSign size={16} />
                    <span className="text-xs font-black uppercase tracking-widest">CFO (재무)</span>
                  </div>
                  <p className="text-xs sm:text-sm text-foreground/90 leading-relaxed">{cSuiteEval.cfo}</p>
                </div>
              </div>

              <div className="bg-indigo-500/10 border border-indigo-500/30 rounded-xl p-4 mt-4 flex items-start gap-3">
                <Sparkles className="text-indigo-500 shrink-0 mt-0.5" size={16} />
                <div>
                  <span className="text-[10px] font-black text-indigo-500 uppercase tracking-widest block mb-1">최종 결의안 (Consensus)</span>
                  <p className="text-sm font-bold text-foreground">{cSuiteEval.consensus}</p>
                </div>
              </div>
            </div>
          )}

          {note.status === 'Conflict' && (
            <div className="bg-destructive/10 border border-destructive/50 rounded-2xl sm:rounded-3xl p-4 sm:p-8 space-y-4 sm:space-y-6 relative overflow-hidden group">
              <div className="absolute top-0 left-0 w-1 h-full bg-destructive/50 group-hover:bg-destructive transition-colors"></div>
              <h3 className="text-[10px] sm:text-[12px] font-black text-destructive uppercase tracking-[0.3em] flex items-center gap-2 sm:gap-3">
                <AlertTriangle size={16} />
                Conflict Detected
              </h3>

              {note.conflictDetails && (
                <div className="mt-4 sm:mt-6 space-y-4">
                  <div className="bg-background/50 border border-border rounded-xl sm:rounded-2xl p-3 sm:p-4">
                    <h4 className="text-xs sm:text-sm font-bold text-foreground mb-2 flex items-center gap-2">
                      <Sparkles size={14} className="text-primary" />
                      분석 요약
                    </h4>
                    <p className="text-xs sm:text-sm text-muted-foreground leading-relaxed">
                      {getCleanSummary(note.conflictDetails.summary)}
                    </p>
                  </div>

                  <div className="space-y-3 sm:space-y-4">
                    {note.conflictDetails.differences.map((diff, idx) => (
                      <div key={idx} className="bg-background/50 border border-border rounded-xl sm:rounded-2xl p-3 sm:p-4 space-y-3">
                        <h5 className="text-[10px] sm:text-xs font-black text-primary uppercase tracking-widest">
                          [차이점 {idx + 1}: {diff.aspect}]
                        </h5>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 sm:gap-4">
                          <div className="space-y-1">
                            <span className="text-[9px] sm:text-[10px] font-black text-muted-foreground uppercase tracking-widest">📝 기획 (Design)</span>
                            <p className="text-xs sm:text-sm text-foreground/90">{diff.design}</p>
                          </div>
                          <div className="space-y-1">
                            <span className="text-[9px] sm:text-[10px] font-black text-muted-foreground uppercase tracking-widest">💻 코드 (Code)</span>
                            <p className="text-xs sm:text-sm text-foreground/90">{diff.code}</p>
                          </div>
                        </div>
                        <div className="pt-2 border-t border-border/50 mt-2">
                          <span className="text-[9px] sm:text-[10px] font-black text-destructive uppercase tracking-widest flex items-center gap-1">
                            <AlertTriangle size={10} /> 영향 (Impact)
                          </span>
                          <p className="text-xs sm:text-sm text-muted-foreground mt-1">{diff.impact}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div className="flex flex-col sm:flex-row gap-3 sm:gap-4">
                <button 
                  onClick={handleResolveConflictWithCode}
                  disabled={isResolvingConflict}
                  className="flex-1 bg-background border border-border hover:border-primary hover:bg-primary/5 p-3 sm:p-4 rounded-xl sm:rounded-2xl transition-all text-left group/btn disabled:opacity-50"
                >
                  <div className="font-bold text-primary text-xs sm:text-sm mb-1 flex items-center gap-2">
                    {isResolvingConflict ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle2 size={14} />}
                    코드가 맞습니다 (설계 업데이트)
                  </div>
                  <div className="text-[10px] sm:text-xs text-muted-foreground">
                    AI가 코드의 내용을 바탕으로 기존 설계 노트를 자동으로 덮어쓰고 업데이트합니다.
                  </div>
                </button>
                <button 
                  onClick={handleResolveConflictWithDesign}
                  disabled={isResolvingConflict}
                  className="flex-1 bg-background border border-border hover:border-amber-500 hover:bg-amber-500/5 p-3 sm:p-4 rounded-xl sm:rounded-2xl transition-all text-left group/btn disabled:opacity-50"
                >
                  <div className="font-bold text-amber-500 text-xs sm:text-sm mb-1 flex items-center gap-2">
                    {isResolvingConflict ? <Loader2 size={14} className="animate-spin" /> : <FileWarning size={14} />}
                    설계가 맞습니다 (수정 가이드 생성)
                  </div>
                  <div className="text-[10px] sm:text-xs text-muted-foreground">
                    AI가 코드를 설계에 맞게 어떻게 수정해야 하는지 구현 보정 가이드(가이드라인)를 생성합니다.
                  </div>
                </button>
              </div>
              
              {conflictResolutionGuide && (
                <div className="mt-4 sm:mt-6 p-4 sm:p-6 bg-background border border-amber-500/30 rounded-xl sm:rounded-2xl">
                  <h4 className="text-[10px] sm:text-xs font-bold text-amber-500 uppercase tracking-widest mb-3 sm:mb-4">구현 보정 가이드</h4>
                  <div className="markdown-body text-xs sm:text-sm">
                    <ReactMarkdown remarkPlugins={[remarkGfm, remarkBreaks]}>{conflictResolutionGuide}</ReactMarkdown>
                  </div>
                </div>
              )}
            </div>
          )}

          <div className="bg-transparent sm:bg-muted/10 border-0 sm:border border-border/50 rounded-none sm:rounded-3xl p-0 sm:p-8 pl-4 sm:pl-8 space-y-3 sm:space-y-6 relative group">
            <div className="absolute top-0 left-0 w-1 h-full bg-amber-500/50 group-hover:bg-amber-500 transition-colors"></div>
            <label className="block text-sm sm:text-base font-bold text-foreground">
              1. {note.noteType === 'Snapshot' ? '기술적 역할' : '비즈니스 요약'}
            </label>
            {isPreview ? (
              <div className="markdown-body text-xs sm:text-sm bg-transparent sm:bg-background/30 border-0 sm:border border-border/30 rounded-none sm:rounded-2xl p-0 sm:p-5 overflow-y-auto">
                <ReactMarkdown remarkPlugins={[remarkGfm, remarkBreaks]}>{note.summary || ''}</ReactMarkdown>
              </div>
            ) : (
              <textarea 
                value={note.summary || ''} 
                onChange={e => updateNote({summary: e.target.value})}
                maxLength={50000}
                className="w-full h-32 bg-background/50 border border-border rounded-xl sm:rounded-2xl p-3 sm:p-5 text-xs sm:text-sm text-foreground/80 focus:ring-2 focus:ring-primary/20 outline-none resize-none leading-relaxed transition-all"
                placeholder={note.noteType === 'Snapshot' ? "AI가 분석한 이 코드 조각의 기술적인 핵심 기능을 정의합니다..." : "이 로직이 최종적으로 달성하려는 목적을 한 문장으로 정의합니다..."}
              />
            )}
          </div>

          <div className="bg-transparent sm:bg-muted/10 border-0 sm:border border-border/50 rounded-none sm:rounded-3xl p-0 sm:p-8 pl-4 sm:pl-8 space-y-3 sm:space-y-6 relative group">
            <div className="absolute top-0 left-0 w-1 h-full bg-blue-500/50 group-hover:bg-blue-500 transition-colors"></div>
            <label className="block text-sm sm:text-base font-bold text-foreground">
              2. {note.noteType === 'Snapshot' ? '기술적 구성 요소' : '비즈니스 구성 요소'}
            </label>
            {isPreview ? (
              <div className="markdown-body text-xs sm:text-sm bg-transparent sm:bg-background/30 border-0 sm:border border-border/30 rounded-none sm:rounded-2xl p-0 sm:p-5 overflow-y-auto custom-scrollbar">
                <ReactMarkdown remarkPlugins={[remarkGfm, remarkBreaks]}>{note.components || ''}</ReactMarkdown>
              </div>
            ) : (
              <textarea 
                value={note.components || ''} 
                onChange={e => updateNote({components: e.target.value})}
                maxLength={50000}
                className="w-full h-48 bg-background/50 border border-border rounded-xl sm:rounded-2xl p-3 sm:p-5 text-xs sm:text-sm text-foreground/80 focus:ring-2 focus:ring-primary/20 outline-none resize-none leading-relaxed transition-all custom-scrollbar"
                placeholder={note.noteType === 'Snapshot' ? "실제 코드에 존재하는 물리적 부품들을 나열합니다 (라이브러리, 변수, 함수 등)..." : "이 로직에서 다루는 주요 개념적 단위들을 나열합니다..."}
              />
            )}
          </div>

          <div className="bg-transparent sm:bg-muted/10 border-0 sm:border border-border/50 rounded-none sm:rounded-3xl p-0 sm:p-8 pl-4 sm:pl-8 space-y-3 sm:space-y-6 relative group">
            <div className="absolute top-0 left-0 w-1 h-full bg-green-500/50 group-hover:bg-green-500 transition-colors"></div>
            <label className="block text-sm sm:text-base font-bold text-foreground">
              3. {note.noteType === 'Snapshot' ? '데이터/실행 흐름' : '논리적 흐름'}
            </label>
            {isPreview ? (
              <div className="markdown-body text-xs sm:text-sm bg-transparent sm:bg-background/30 border-0 sm:border border-border/30 rounded-none sm:rounded-2xl p-0 sm:p-5 overflow-y-auto custom-scrollbar">
                <ReactMarkdown remarkPlugins={[remarkGfm, remarkBreaks]}>{note.flow || ''}</ReactMarkdown>
              </div>
            ) : (
              <textarea 
                value={note.flow || ''} 
                onChange={e => updateNote({flow: e.target.value})}
                maxLength={50000}
                className="w-full h-64 bg-background/50 border border-border rounded-xl sm:rounded-2xl p-3 sm:p-5 text-xs sm:text-sm text-foreground/80 focus:ring-2 focus:ring-primary/20 outline-none resize-none leading-relaxed transition-all custom-scrollbar"
                placeholder={note.noteType === 'Snapshot' ? "코드의 실제 실행 순서와 데이터가 변하는 과정을 기록합니다..." : "코드가 아닌 '사람의 행동/의사결정' 순서로 설명합니다..."}
              />
            )}
          </div>

          <div className="bg-transparent sm:bg-muted/10 border-0 sm:border border-border/50 rounded-none sm:rounded-3xl p-0 sm:p-8 pl-4 sm:pl-8 space-y-3 sm:space-y-6 relative group">
            <div className="absolute top-0 left-0 w-1 h-full bg-purple-500/50 group-hover:bg-purple-500 transition-colors"></div>
            <label className="block text-sm sm:text-base font-bold text-foreground">
              4. {note.noteType === 'Snapshot' ? '기술적 입출력' : '비즈니스 입출력'}
            </label>
            {isPreview ? (
              <div className="markdown-body text-xs sm:text-sm bg-transparent sm:bg-background/30 border-0 sm:border border-border/30 rounded-none sm:rounded-2xl p-0 sm:p-5 overflow-y-auto custom-scrollbar">
                <ReactMarkdown remarkPlugins={[remarkGfm, remarkBreaks]}>{note.io || ''}</ReactMarkdown>
              </div>
            ) : (
              <textarea 
                value={note.io || ''} 
                onChange={e => updateNote({io: e.target.value})}
                maxLength={50000}
                className="w-full h-32 bg-background/50 border border-border rounded-xl sm:rounded-2xl p-3 sm:p-5 text-xs sm:text-sm text-foreground/80 focus:ring-2 focus:ring-primary/20 outline-none resize-none leading-relaxed transition-all custom-scrollbar"
                placeholder={note.noteType === 'Snapshot' ? "입력(Parameters)과 출력(Returns)을 명시합니다..." : "입력(Input)과 출력(Output)을 명시합니다..."}
              />
            )}
          </div>
          </div>
        </div>
      </div>
    </div>
  );
};
