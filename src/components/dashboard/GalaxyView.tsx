import React, { useEffect, useRef } from 'react';
import { Note, LensType } from '../../types';
import * as d3 from 'd3';

interface GalaxyViewProps {
  notes: Note[];
  projectName: string;
  onSelectNote: (id: string) => void;
  activeLens: LensType;
}

interface Node extends d3.SimulationNodeDatum {
  id: string;
  group: number;
  radius: number;
  title: string;
  type: 'project' | 'domain' | 'module' | 'logic' | 'snapshot';
  status?: string;
}

interface Link extends d3.SimulationLinkDatum<Node> {
  source: string | Node;
  target: string | Node;
  value: number;
}

export const GalaxyView: React.FC<GalaxyViewProps> = ({ notes, projectName, onSelectNote, activeLens }) => {
  const svgRef = useRef<SVGSVGElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!svgRef.current || !containerRef.current || notes.length === 0) return;

    // Filter notes by activeLens
    const filteredNotes = notes.filter(n => {
      if (n.noteType === 'Domain' || n.noteType === 'Module') {
        if (n.lens && n.lens !== activeLens) return false;
        if (!n.lens && activeLens !== 'Feature') return false;
      }
      return true;
    });

    const width = containerRef.current.clientWidth;
    const height = containerRef.current.clientHeight;

    // Clear previous graph
    d3.select(svgRef.current).selectAll("*").remove();

    // Prepare data
    const nodes: Node[] = [];
    const links: Link[] = [];

    // Central Project Node
    nodes.push({
      id: 'project',
      group: 0,
      radius: 40,
      title: projectName,
      type: 'project'
    });

    const noteIds = new Set(filteredNotes.map(n => n.id));

    // Add notes as nodes
    filteredNotes.forEach(note => {
      let radius = 15;
      let group = 1;
      
      if (note.noteType === 'Domain') { radius = 30; group = 1; }
      else if (note.noteType === 'Module') { radius = 20; group = 2; }
      else if (note.noteType === 'Logic') { radius = 12; group = 3; }
      else if (note.noteType === 'Snapshot') { radius = 8; group = 4; }

      nodes.push({
        id: note.id,
        group: group,
        radius: radius,
        title: note.title || 'Untitled',
        type: note.noteType.toLowerCase() as 'project' | 'domain' | 'module' | 'logic' | 'snapshot',
        status: note.status
      });
    });

    // Add links based on parentNoteIds
    filteredNotes.forEach(note => {
      if (note.parentNoteIds && note.parentNoteIds.length > 0) {
        let hasValidParent = false;
        note.parentNoteIds.forEach(parentId => {
          if (noteIds.has(parentId)) {
            links.push({
              source: parentId,
              target: note.id,
              value: 1
            });
            hasValidParent = true;
          }
        });
        
        // Fallback: if no valid parent exists in the current notes array, link to project
        if (!hasValidParent) {
          links.push({
            source: 'project',
            target: note.id,
            value: note.noteType === 'Domain' ? 2 : 1
          });
        }
      } else {
        // No parent specified, link to project root
        links.push({
          source: 'project',
          target: note.id,
          value: note.noteType === 'Domain' ? 2 : 1
        });
      }
    });

    const svg = d3.select(svgRef.current)
      .attr("viewBox", [0, 0, width, height])
      .style("max-width", "100%")
      .style("height", "auto");

    // Add zoom capabilities
    const g = svg.append("g");
    
    const zoom = d3.zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.1, 4])
      .on("zoom", (event) => {
        g.attr("transform", event.transform);
      });
      
    svg.call(zoom);

    const simulation = d3.forceSimulation<Node>(nodes)
      .force("link", d3.forceLink<Node, Link>(links).id(d => d.id).distance(d => {
        if (d.source === 'project') return 120;
        if ((d.source as any).type === 'domain') return 80;
        if ((d.source as any).type === 'module') return 50;
        return 40;
      }))
      .force("charge", d3.forceManyBody().strength(-200))
      .force("center", d3.forceCenter(width / 2, height / 2))
      .force("collide", d3.forceCollide<Node>().radius(d => d.radius + 15).iterations(2));

    const link = g.append("g")
      .attr("stroke", "#999")
      .attr("stroke-opacity", 0.3)
      .selectAll("line")
      .data(links)
      .join("line")
      .attr("stroke-width", d => Math.sqrt(d.value));

    const node = g.append("g")
      .attr("stroke", "#fff")
      .attr("stroke-width", 1.5)
      .selectAll("circle")
      .data(nodes)
      .join("circle")
      .attr("r", d => d.radius)
      .attr("fill", d => {
        if (d.type === 'project') return '#8b5cf6'; // purple-500
        if (d.type === 'domain') return '#3b82f6'; // blue-500
        if (d.status === 'Done') return '#10b981'; // emerald-500
        if (d.status === 'Conflict') return '#f43f5e'; // rose-500
        if (d.status === 'In Progress') return '#f59e0b'; // amber-500
        return '#64748b'; // slate-500
      })
      .style("cursor", d => d.type !== 'project' ? 'pointer' : 'default')
      .on("click", (event, d) => {
        if (d.type !== 'project') {
          onSelectNote(d.id);
        }
      });

    node.append("title")
      .text(d => d.title);

    const labels = g.append("g")
      .selectAll("text")
      .data(nodes)
      .join("text")
      .text(d => d.title.length > 15 ? d.title.substring(0, 15) + '...' : d.title)
      .attr("font-size", d => d.type === 'project' ? "14px" : d.type === 'domain' ? "12px" : "10px")
      .attr("font-weight", d => (d.type === 'logic' || d.type === 'snapshot') ? "normal" : "bold")
      .attr("fill", "currentColor")
      .attr("text-anchor", "middle")
      .attr("dy", d => d.radius + 15)
      .style("pointer-events", "none");

    simulation.on("tick", () => {
      link
        .attr("x1", d => (d.source as Node).x!)
        .attr("y1", d => (d.source as Node).y!)
        .attr("x2", d => (d.target as Node).x!)
        .attr("y2", d => (d.target as Node).y!);

      node
        .attr("cx", d => d.x!)
        .attr("cy", d => d.y!);
        
      labels
        .attr("x", d => d.x!)
        .attr("y", d => d.y!);
    });

    // Drag functions
    const drag = d3.drag<SVGCircleElement, Node>()
      .on("start", (event, d) => {
        if (!event.active) simulation.alphaTarget(0.3).restart();
        d.fx = d.x;
        d.fy = d.y;
      })
      .on("drag", (event, d) => {
        d.fx = event.x;
        d.fy = event.y;
      })
      .on("end", (event, d) => {
        if (!event.active) simulation.alphaTarget(0);
        d.fx = null;
        d.fy = null;
      });

    node.call(drag as any);

    return () => {
      simulation.stop();
    };
  }, [notes, projectName, onSelectNote]);

  return (
    <div ref={containerRef} className="w-full h-full bg-card border border-border rounded-3xl shadow-sm overflow-hidden relative">
      <div className="absolute top-4 left-4 bg-background/80 backdrop-blur-sm p-3 rounded-xl border border-border text-xs space-y-2 z-10">
        <div className="font-bold mb-2 uppercase tracking-widest text-muted-foreground">Legend</div>
        <div className="flex items-center gap-2"><div className="w-3 h-3 rounded-full bg-purple-500"></div> Project Core</div>
        <div className="flex items-center gap-2"><div className="w-3 h-3 rounded-full bg-blue-500"></div> Domain</div>
        <div className="flex items-center gap-2"><div className="w-3 h-3 rounded-full bg-slate-500"></div> Planned</div>
        <div className="flex items-center gap-2"><div className="w-3 h-3 rounded-full bg-amber-500"></div> In Progress</div>
        <div className="flex items-center gap-2"><div className="w-3 h-3 rounded-full bg-emerald-500"></div> Done</div>
        <div className="flex items-center gap-2"><div className="w-3 h-3 rounded-full bg-rose-500"></div> Conflict</div>
      </div>
      <svg ref={svgRef} className="w-full h-full cursor-grab active:cursor-grabbing"></svg>
    </div>
  );
};
