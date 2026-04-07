import React, { useEffect, useState, useRef } from 'react';
import { collection, onSnapshot, query, where, deleteDoc, doc, addDoc, serverTimestamp, getDocs, writeBatch } from 'firebase/firestore';
import { db, auth } from '../firebase';
import { useAuth } from '../contexts/AuthContext';
import { Note, Project, OperationType, LensType } from '../types';
import { handleFirestoreError } from '../lib/utils';
import { Folder, FileText, Plus, CheckSquare, Trash2, PanelLeftClose, ChevronDown, Check, FolderGit2, Circle, CheckCircle2, RefreshCw, Sparkles, FoldVertical, UnfoldVertical } from 'lucide-react';
import * as dbManager from '../services/dbManager';
import { generateInitialBlueprint } from '../services/gemini';

export const Sidebar = ({ 
  onSelectNote, 
  selectedNoteId, 
  onClose,
  selectedProjectId,
  onSelectProject,
  onNotesChanged,
  notes,
  activeLens,
  setActiveLens
}: { 
  onSelectNote: (id: string) => void, 
  selectedNoteId: string | null, 
  onClose: () => void,
  selectedProjectId: string | null,
  onSelectProject: (id: string | null) => void,
  onNotesChanged?: () => void,
  notes: Note[],
  activeLens: LensType,
  setActiveLens: (lens: LensType) => void
}) => {
  const { user } = useAuth();
  const [projects, setProjects] = useState<Project[]>([]);
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [confirmDelete, setConfirmDelete] = useState(false);
  
  const [isProjectMenuOpen, setIsProjectMenuOpen] = useState(false);
  const [isCreatingProject, setIsCreatingProject] = useState(false);
  const [isDeletingProject, setIsDeletingProject] = useState(false);
  const [projectToDeleteId, setProjectToDeleteId] = useState<string | null>(null);
  const [newProjectName, setNewProjectName] = useState('');
  const [collapsedIds, setCollapsedIds] = useState<string[]>([]);

  const handleCollapseAll = () => {
    const allNoteIds = notes.map(n => n.id);
    const allPaths = Array.from(new Set(notes.filter(n => n.noteType === 'Snapshot' && n.originPath).map(n => `folder:${n.originPath}`)));
    setCollapsedIds([...allNoteIds, ...allPaths]);
  };

  const handleExpandAll = () => {
    setCollapsedIds([]);
  };

  const subtreeStatusMap = React.useMemo(() => {
    const statusMap: Record<string, 'Done' | 'Conflict' | 'Planned'> = {};
    
    const calculateStatus = (id: string): 'Done' | 'Conflict' | 'Planned' => {
      if (statusMap[id]) return statusMap[id];
      
      const note = notes.find(n => n.id === id);
      if (!note) return 'Planned';

      const children = notes.filter(n => n.parentNoteIds.includes(id));
      
      let hasConflict = note.status === 'Conflict';
      let allDone = note.status === 'Done';

      for (const child of children) {
        const childStatus = calculateStatus(child.id);
        if (childStatus === 'Conflict') hasConflict = true;
        if (childStatus !== 'Done') allDone = false;
      }

      const result = hasConflict ? 'Conflict' : (allDone ? 'Done' : 'Planned');
      statusMap[id] = result;
      return result;
    };

    notes.forEach(n => {
      if (n.parentNoteIds.length === 0) {
        calculateStatus(n.id);
      }
    });

    // Ensure all notes are calculated even if orphaned
    notes.forEach(n => calculateStatus(n.id));

    return statusMap;
  }, [notes]);

  const onSelectProjectRef = useRef(onSelectProject);
  const selectedProjectIdRef = useRef(selectedProjectId);

  useEffect(() => {
    onSelectProjectRef.current = onSelectProject;
    selectedProjectIdRef.current = selectedProjectId;
  }, [onSelectProject, selectedProjectId]);

  useEffect(() => {
    if (!auth || !user || !db) {
      // Local-only mode: fetch projects from IndexedDB
      const loadLocalProjects = async () => {
        const localProjects = await dbManager.getAllProjects();
        setProjects(localProjects);
        if (localProjects.length > 0 && !selectedProjectIdRef.current) {
          onSelectProjectRef.current(localProjects[0].id);
        }
      };
      loadLocalProjects();
      return;
    }
    const q = query(collection(db, 'projects'), where('uid', '==', user.uid));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const fetchedProjects = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Project));
      setProjects(fetchedProjects);
      if (fetchedProjects.length > 0 && !selectedProjectIdRef.current) {
        onSelectProjectRef.current(fetchedProjects[0].id);
      } else if (fetchedProjects.length === 0) {
        onSelectProjectRef.current(null);
      }
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, 'projects');
    });
    return () => unsubscribe();
  }, [user?.uid]);

  const handleCreateProject = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newProjectName.trim() || !user) return;
    
    setIsCreatingProject(true);
    try {
      const projectId = crypto.randomUUID();
      const newProject = {
        id: projectId,
        name: newProjectName.trim(),
        repoUrl: '',
        uid: user.uid,
        createdAt: new Date().toISOString()
      };

      if (db) {
        await addDoc(collection(db, 'projects'), {
          ...newProject,
          createdAt: serverTimestamp()
        });
      }
      
      // Always save locally
      await dbManager.saveProject(newProject);

      onSelectProject(projectId);
      setIsCreatingProject(false);
      setNewProjectName('');
      setIsProjectMenuOpen(false);
      
      // Trigger local refresh if in local mode
      if (!db) {
        const localProjects = await dbManager.getAllProjects();
        setProjects(localProjects);
      }
    } catch (error) {
      if (db) handleFirestoreError(error, OperationType.CREATE, 'projects');
      else console.error("Error creating local project", error);
      setIsCreatingProject(false);
    }
  };

  const executeDeleteProject = async (projectId: string) => {
    if (!user) return;
    setIsDeletingProject(true);

    try {
      if (db) {
        // 1. Delete all notes for this project (Remote)
        const notesQuery = query(
          collection(db, 'notes'), 
          where('uid', '==', user.uid),
          where('projectId', '==', projectId)
        );
        const notesSnap = await getDocs(notesQuery);
        
        let batch = writeBatch(db);
        let count = 0;
        for (const d of notesSnap.docs) {
          batch.delete(doc(db, 'notes', d.id));
          count++;
          if (count >= 450) {
            await batch.commit();
            batch = writeBatch(db);
            count = 0;
          }
        }
        if (count > 0) await batch.commit();
      }

      // Delete all notes for this project (Local)
      const allLocalNotes = await dbManager.getAllNotes();
      const localNotesToDelete = allLocalNotes.filter(n => n.projectId === projectId).map(n => n.id);
      if (localNotesToDelete.length > 0) {
        await dbManager.bulkDeleteNotes(localNotesToDelete);
      }

      if (db) {
        // 2. Delete sync ledger
        const ledgerQuery = query(
          collection(db, 'syncLedgers'), 
          where('uid', '==', user.uid),
          where('projectId', '==', projectId)
        );
        const ledgerSnap = await getDocs(ledgerQuery);
        for (const d of ledgerSnap.docs) {
          await deleteDoc(doc(db, 'syncLedgers', d.id));
        }

        // Delete sync_manifests
        await deleteDoc(doc(db, 'sync_manifests', projectId));

        // 3. Delete project (Remote)
        await deleteDoc(doc(db, 'projects', projectId));
      }

      // Delete project (Local)
      await dbManager.deleteProject(projectId);

      if (selectedProjectId === projectId) {
        onSelectProject(null);
        onSelectNote('new');
      }
      setIsProjectMenuOpen(false);
      setProjectToDeleteId(null);
      
      // Refresh local projects
      const localProjects = await dbManager.getAllProjects();
      setProjects(localProjects);
    } catch (error) {
      if (db) handleFirestoreError(error, OperationType.DELETE, `projects/${projectId}`);
      else console.error("Error deleting local project", error);
    } finally {
      setIsDeletingProject(false);
    }
  };

  const handleBulkDelete = async () => {
    if (selectedIds.length === 0) return;

    try {
      await dbManager.bulkDeleteNotes(selectedIds);
      if (selectedNoteId && selectedIds.includes(selectedNoteId)) {
        onSelectNote('new');
      }
      setSelectedIds([]);
      setSelectionMode(false);
      setConfirmDelete(false);
      if (onNotesChanged) onNotesChanged();
    } catch (error) {
      console.error("Error bulk deleting notes", error);
    }
  };

  const handleSelectAll = () => {
    if (notes.length === 0) return;
    if (selectedIds.length === notes.length) {
      setSelectedIds([]);
    } else {
      setSelectedIds(notes.map(n => n.id));
    }
  };

  const getAllDescendantIds = (parentId: string): string[] => {
    let descendants: string[] = [];
    const children = notes.filter(n => n.parentNoteIds.includes(parentId));
    for (const child of children) {
      descendants.push(child.id);
      descendants = descendants.concat(getAllDescendantIds(child.id));
    }
    return descendants;
  };

  const renderItem = (item: Note) => {
    const isSelected = selectedIds.includes(item.id);
    const isActive = selectedNoteId === item.id && !selectionMode;
    const isFolder = item.noteType !== 'Snapshot';
    const isCollapsed = collapsedIds.includes(item.id);
    const status = subtreeStatusMap[item.id] || 'Planned';
    
    const getStatusColor = () => {
      if (status === 'Conflict') return 'text-destructive';
      if (status === 'Done') return 'text-green-500';
      return isActive ? 'text-primary' : 'text-muted-foreground/70';
    };

    return (
      <div 
        className={`group flex items-center gap-2 p-3 sm:p-2 rounded-xl cursor-pointer transition-all duration-200 border border-transparent ${
          isActive 
            ? 'bg-primary/10 shadow-lg shadow-primary/5 border-primary/20' 
            : 'hover:bg-muted/50 hover:border-border/50'
        } ${getStatusColor()}`}
        onClick={(e) => {
          if (selectionMode) {
            const isCurrentlySelected = selectedIds.includes(item.id);
            const descendantIds = getAllDescendantIds(item.id);
            const idsToToggle = [item.id, ...descendantIds];

            if (isCurrentlySelected) {
              // Deselect item and all its descendants
              setSelectedIds(prev => prev.filter(id => !idsToToggle.includes(id)));
            } else {
              // Select item and all its descendants
              setSelectedIds(prev => Array.from(new Set([...prev, ...idsToToggle])));
            }
          } else {
            onSelectNote(item.id);
          }
        }}
      >
        {selectionMode && (
          <input 
            type="checkbox" 
            checked={isSelected} 
            readOnly
            className="w-3.5 h-3.5 rounded border-border bg-background text-primary focus:ring-primary transition-all"
          />
        )}
        
        <div className="flex items-center gap-1">
          {isFolder && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                setCollapsedIds(prev => 
                  isCollapsed ? prev.filter(id => id !== item.id) : [...prev, item.id]
                );
              }}
              className="p-0.5 hover:bg-accent rounded-md transition-colors text-inherit opacity-50 hover:opacity-100"
            >
              <ChevronDown size={10} className={`transition-transform duration-200 ${isCollapsed ? '-rotate-90' : ''}`} />
            </button>
          )}

          {status === 'Done' ? (
            <CheckCircle2 size={12} className="shrink-0" />
          ) : (
            <Circle size={12} className="shrink-0 opacity-40" />
          )}
        </div>

        <div className="flex flex-col min-w-0 flex-1">
          <span className="text-[11px] font-bold truncate tracking-tight uppercase leading-none">{item.title || 'UNTITLED_NODE'}</span>
        </div>
        {isActive && <div className="w-1 h-1 rounded-full bg-primary glow-primary animate-pulse" />}
      </div>
    );
  };

  const renderSnapshotTree = () => {
    // Find all Snapshot notes that have an originPath
    const snapshotNotes = notes.filter(n => n.noteType === 'Snapshot' && n.originPath);
    
    // Group by originPath
    const pathGroups: Record<string, Note[]> = {};
    snapshotNotes.forEach(snap => {
      const path = snap.originPath!;
      if (!pathGroups[path]) pathGroups[path] = [];
      pathGroups[path].push(snap);
    });

    const sortedPaths = Object.keys(pathGroups).sort();

    return sortedPaths.map(path => {
      const isCollapsed = collapsedIds.includes(`folder:${path}`);
      const snapsInPath = pathGroups[path];
      
      // Find unique parent notes for these snapshots
      const parentIds = Array.from(new Set(snapsInPath.flatMap(s => s.parentNoteIds)));
      const parentNotes = notes.filter(n => parentIds.includes(n.id));
      const orphanSnaps = snapsInPath.filter(s => !s.parentNoteIds.some(pid => parentNotes.some(l => l.id === pid)));

      return (
        <div key={`folder:${path}`} className="mt-1">
          <div 
            className="group flex items-center gap-2 p-3 sm:p-2 rounded-xl cursor-pointer hover:bg-muted/50 transition-all text-muted-foreground"
            onClick={() => {
              setCollapsedIds(prev => 
                isCollapsed ? prev.filter(id => id !== `folder:${path}`) : [...prev, `folder:${path}`]
              );
            }}
          >
            <ChevronDown size={12} className={`transition-transform duration-200 ${isCollapsed ? '-rotate-90' : ''}`} />
            <FolderGit2 size={14} className="text-primary/70" />
            <span className="text-[11px] font-bold truncate tracking-tight">{path}</span>
          </div>
          
          {!isCollapsed && (
            <div className="mt-1">
              {parentNotes.map(parentNode => {
                const isNodeCollapsed = collapsedIds.includes(parentNode.id);
                // Only show snapshots that belong to this path AND this parent note
                const childSnaps = snapsInPath.filter(s => s.parentNoteIds.includes(parentNode.id) && s.originPath === path);
                
                return (
                  <div key={parentNode.id} className="ml-4 border-l border-border/30 pl-2 mt-1">
                    {renderItem(parentNode)}
                    {!isNodeCollapsed && (
                      <div className="mt-1">
                        {childSnaps.map(snap => (
                          <div key={snap.id} className="ml-4 border-l border-border/30 pl-2 mt-1">
                            {renderItem(snap)}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
              {orphanSnaps.filter(s => s.originPath === path).map(snap => (
                <div key={snap.id} className="ml-4 border-l border-border/30 pl-2 mt-1">
                  {renderItem(snap)}
                </div>
              ))}
            </div>
          )}
        </div>
      );
    });
  };

  const renderTree = (parentId: string | null) => {
    const lensNoteIds = new Set(notes.filter(n => {
      if (n.lens) return n.lens === activeLens;
      // Fallback for notes without lens property
      if (activeLens === 'Feature') return n.noteType !== 'Snapshot';
      if (activeLens === 'Snapshot') return n.noteType === 'Snapshot';
      return false;
    }).map(n => n.id));

    // 1. Get all notes that belong to this parent
    const children = notes.filter(n => {
      if (parentId === null) {
        // Root level:
        if (activeLens === 'Snapshot') {
          return false; // Snapshot lens root is handled by renderSnapshotTree
        }
        
        // For Domain/Module, only show if it matches the active lens and has no parent in the same lens
        if (n.noteType === 'Domain' || n.noteType === 'Module') {
          const matchesLens = n.lens ? n.lens === activeLens : activeLens === 'Feature';
          if (!matchesLens) return false;
          return !n.parentNoteIds.some(pid => lensNoteIds.has(pid));
        }
        
        // For Logic/Snapshot, show if it has no parent in the active lens
        return !n.parentNoteIds.some(pid => lensNoteIds.has(pid));
      }
      // For children, show all notes that have this parent
      return n.parentNoteIds.includes(parentId);
    });

    // Sort by noteType to keep Domain -> Module -> Logic -> Snapshot order
    const typeOrder: Record<string, number> = { 'Domain': 0, 'Module': 1, 'Logic': 2, 'Snapshot': 3 };
    children.sort((a, b) => typeOrder[a.noteType] - typeOrder[b.noteType] || a.title.localeCompare(b.title));

    return children.map(item => {
      const isCollapsed = collapsedIds.includes(item.id);
      return (
        <div key={item.id} className={parentId === null ? "mt-1" : "ml-4 border-l border-border/30 pl-2 mt-1"}>
          {renderItem(item)}
          {!isCollapsed && (
            <div className="mt-1">
              {renderTree(item.id)}
            </div>
          )}
        </div>
      );
    });
  };

  const selectedProject = projects.find(p => p.id === selectedProjectId);

  return (
    <div className="w-full bg-card h-full flex flex-col relative border-r border-border">
      {/* Project Selector Header */}
      <div className="p-5 border-b border-border flex flex-col gap-3 bg-card/80 backdrop-blur-sm z-10">
        <div className="flex justify-between items-center w-full">
          <div className="relative flex-1 flex items-center gap-2">
            <button 
              onClick={() => setIsProjectMenuOpen(!isProjectMenuOpen)}
              className="flex items-center gap-2.5 font-bold text-foreground hover:bg-accent p-2 rounded-xl flex-1 text-left transition-all"
            >
            <div className="w-8 h-8 bg-primary/10 rounded-lg flex items-center justify-center text-primary glow-primary">
              <FolderGit2 size={18} />
            </div>
            <span className="truncate flex-1 text-sm tracking-tight">{selectedProject ? selectedProject.name : 'Select Project'}</span>
            <ChevronDown size={16} className="text-muted-foreground" />
          </button>
          
          
          {isProjectMenuOpen && (
            <div className="absolute top-full left-0 w-full mt-2 bg-popover border border-border shadow-2xl rounded-2xl overflow-hidden z-50 glass">
              {projectToDeleteId ? (
                <div className="p-4 space-y-4 animate-in fade-in zoom-in-95 duration-200">
                  <p className="text-[10px] font-black text-foreground text-center leading-relaxed uppercase tracking-wider">
                    Delete project and all notes?<br/>
                    <span className="text-destructive">This cannot be undone.</span>
                  </p>
                  <div className="flex gap-2">
                    <button 
                      onClick={() => executeDeleteProject(projectToDeleteId)}
                      disabled={isDeletingProject}
                      className="flex-1 bg-destructive text-destructive-foreground text-[10px] font-black uppercase py-2.5 rounded-xl shadow-lg shadow-destructive/20 active:scale-95 transition-all disabled:opacity-50 flex items-center justify-center gap-2"
                    >
                      {isDeletingProject ? (
                        <>
                          <RefreshCw size={12} className="animate-spin" />
                          Deleting...
                        </>
                      ) : 'Delete'}
                    </button>
                    <button 
                      onClick={() => setProjectToDeleteId(null)}
                      disabled={isDeletingProject}
                      className="flex-1 bg-muted text-muted-foreground text-[10px] font-black uppercase py-2.5 rounded-xl active:scale-95 transition-all disabled:opacity-50"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  <div className="max-h-60 overflow-y-auto p-1">
                    {projects.map(p => (
                      <div key={p.id} className="group/project relative">
                        <button
                          onClick={() => {
                            onSelectProject(p.id);
                            setIsProjectMenuOpen(false);
                            setIsCreatingProject(false);
                          }}
                          className={`w-full text-left px-4 py-2.5 text-sm rounded-xl flex items-center justify-between transition-colors ${
                            p.id === selectedProjectId ? 'bg-primary/10 text-primary font-semibold' : 'hover:bg-accent text-muted-foreground hover:text-foreground'
                          }`}
                        >
                          <span className="truncate pr-6">{p.name}</span>
                          {p.id === selectedProjectId && <Check size={14} />}
                        </button>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setProjectToDeleteId(p.id);
                          }}
                          className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 text-muted-foreground/20 group-hover/project:text-destructive hover:bg-destructive/10 rounded-lg transition-all"
                          title="Delete Project"
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    ))}
                  </div>
                  <div className="border-t border-border p-3 bg-muted/30">
                    {isCreatingProject ? (
                      <form onSubmit={handleCreateProject} className="flex flex-col gap-3">
                        <div className="space-y-2">
                          <input
                            type="text"
                            placeholder="Project Name (e.g., Local Bakery App)"
                            value={newProjectName}
                            onChange={e => setNewProjectName(e.target.value)}
                            className="w-full px-3 py-2 text-sm bg-background border border-border rounded-xl focus:ring-2 focus:ring-primary/20 outline-none"
                            autoFocus
                          />
                        </div>
                        <div className="flex gap-2">
                          <button 
                            type="submit" 
                            disabled={!newProjectName.trim()}
                            className="flex-1 bg-primary text-primary-foreground text-xs font-bold py-2 rounded-xl shadow-lg shadow-primary/20 disabled:opacity-50 flex items-center justify-center gap-1"
                          >
                            <Plus size={12} />
                            Create Project
                          </button>
                          <button 
                            type="button" 
                            onClick={() => setIsCreatingProject(false)} 
                            className="flex-1 bg-secondary text-secondary-foreground text-xs font-bold py-2 rounded-xl disabled:opacity-50"
                          >
                            Cancel
                          </button>
                        </div>
                      </form>
                    ) : (
                      <button
                        onClick={() => setIsCreatingProject(true)}
                        className="w-full text-left px-3 py-2 text-sm text-primary font-semibold hover:bg-primary/5 rounded-xl flex items-center gap-2 transition-colors"
                      >
                        <Plus size={16} /> New Project
                      </button>
                    )}
                  </div>
                </>
              )}
            </div>
          )}
        </div>
        <button onClick={onClose} className="hidden sm:flex p-2 hover:bg-accent rounded-xl text-muted-foreground ml-2 transition-colors" title="Close Sidebar">
          <PanelLeftClose size={18} />
        </button>
        </div>

        {/* Lens Switcher */}
        {selectedProjectId && (
          <div className="flex bg-muted/50 p-1 rounded-xl border border-border w-full">
            <button
              onClick={() => setActiveLens('Feature')}
              className={`flex-1 py-1.5 text-[10px] font-bold rounded-lg transition-all ${activeLens === 'Feature' ? 'bg-background shadow-sm text-primary' : 'text-muted-foreground hover:text-foreground'}`}
            >
              🎯 Feature
            </button>
            <button
              onClick={() => setActiveLens('Snapshot')}
              className={`flex-1 py-1.5 text-[10px] font-bold rounded-lg transition-all ${activeLens === 'Snapshot' ? 'bg-background shadow-sm text-primary' : 'text-muted-foreground hover:text-foreground'}`}
            >
              📸 Snap
            </button>
          </div>
        )}
      </div>

      {/* Action Bar */}
      <div className="px-5 py-3 border-b border-border flex justify-end items-center bg-muted/20">
        <div className="flex gap-1.5">
          <button 
            onClick={handleExpandAll} 
            className="p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground rounded-lg transition-all" 
            title="Expand All"
            disabled={!selectedProjectId}
          >
            <UnfoldVertical size={16} className={!selectedProjectId ? 'opacity-30' : ''} />
          </button>
          <button 
            onClick={handleCollapseAll} 
            className="p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground rounded-lg transition-all" 
            title="Collapse All"
            disabled={!selectedProjectId}
          >
            <FoldVertical size={16} className={!selectedProjectId ? 'opacity-30' : ''} />
          </button>
          <div className="w-px h-4 bg-border mx-1 self-center" />
          <button 
            onClick={() => { setSelectionMode(!selectionMode); setSelectedIds([]); setConfirmDelete(false); }} 
            className={`p-1.5 rounded-lg transition-all ${selectionMode ? 'bg-primary text-primary-foreground shadow-lg shadow-primary/20' : 'text-muted-foreground hover:bg-accent hover:text-foreground'}`}
            title="Select Multiple"
            disabled={!selectedProjectId}
          >
            <CheckSquare size={16} className={!selectedProjectId ? 'opacity-30' : ''} />
          </button>
          <button 
            onClick={() => onSelectNote('new')} 
            className="p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground rounded-lg transition-all" 
            title="New Note"
            disabled={!selectedProjectId}
          >
            <Plus size={18} className={!selectedProjectId ? 'opacity-30' : ''} />
          </button>
        </div>
      </div>
      
      {selectionMode && (
        <div className="p-3 bg-primary/5 flex justify-between items-center text-xs border-b border-primary/20 animate-in slide-in-from-top duration-200">
          <div className="flex items-center gap-2">
            <button 
              onClick={handleSelectAll}
              className="p-1 hover:bg-primary/20 rounded text-primary transition-colors flex items-center justify-center"
              title={selectedIds.length === notes.length && notes.length > 0 ? "Deselect All" : "Select All"}
            >
              <CheckSquare size={14} className={selectedIds.length === notes.length && notes.length > 0 ? "fill-primary/20" : "opacity-50"} />
            </button>
            <span className="font-bold text-primary">{selectedIds.length} selected</span>
          </div>
          {selectedIds.length > 0 && (
            <button 
              onClick={() => {
                if (confirmDelete) handleBulkDelete();
                else setConfirmDelete(true);
              }} 
              className="bg-destructive text-destructive-foreground px-2 py-1 rounded-md font-bold flex items-center gap-1 shadow-lg shadow-destructive/20"
            >
              <Trash2 size={12} /> {confirmDelete ? 'Confirm?' : 'Delete'}
            </button>
          )}
        </div>
      )}

      <div className="p-3 flex-1 overflow-y-auto custom-scrollbar">
        {!selectedProjectId ? (
          <div className="text-sm text-muted-foreground p-8 text-center opacity-50 italic">Select or create a project to view notes.</div>
        ) : notes.length === 0 ? (
          <div className="text-sm text-muted-foreground p-8 text-center opacity-50 italic">No notes yet. Create one!</div>
        ) : (
          <div className="space-y-1">
            {activeLens === 'Snapshot' ? renderSnapshotTree() : renderTree(null)}
          </div>
        )}
      </div>

      {!db && (
        <div className="p-3 border-t border-border bg-primary/5 text-[10px] font-bold text-primary flex items-center justify-center gap-2">
          <Circle size={8} className="fill-primary animate-pulse" />
          LOCAL-ONLY MODE (NO CLOUD SYNC)
        </div>
      )}
    </div>
  );
};
