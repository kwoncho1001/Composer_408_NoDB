import React from 'react';
import { Note } from '../../types';
import { CircleDashed, Loader2, CheckCircle2, AlertCircle } from 'lucide-react';

interface JourneyViewProps {
  notes: Note[];
  onSelectNote: (id: string) => void;
}

export const JourneyView: React.FC<JourneyViewProps> = ({ notes, onSelectNote }) => {
  const stages = [
    { id: 'Planned', title: 'Ideation & Planning', icon: CircleDashed, color: 'text-blue-500', bg: 'bg-blue-500/10', border: 'border-blue-500/20' },
    { id: 'In Progress', title: 'Development', icon: Loader2, color: 'text-amber-500', bg: 'bg-amber-500/10', border: 'border-amber-500/20' },
    { id: 'Done', title: 'Ready for Launch', icon: CheckCircle2, color: 'text-emerald-500', bg: 'bg-emerald-500/10', border: 'border-emerald-500/20' },
    { id: 'Conflict', title: 'Roadblocks', icon: AlertCircle, color: 'text-rose-500', bg: 'bg-rose-500/10', border: 'border-rose-500/20' }
  ];

  return (
    <div className="h-full overflow-x-auto custom-scrollbar p-4 md:p-6">
      <div className="flex gap-4 md:gap-8 min-w-max h-full">
        {stages.map((stage, index) => {
          const stageNotes = notes.filter(n => n.status === stage.id);
          
          return (
            <div key={stage.id} className="w-72 md:w-80 flex flex-col h-full relative">
              {/* Connection Line */}
              {index < stages.length - 1 && (
                <div className="absolute top-8 left-full w-4 md:w-8 h-0.5 bg-border z-0"></div>
              )}
              
              <div className={`p-3 md:p-4 rounded-2xl border ${stage.border} ${stage.bg} flex items-center gap-2 md:gap-3 mb-4 md:mb-6 relative z-10`}>
                <stage.icon size={20} className={`md:w-6 md:h-6 ${stage.color}`} />
                <div>
                  <h3 className={`font-black text-sm md:text-base ${stage.color}`}>{stage.title}</h3>
                  <p className="text-[10px] md:text-xs text-muted-foreground font-medium">{stageNotes.length} modules</p>
                </div>
              </div>
              
              <div className="flex-1 overflow-y-auto custom-scrollbar pr-2 space-y-4">
                {stageNotes.length === 0 ? (
                  <div className="text-center p-8 text-muted-foreground/50 border border-dashed border-border rounded-2xl text-sm">
                    Empty Stage
                  </div>
                ) : (
                  stageNotes.map(note => (
                    <div 
                      key={note.id}
                      onClick={() => onSelectNote(note.id)}
                      className="bg-card border border-border rounded-2xl p-4 shadow-sm hover:shadow-md hover:border-primary/30 transition-all cursor-pointer group"
                    >
                      <div className="flex items-start justify-between gap-2 mb-2">
                        <h4 className="font-bold text-sm leading-tight group-hover:text-primary transition-colors">
                          {note.title || 'Untitled'}
                        </h4>
                      </div>
                      {note.summary && (
                        <p className="text-xs text-muted-foreground line-clamp-2 mb-3">
                          {note.summary}
                        </p>
                      )}
                      <div className="flex items-center justify-between">
                        <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">
                          {note.folder || 'General'}
                        </span>
                        {note.priority && (
                          <span className={`text-[10px] font-bold px-2 py-1 rounded-md border ${
                            note.priority === 'P1' ? 'bg-rose-500/10 text-rose-500 border-rose-500/20' :
                            note.priority === 'P2' ? 'bg-amber-500/10 text-amber-500 border-amber-500/20' :
                            'bg-slate-500/10 text-slate-500 border-slate-500/20'
                          }`}>
                            {note.priority}
                          </span>
                        )}
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
