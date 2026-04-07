import React, { useState, useEffect } from 'react';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { CoFounderProvider } from './contexts/CoFounderContext';
import { Sidebar } from './components/Sidebar';
import { NoteEditor } from './components/NoteEditor';
import { GitHubSync } from './components/GitHubSync';
import { DashboardView } from './components/DashboardView';
import { 
  LogOut, 
  PanelLeftClose, 
  PanelLeftOpen, 
  PanelRightClose, 
  PanelRightOpen, 
  Moon, 
  Sun,
  Github,
  FolderGit2,
  Folder,
  Layers,
  LayoutDashboard,
  FileEdit
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { Note, OperationType, LensType } from './types';
import { handleFirestoreError } from './lib/utils';
import * as dbManager from './services/dbManager';
import { syncNotes } from './services/syncManager';

function MainApp() {
  const { user, loading: authLoading } = useAuth();
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [selectedNoteId, setSelectedNoteId] = useState<string | null>(null);
  const [isLeftOpen, setIsLeftOpen] = useState(false);
  const [isRightOpen, setIsRightOpen] = useState(false);
  const [viewMode, setViewMode] = useState<'editor' | 'dashboard'>('dashboard');
  const [activeLens, setActiveLens] = useState<LensType>('Feature');

  const toggleLeftSidebar = (open: boolean) => {
    setIsLeftOpen(open);
    if (open && typeof window !== 'undefined' && window.innerWidth < 640) {
      setIsRightOpen(false);
    }
  };

  const toggleRightSidebar = (open: boolean) => {
    setIsRightOpen(open);
    if (open && typeof window !== 'undefined' && window.innerWidth < 640) {
      setIsLeftOpen(false);
    }
  };

  const [projectNotes, setProjectNotes] = useState<Note[]>([]);
  const [leftWidth, setLeftWidth] = useState(256); // Default w-64
  const [rightWidth, setRightWidth] = useState(384); // Default w-96
  const [isResizingLeft, setIsResizingLeft] = useState(false);
  const [isResizingRight, setIsResizingRight] = useState(false);
  const [theme, setTheme] = useState<'light' | 'dark'>(() => {
    if (typeof window !== 'undefined') {
      return localStorage.getItem('theme') as 'light' | 'dark' || 'dark';
    }
    return 'dark';
  });

  const loadNotes = async () => {
    if (!selectedProjectId) {
      setProjectNotes([]);
      return;
    }
    const allNotes = await dbManager.getAllNotes();
    const filteredNotes = allNotes.filter(n => n.projectId === selectedProjectId);
    setProjectNotes(filteredNotes);
  };

  useEffect(() => {
    loadNotes();

    if (user && selectedProjectId) {
      // Trigger background sync (local only now)
      syncNotes(selectedProjectId, (updatedNotes) => {
        setProjectNotes(updatedNotes);
      }, user.uid).catch(err => {
        console.error("Background sync failed:", err);
      });
    }
  }, [user, selectedProjectId]);

  useEffect(() => {
    const root = window.document.documentElement;
    if (theme === 'dark') {
      root.classList.add('dark');
    } else {
      root.classList.remove('dark');
    }
    localStorage.setItem('theme', theme);
  }, [theme]);

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (isResizingLeft) {
        const newWidth = e.clientX;
        if (newWidth > 160 && newWidth < 480) {
          setLeftWidth(newWidth);
        }
      }
      if (isResizingRight) {
        const newWidth = window.innerWidth - e.clientX;
        if (newWidth > 240 && newWidth < 600) {
          setRightWidth(newWidth);
        }
      }
    };

    const handleMouseUp = () => {
      setIsResizingLeft(false);
      setIsResizingRight(false);
      document.body.style.cursor = 'default';
    };

    if (isResizingLeft || isResizingRight) {
      window.addEventListener('mousemove', handleMouseMove);
      window.addEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = 'col-resize';
    }

    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isResizingLeft, isResizingRight]);

  const toggleTheme = () => {
    setTheme(prev => prev === 'light' ? 'dark' : 'light');
  };

  if (authLoading) {
    return <div className="h-screen flex items-center justify-center bg-background text-foreground">Loading...</div>;
  }

  if (!user) {
    return (
      <div className="h-screen flex items-center justify-center bg-background text-foreground p-4">
        <div className="bg-card p-8 rounded-2xl shadow-xl border border-border text-center max-w-md w-full glass">
          <div className="w-16 h-16 bg-primary/10 rounded-2xl flex items-center justify-center mx-auto mb-6 glow-primary">
            <div className="w-8 h-8 bg-primary rounded-lg"></div>
          </div>
          <h1 className="text-4xl font-bold mb-3 tracking-tight">Compose</h1>
          <p className="text-muted-foreground mb-10 text-lg">Vibe coding blueprint & sync for solo developers.</p>
          <p className="text-sm text-muted-foreground">Initializing local environment...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-screen bg-background text-foreground font-sans selection:bg-primary/30 selection:text-primary-foreground">
      {/* Left Sidebar */}
      <motion.div 
        animate={{ width: isLeftOpen ? (typeof window !== 'undefined' && window.innerWidth < 640 ? '100%' : leftWidth) : 0 }}
        transition={{ type: 'spring', damping: 25, stiffness: 200 }}
        className="fixed top-16 bottom-0 left-0 sm:relative sm:top-0 flex border-r border-border bg-secondary/30 group/sidebar z-40 shadow-2xl sm:shadow-none overflow-hidden"
      >
        <div style={{ width: typeof window !== 'undefined' && window.innerWidth < 640 ? '100%' : leftWidth }} className="h-full flex flex-col">
          <Sidebar 
            onSelectNote={(id) => {
              setSelectedNoteId(id);
              if (window.innerWidth < 640) toggleLeftSidebar(false);
            }} 
            selectedNoteId={selectedNoteId} 
            onClose={() => toggleLeftSidebar(false)} 
            selectedProjectId={selectedProjectId}
            onSelectProject={(id) => {
              setSelectedProjectId(id);
            }}
            onNotesChanged={loadNotes}
            notes={projectNotes}
            activeLens={activeLens}
            setActiveLens={setActiveLens}
          />
          {/* Left Resizer Handle */}
          <div 
            className="hidden sm:flex absolute top-0 -right-1 w-2 h-full cursor-col-resize hover:bg-primary/40 transition-colors z-50 items-center justify-center"
            onMouseDown={(e) => {
              e.preventDefault();
              setIsResizingLeft(true);
            }}
          >
            <div className={`w-[1px] h-full ${isResizingLeft ? 'bg-primary' : 'bg-transparent'}`} />
          </div>
        </div>
      </motion.div>

      {/* Main Content */}
      <main className="flex-1 flex flex-col overflow-hidden">
        <header className="h-16 border-b border-border bg-card/50 backdrop-blur-md flex items-center justify-between px-4 sm:px-6 sticky top-0 z-50">
          <div className="flex items-center gap-2 sm:gap-4">
            {/* Sidebar Toggle */}
            <button 
              onClick={() => toggleLeftSidebar(!isLeftOpen)}
              className="p-2 text-muted-foreground hover:bg-muted rounded-xl transition-all active:scale-95"
            >
              {isLeftOpen ? <PanelLeftClose size={20} className="text-primary" /> : <PanelLeftOpen size={20} />}
            </button>

            <div className="flex items-center gap-2 sm:gap-3">
              <div className="hidden xs:block">
                <h1 className="text-sm sm:text-lg font-black tracking-tighter uppercase italic leading-none">Composer</h1>
                <span className="text-[8px] sm:text-[10px] font-bold text-muted-foreground/60 tracking-[0.2em] uppercase">System Engine</span>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-1 sm:gap-4">
            <div className="flex items-center gap-1 sm:gap-3 sm:pr-4">
              {/* View Mode Toggle */}
              <div className="hidden sm:flex items-center bg-muted/50 p-1 rounded-xl border border-border">
                <button
                  onClick={() => setViewMode('dashboard')}
                  className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-medium transition-all ${viewMode === 'dashboard' ? 'bg-background shadow-sm text-primary' : 'text-muted-foreground hover:text-foreground'}`}
                >
                  <LayoutDashboard size={16} />
                  Dashboard
                </button>
                <button
                  onClick={() => setViewMode('editor')}
                  className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-medium transition-all ${viewMode === 'editor' ? 'bg-background shadow-sm text-primary' : 'text-muted-foreground hover:text-foreground'}`}
                >
                  <FileEdit size={16} />
                  Editor
                </button>
              </div>

              <button 
                onClick={toggleTheme}
                className="p-2 text-muted-foreground hover:bg-muted rounded-xl transition-all active:scale-95 hidden sm:flex"
                title={theme === 'light' ? 'Switch to Dark' : 'Switch to Light'}
              >
                {theme === 'light' ? <Moon size={18} /> : <Sun size={18} />}
              </button>
              
              <div className="flex items-center gap-2 sm:gap-3 px-1 sm:px-2 py-1.5 hover:bg-muted rounded-2xl transition-all cursor-pointer group">
                <img 
                  src={user.photoURL || `https://ui-avatars.com/api/?name=${user.displayName}`} 
                  alt="Profile" 
                  className="w-8 h-8 sm:w-9 sm:h-9 rounded-xl border-2 border-border group-hover:border-primary transition-all shadow-md"
                  referrerPolicy="no-referrer"
                />
                <div className="text-right hidden lg:block">
                  <p className="text-xs font-bold leading-none group-hover:text-primary transition-colors">{user.displayName || 'Developer'}</p>
                  <p className="text-[10px] text-muted-foreground/60 mt-0.5">Local Mode</p>
                </div>
              </div>
              
              <button 
                onClick={() => toggleRightSidebar(!isRightOpen)}
                className="p-2 text-muted-foreground hover:bg-muted rounded-xl transition-all active:scale-95"
              >
                {isRightOpen ? <PanelRightClose size={20} className="text-primary" /> : <PanelRightOpen size={20} />}
              </button>
            </div>
          </div>
        </header>
        
        <div className="flex-1 overflow-auto p-0 sm:p-8 lg:p-12 bg-muted/5 relative">
          <div className={`${viewMode === 'dashboard' ? 'max-w-none' : 'max-w-6xl'} mx-auto w-full h-full`}>
            <AnimatePresence mode="wait">
              <motion.div 
                key={viewMode === 'dashboard' ? 'dashboard' : 'editor'}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                className="h-full"
              >
                {selectedProjectId ? (
                  viewMode === 'dashboard' ? (
                    <DashboardView 
                      projectId={selectedProjectId}
                      notes={projectNotes} 
                      onSelectNote={(id) => {
                        setSelectedNoteId(id);
                        setViewMode('editor');
                      }} 
                      onNotesChanged={loadNotes}
                      activeLens={activeLens}
                      setActiveLens={setActiveLens}
                    />
                  ) : (
                    <NoteEditor 
                      noteId={selectedNoteId} 
                      projectId={selectedProjectId}
                      onSaved={loadNotes}
                      onDeleted={() => {
                        setSelectedNoteId(null);
                        loadNotes();
                      }}
                    />
                  )
                ) : (
                  <div className="flex h-full flex-col items-center justify-center text-center max-w-md mx-auto">
                    <div className="w-24 h-24 bg-muted rounded-[2.5rem] flex items-center justify-center mb-8 text-muted-foreground/30 shadow-inner">
                      <FolderGit2 size={40} />
                    </div>
                    <h2 className="text-2xl font-bold mb-3 tracking-tight">Initialize Workspace</h2>
                    <p className="text-muted-foreground mb-8 leading-relaxed">Select an existing project from the explorer or create a new one to begin architecting your system.</p>
                  </div>
                )}
              </motion.div>
            </AnimatePresence>
          </div>
        </div>
      </main>

      {/* Right Sidebar */}
      <motion.div 
        animate={{ width: isRightOpen ? (typeof window !== 'undefined' && window.innerWidth < 640 ? '100%' : rightWidth) : 0 }}
        transition={{ type: 'spring', damping: 25, stiffness: 200 }}
        className="fixed top-16 bottom-0 right-0 sm:relative sm:top-0 flex border-l border-border bg-secondary/30 group/sidebar z-40 shadow-2xl sm:shadow-none overflow-hidden"
      >
        <div style={{ width: typeof window !== 'undefined' && window.innerWidth < 640 ? '100%' : rightWidth }} className="h-full flex flex-col">
          <GitHubSync 
            onClose={() => toggleRightSidebar(false)} 
            projectId={selectedProjectId} 
            onSyncComplete={() => {
              loadNotes();
              if (selectedProjectId) {
                syncNotes(selectedProjectId, undefined, user.uid).then(() => loadNotes());
              }
            }} 
            activeLens={activeLens}
            setActiveLens={setActiveLens}
          />
          {/* Right Resizer Handle */}
          <div 
            className="hidden sm:flex absolute top-0 -left-1 w-2 h-full cursor-col-resize hover:bg-primary/40 transition-colors z-50 items-center justify-center"
            onMouseDown={(e) => {
              e.preventDefault();
              setIsResizingRight(true);
            }}
          >
            <div className={`w-[1px] h-full ${isResizingRight ? 'bg-primary' : 'bg-transparent'}`} />
          </div>
        </div>
      </motion.div>

    </div>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <CoFounderProvider>
        <MainApp />
      </CoFounderProvider>
    </AuthProvider>
  );
}
