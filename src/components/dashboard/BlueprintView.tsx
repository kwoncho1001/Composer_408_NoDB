import React from 'react';
import { Note } from '../../types';
import { Layers, Blocks, Cpu, Code, ChevronRight, Sparkles, Target, Info } from 'lucide-react';
import { motion } from 'motion/react';

interface BlueprintViewProps {
  notes: Note[];
  onSelectNote: (id: string) => void;
}

export const BlueprintView: React.FC<BlueprintViewProps> = ({ notes, onSelectNote }) => {
  const domains = notes.filter(n => n.noteType === 'Domain');
  const modules = notes.filter(n => n.noteType === 'Module');
  const logics = notes.filter(n => n.noteType === 'Logic');
  const snapshots = notes.filter(n => n.noteType === 'Snapshot');

  const getChildren = (parentId: string, type: string) => {
    return notes.filter(n => n.parentNoteIds?.includes(parentId) && n.noteType === type);
  };

  if (domains.length === 0) {
    return (
      <div className="h-full flex flex-col items-center justify-center p-8 text-center">
        <div className="w-20 h-20 bg-primary/10 rounded-full flex items-center justify-center mb-6">
          <Layers size={40} className="text-primary" />
        </div>
        <h3 className="text-2xl font-black mb-2">아직 설계도가 없습니다</h3>
        <p className="text-muted-foreground max-w-md">
          AI Co-founder의 제안을 수락하거나 'Magic Start'를 통해 서비스의 첫 설계도를 그려보세요.
        </p>
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto custom-scrollbar p-4 md:p-12">
      <div className="w-full space-y-12">
        <div className="flex items-center justify-between border-b border-border pb-6">
          <div>
            <h3 className="text-3xl font-black flex items-center gap-3">
              <Layers className="text-primary" size={32} />
              서비스 설계도 (System Blueprint)
            </h3>
            <p className="text-muted-foreground mt-2 text-lg">서비스의 전체 구조와 핵심 규칙을 한눈에 파악하세요.</p>
          </div>
          <div className="flex gap-6 text-sm font-bold uppercase tracking-widest text-muted-foreground">
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 rounded-full bg-primary"></div>
              <span>{domains.length} 주요 영역</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 rounded-full bg-purple-500"></div>
              <span>{modules.length} 세부 기능</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 rounded-full bg-emerald-500"></div>
              <span>{logics.length} 핵심 규칙</span>
            </div>
          </div>
        </div>

        <div className="space-y-16">
          {domains.map((domain, dIdx) => (
            <motion.div 
              key={domain.id}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: dIdx * 0.1 }}
              className="relative"
            >
              <div className="bg-card border border-border rounded-[2.5rem] p-8 shadow-sm hover:shadow-md transition-all group">
                <div className="flex items-start gap-6 mb-8">
                  <div className="p-4 bg-primary/10 rounded-3xl text-primary group-hover:scale-110 transition-transform">
                    <Layers size={32} />
                  </div>
                  <div className="flex-1">
                    <div className="flex items-center justify-between">
                      <h4 className="text-2xl font-black group-hover:text-primary transition-colors cursor-pointer" onClick={() => onSelectNote(domain.id)}>
                        {domain.title}
                      </h4>
                      <span className="text-xs font-black px-3 py-1.5 rounded-lg bg-primary/10 text-primary uppercase tracking-wider">주요 영역 (Domain)</span>
                    </div>
                    <p className="text-base text-muted-foreground mt-2 leading-relaxed max-w-3xl">{domain.summary}</p>
                  </div>
                </div>

                <div className="flex gap-6 overflow-x-auto pb-6 custom-scrollbar snap-x">
                  {getChildren(domain.id, 'Module').map((mod) => (
                    <div key={mod.id} className="flex-none w-[400px] bg-muted/30 rounded-[2rem] p-6 border border-border/50 hover:border-purple-500/30 transition-colors snap-start">
                      <div className="flex items-center gap-3 mb-4">
                        <div className="p-2.5 bg-purple-500/10 rounded-2xl text-purple-500">
                          <Blocks size={22} />
                        </div>
                        <h5 className="font-black text-lg cursor-pointer hover:text-purple-500 transition-colors" onClick={() => onSelectNote(mod.id)}>
                          {mod.title}
                        </h5>
                      </div>
                      <p className="text-sm text-muted-foreground mb-6 leading-relaxed line-clamp-2">{mod.summary}</p>
                      
                      <div className="space-y-3">
                        <div className="text-[10px] font-black text-muted-foreground uppercase tracking-widest mb-1 px-1">핵심 규칙 & 데이터</div>
                        {getChildren(mod.id, 'Logic').map((logic) => (
                          <div 
                            key={logic.id} 
                            onClick={() => onSelectNote(logic.id)}
                            className="bg-background/50 border border-border/50 rounded-2xl p-4 flex flex-col gap-1 hover:border-emerald-500/30 hover:bg-emerald-500/5 transition-all cursor-pointer group/logic"
                          >
                            <div className="flex items-center gap-3">
                              <Cpu size={16} className="text-emerald-500 group-hover/logic:scale-110 transition-transform" />
                              <p className="text-sm font-black truncate flex-1">{logic.title}</p>
                              <ChevronRight size={14} className="text-muted-foreground opacity-0 group-hover/logic:opacity-100 transition-all" />
                            </div>
                            <p className="text-xs text-muted-foreground pl-7 line-clamp-2 leading-relaxed">{logic.summary}</p>
                          </div>
                        ))}
                        
                        {/* Snapshots associated with this module or its logics */}
                        {getChildren(mod.id, 'Snapshot').map((snap) => (
                          <div 
                            key={snap.id} 
                            onClick={() => onSelectNote(snap.id)}
                            className="bg-background/50 border border-border/50 rounded-2xl p-4 flex flex-col gap-1 hover:border-amber-500/30 hover:bg-amber-500/5 transition-all cursor-pointer group/snap"
                          >
                            <div className="flex items-center gap-3">
                              <Code size={16} className="text-amber-500 group-hover/snap:scale-110 transition-transform" />
                              <p className="text-sm font-black truncate flex-1">{snap.title}</p>
                              <ChevronRight size={14} className="text-muted-foreground opacity-0 group-hover/snap:opacity-100 transition-all" />
                            </div>
                            <p className="text-xs text-muted-foreground pl-7 line-clamp-1 leading-relaxed italic">{snap.summary}</p>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </motion.div>
          ))}
        </div>
      </div>
    </div>
  );
};
