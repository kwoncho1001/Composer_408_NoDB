import React from 'react';
import { motion } from 'motion/react';
import { MindMap, MindMapNode } from '../types';
import { cn } from '../lib/utils';
import { Lightbulb, Layers, Cpu, Target, ChevronRight } from 'lucide-react';

interface MindMapViewProps {
  mindMap: MindMap;
  onRefine?: (feedback: string) => void;
}

const NodeIcon = ({ type }: { type: MindMapNode['type'] }) => {
  switch (type) {
    case 'core': return <Lightbulb size={16} className="text-yellow-500" />;
    case 'feature': return <Layers size={16} className="text-blue-500" />;
    case 'technical': return <Cpu size={16} className="text-purple-500" />;
    case 'market': return <Target size={16} className="text-green-500" />;
    default: return null;
  }
};

const MindMapNodeItem: React.FC<{ node: MindMapNode; depth?: number }> = ({ node, depth = 0 }) => {
  return (
    <div className={cn("flex flex-col gap-2", depth > 0 && "ml-6 border-l border-border/50 pl-4")}>
      <motion.div 
        initial={{ opacity: 0, x: -10 }}
        animate={{ opacity: 1, x: 0 }}
        className="flex items-start gap-3 p-3 rounded-xl bg-card border border-border/50 shadow-sm hover:shadow-md transition-all group"
      >
        <div className="mt-1">
          <NodeIcon type={node.type} />
        </div>
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <span className="font-bold text-sm">{node.label}</span>
            <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-muted text-muted-foreground uppercase tracking-wider font-bold">
              {node.type}
            </span>
          </div>
          {node.description && (
            <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
              {node.description}
            </p>
          )}
        </div>
      </motion.div>
      {node.children && node.children.length > 0 && (
        <div className="flex flex-col gap-2 mt-1">
          {node.children.map((child, idx) => (
            <MindMapNodeItem key={`${child.id}-${idx}`} node={child} depth={depth + 1} />
          ))}
        </div>
      )}
    </div>
  );
};

export const MindMapView: React.FC<MindMapViewProps> = ({ mindMap }) => {
  return (
    <div className="flex flex-col gap-6">
      <div className="bg-primary/5 border border-primary/10 rounded-2xl p-4">
        <h3 className="text-sm font-bold text-primary flex items-center gap-2 mb-2">
          <Lightbulb size={16} />
          AI가 이해한 생각의 지도
        </h3>
        <p className="text-sm text-muted-foreground leading-relaxed italic">
          "{mindMap.summary}"
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {mindMap.nodes.map((node, idx) => (
          <MindMapNodeItem key={`${node.id}-${idx}`} node={node} />
        ))}
      </div>
    </div>
  );
};
