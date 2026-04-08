import React, { useState, useEffect } from 'react';
import { Note, CostEstimate, PitchDeck, CompetitorAnalysis, ProactiveNudge, LensType, MindMap } from '../types';
import { Layers, Blocks, Cpu, Code, AlertCircle, CheckCircle2, CircleDashed, Target, Loader2, X, Receipt, Cloud, Wrench, Zap, Presentation, FileText, Lightbulb, Users, Briefcase, Swords, Crosshair, ShieldAlert, Rocket, PlusCircle, Sparkles, MessageSquarePlus, ChevronRight, LayoutGrid, Map, Network, Check, Send } from 'lucide-react';
import { ArchitectureRefinementModal } from './dashboard/ArchitectureRefinementModal';
import { KeywordInputModal, SuggestedKeywordsModal } from './dashboard/GenerationModals';
import { scopeMVP, estimateProjectCost, generatePitchDeck, analyzeCompetitor, generateInitialBlueprint, generateProactiveNudges, generateProactiveNudgesWithKeywords, addFeatureBlueprint, refineIdeaWithSparring, generateDetailedBlueprint, refineBlueprintDraft, generateKeywords, generateMindMap, refineMindMap, generateArchitectureInsights, generateCodeSkeleton } from '../services/gemini';
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
import { MindMapView } from './MindMapView';

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
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const [showMindMapModal, setShowMindMapModal] = useState(false);
  const [isGeneratingMindMap, setIsGeneratingMindMap] = useState(false);
  const [currentMindMap, setCurrentMindMap] = useState<MindMap | null>(null);
  const [mindMapFeedback, setMindMapFeedback] = useState('');

  const [activeView, setActiveView] = useState<'bento' | 'journey' | 'galaxy' | 'blueprint'>('bento');

  // Refinement Modal State
  const [showRefinementModal, setShowRefinementModal] = useState(false);
  const [draftBlueprint, setDraftBlueprint] = useState<any>(null);
  const [refiningNudge, setRefiningNudge] = useState<ProactiveNudge | null>(null);
  const [isRefiningBlueprint, setIsRefiningBlueprint] = useState(false);
  const [isFinalizingBlueprint, setIsFinalizingBlueprint] = useState(false);
  const [generationProgressMsg, setGenerationProgressMsg] = useState('');

  const [architectureInsights, setArchitectureInsights] = useState<any[]>([]);
  const [isFetchingInsights, setIsFetchingInsights] = useState(false);

  const [showSkeletonModal, setShowSkeletonModal] = useState(false);
  const [isGeneratingSkeleton, setIsGeneratingSkeleton] = useState(false);
  const [codeSkeleton, setCodeSkeleton] = useState<any>(null);
  const [selectedNoteForSkeleton, setSelectedNoteForSkeleton] = useState<Note | null>(null);

  const {
    nudges, setNudges,
    pastNudges, setPastNudges,
    loadingNudgeTypes, setLoadingNudgeTypes,
    isFetchingNudges, setIsFetchingNudges,
    isCoFounderOpen, setIsCoFounderOpen,
    applyingNudgeId, setApplyingNudgeId,
    generationMode, setGenerationMode
  } = useCoFounder();
  const [showKeywordModal, setShowKeywordModal] = useState(false);
  const [showSuggestedModal, setShowSuggestedModal] = useState(false);
  const [suggestedKeywords, setSuggestedKeywords] = useState<string[]>([]);
  const [isGeneratingKeywords, setIsGeneratingKeywords] = useState(false);

  useEffect(() => {
    // Reset all AI-related states when project changes to ensure isolation
    setMagicIdea('');
    setIsGeneratingMagic(false);
    setErrorMessage(null);
    setShowMindMapModal(false);
    setIsGeneratingMindMap(false);
    setCurrentMindMap(null);
    setMindMapFeedback('');
    setShowRefinementModal(false);
    setDraftBlueprint(null);
    setRefiningNudge(null);
    setIsRefiningBlueprint(false);
    setIsFinalizingBlueprint(false);
    setGenerationProgressMsg('');
    setArchitectureInsights([]);
    setIsFetchingInsights(false);
    setShowSkeletonModal(false);
    setIsGeneratingSkeleton(false);
    setCodeSkeleton(null);
    setSelectedNoteForSkeleton(null);
  }, [projectId]);

  const handleOpenCoFounder = async () => {
    setIsCoFounderOpen(true);
    if (nudges.length === 0 && notes.length > 0) {
      setIsFetchingNudges(true);
      try {
        const results = await Promise.all([
          generateProactiveNudges(notes, pastNudges, 'Involution'),
          generateProactiveNudges(notes, pastNudges, 'Evolution')
        ]);
        console.log("Results:", results);
        if (!Array.isArray(results)) {
          console.error("results is not an array:", results);
          return;
        }
        const [involutionNudges, evolutionNudges] = results;
        console.log("involutionNudges:", involutionNudges);
        console.log("evolutionNudges:", evolutionNudges);
        const inv = Array.isArray(involutionNudges) ? involutionNudges : [];
        const evo = Array.isArray(evolutionNudges) ? evolutionNudges : [];
        setNudges([...inv, ...evo]);
      } catch (e) {
        console.error(e);
      } finally {
        setIsFetchingNudges(false);
      }
    }
  };

  const handleRerollAllNudges = async (mode?: 'auto' | 'keyword' | 'suggested') => {
    const currentMode = mode || generationMode;
    setGenerationMode(currentMode);
    
    if (currentMode === 'keyword') {
      setShowKeywordModal(true);
      return;
    }
    if (currentMode === 'suggested') {
      setIsGeneratingKeywords(true);
      const keywords = await generateKeywords(notes);
      setSuggestedKeywords(keywords);
      setIsGeneratingKeywords(false);
      setShowSuggestedModal(true);
      return;
    }
    await performGeneration([]);
  };

  const performGeneration = async (keywords: string[]) => {
    setIsFetchingNudges(true);
    setNudges([]);
    try {
      const results = await Promise.all([
        generateProactiveNudgesWithKeywords(notes, pastNudges, 'Involution', keywords),
        generateProactiveNudgesWithKeywords(notes, pastNudges, 'Evolution', keywords)
      ]);
      const [involutionNudges, evolutionNudges] = results;
      const inv = Array.isArray(involutionNudges) ? involutionNudges : [];
      const evo = Array.isArray(evolutionNudges) ? evolutionNudges : [];
      setNudges([...inv, ...evo]);
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
      setErrorMessage("아이디어 구체화에 실패했습니다. 다시 시도해주세요.");
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

        // Fetch insights in parallel for the new feature blueprint
        setIsFetchingInsights(true);
        generateArchitectureInsights(blueprint).then(res => {
          setArchitectureInsights(res.insights || []);
          setIsFetchingInsights(false);
        }).catch(() => setIsFetchingInsights(false));
      }
    } catch (error) {
      console.error("Failed to generate blueprint:", error);
      setErrorMessage("설계도 생성에 실패했습니다.");
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

      // Re-fetch insights for refined blueprint
      setIsFetchingInsights(true);
      generateArchitectureInsights(refined).then(res => {
        setArchitectureInsights(res.insights || []);
        setIsFetchingInsights(false);
      }).catch(() => setIsFetchingInsights(false));
    } catch (error) {
      console.error("Failed to refine blueprint:", error);
      setErrorMessage("설계 수정에 실패했습니다.");
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
                  body: logic.content || '',
                  noteType: 'Logic',
                  parentNoteIds: [moduleId],
                  childNoteIds: [],
                  summary: logic.summary,
                  businessRules: logic.businessRules,
                  constraints: logic.constraints,
                  ioMapping: logic.ioMapping,
                  edgeCases: logic.edgeCases,
                  status: 'Planned',
                  priority: '3rd',
                  createdAt: Date.now(),
                  updatedAt: Date.now()
                } as any);
              }
            }

            newNotes.push({
              id: moduleId,
              projectId,
              title: mod.title,
              body: mod.content || '',
              noteType: 'Module',
              parentNoteIds: [domainId],
              childNoteIds: moduleChildIds,
              summary: mod.summary,
              uxGoals: mod.uxGoals,
              requirements: mod.requirements,
              userJourney: mod.userJourney,
              ia: mod.ia,
              status: 'Planned',
              priority: '3rd',
              createdAt: Date.now(),
              updatedAt: Date.now()
            } as any);
          }
        }

        newNotes.push({
          id: domainId,
          projectId,
          title: domain.title,
          body: domain.content || '',
          noteType: 'Domain',
          parentNoteIds: [],
          childNoteIds: domainChildIds,
          summary: domain.summary,
          vision: domain.vision,
          boundaries: domain.boundaries,
          stakeholders: domain.stakeholders,
          kpis: domain.kpis,
          status: 'Planned',
          priority: '3rd',
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
      setErrorMessage("최종 적용에 실패했습니다.");
    } finally {
      setIsFinalizingBlueprint(false);
      setGenerationProgressMsg('');
    }
  };

  const handleMagicStart = async () => {
    if (!(magicIdea || '').trim()) return;
    setIsGeneratingMindMap(true);
    setShowMindMapModal(true);
    try {
      const mindMap = await generateMindMap((magicIdea || '').trim(), notes);
      setCurrentMindMap(mindMap);
    } catch (error) {
      console.error("Mind Map generation failed:", error);
      setErrorMessage("생각의 지도 생성에 실패했습니다.");
      setShowMindMapModal(false);
    } finally {
      setIsGeneratingMindMap(false);
    }
  };

  const handleRefineMindMap = async () => {
    if (!currentMindMap || !mindMapFeedback.trim()) return;
    setIsGeneratingMindMap(true);
    try {
      const refined = await refineMindMap(currentMindMap, mindMapFeedback);
      setCurrentMindMap(refined);
      setMindMapFeedback('');
    } catch (error) {
      console.error("Mind Map refinement failed:", error);
      setErrorMessage("지도 수정에 실패했습니다.");
    } finally {
      setIsGeneratingMindMap(false);
    }
  };

  const handleConfirmMindMap = async () => {
    if (!currentMindMap) return;
    setIsGeneratingMagic(true);
    setShowMindMapModal(false);
    try {
      // Use the mind map summary and nodes to generate a better blueprint
      const context = `Summary: ${currentMindMap.summary}\nNodes: ${JSON.stringify(currentMindMap.nodes)}`;
      const blueprint = await generateInitialBlueprint(context);
      if (blueprint && blueprint.domains && blueprint.domains.length > 0) {
        setDraftBlueprint(blueprint);
        setRefiningNudge(null);
        setShowRefinementModal(true);
        setMagicIdea('');
        
        // Fetch insights in parallel
        setIsFetchingInsights(true);
        generateArchitectureInsights(blueprint).then(res => {
          setArchitectureInsights(res.insights || []);
          setIsFetchingInsights(false);
        }).catch(() => setIsFetchingInsights(false));
      }
    } catch (error) {
      console.error("Blueprint generation failed:", error);
      setErrorMessage("설계도 생성에 실패했습니다.");
    } finally {
      setIsGeneratingMagic(false);
      setCurrentMindMap(null);
    }
  };

  const handleGenerateSkeleton = async (note: Note) => {
    setSelectedNoteForSkeleton(note);
    setIsGeneratingSkeleton(true);
    setShowSkeletonModal(true);
    try {
      const skeleton = await generateCodeSkeleton(note);
      setCodeSkeleton(skeleton);
    } catch (error) {
      console.error("Failed to generate code skeleton:", error);
      setErrorMessage("코드 스켈레톤 생성에 실패했습니다.");
    } finally {
      setIsGeneratingSkeleton(false);
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
      case '1st': return 'text-rose-500 bg-rose-500/10 border-rose-500/20';
      case '2nd': return 'text-amber-500 bg-amber-500/10 border-amber-500/20';
      case '3rd': return 'text-blue-500 bg-blue-500/10 border-blue-500/20';
      default: return 'text-muted-foreground/60 bg-muted border-transparent';
    }
  };

  const handleScopeMVP = async () => {
    if (!(scopingConstraint || '').trim()) return;
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
      setErrorMessage("MVP 스코핑에 실패했습니다: " + (error as Error).message);
    } finally {
      setIsScoping(false);
    }
  };

  const handleEstimateCost = async () => {
    setIsEstimatingCost(true);
    setShowCostModal(true);
    try {
      const targetNotes = [...modules, ...logics].filter(n => n.priority === '1st' || n.priority === '2nd');
      const estimate = await estimateProjectCost(targetNotes);
      setCostEstimate(estimate);
    } catch (error) {
      console.error("Failed to estimate cost:", error);
      setErrorMessage("비용 추정에 실패했습니다: " + (error as Error).message);
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
      setErrorMessage("피치덱 생성에 실패했습니다: " + (error as Error).message);
      setShowPitchModal(false);
    } finally {
      setIsGeneratingPitch(false);
    }
  };

  const handleAnalyzeCompetitor = async () => {
    if (!(competitorName || '').trim()) return;
    setIsAnalyzingCompetitor(true);
    try {
      const analysis = await analyzeCompetitor(competitorName, notes);
      setCompetitorAnalysis(analysis);
    } catch (error) {
      console.error("Failed to analyze competitor:", error);
      setErrorMessage("경쟁사 분석에 실패했습니다: " + (error as Error).message);
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

  return (
    <div className="h-full flex flex-col relative bg-background">
      {errorMessage && (
        <div className="absolute top-4 left-1/2 -translate-x-1/2 bg-destructive text-destructive-foreground px-6 py-3 rounded-xl shadow-2xl flex items-center gap-3 z-50 animate-in slide-in-from-top-4">
          <AlertCircle size={20} />
          <span className="font-bold text-sm">{errorMessage}</span>
          <button onClick={() => setErrorMessage(null)} className="ml-2 hover:opacity-70"><X size={16} /></button>
        </div>
      )}
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
            magicIdea={magicIdea}
            setMagicIdea={setMagicIdea}
            onMagicStart={handleMagicStart}
            isGeneratingMagic={isGeneratingMagic}
            isGeneratingMindMap={isGeneratingMindMap}
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
        <BlueprintView 
          notes={notes} 
          onSelectNote={onSelectNote} 
          onGenerateSkeleton={handleGenerateSkeleton}
        />
        )}
      </div>

      {/* Mind Map Modal */}
      {showMindMapModal && (
        <div className="fixed inset-0 bg-background/80 backdrop-blur-sm z-[60] flex items-center justify-center p-4">
          <motion.div 
            initial={{ opacity: 0, scale: 0.95, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            className="bg-card border border-border shadow-2xl rounded-3xl w-full max-w-4xl max-h-[90vh] overflow-hidden flex flex-col"
          >
            <div className="p-6 border-b border-border flex items-center justify-between bg-muted/30">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center text-primary">
                  <Lightbulb size={24} />
                </div>
                <div>
                  <h3 className="text-xl font-black tracking-tight">생각의 지도 (Mirroring)</h3>
                  <p className="text-xs text-muted-foreground">사용자의 아이디어를 AI가 이렇게 이해했습니다. 맞는지 확인해주세요.</p>
                </div>
              </div>
              <button 
                onClick={() => setShowMindMapModal(false)}
                className="p-2 hover:bg-muted rounded-full transition-colors"
              >
                <X size={20} />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-6">
              {isGeneratingMindMap && !currentMindMap ? (
                <div className="h-64 flex flex-col items-center justify-center gap-4">
                  <div className="w-12 h-12 border-4 border-primary border-t-transparent rounded-full animate-spin"></div>
                  <p className="text-sm font-medium text-muted-foreground animate-pulse">아이디어를 분석하여 지도를 그리는 중...</p>
                </div>
              ) : currentMindMap ? (
                <MindMapView mindMap={currentMindMap} />
              ) : null}
            </div>

            <div className="p-6 border-t border-border bg-muted/30">
              <div className="flex flex-col gap-4">
                <div className="relative">
                  <textarea
                    value={mindMapFeedback}
                    onChange={(e) => setMindMapFeedback(e.target.value)}
                    placeholder="지도를 보고 수정하고 싶은 내용이나 추가하고 싶은 아이디어를 말씀해주세요."
                    className="w-full bg-background border border-border rounded-2xl p-4 text-sm min-h-[100px] focus:ring-2 focus:ring-primary/20 transition-all resize-none"
                  />
                  <button
                    onClick={handleRefineMindMap}
                    disabled={isGeneratingMindMap || !mindMapFeedback.trim()}
                    className="absolute bottom-3 right-3 px-4 py-2 bg-primary text-primary-foreground rounded-xl text-xs font-bold hover:opacity-90 disabled:opacity-50 transition-all flex items-center gap-2"
                  >
                    {isGeneratingMindMap ? <div className="w-3 h-3 border-2 border-current border-t-transparent rounded-full animate-spin" /> : <Send size={14} />}
                    지도 수정하기
                  </button>
                </div>
                <div className="flex items-center justify-between gap-4">
                  <p className="text-[10px] text-muted-foreground">
                    * 지도가 마음에 드신다면 '이대로 설계도 만들기'를 눌러주세요.
                  </p>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => setShowMindMapModal(false)}
                      className="px-6 py-3 rounded-2xl text-sm font-bold hover:bg-muted transition-all"
                    >
                      취소
                    </button>
                    <button
                      onClick={handleConfirmMindMap}
                      disabled={isGeneratingMindMap || !currentMindMap}
                      className="px-8 py-3 bg-primary text-primary-foreground rounded-2xl text-sm font-bold shadow-lg shadow-primary/20 hover:shadow-xl hover:shadow-primary/30 transition-all flex items-center gap-2"
                    >
                      <Check size={18} />
                      이대로 설계도 만들기
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </motion.div>
        </div>
      )}

      <ArchitectureRefinementModal
        isOpen={showRefinementModal}
        onClose={() => setShowRefinementModal(false)}
        blueprint={draftBlueprint}
        onRefine={handleRefineBlueprint}
        onFinalize={handleFinalizeBlueprint}
        isRefining={isRefiningBlueprint}
        isFinalizing={isFinalizingBlueprint}
        progressMessage={generationProgressMsg}
        insights={architectureInsights}
        isFetchingInsights={isFetchingInsights}
      />

      {/* Code Skeleton Modal */}
      {showSkeletonModal && (
        <div className="fixed inset-0 bg-background/80 backdrop-blur-sm z-[60] flex items-center justify-center p-4">
          <motion.div 
            initial={{ opacity: 0, scale: 0.95, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            className="bg-card border border-border shadow-2xl rounded-3xl w-full max-w-4xl max-h-[90vh] overflow-hidden flex flex-col"
          >
            <div className="p-6 border-b border-border flex items-center justify-between bg-muted/30">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-purple-500/10 flex items-center justify-center text-purple-500">
                  <Code size={24} />
                </div>
                <div>
                  <h3 className="text-xl font-black tracking-tight">코드 스켈레톤 (Boilerplate)</h3>
                  <p className="text-xs text-muted-foreground">{selectedNoteForSkeleton?.title} 기능을 위한 초기 코드 구조입니다.</p>
                </div>
              </div>
              <button 
                onClick={() => {
                  setShowSkeletonModal(false);
                  setCodeSkeleton(null);
                }}
                className="p-2 hover:bg-muted rounded-full transition-colors"
              >
                <X size={20} />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-6 bg-muted/10">
              {isGeneratingSkeleton ? (
                <div className="h-64 flex flex-col items-center justify-center gap-4">
                  <Loader2 size={48} className="animate-spin text-primary/50" />
                  <p className="text-sm font-medium text-muted-foreground animate-pulse">코드 구조를 설계하는 중...</p>
                </div>
              ) : codeSkeleton && codeSkeleton.files ? (
                <div className="space-y-6">
                  {codeSkeleton.files.map((file: any, idx: number) => (
                    <div key={idx} className="bg-background border border-border rounded-xl overflow-hidden shadow-sm">
                      <div className="bg-muted/50 px-4 py-2 border-b border-border flex items-center justify-between">
                        <span className="text-xs font-mono font-bold text-muted-foreground">{file.path}</span>
                        <button 
                          onClick={() => navigator.clipboard.writeText(file.content)}
                          className="text-[10px] font-bold hover:text-primary transition-colors"
                        >
                          COPY
                        </button>
                      </div>
                      <pre className="p-4 text-xs font-mono overflow-x-auto leading-relaxed">
                        <code>{file.content}</code>
                      </pre>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="h-64 flex flex-col items-center justify-center text-muted-foreground">
                  <p>생성된 코드가 없습니다.</p>
                </div>
              )}
            </div>

            <div className="p-6 border-t border-border bg-muted/30 flex justify-end">
              <button
                onClick={() => {
                  setShowSkeletonModal(false);
                  setCodeSkeleton(null);
                }}
                className="px-8 py-3 bg-primary text-primary-foreground rounded-2xl text-sm font-bold shadow-lg shadow-primary/20 hover:shadow-xl hover:shadow-primary/30 transition-all"
              >
                확인 완료
              </button>
            </div>
          </motion.div>
        </div>
      )}

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
                disabled={isScoping || !(scopingConstraint || '').trim()}
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
                disabled={isAnalyzingCompetitor || !(competitorName || '').trim()}
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

      <KeywordInputModal 
        isOpen={showKeywordModal} 
        onClose={() => setShowKeywordModal(false)} 
        onConfirm={(k) => { setShowKeywordModal(false); performGeneration([k]); }} 
        title="키워드 입력" 
      />
      <SuggestedKeywordsModal 
        isOpen={showSuggestedModal} 
        onClose={() => setShowSuggestedModal(false)} 
        onConfirm={(ks) => { setShowSuggestedModal(false); performGeneration(ks); }} 
        title="키워드 선택" 
        suggestions={suggestedKeywords}
      />
    </div>
  );
};
