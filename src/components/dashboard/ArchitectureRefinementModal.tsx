import React, { useState } from 'react';
import { X, Layers, Blocks, Cpu, Loader2, Sparkles, MessageSquarePlus, CheckCircle2 } from 'lucide-react';
import { motion } from 'motion/react';

interface ArchitectureRefinementModalProps {
  isOpen: boolean;
  onClose: () => void;
  blueprint: any;
  onRefine: (feedback: string) => void;
  onFinalize: (finalBlueprint: any) => void;
  isRefining: boolean;
  isFinalizing: boolean;
  progressMessage?: string;
}

export const ArchitectureRefinementModal: React.FC<ArchitectureRefinementModalProps> = ({
  isOpen,
  onClose,
  blueprint,
  onRefine,
  onFinalize,
  isRefining,
  isFinalizing,
  progressMessage
}) => {
  const [feedback, setFeedback] = useState('');

  if (!isOpen || !blueprint) return null;

  return (
    <div className="absolute inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm p-4">
      <div className="bg-card border border-border rounded-2xl shadow-xl w-full max-w-6xl p-8 relative max-h-[90vh] flex flex-col">
        <button 
          onClick={onClose}
          disabled={isFinalizing}
          className="absolute top-6 right-6 text-muted-foreground hover:text-foreground disabled:opacity-50"
        >
          <X size={24} />
        </button>
        
        <h3 className="text-2xl font-black mb-3 flex items-center gap-3 text-primary">
          <Sparkles size={28} />
          아키텍처 설계 검토 및 구체화
        </h3>
        <p className="text-base text-muted-foreground mb-8">
          AI가 제안한 초기 설계도입니다. 구조를 검토하고 수정 사항을 요청하거나, 바로 최종 적용하여 상세 내용을 생성하세요.
        </p>

        {/* Blueprint Tree View */}
        <div className="flex-1 overflow-y-auto custom-scrollbar mb-8 bg-muted/30 rounded-2xl p-6 border border-border">
          {blueprint.domains?.map((domain: any, dIdx: number) => (
            <div key={dIdx} className="mb-10 last:mb-0">
              <div className="flex items-start gap-4 mb-4">
                <Layers className="text-primary mt-1 shrink-0" size={24} />
                <div>
                  <h4 className="text-xl font-black text-foreground">{domain.title}</h4>
                  <p className="text-sm text-muted-foreground mt-1">{domain.summary}</p>
                </div>
              </div>
              
              <div className="pl-8 space-y-6 border-l-2 border-border/50 ml-3">
                {domain.modules?.map((mod: any, mIdx: number) => (
                  <div key={mIdx}>
                    <div className="flex items-start gap-3 mb-3">
                      <Blocks className="text-purple-500 mt-1 shrink-0" size={20} />
                      <div>
                        <h5 className="font-bold text-lg text-foreground">{mod.title}</h5>
                        <p className="text-sm text-muted-foreground mt-1">{mod.summary}</p>
                      </div>
                    </div>
                    
                    <div className="pl-8 space-y-3 border-l-2 border-border/50 ml-2">
                      {mod.logics?.map((logic: any, lIdx: number) => (
                        <div key={lIdx} className="flex items-start gap-3 bg-background p-4 rounded-xl border border-border/50 shadow-sm">
                          <Cpu className="text-emerald-500 mt-1 shrink-0" size={18} />
                          <div>
                            <h6 className="font-bold text-base text-foreground">{logic.title}</h6>
                            <p className="text-sm text-muted-foreground mt-1">{logic.summary}</p>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>

        {/* Interaction Area */}
        <div className="flex flex-col gap-4">
          {isFinalizing ? (
            <div className="bg-primary/5 border border-primary/20 rounded-2xl p-8 flex flex-col items-center justify-center space-y-6">
              <Loader2 size={48} className="animate-spin text-primary" />
              <div className="text-center">
                <p className="font-black text-xl text-primary mb-2">상세 설계도 생성 중...</p>
                <p className="text-sm text-muted-foreground animate-pulse">{progressMessage || '각 노드의 맥락을 분석하여 내용을 채우고 있습니다.'}</p>
              </div>
            </div>
          ) : (
            <>
              <div className="flex gap-4">
                <textarea
                  value={feedback}
                  onChange={(e) => setFeedback(e.target.value)}
                  placeholder="예: '결제 모듈'에 '포인트 사용 로직'을 추가해줘. 또는 '사용자 도메인'은 빼줘."
                  className="flex-1 h-24 bg-background border border-border rounded-2xl p-4 text-base focus:outline-none focus:ring-2 focus:ring-primary/50 resize-none"
                  disabled={isRefining}
                />
                <button
                  onClick={() => {
                    onRefine(feedback);
                    setFeedback('');
                  }}
                  disabled={isRefining || !feedback.trim()}
                  className="bg-secondary text-secondary-foreground px-6 py-3 rounded-2xl text-base font-black hover:bg-secondary/80 transition-colors disabled:opacity-50 flex flex-col items-center justify-center gap-2 min-w-[140px]"
                >
                  {isRefining ? <Loader2 size={24} className="animate-spin" /> : <MessageSquarePlus size={24} />}
                  <span>수정 요청</span>
                </button>
              </div>
              
              <div className="flex justify-end gap-3 pt-4 border-t border-border">
                <button
                  onClick={onClose}
                  className="px-6 py-3 rounded-2xl text-base font-bold hover:bg-muted transition-colors"
                >
                  취소
                </button>
                <button
                  onClick={() => onFinalize(blueprint)}
                  className="flex items-center gap-3 bg-primary text-primary-foreground px-8 py-3 rounded-2xl text-lg font-black hover:bg-primary/90 transition-colors shadow-lg shadow-primary/20"
                >
                  <CheckCircle2 size={24} />
                  최종 적용 및 상세 내용 생성
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
};
