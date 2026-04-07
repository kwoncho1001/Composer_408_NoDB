import React, { useState } from 'react';
import { Note, CostEstimate, PitchDeck, CompetitorAnalysis, ProactiveNudge, LensType } from '../types';
import { Layers, Blocks, Cpu, Code, AlertCircle, CheckCircle2, CircleDashed, Target, Loader2, X, Receipt, Cloud, Wrench, Zap, Presentation, FileText, Lightbulb, Users, Briefcase, Swords, Crosshair, ShieldAlert, Rocket, PlusCircle, Sparkles, MessageSquarePlus, ChevronRight, LayoutGrid, Map, Network } from 'lucide-react';
import { ArchitectureRefinementModal } from './dashboard/ArchitectureRefinementModal';
import { scopeMVP, estimateProjectCost, generatePitchDeck, analyzeCompetitor, generateInitialBlueprint, generateProactiveNudges, addFeatureBlueprint, refineIdeaWithSparring, generateDetailedBlueprint, refineBlueprintDraft } from '../services/gemini';
import * as dbManager from '../services/dbManager';
import { saveNoteToSync } from '../services/syncManager';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkBreaks from 'remark-breaks';
import { motion, AnimatePresence } from 'motion/react';
import { BentoView } from './dashboard/BentoView';
import { useCoFounder } from '../contexts/CoFounderContext';
import { JourneyView } from './dashboard/JourneyView';
import { GalaxyView } from './dashboard/GalaxyView';
import { BlueprintView } from './dashboard/BlueprintView';

interface DashboardViewProps {
  projectId: string;
  notes: Note[];
  onSelectNote: (id: string) => void;
  onNotesChanged?: () => void;
  activeLens: LensType;
  setActiveLens: (lens: LensType) => void;
}

export const DashboardView: React.FC<DashboardViewProps> = ({ projectId, notes, onSelectNote, onNotesChanged, activeLens, setActiveLens }) => {
  const [showScopingModal, setShowScopingModal] = useState(false);
  const [scopingConstraint, setScopingConstraint] = useState('');
  const [isScoping, setIsScoping] = useState(false);
  
  const [showCostModal, setShowCostModal] = useState(false);
  const [isEstimatingCost, setIsEstimatingCost] = useState(false);
  const [costEstimate, setCostEstimate] = useState<CostEstimate | null>(null);

  const [showPitchModal, setShowPitchModal] = useState(false);
  const [isGeneratingPitch, setIsGeneratingPitch] = useState(false);
  const [pitchDeck, setPitchDeck] = useState<PitchDeck | null>(null);

  const [showCompetitorModal, setShowCompetitorModal] = useState(false);
  const [isAnalyzingCompetitor, setIsAnalyzingCompetitor] = useState(false);
  const [competitorName, setCompetitorName] = useState('');
  const [competitorAnalysis, setCompetitorAnalysis] = useState<CompetitorAnalysis | null>(null);

  const [magicIdea, setMagicIdea] = useState('');
  const [isGeneratingMagic, setIsGeneratingMagic] = useState(false);

  const [activeView, setActiveView] = useState<'bento' | 'journey' | 'galaxy' | 'blueprint'>('bento');

  // Refinement Modal State
  const [showRefinementModal, setShowRefinementModal] = useState(false);
  const [draftBlueprint, setDraftBlueprint] = useState<any>(null);
  const [refiningNudge, setRefiningNudge] = useState<ProactiveNudge | null>(null);
  const [isRefiningBlueprint, setIsRefiningBlueprint] = useState(false);
  const [isFinalizingBlueprint, setIsFinalizingBlueprint] = useState(false);
  const [generationProgressMsg, setGenerationProgressMsg] = useState('');

  const {
    nudges, setNudges,
    pastNudges, setPastNudges,
    loadingNudgeTypes, setLoadingNudgeTypes,
    isFetchingNudges, setIsFetchingNudges,
    isCoFounderOpen, setIsCoFounderOpen,
    applyingNudgeId, setApplyingNudgeId
  } = useCoFounder();

  const handleOpenCoFounder = async () => {
    setIsCoFounderOpen(true);
    if (nudges.length === 0 && notes.length > 0) {
      setIsFetchingNudges(true);
      try {
        const [involutionNudges, evolutionNudges] = await Promise.all([
          generateProactiveNudges(notes, pastNudges, 'Involution'),
          generateProactiveNudges(notes, pastNudges, 'Evolution')
        ]);
        setNudges([...involutionNudges, ...evolutionNudges]);
      } catch (e) {
        console.error(e);
      } finally {
        setIsFetchingNudges(false);
      }
    }
  };

  const handleRerollAllNudges = async () => {
    setIsFetchingNudges(true);
    setNudges([]);
    try {
      const [involutionNudges, evolutionNudges] = await Promise.all([
        generateProactiveNudges(notes, pastNudges, 'Involution'),
        generateProactiveNudges(notes, pastNudges, 'Evolution')
      ]);
      setNudges([...involutionNudges, ...evolutionNudges]);
    } catch (e) {
      console.error(e);
    } finally {
      setIsFetchingNudges(false);
    }
  };

  // Fetch nudges automatically when entering Bento view if empty
  React.useEffect(() => {
    // Removed automatic nudge generation
  }, [activeView, notes.length]);

  const handleRejectNudge = async (nudgeId: string) => {
    const rejectedNudge = nudges.find(n => n.id === nudgeId);
    if (!rejectedNudge) return;

    const newPastNudges = [...pastNudges, rejectedNudge.question].slice(-20);
    setPastNudges(newPastNudges);

    setNudges(prev => prev.filter(n => n.id !== nudgeId));
    setLoadingNudgeTypes(prev => [...prev, rejectedNudge.nudgeType]);

    try {
      const result = await generateProactiveNudges(notes, newPastNudges, rejectedNudge.track, rejectedNudge.nudgeType);
      if (result && result.length > 0) {
        setNudges(prev => [...prev, result[0]]);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoadingNudgeTypes(prev => {
        const idx = prev.indexOf(rejectedNudge.nudgeType);
        if (idx > -1) {
          const next = [...prev];
          next.splice(idx, 1);
          return next;
        }
        return prev;
      });
    }
  };

  const handleSparringSubmit = async (nudge: ProactiveNudge, response: string) => {
    setApplyingNudgeId(nudge.id);
    try {
      const blueprint = await refineIdeaWithSparring(notes, nudge, response);
      if (blueprint && blueprint.domains && blueprint.domains.length > 0) {
        setDraftBlueprint(blueprint);
        setRefiningNudge(nudge);
        setShowRefinementModal(true);
      }
    } catch (error) {
      console.error("Failed to refine idea with sparring:", error);
      alert("아이디어 구체화에 실패했습니다. 다시 시도해주세요.");
    } finally {
      setApplyingNudgeId(null);
    }
  };

  const handleAcceptNudge = async (nudge: ProactiveNudge) => {
    setApplyingNudgeId(nudge.id);
    try {
      const blueprint = await addFeatureBlueprint(nudge, notes);
      if (blueprint && blueprint.domains && blueprint.domains.length > 0) {
        setDraftBlueprint(blueprint);
        setRefiningNudge(nudge);
        setShowRefinementModal(true);
      }
    } catch (error) {
      console.error("Failed to generate blueprint:", error);
      alert("설계도 생성에 실패했습니다.");
    } finally {
      setApplyingNudgeId(null);
    }
  };

  const handleRefineBlueprint = async (feedback: string) => {
    if (!draftBlueprint) return;
    setIsRefiningBlueprint(true);
    try {
      const refined = await refineBlueprintDraft(draftBlueprint, feedback);
      setDraftBlueprint(refined);
    } catch (error) {
      console.error("Failed to refine blueprint:", error);
      alert("설계 수정에 실패했습니다.");
    } finally {
      setIsRefiningBlueprint(false);
    }
  };

  const handleFinalizeBlueprint = async (finalBlueprint: any) => {
    setIsFinalizingBlueprint(true);
    setGenerationProgressMsg('아키텍처 상세화 시작...');
    try {
      const detailed = await generateDetailedBlueprint(finalBlueprint, (msg) => {
        setGenerationProgressMsg(msg);
      });

      const newNotes: Note[] = [];
      for (const domain of detailed.domains) {
        const domainId = crypto.randomUUID();
        const domainChildIds: string[] = [];
        
        if (domain.modules) {
          for (const mod of domain.modules) {
            const moduleId = crypto.randomUUID();
            const moduleChildIds: string[] = [];
            domainChildIds.push(moduleId);

            if (mod.logics) {
              for (const logic of mod.logics) {
                const logicId = crypto.randomUUID();
                moduleChildIds.push(logicId);
                
                newNotes.push({
                  id: logicId,
                  projectId,
                  title: logic.title,
                  content: logic.content || '',
                  noteType: 'Logic',
                  parentNoteIds: [moduleId],
                  childNoteIds: [],
                  summary: logic.summary,
                  status: 'Planned',
                  priority: 'P3',
                  createdAt: Date.now(),
                  updatedAt: Date.now()
                } as any);
              }
            }

            newNotes.push({
              id: moduleId,
              projectId,
              title: mod.title,
              content: mod.content || '',
              noteType: 'Module',
              parentNoteIds: [domainId],
              childNoteIds: moduleChildIds,
              summary: mod.summary,
              status: 'Planned',
              priority: 'P3',
              createdAt: Date.now(),
              updatedAt: Date.now()
            } as any);
          }
        }

        newNotes.push({
          id: domainId,
          projectId,
          title: domain.title,
          content: domain.content || '',
          noteType: 'Domain',
          parentNoteIds: [],
          childNoteIds: domainChildIds,
          summary: domain.summary,
          status: 'Planned',
          priority: 'P3',
          createdAt: Date.now(),
          updatedAt: Date.now()
        } as any);
      }

      await dbManager.bulkSaveNotes(newNotes);
      if (onNotesChanged) onNotesChanged();
      
      // Remove nudge after success
      if (refiningNudge) {
        setNudges(prev => prev.filter(n => n.id !== refiningNudge.id));
      }
      setShowRefinementModal(false);
      setDraftBlueprint(null);
      setRefiningNudge(null);
    } catch (error) {
      console.error("Failed to finalize blueprint:", error);
      alert("최종 적용에 실패했습니다.");
    } finally {
      setIsFinalizingBlueprint(false);
      setGenerationProgressMsg('');
    }
  };

  const handleMagicStart = async () => {
    if (!magicIdea.trim()) return;
    setIsGeneratingMagic(true);
    try {
      const blueprint = await generateInitialBlueprint(magicIdea.trim());
      if (blueprint && blueprint.domains && blueprint.domains.length > 0) {
        setDraftBlueprint(blueprint);
        setRefiningNudge(null);
        setShowRefinementModal(true);
        setMagicIdea('');
      }
    } catch (error) {
      console.error("Magic Start failed:", error);
      alert("초기 기획 생성에 실패했습니다: " + (error as Error).message);
    } finally {
      setIsGeneratingMagic(false);
    }
  };

  const getNotesByType = (type: string) => {
    return notes.filter(n => n.noteType === type);
  };

  const domains = getNotesByType('Domain');
  const modules = getNotesByType('Module');
  const logics = getNotesByType('Logic');
  const snapshots = getNotesByType('Snapshot');

  const columns = [
    { title: 'Domain', icon: Layers, items: domains },
    { title: 'Module', icon: Blocks, items: modules },
    { title: 'Logic', icon: Cpu, items: logics },
    { title: 'Snapshot', icon: Code, items: snapshots },
  ];

  const getStatusConfig = (status: string) => {
    switch (status) {
      case 'Done':
        return { color: 'text-emerald-500', bg: 'bg-emerald-500/10', border: 'border-emerald-500/20', icon: CheckCircle2 };
      case 'Conflict':
        return { color: 'text-rose-500', bg: 'bg-rose-500/10', border: 'border-rose-500/20', icon: AlertCircle };
      case 'Planned':
      default:
        return { color: 'text-slate-500', bg: 'bg-slate-500/10', border: 'border-slate-500/20', icon: CircleDashed };
    }
  };

  const getPriorityColor = (priority: string) => {
    switch (priority) {
      case 'P1': return 'text-rose-500 bg-rose-500/10 border-rose-500/20';
      case 'P2': return 'text-amber-500 bg-amber-500/10 border-amber-500/20';
      case 'P3': return 'text-slate-500 bg-slate-500/10 border-slate-500/20';
      default: return 'text-muted-foreground/60 bg-muted border-transparent';
    }
  };

  const handleScopeMVP = async () => {
    if (!scopingConstraint.trim()) return;
    setIsScoping(true);
    try {
      const targetNotes = [...modules, ...logics];
      const scopingResult = await scopeMVP(targetNotes, scopingConstraint);
      
      const updatedNotes = [];
      for (const result of scopingResult) {
        const note = targetNotes.find(n => n.id === result.id);
        if (note) {
          const updatedNote = { ...note, priority: result.priority as any };
          updatedNotes.push(updatedNote);
          await saveNoteToSync(updatedNote);
        }
      }
      
      setShowScopingModal(false);
      setScopingConstraint('');
      if (onNotesChanged) onNotesChanged();
    } catch (error) {
      console.error("Failed to scope MVP:", error);
      alert("MVP 스코핑에 실패했습니다: " + (error as Error).message);
    } finally {
      setIsScoping(false);
    }
  };

  const handleEstimateCost = async () => {
    setIsEstimatingCost(true);
    setShowCostModal(true);
    try {
      const targetNotes = [...modules, ...logics].filter(n => n.priority === 'P1' || n.priority === 'P2');
      const estimate = await estimateProjectCost(targetNotes);
      setCostEstimate(estimate);
    } catch (error) {
      console.error("Failed to estimate cost:", error);
      alert("비용 추정에 실패했습니다: " + (error as Error).message);
      setShowCostModal(false);
    } finally {
      setIsEstimatingCost(false);
    }
  };

  const handleGeneratePitch = async () => {
    setIsGeneratingPitch(true);
    setShowPitchModal(true);
    try {
      const targetNotes = notes.filter(n => n.noteType !== 'Snapshot');
      const pitch = await generatePitchDeck(targetNotes);
      setPitchDeck(pitch);
    } catch (error) {
      console.error("Failed to generate pitch deck:", error);
      alert("피치덱 생성에 실패했습니다: " + (error as Error).message);
      setShowPitchModal(false);
    } finally {
      setIsGeneratingPitch(false);
    }
  };

  const handleAnalyzeCompetitor = async () => {
    if (!competitorName.trim()) return;
    setIsAnalyzingCompetitor(true);
    try {
      const analysis = await analyzeCompetitor(competitorName, notes);
      setCompetitorAnalysis(analysis);
    } catch (error) {
      console.error("Failed to analyze competitor:", error);
      alert("경쟁사 분석에 실패했습니다: " + (error as Error).message);
    } finally {
      setIsAnalyzingCompetitor(false);
    }
  };

  const handleActionOpen = (action: string) => {
    if (action === 'pitch') setShowPitchModal(true);
    if (action === 'competitor') setShowCompetitorModal(true);
    if (action === 'mvp') setShowScopingModal(true);
    if (action === 'cost') setShowCostModal(true);
  };

  if (notes.length === 0) {
    return (
      <div className="h-full flex flex-col items-center justify-center p-8 relative overflow-hidden">
        {/* Background decorations */}
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[800px] h-[800px] bg-primary/5 rounded-full blur-3xl -z-10"></div>
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[400px] h-[400px] bg-purple-500/5 rounded-full blur-2xl -z-10"></div>

        <div className="max-w-2xl w-full text-center space-y-8 animate-in fade-in slide-in-from-bottom-8 duration-700">
          <div className="space-y-4">
            <div className="w-20 h-20 bg-primary/10 rounded-3xl flex items-center justify-center mx-auto mb-6 glow-primary shadow-2xl shadow-primary/20">
              <Sparkles size={40} className="text-primary" />
            </div>
            <h2 className="text-4xl sm:text-5xl font-black tracking-tighter">
              어떤 비즈니스를 만들고 싶으신가요?
            </h2>
            <p className="text-lg text-muted-foreground leading-relaxed max-w-xl mx-auto">
              한 줄만 입력하세요. AI 코파운더가 Pitch Deck부터 핵심 로직까지<br />
              당신의 비즈니스 청사진을 완벽하게 설계해 드립니다.
            </p>
          </div>

          <div className="relative group max-w-xl mx-auto mt-12">
            <div className="absolute -inset-1 bg-gradient-to-r from-primary via-purple-500 to-rose-500 rounded-2xl blur opacity-25 group-hover:opacity-50 transition duration-1000 group-hover:duration-200"></div>
            <div className="relative flex items-center bg-card border border-border rounded-2xl shadow-2xl overflow-hidden focus-within:ring-2 focus-within:ring-primary/50 transition-all">
              <input
                type="text"
                value={magicIdea}
                onChange={(e) => setMagicIdea(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleMagicStart();
                }}
                placeholder="예: 동네 빵집의 남은 빵을 마감 할인으로 판매하는 플랫폼"
                className="flex-1 bg-transparent px-6 py-5 text-lg outline-none placeholder:text-muted-foreground/50"
                disabled={isGeneratingMagic}
                autoFocus
              />
              <button
                onClick={handleMagicStart}
                disabled={isGeneratingMagic || !magicIdea.trim()}
                className="bg-primary text-primary-foreground px-8 py-5 font-bold text-lg hover:bg-primary/90 transition-colors disabled:opacity-50 flex items-center gap-2"
              >
                {isGeneratingMagic ? (
                  <>
                    <Loader2 size={24} className="animate-spin" />
                    설계 중...
                  </>
                ) : (
                  <>
                    <Rocket size={24} />
                    시작하기
                  </>
                )}
              </button>
            </div>
          </div>

          <div className="pt-12 flex items-center justify-center gap-2 text-sm text-muted-foreground">
            <span className="w-12 h-[1px] bg-border"></span>
            <span>또는 이미 진행 중인 프로젝트가 있다면</span>
            <span className="w-12 h-[1px] bg-border"></span>
          </div>
          
          <p className="text-sm text-muted-foreground">
            우측 패널에서 <strong className="text-foreground">GitHub Sync</strong>를 연결하여 코드를 동기화하세요.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col relative bg-background">
      <div className="mb-4 md:mb-6 flex flex-col md:flex-row md:items-center justify-between px-4 md:px-6 pt-4 md:pt-6 gap-4">
        <div>
          <h2 className="text-xl md:text-2xl font-black tracking-tight">Business Command Center</h2>
          <p className="text-muted-foreground text-xs md:text-sm mt-1">Strategic overview of your system architecture and implementation status.</p>
        </div>
        <div className="flex gap-1 md:gap-2 bg-muted/50 p-1 rounded-xl border border-border overflow-x-auto hide-scrollbar">
          <button 
            onClick={() => setActiveView('bento')}
            className={`px-3 md:px-4 py-2 rounded-lg text-xs md:text-sm font-bold flex items-center gap-1.5 md:gap-2 transition-all whitespace-nowrap ${activeView === 'bento' ? 'bg-background shadow-sm text-foreground' : 'text-muted-foreground hover:text-foreground'}`}
          >
            <LayoutGrid size={16} /> Executive
          </button>
          <button 
            onClick={() => setActiveView('journey')}
            className={`px-3 md:px-4 py-2 rounded-lg text-xs md:text-sm font-bold flex items-center gap-1.5 md:gap-2 transition-all whitespace-nowrap ${activeView === 'journey' ? 'bg-background shadow-sm text-foreground' : 'text-muted-foreground hover:text-foreground'}`}
          >
            <Map size={16} /> Journey
          </button>
          <button 
            onClick={() => setActiveView('galaxy')}
            className={`px-3 md:px-4 py-2 rounded-lg text-xs md:text-sm font-bold flex items-center gap-1.5 md:gap-2 transition-all whitespace-nowrap ${activeView === 'galaxy' ? 'bg-background shadow-sm text-foreground' : 'text-muted-foreground hover:text-foreground'}`}
          >
            <Network size={16} /> Galaxy
          </button>
          <button 
            onClick={() => setActiveView('blueprint')}
            className={`px-3 md:px-4 py-2 rounded-lg text-xs md:text-sm font-bold flex items-center gap-1.5 md:gap-2 transition-all whitespace-nowrap ${activeView === 'blueprint' ? 'bg-background shadow-sm text-foreground' : 'text-muted-foreground hover:text-foreground'}`}
          >
            <Layers size={16} /> Blueprint
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-hidden relative">
        {activeView === 'bento' && (
          <BentoView 
            notes={notes} 
            onAcceptNudge={handleAcceptNudge} 
            onSparringSubmit={handleSparringSubmit}
            onRejectNudge={handleRejectNudge}
            onRerollAllNudges={handleRerollAllNudges}
            onOpenAction={handleActionOpen}
          />
        )}
        {activeView === 'journey' && (
          <JourneyView notes={notes} onSelectNote={onSelectNote} />
        )}
        {activeView === 'galaxy' && (
          <div className="h-full p-4 md:p-6 flex flex-col">
            <div className="flex justify-center mb-4">
              <div className="flex gap-1 bg-muted/50 p-1 rounded-xl border border-border">
                <button 
                  onClick={() => setActiveLens('Feature')}
                  className={`px-4 py-2 rounded-lg text-xs font-bold flex items-center gap-2 transition-all ${activeLens === 'Feature' ? 'bg-background shadow-sm text-foreground' : 'text-muted-foreground hover:text-foreground'}`}
                >
                  🎯 기능(UX)
                </button>
              </div>
            </div>
            <div className="flex-1">
              <GalaxyView notes={notes} projectName="My Project" onSelectNote={onSelectNote} activeLens={activeLens} />
            </div>
          </div>
        )}
        {activeView === 'blueprint' && (
          <BlueprintView notes={notes} onSelectNote={onSelectNote} />
        )}
      </div>

      <ArchitectureRefinementModal
        isOpen={showRefinementModal}
        onClose={() => setShowRefinementModal(false)}
        blueprint={draftBlueprint}
        onRefine={handleRefineBlueprint}
        onFinalize={handleFinalizeBlueprint}
        isRefining={isRefiningBlueprint}
        isFinalizing={isFinalizingBlueprint}
        progressMessage={generationProgressMsg}
      />

      {showScopingModal && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm">
          <div className="bg-card border border-border rounded-2xl shadow-xl w-full max-w-md p-6 relative">
            <button 
              onClick={() => setShowScopingModal(false)}
              className="absolute top-4 right-4 text-muted-foreground hover:text-foreground"
            >
              <X size={20} />
            </button>
            <h3 className="text-lg font-bold mb-2 flex items-center gap-2">
              <Target size={20} className="text-primary" />
              Dynamic MVP Scoping
            </h3>
            <p className="text-sm text-muted-foreground mb-4">
              비즈니스 제약 조건이나 목표를 입력하세요. AI가 현재 기획된 모듈과 로직의 우선순위(P1, P2, P3)를 자동으로 재조정합니다.
            </p>
            <textarea
              value={scopingConstraint}
              onChange={(e) => setScopingConstraint(e.target.value)}
              placeholder="예: 이번 주말까지 핵심 결제와 로그인 기능만 런칭해야 해."
              className="w-full h-32 bg-background border border-border rounded-xl p-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 resize-none mb-4"
            />
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setShowScopingModal(false)}
                className="px-4 py-2 rounded-xl text-sm font-medium hover:bg-muted transition-colors"
                disabled={isScoping}
              >
                취소
              </button>
              <button
                onClick={handleScopeMVP}
                disabled={isScoping || !scopingConstraint.trim()}
                className="flex items-center gap-2 bg-primary text-primary-foreground px-4 py-2 rounded-xl text-sm font-bold hover:bg-primary/90 transition-colors disabled:opacity-50"
              >
                {isScoping ? <Loader2 size={16} className="animate-spin" /> : <Target size={16} />}
                스코핑 실행
              </button>
            </div>
          </div>
        </div>
      )}

      {showCostModal && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm p-4">
          <div className="bg-card border border-border rounded-2xl shadow-xl w-full max-w-2xl p-6 relative max-h-[90vh] overflow-y-auto custom-scrollbar">
            <button 
              onClick={() => setShowCostModal(false)}
              className="absolute top-4 right-4 text-muted-foreground hover:text-foreground"
            >
              <X size={20} />
            </button>
            <h3 className="text-lg font-bold mb-2 flex items-center gap-2 text-emerald-500">
              <Receipt size={20} />
              Code-to-Cost (Burn Rate Estimator)
            </h3>
            <p className="text-sm text-muted-foreground mb-6">
              현재 기획된 P1, P2 핵심 기능들을 바탕으로 초기 1개월간의 예상 인프라 및 API 유지 비용을 추정합니다.
            </p>

            {isEstimatingCost ? (
              <div className="flex flex-col items-center justify-center py-12 space-y-4">
                <Loader2 size={32} className="animate-spin text-emerald-500" />
                <p className="text-sm font-medium text-muted-foreground animate-pulse">CFO가 클라우드 비용을 계산 중입니다...</p>
              </div>
            ) : costEstimate ? (
              <div className="space-y-6">
                <div className="bg-emerald-500/10 border border-emerald-500/20 rounded-xl p-6 text-center">
                  <span className="text-xs font-black text-emerald-500 uppercase tracking-widest block mb-2">예상 월간 비용 (Total Monthly Cost)</span>
                  <div className="text-3xl font-black text-foreground">{costEstimate.totalMonthlyCost}</div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="bg-background border border-border rounded-xl p-4 space-y-3">
                    <div className="flex items-center gap-2 text-blue-500">
                      <Cloud size={16} />
                      <span className="text-xs font-black uppercase tracking-widest">인프라 (Infrastructure)</span>
                    </div>
                    <p className="text-sm text-foreground/90 leading-relaxed">{costEstimate.infrastructure}</p>
                  </div>

                  <div className="bg-background border border-border rounded-xl p-4 space-y-3">
                    <div className="flex items-center gap-2 text-purple-500">
                      <Zap size={16} />
                      <span className="text-xs font-black uppercase tracking-widest">외부 API (3rd Party APIs)</span>
                    </div>
                    <p className="text-sm text-foreground/90 leading-relaxed">{costEstimate.thirdPartyApis}</p>
                  </div>

                  <div className="bg-background border border-border rounded-xl p-4 space-y-3 md:col-span-2">
                    <div className="flex items-center gap-2 text-amber-500">
                      <Wrench size={16} />
                      <span className="text-xs font-black uppercase tracking-widest">유지보수 (Maintenance & Hidden Costs)</span>
                    </div>
                    <p className="text-sm text-foreground/90 leading-relaxed">{costEstimate.maintenance}</p>
                  </div>
                </div>

                <div className="bg-muted/50 border border-border rounded-xl p-4 flex items-start gap-3">
                  <div className="bg-background p-2 rounded-lg border border-border shrink-0">
                    <Receipt size={16} className="text-foreground" />
                  </div>
                  <div>
                    <span className="text-[10px] font-black text-muted-foreground uppercase tracking-widest block mb-1">CFO's Advice</span>
                    <p className="text-sm font-bold text-foreground leading-relaxed">{costEstimate.summary}</p>
                  </div>
                </div>
              </div>
            ) : null}
          </div>
        </div>
      )}

      {showPitchModal && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm p-4">
          <div className="bg-card border border-border rounded-2xl shadow-xl w-full max-w-4xl p-6 relative max-h-[90vh] overflow-y-auto custom-scrollbar">
            <button 
              onClick={() => setShowPitchModal(false)}
              className="absolute top-4 right-4 text-muted-foreground hover:text-foreground"
            >
              <X size={20} />
            </button>
            <h3 className="text-lg font-bold mb-2 flex items-center gap-2 text-purple-500">
              <Presentation size={20} />
              PR/FAQ & Pitch Deck
            </h3>
            <p className="text-sm text-muted-foreground mb-6">
              아마존의 Working Backwards 방법론을 적용하여, 코드를 짜기 전에 제품의 시장 가치를 증명하는 보도자료와 피치덱을 생성합니다.
            </p>

            {isGeneratingPitch ? (
              <div className="flex flex-col items-center justify-center py-12 space-y-4">
                <Loader2 size={32} className="animate-spin text-purple-500" />
                <p className="text-sm font-medium text-muted-foreground animate-pulse">실리콘밸리 VC 파트너가 피치덱을 작성 중입니다...</p>
              </div>
            ) : pitchDeck ? (
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {/* Left Column: PR */}
                <div className="space-y-6">
                  <div className="bg-purple-500/5 border border-purple-500/20 rounded-xl p-6 h-full">
                    <div className="flex items-center gap-2 text-purple-500 mb-4">
                      <FileText size={18} />
                      <h4 className="font-black uppercase tracking-widest text-sm">Press Release (보도자료)</h4>
                    </div>
                    <div className="markdown-body text-sm bg-background/50 p-4 rounded-lg border border-border/50 h-[calc(100%-2rem)] overflow-y-auto custom-scrollbar">
                      <ReactMarkdown remarkPlugins={[remarkGfm, remarkBreaks]}>{pitchDeck.pressRelease}</ReactMarkdown>
                    </div>
                  </div>
                </div>

                {/* Right Column: Pitch Deck */}
                <div className="space-y-4">
                  <div className="bg-background border border-border rounded-xl p-5 space-y-2 relative overflow-hidden group">
                    <div className="absolute top-0 left-0 w-1 h-full bg-blue-500/50 group-hover:bg-blue-500 transition-colors"></div>
                    <div className="flex items-center gap-2 text-blue-500 mb-2">
                      <Lightbulb size={16} />
                      <span className="text-xs font-black uppercase tracking-widest">Elevator Pitch</span>
                    </div>
                    <p className="text-sm text-foreground/90 leading-relaxed font-medium">{pitchDeck.elevatorPitch}</p>
                  </div>

                  <div className="bg-background border border-border rounded-xl p-5 space-y-2 relative overflow-hidden group">
                    <div className="absolute top-0 left-0 w-1 h-full bg-rose-500/50 group-hover:bg-rose-500 transition-colors"></div>
                    <div className="flex items-center gap-2 text-rose-500 mb-2">
                      <Target size={16} />
                      <span className="text-xs font-black uppercase tracking-widest">Problem & Solution</span>
                    </div>
                    <p className="text-sm text-foreground/90 leading-relaxed">{pitchDeck.problemAndSolution}</p>
                  </div>

                  <div className="bg-background border border-border rounded-xl p-5 space-y-2 relative overflow-hidden group">
                    <div className="absolute top-0 left-0 w-1 h-full bg-amber-500/50 group-hover:bg-amber-500 transition-colors"></div>
                    <div className="flex items-center gap-2 text-amber-500 mb-2">
                      <Users size={16} />
                      <span className="text-xs font-black uppercase tracking-widest">Target Audience</span>
                    </div>
                    <p className="text-sm text-foreground/90 leading-relaxed">{pitchDeck.targetAudience}</p>
                  </div>

                  <div className="bg-background border border-border rounded-xl p-5 space-y-2 relative overflow-hidden group">
                    <div className="absolute top-0 left-0 w-1 h-full bg-emerald-500/50 group-hover:bg-emerald-500 transition-colors"></div>
                    <div className="flex items-center gap-2 text-emerald-500 mb-2">
                      <Briefcase size={16} />
                      <span className="text-xs font-black uppercase tracking-widest">Business Model</span>
                    </div>
                    <p className="text-sm text-foreground/90 leading-relaxed">{pitchDeck.businessModel}</p>
                  </div>
                </div>
              </div>
            ) : null}
          </div>
        </div>
      )}

      {showCompetitorModal && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm p-4">
          <div className="bg-card border border-border rounded-2xl shadow-xl w-full max-w-3xl p-6 relative max-h-[90vh] overflow-y-auto custom-scrollbar">
            <button 
              onClick={() => setShowCompetitorModal(false)}
              className="absolute top-4 right-4 text-muted-foreground hover:text-foreground"
            >
              <X size={20} />
            </button>
            <h3 className="text-lg font-bold mb-2 flex items-center gap-2 text-rose-500">
              <Swords size={20} />
              Competitor Teardown (경쟁사 역설계)
            </h3>
            <p className="text-sm text-muted-foreground mb-6">
              경쟁사의 핵심 로직과 치명적인 약점을 분석하여, 우리 프로덕트가 취해야 할 블루오션 전략을 도출합니다.
            </p>

            <div className="flex gap-2 mb-6">
              <input
                type="text"
                value={competitorName}
                onChange={(e) => setCompetitorName(e.target.value)}
                placeholder="경쟁사 이름 또는 서비스명 (예: Notion, Slack, 배달의민족)"
                className="flex-1 bg-background border border-border rounded-xl p-3 text-sm focus:outline-none focus:ring-2 focus:ring-rose-500/50"
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleAnalyzeCompetitor();
                }}
              />
              <button
                onClick={handleAnalyzeCompetitor}
                disabled={isAnalyzingCompetitor || !competitorName.trim()}
                className="bg-rose-500 text-white px-6 py-3 rounded-xl text-sm font-bold hover:bg-rose-600 transition-colors disabled:opacity-50 flex items-center gap-2 shrink-0"
              >
                {isAnalyzingCompetitor ? <Loader2 size={16} className="animate-spin" /> : <Crosshair size={16} />}
                분석 시작
              </button>
            </div>

            {isAnalyzingCompetitor ? (
              <div className="flex flex-col items-center justify-center py-12 space-y-4">
                <Loader2 size={32} className="animate-spin text-rose-500" />
                <p className="text-sm font-medium text-muted-foreground animate-pulse">경쟁사({competitorName})의 아키텍처를 리버스 엔지니어링 중입니다...</p>
              </div>
            ) : competitorAnalysis ? (
              <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {/* Core Mechanics */}
                  <div className="bg-background border border-border rounded-xl p-5 space-y-3 relative overflow-hidden group">
                    <div className="absolute top-0 left-0 w-1 h-full bg-slate-500/50 group-hover:bg-slate-500 transition-colors"></div>
                    <div className="flex items-center gap-2 text-slate-500">
                      <Cpu size={18} />
                      <span className="text-xs font-black uppercase tracking-widest">핵심 동작 원리 (Core Mechanics)</span>
                    </div>
                    <p className="text-sm text-foreground/90 leading-relaxed">{competitorAnalysis.coreMechanics}</p>
                  </div>

                  {/* Weaknesses */}
                  <div className="bg-rose-500/5 border border-rose-500/20 rounded-xl p-5 space-y-3 relative overflow-hidden group">
                    <div className="absolute top-0 left-0 w-1 h-full bg-rose-500/50 group-hover:bg-rose-500 transition-colors"></div>
                    <div className="flex items-center gap-2 text-rose-500">
                      <ShieldAlert size={18} />
                      <span className="text-xs font-black uppercase tracking-widest">치명적 약점 (Weaknesses)</span>
                    </div>
                    <p className="text-sm text-foreground/90 leading-relaxed">{competitorAnalysis.weaknesses}</p>
                  </div>
                </div>

                {/* Blue Ocean Strategy */}
                <div className="bg-blue-500/10 border border-blue-500/30 rounded-xl p-6 text-center space-y-4">
                  <div className="flex items-center justify-center gap-2 text-blue-500">
                    <Rocket size={24} />
                    <span className="text-sm font-black uppercase tracking-widest">우리의 블루오션 전략 (Blue Ocean Strategy)</span>
                  </div>
                  <p className="text-lg font-bold text-foreground leading-relaxed">{competitorAnalysis.blueOceanStrategy}</p>
                </div>

                {/* Actionable Logics */}
                <div className="space-y-3">
                  <h4 className="text-xs font-black text-muted-foreground uppercase tracking-widest flex items-center gap-2 ml-1">
                    <PlusCircle size={14} />
                    즉시 추가해야 할 차별화 로직
                  </h4>
                  <div className="grid grid-cols-1 gap-3">
                    {competitorAnalysis.actionableLogics.map((logic, idx) => (
                      <div key={idx} className="bg-background border border-border rounded-lg p-4 flex gap-3 items-start">
                        <div className="bg-primary/10 text-primary w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold shrink-0 mt-0.5">
                          {idx + 1}
                        </div>
                        <p className="text-sm text-foreground/90 leading-relaxed">{logic}</p>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            ) : null}
          </div>
        </div>
      )}

    </div>
  );
};
