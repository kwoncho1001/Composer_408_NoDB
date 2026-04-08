import React, { useState } from 'react';
import { Loader2, X } from 'lucide-react';

interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: (data: any) => void;
  title: string;
}

export const KeywordInputModal: React.FC<ModalProps> = ({ isOpen, onClose, onConfirm, title }) => {
  const [keyword, setKeyword] = useState('');

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-card border border-border rounded-2xl p-6 w-full max-w-md shadow-xl">
        <div className="flex justify-between items-center mb-4">
          <h3 className="text-lg font-bold">{title}</h3>
          <button onClick={onClose}><X size={20} /></button>
        </div>
        <input
          type="text"
          value={keyword}
          onChange={(e) => setKeyword(e.target.value)}
          placeholder="예: 결제 시스템, 사용자 경험 개선"
          className="w-full bg-background border border-border rounded-xl p-3 mb-4"
        />
        <button
          onClick={() => onConfirm(keyword)}
          className="w-full bg-primary text-primary-foreground py-2 rounded-xl font-bold"
        >
          생성하기
        </button>
      </div>
    </div>
  );
};

export const SuggestedKeywordsModal: React.FC<ModalProps & { suggestions: string[] }> = ({ isOpen, onClose, onConfirm, title, suggestions }) => {
  const [selected, setSelected] = useState<string[]>([]);

  if (!isOpen) return null;

  const toggleKeyword = (k: string) => {
    setSelected(prev => prev.includes(k) ? prev.filter(i => i !== k) : [...prev, k]);
  };

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-card border border-border rounded-2xl p-6 w-full max-w-md shadow-xl">
        <div className="flex justify-between items-center mb-4">
          <h3 className="text-lg font-bold">{title}</h3>
          <button onClick={onClose}><X size={20} /></button>
        </div>
        <div className="flex flex-wrap gap-2 mb-4">
          {suggestions.map(k => (
            <button
              key={k}
              onClick={() => toggleKeyword(k)}
              className={`px-3 py-1 rounded-full text-xs font-bold ${selected.includes(k) ? 'bg-primary text-primary-foreground' : 'bg-muted'}`}
            >
              {k}
            </button>
          ))}
        </div>
        <button
          onClick={() => onConfirm(selected)}
          className="w-full bg-primary text-primary-foreground py-2 rounded-xl font-bold"
        >
          선택한 키워드로 생성
        </button>
      </div>
    </div>
  );
};
