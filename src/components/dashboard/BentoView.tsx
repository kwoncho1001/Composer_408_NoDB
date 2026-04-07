import React from 'react';
import { Note, ProactiveNudge } from '../../types';
import { Target, Receipt, Presentation, Swords, Sparkles, MessageSquarePlus, ChevronRight, Loader2, CheckCircle2, AlertCircle, CircleDashed, Clock, RefreshCw, X, Wrench, Lightbulb } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { useCoFounder } from '../../contexts/CoFounderContext';

interface BentoViewProps {
  notes: Note[];
  onAcceptNudge: (nudge: ProactiveNudge) => void;
  onSparringSubmit: (nudge: ProactiveNudge, response: string) => void;
  onRejectNudge: (nudgeId: string) => void;
  onRerollAllNudges: () => void;
  onOpenAction: (action: string) => void;
}

export const BentoView: React.FC<BentoViewProps> = ({ 
  notes, onAcceptNudge, onSparringSubmit, onRejectNudge, onRerollAllNudges, onOpenAction 
}) => {
  const { nudges, isFetchingNudges, loadingNudgeTypes, applyingNudgeId } = useCoFounder();
  const [sparringNudgeId, setSparringNudgeId] = React.useState<string | null>(null);
  const [sparringText, setSparringText] = React.useState("");
  const totalNotes = notes.length;
  const completedNotes = notes.filter(n => n.status === 'Done').length;
  const progress = totalNotes === 0 ? 0 : Math.round((completedNotes / totalNotes) * 100);

  const p1Notes = notes.filter(n => n.priority === 'P1');
  const conflictNotes = notes.filter(n => n.status === 'Conflict');

  return (
    <div className="h-full overflow-y-auto custom-scrollbar p-4 md:p-6">
      <div className="max-w-7xl mx-auto grid grid-cols-1 md:grid-cols-3 lg:grid-cols-4 gap-4 md:gap-6">
        
        {/* Progress & Health */}
        <div className="col-span-1 md:col-span-2 lg:col-span-2 bg-card border border-border rounded-3xl p-4 md:p-6 shadow-sm flex flex-col justify-between">
          <div>
            <h3 className="text-xs md:text-sm font-black uppercase tracking-widest text-muted-foreground mb-4">Project Health</h3>
            <div className="flex items-end gap-2 md:gap-4 mb-4 md:mb-6">
              <span className="text-4xl md:text-6xl font-black tracking-tighter">{progress}%</span>
              <span className="text-muted-foreground mb-1 md:mb-2 text-sm md:text-base font-medium">Completed</span>
            </div>
            
            <div className="w-full bg-muted rounded-full h-2 md:h-3 mb-4 md:mb-6 overflow-hidden">
              <div className="bg-primary h-full rounded-full transition-all duration-1000" style={{ width: `${progress}%` }}></div>
            </div>
          </div>
          
          <div className="grid grid-cols-3 gap-2 md:gap-4">
            <div className="bg-background rounded-2xl p-2 md:p-4 border border-border flex flex-col items-center justify-center text-center">
              <span className="text-xl md:text-2xl font-black">{totalNotes}</span>
              <span className="text-[8px] md:text-[10px] uppercase tracking-widest text-muted-foreground mt-1">Total Modules</span>
            </div>
            <div className="bg-rose-500/10 text-rose-500 rounded-2xl p-2 md:p-4 border border-rose-500/20 flex flex-col items-center justify-center text-center">
              <span className="text-xl md:text-2xl font-black">{conflictNotes.length}</span>
              <span className="text-[8px] md:text-[10px] uppercase tracking-widest mt-1">Conflicts</span>
            </div>
            <div className="bg-amber-500/10 text-amber-500 rounded-2xl p-2 md:p-4 border border-amber-500/20 flex flex-col items-center justify-center text-center">
              <span className="text-xl md:text-2xl font-black">{p1Notes.length}</span>
              <span className="text-[8px] md:text-[10px] uppercase tracking-widest mt-1">P1 Priority</span>
            </div>
          </div>
        </div>

        {/* Quick Actions */}
        <div className="col-span-1 lg:col-span-2 grid grid-cols-2 gap-3 md:gap-4">
          <button onClick={() => onOpenAction('competitor')} className="bg-rose-500/10 hover:bg-rose-500 hover:text-white text-rose-500 border border-rose-500/20 rounded-2xl md:rounded-3xl p-4 md:p-6 flex flex-col items-center justify-center gap-2 md:gap-3 transition-all group">
            <Swords size={24} className="md:w-8 md:h-8 group-hover:scale-110 transition-transform" />
            <span className="font-bold text-xs md:text-sm">경쟁사 역설계</span>
          </button>
          <button onClick={() => onOpenAction('pitch')} className="bg-purple-500/10 hover:bg-purple-500 hover:text-white text-purple-500 border border-purple-500/20 rounded-2xl md:rounded-3xl p-4 md:p-6 flex flex-col items-center justify-center gap-2 md:gap-3 transition-all group">
            <Presentation size={24} className="md:w-8 md:h-8 group-hover:scale-110 transition-transform" />
            <span className="font-bold text-xs md:text-sm">Pitch Deck</span>
          </button>
          <button onClick={() => onOpenAction('cost')} className="bg-emerald-500/10 hover:bg-emerald-500 hover:text-white text-emerald-500 border border-emerald-500/20 rounded-2xl md:rounded-3xl p-4 md:p-6 flex flex-col items-center justify-center gap-2 md:gap-3 transition-all group">
            <Receipt size={24} className="md:w-8 md:h-8 group-hover:scale-110 transition-transform" />
            <span className="font-bold text-xs md:text-sm">Burn Rate 예측</span>
          </button>
          <button onClick={() => onOpenAction('mvp')} className="bg-primary/10 hover:bg-primary hover:text-primary-foreground text-primary border border-primary/20 rounded-2xl md:rounded-3xl p-4 md:p-6 flex flex-col items-center justify-center gap-2 md:gap-3 transition-all group">
            <Target size={24} className="md:w-8 md:h-8 group-hover:scale-110 transition-transform" />
            <span className="font-bold text-xs md:text-sm">MVP 스코핑</span>
          </button>
        </div>

        {/* AI Co-founder Nudges */}
        <div className="col-span-1 md:col-span-3 lg:col-span-4 bg-gradient-to-br from-primary/5 to-purple-500/5 border border-primary/20 rounded-3xl p-6 shadow-sm relative overflow-hidden">
          <div className="absolute top-0 right-0 p-6 opacity-10">
            <Sparkles size={120} />
          </div>
          <div className="relative z-10">
            <div className="flex items-center justify-start gap-4 mb-6">
              <h3 className="text-sm font-black uppercase tracking-widest text-primary flex items-center gap-2">
                <Sparkles size={16} /> AI CO-FOUNDER INSIGHTS
              </h3>
              <button 
                onClick={onRerollAllNudges}
                disabled={isFetchingNudges}
                className="text-xs font-bold bg-primary/10 hover:bg-primary/20 text-primary px-3 py-1.5 rounded-lg flex items-center gap-1.5 transition-all disabled:opacity-50"
              >
                <RefreshCw size={14} className={isFetchingNudges ? "animate-spin" : ""} />
                {nudges.length > 0 ? "새로운 인사이트 뽑기" : "인사이트 생성하기"}
              </button>
            </div>
            <div className="w-full">
            {isFetchingNudges && nudges.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 space-y-4">
                <Loader2 size={32} className="animate-spin text-primary" />
                <p className="text-sm font-medium text-muted-foreground animate-pulse text-center">
                  현재 시스템을 분석하여<br/>새로운 비즈니스 아이디어를 발상 중입니다...
                </p>
              </div>
            ) : nudges.length === 0 ? (
              <div className="text-center py-24 text-muted-foreground text-sm bg-background/50 rounded-2xl border border-dashed border-border w-full">
                {notes.length === 0 ? "프로젝트에 노트를 추가하면 AI 코파운더가 인사이트를 제공합니다." : "현재 제안할 새로운 아이디어가 없습니다."}
              </div>
            ) : (
              <div className="space-y-8">
                {/* Track: Involution */}
                <div className="mb-12">
                  <h4 className="text-sm font-bold text-muted-foreground mb-6 flex items-center gap-2">
                    <Wrench size={16} /> Involution (내적 최적화)
                  </h4>
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                    {nudges.filter(n => n.track === 'Involution').map(nudge => (
                      <div key={nudge.id} className="bg-background border border-border rounded-2xl p-5 shadow-sm hover:border-primary/50 transition-colors flex flex-col">
                        <div className="flex items-center justify-between mb-3">
                          <span className="text-[10px] font-bold px-2 py-1 rounded-md bg-secondary text-secondary-foreground uppercase tracking-wider">
                            {nudge.nudgeType}
                          </span>
                        </div>
                        <p className="text-xs text-muted-foreground mb-3">
                          {nudge.context}
                        </p>
                        <p className="text-sm font-bold text-foreground leading-relaxed mb-4">
                          {nudge.question}
                        </p>
                        <div className="bg-muted/50 rounded-xl p-3 mb-5 flex-1">
                          <p className="text-xs text-muted-foreground leading-relaxed">
                            <strong className="text-foreground">AI 가설: </strong>{nudge.hypothesis}
                          </p>
                        </div>
                        {sparringNudgeId === nudge.id ? (
                          <div className="mt-auto flex flex-col gap-2">
                            <textarea
                              className="w-full text-xs p-2 rounded-lg bg-background border border-border resize-none focus:outline-none focus:border-primary"
                              rows={3}
                              placeholder="아니, 내 생각은 달라. 차라리..."
                              value={sparringText}
                              onChange={(e) => setSparringText(e.target.value)}
                              autoFocus
                            />
                            <div className="flex gap-2">
                              <button
                                onClick={() => setSparringNudgeId(null)}
                                className="flex-1 bg-muted text-muted-foreground hover:bg-muted/80 text-xs font-bold py-2 rounded-xl transition-all"
                              >
                                취소
                              </button>
                              <button
                                onClick={() => {
                                  onSparringSubmit(nudge, sparringText);
                                  setSparringNudgeId(null);
                                  setSparringText("");
                                }}
                                disabled={!sparringText.trim() || applyingNudgeId === nudge.id}
                                className="flex-1 bg-primary text-primary-foreground hover:bg-primary/90 text-xs font-bold py-2 rounded-xl transition-all flex items-center justify-center gap-2 disabled:opacity-50"
                              >
                                {applyingNudgeId === nudge.id ? <Loader2 size={14} className="animate-spin" /> : "반박하기"}
                              </button>
                            </div>
                          </div>
                        ) : (
                          <div className="mt-auto flex flex-col gap-2">
                            <button
                              onClick={() => onAcceptNudge(nudge)}
                              disabled={applyingNudgeId === nudge.id}
                              className="w-full bg-primary text-primary-foreground hover:bg-primary/90 text-xs font-bold py-2.5 rounded-xl transition-all flex items-center justify-center gap-2 disabled:opacity-50"
                            >
                              {applyingNudgeId === nudge.id ? (
                                <><Loader2 size={14} className="animate-spin" /> 구체화 중...</>
                              ) : (
                                <>🛠️ 아키텍처에 추가</>
                              )}
                            </button>
                            <div className="flex gap-2">
                              <button
                                onClick={() => {
                                  setSparringNudgeId(nudge.id);
                                  setSparringText("");
                                }}
                                disabled={applyingNudgeId === nudge.id}
                                className="flex-1 bg-secondary text-secondary-foreground hover:bg-secondary/80 text-xs font-bold py-2 rounded-xl transition-all flex items-center justify-center gap-1.5 disabled:opacity-50"
                              >
                                <MessageSquarePlus size={14} /> 수정 제안
                              </button>
                              <button
                                onClick={() => onRejectNudge(nudge.id)}
                                disabled={applyingNudgeId === nudge.id}
                                className="bg-muted text-muted-foreground hover:bg-muted/80 text-xs font-bold px-3 py-2 rounded-xl transition-all flex items-center justify-center disabled:opacity-50"
                              >
                                패스
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                    ))}
                    {loadingNudgeTypes.filter(t => ['Cost', 'Debt', 'EdgeCase', 'Efficiency'].includes(t)).map((type, idx) => (
                      <div key={`loading-involution-${idx}`} className="bg-background/40 backdrop-blur-sm border border-border border-dashed rounded-2xl p-5 flex flex-col items-center justify-center min-h-[250px]">
                        <Loader2 size={24} className="animate-spin text-muted-foreground mb-3" />
                        <span className="text-[10px] font-bold px-2 py-1 rounded-md bg-secondary text-secondary-foreground uppercase tracking-wider mb-2">
                          {type}
                        </span>
                        <p className="text-xs text-muted-foreground animate-pulse text-center">
                          새로운 최적화 방안을<br/>준비 중입니다...
                        </p>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Track: Evolution */}
                <div className="pt-8 border-t border-primary/10">
                  <h4 className="text-sm font-bold text-primary mb-6 flex items-center gap-2">
                    <Lightbulb size={16} /> Evolution (외적 임팩트)
                  </h4>
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                    {nudges.filter(n => n.track === 'Evolution').map(nudge => (
                      <div key={nudge.id} className="bg-gradient-to-br from-primary/5 to-purple-500/5 backdrop-blur-sm border border-primary/20 rounded-2xl p-5 shadow-sm hover:border-primary/40 transition-colors flex flex-col">
                        <div className="flex items-center justify-between mb-3">
                          <span className="text-[10px] font-bold px-2 py-1 rounded-md bg-primary/10 text-primary uppercase tracking-wider">
                            {nudge.nudgeType}
                          </span>
                          <Sparkles size={14} className="text-primary/50" />
                        </div>
                        <p className="text-xs text-muted-foreground mb-3">
                          {nudge.context}
                        </p>
                        <p className="text-sm font-bold text-foreground leading-relaxed mb-4">
                          {nudge.question}
                        </p>
                        <div className="bg-primary/5 rounded-xl p-3 mb-5 flex-1 border border-primary/10">
                          <p className="text-xs text-primary/80 leading-relaxed">
                            <strong className="text-primary">AI 가설: </strong>{nudge.hypothesis}
                          </p>
                        </div>
                        {sparringNudgeId === nudge.id ? (
                          <div className="mt-auto flex flex-col gap-2">
                            <textarea
                              className="w-full text-xs p-2 rounded-lg bg-background border border-border resize-none focus:outline-none focus:border-primary"
                              rows={3}
                              placeholder="아니, 내 생각은 달라. 차라리..."
                              value={sparringText}
                              onChange={(e) => setSparringText(e.target.value)}
                              autoFocus
                            />
                            <div className="flex gap-2">
                              <button
                                onClick={() => setSparringNudgeId(null)}
                                className="flex-1 bg-muted text-muted-foreground hover:bg-muted/80 text-xs font-bold py-2 rounded-xl transition-all"
                              >
                                취소
                              </button>
                              <button
                                onClick={() => {
                                  onSparringSubmit(nudge, sparringText);
                                  setSparringNudgeId(null);
                                  setSparringText("");
                                }}
                                disabled={!sparringText.trim() || applyingNudgeId === nudge.id}
                                className="flex-1 bg-primary text-primary-foreground hover:bg-primary/90 text-xs font-bold py-2 rounded-xl transition-all flex items-center justify-center gap-2 disabled:opacity-50"
                              >
                                {applyingNudgeId === nudge.id ? <Loader2 size={14} className="animate-spin" /> : "반박하기"}
                              </button>
                            </div>
                          </div>
                        ) : (
                          <div className="mt-auto flex flex-col gap-2">
                            <button
                              onClick={() => onAcceptNudge(nudge)}
                              disabled={applyingNudgeId === nudge.id}
                              className="w-full bg-primary text-primary-foreground hover:bg-primary/90 text-xs font-bold py-2.5 rounded-xl transition-all flex items-center justify-center gap-2 disabled:opacity-50"
                            >
                              {applyingNudgeId === nudge.id ? (
                                <><Loader2 size={14} className="animate-spin" /> 구체화 중...</>
                              ) : (
                                <>🔥 오, 자극되네! (바로 적용)</>
                              )}
                            </button>
                            <div className="flex gap-2">
                              <button
                                onClick={() => {
                                  setSparringNudgeId(nudge.id);
                                  setSparringText("");
                                }}
                                disabled={applyingNudgeId === nudge.id}
                                className="flex-1 bg-secondary text-secondary-foreground hover:bg-secondary/80 text-xs font-bold py-2 rounded-xl transition-all flex items-center justify-center gap-1.5 disabled:opacity-50"
                              >
                                <MessageSquarePlus size={14} /> 내 생각은 달라
                              </button>
                              <button
                                onClick={() => onRejectNudge(nudge.id)}
                                disabled={applyingNudgeId === nudge.id}
                                className="bg-muted text-muted-foreground hover:bg-muted/80 text-xs font-bold px-3 py-2 rounded-xl transition-all flex items-center justify-center disabled:opacity-50"
                              >
                                패스
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                    ))}
                    {loadingNudgeTypes.filter(t => ['AhaMoment', 'HighImpact', 'Pivot', 'Expansion'].includes(t)).map((type, idx) => (
                      <div key={`loading-evolution-${idx}`} className="bg-background/40 backdrop-blur-sm border border-primary/20 border-dashed rounded-2xl p-5 flex flex-col items-center justify-center min-h-[250px]">
                        <Loader2 size={24} className="animate-spin text-primary mb-3" />
                        <span className="text-[10px] font-bold px-2 py-1 rounded-md bg-primary/10 text-primary uppercase tracking-wider mb-2">
                          {type}
                        </span>
                        <p className="text-xs text-muted-foreground animate-pulse text-center">
                          거대한 임팩트를<br/>준비 중입니다...
                        </p>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
