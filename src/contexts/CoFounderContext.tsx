import React, { createContext, useContext, useState } from 'react';
import { ProactiveNudge } from '../types';

interface CoFounderContextType {
  nudges: ProactiveNudge[];
  setNudges: React.Dispatch<React.SetStateAction<ProactiveNudge[]>>;
  pastNudges: string[];
  setPastNudges: React.Dispatch<React.SetStateAction<string[]>>;
  loadingNudgeTypes: string[];
  setLoadingNudgeTypes: React.Dispatch<React.SetStateAction<string[]>>;
  isFetchingNudges: boolean;
  setIsFetchingNudges: React.Dispatch<React.SetStateAction<boolean>>;
  isCoFounderOpen: boolean;
  setIsCoFounderOpen: React.Dispatch<React.SetStateAction<boolean>>;
  applyingNudgeId: string | null;
  setApplyingNudgeId: React.Dispatch<React.SetStateAction<string | null>>;
}

const CoFounderContext = createContext<CoFounderContextType | undefined>(undefined);

export const CoFounderProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [nudges, setNudges] = useState<ProactiveNudge[]>([]);
  const [pastNudges, setPastNudges] = useState<string[]>([]);
  const [loadingNudgeTypes, setLoadingNudgeTypes] = useState<string[]>([]);
  const [isFetchingNudges, setIsFetchingNudges] = useState(false);
  const [isCoFounderOpen, setIsCoFounderOpen] = useState(false);
  const [applyingNudgeId, setApplyingNudgeId] = useState<string | null>(null);

  return (
    <CoFounderContext.Provider value={{
      nudges, setNudges,
      pastNudges, setPastNudges,
      loadingNudgeTypes, setLoadingNudgeTypes,
      isFetchingNudges, setIsFetchingNudges,
      isCoFounderOpen, setIsCoFounderOpen,
      applyingNudgeId, setApplyingNudgeId
    }}>
      {children}
    </CoFounderContext.Provider>
  );
};

export const useCoFounder = () => {
  const context = useContext(CoFounderContext);
  if (!context) {
    throw new Error('useCoFounder must be used within a CoFounderProvider');
  }
  return context;
};
