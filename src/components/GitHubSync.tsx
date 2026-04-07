import React, { useState, useEffect, useRef } from 'react';
import { fetchRepoTree, fetchFileContent, getCurrentCommitSHA, getChangedFiles } from '../services/github';
import { analyzeLogicUnit, translateToBusinessLogic, checkImplementationConflict, getEmbeddingsBulk, cosineSimilarity, generateModuleFromCluster, generateDomainsFromModules } from '../services/gemini';
import { kMeansClustering } from '../lib/clustering';
import { parseCodeToNodes } from '../services/astParser';
import { useAuth } from '../contexts/AuthContext';
import { Note, OperationType, LensType } from '../types';
import { computeHash } from '../lib/utils';
import * as dbManager from '../services/dbManager';
import { Github, RefreshCw, AlertCircle, PanelRightClose, X, Trash2, ChevronDown, ChevronUp, Loader2, Sparkles } from 'lucide-react';
import { toast } from 'sonner';

export const GitHubSync = ({ onClose, projectId, onSyncComplete, activeLens, setActiveLens }: { onClose: () => void, projectId: string | null, onSyncComplete?: () => void, activeLens: LensType, setActiveLens: (lens: LensType) => void }) => {
  const { user } = useAuth();
  const [repoUrl, setRepoUrl] = useState('');
  const [syncing, setSyncing] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);
  const [logs, setLogs] = useState<{ msg: string, time: string }[]>([]);
  const [granularity, setGranularity] = useState<number>(2);
  const [similarityThreshold, setSimilarityThreshold] = useState<number>(0.75);
  const [reconstructStrictness, setReconstructStrictness] = useState<number>(0.75);
  const [isSettingsExpanded, setIsSettingsExpanded] = useState(true);
  const cancelSyncRef = useRef(false);
  const logsEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (logsEndRef.current) {
      logsEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [logs]);

  useEffect(() => {
    if (!projectId) return;
    const fetchProject = async () => {
      try {
        const localProjects = await dbManager.getAllProjects();
        const localProject = localProjects.find(p => p.id === projectId);
        if (localProject && localProject.repoUrl) {
          setRepoUrl(localProject.repoUrl);
        }
      } catch (error) {
        console.error("Error fetching local project", error);
      }
    };
    fetchProject();
  }, [projectId]);

  const [isReconstructing, setIsReconstructing] = useState(false);

  const addLog = (msg: string) => {
    const time = new Date().toLocaleTimeString([], { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
    setLogs(prev => [...prev, { msg, time }]);
  };

  const handleSaveUrl = async () => {
    if (!projectId) return;
    try {
      const project = await dbManager.getProject(projectId);
      if (project) {
        await dbManager.saveProject({ ...project, repoUrl });
      }
      addLog('Repository URL saved.');
      toast.success('Repository URL saved');
    } catch (error) {
      console.error("Error saving local project URL", error);
      toast.error('Failed to save URL');
    }
  };

  const handleCancelSync = () => {
    cancelSyncRef.current = true;
    addLog('Cancelling sync... Please wait for the current file to finish.');
  };

  const handleAutoReconstruct = async () => {
    if (!user || !projectId) return;
    
    let targetLens = activeLens;
    if (activeLens === 'Snapshot') {
      addLog('Switching to Feature lens for reconstruction...');
      setActiveLens('Feature');
      targetLens = 'Feature';
    }
    
    setIsReconstructing(true);
    cancelSyncRef.current = false;
    setLogs([]);
    addLog(`Starting Auto-Reconstruct for Lens: ${targetLens}...`);

    try {
      const allLocalNotes = await dbManager.getAllNotes();
      const logicNotes = allLocalNotes.filter(n => n.projectId === projectId && n.noteType === 'Logic');
      const existingLensNotes = allLocalNotes.filter(n => 
        n.projectId === projectId && 
        (n.noteType === 'Domain' || n.noteType === 'Module') && 
        n.lens === targetLens
      );

      if (logicNotes.length === 0) {
        addLog('No Logic notes found to reconstruct.');
        setIsReconstructing(false);
        return;
      }
      addLog(`Found ${logicNotes.length} Logic notes. Generating Blueprint...`);

      if (existingLensNotes.length > 0) {
        addLog(`Clearing ${existingLensNotes.length} existing Domains/Modules for Lens: ${activeLens}...`);
        for (const note of existingLensNotes) {
          await dbManager.deleteNote(note.id);
        }
        
        const deletedIds = new Set(existingLensNotes.map(n => n.id));
        const updatedLogics: Note[] = [];
        
        for (const logic of logicNotes) {
          if (logic.parentNoteIds && logic.parentNoteIds.some(id => deletedIds.has(id))) {
            const newParentIds = logic.parentNoteIds.filter(id => !deletedIds.has(id));
            updatedLogics.push({ ...logic, parentNoteIds: newParentIds });
          }
        }
        if (updatedLogics.length > 0) await dbManager.bulkSaveNotes(updatedLogics);
        
        updatedLogics.forEach(ul => {
          const idx = logicNotes.findIndex(l => l.id === ul.id);
          if (idx !== -1) logicNotes[idx] = ul;
        });
      }

      addLog(`Preparing embeddings for ${logicNotes.length} Logic notes...`);
      let logicEmbeddings: number[][] = new Array(logicNotes.length).fill([]);
      const textsToEmbed: string[] = [];
      const indicesToEmbed: number[] = [];
      
      logicNotes.forEach((logic, idx) => {
        if (logic.embedding && logic.embedding.length > 0) {
          logicEmbeddings[idx] = logic.embedding;
        } else {
          textsToEmbed.push(`${logic.title} ${logic.summary}`);
          indicesToEmbed.push(idx);
        }
      });

      if (textsToEmbed.length > 0) {
        addLog(`Fetching embeddings for ${textsToEmbed.length} notes...`);
        const newEmbeddings = await getEmbeddingsBulk(textsToEmbed);
        if (cancelSyncRef.current) throw new Error("Reconstruction cancelled by user");
        newEmbeddings.forEach((emb, i) => {
          const originalIdx = indicesToEmbed[i];
          logicEmbeddings[originalIdx] = emb;
          const updatedNote = {
            ...logicNotes[originalIdx],
            embedding: emb,
            lastUpdated: new Date().toISOString()
          };
          dbManager.saveNote(updatedNote);
        });
      }

      const divisor = Math.max(2, 2 + (1 - reconstructStrictness) * 20);
      const k = Math.max(1, Math.ceil(logicNotes.length / divisor));
      addLog(`Clustering ${logicNotes.length} logics into ${k} modules (Strictness: ${Math.round(reconstructStrictness * 100)}%)...`);
      const assignments = kMeansClustering(logicEmbeddings, k);

      const clusters: { [key: number]: Note[] } = {};
      for (let i = 0; i < assignments.length; i++) {
        const clusterId = assignments[i];
        if (!clusters[clusterId]) clusters[clusterId] = [];
        clusters[clusterId].push(logicNotes[i]);
      }

      addLog(`Generating Module details using AI...`);
      const generatedModules: { id: string, title: string, summary: string, body: string, logicIds: string[] }[] = [];
      
      const clusterPromises = Object.entries(clusters).map(async ([clusterId, logics], idx) => {
        if (cancelSyncRef.current) return;
        const logicsData = logics.map(l => ({ title: l.title, summary: l.summary }));
        const moduleData = await generateModuleFromCluster(logicsData);
        generatedModules.push({
          id: `MOD_${idx}`,
          ...moduleData,
          logicIds: logics.map(l => l.id)
        });
      });

      await Promise.all(clusterPromises);
      if (cancelSyncRef.current) throw new Error("Reconstruction cancelled by user");

      addLog(`Grouping ${generatedModules.length} Modules into Domains...`);
      const modulesData = generatedModules.map(m => ({ id: m.id, title: m.title, summary: m.summary }));
      const domainsBlueprint = await generateDomainsFromModules(modulesData);

      if (!domainsBlueprint.domains || domainsBlueprint.domains.length === 0) {
        throw new Error("Failed to generate domains blueprint.");
      }
      
      const assignedModuleIds = new Set(domainsBlueprint.domains.flatMap(d => d.moduleIds || []));
      const unassignedModules = generatedModules.filter(m => !assignedModuleIds.has(m.id));
      
      if (unassignedModules.length > 0) {
        domainsBlueprint.domains.push({
          title: "기타 기능 및 유틸리티",
          summary: "특정 도메인에 분류되지 않은 나머지 기능 모듈들입니다.",
          moduleIds: unassignedModules.map(m => m.id)
        });
      }

      addLog(`Blueprint generated with ${domainsBlueprint.domains.length} Domains.`);

      for (const domainData of domainsBlueprint.domains) {
        if (cancelSyncRef.current) throw new Error("Reconstruction cancelled by user");
        const domainId = crypto.randomUUID();
        const domainNote: Note = {
          id: domainId,
          title: domainData.title.substring(0, 200),
          projectId,
          summary: domainData.summary || '',
          body: '',
          noteType: 'Domain',
          status: 'Planned',
          priority: '3rd',
          parentNoteIds: [],
          childNoteIds: [],
          uid: user.uid,
          lastUpdated: new Date().toISOString(),
          createdAt: new Date().toISOString(),
          lens: 'Feature'
        };

        await dbManager.saveNote(domainNote);

        if (domainData.moduleIds) {
          for (const moduleIdKey of domainData.moduleIds) {
            const moduleData = generatedModules.find(m => m.id === moduleIdKey);
            if (!moduleData) continue;

            const moduleId = crypto.randomUUID();
            const [moduleEmbedding] = await getEmbeddingsBulk([`${moduleData.title} ${moduleData.summary || ''}`]);
            
            const moduleNote: Note = {
              id: moduleId,
              title: moduleData.title.substring(0, 200),
              projectId,
              summary: moduleData.summary || '',
              body: moduleData.body || '',
              noteType: 'Module',
              status: 'Planned',
              priority: '3rd',
              parentNoteIds: [domainId],
              childNoteIds: moduleData.logicIds,
              uid: user.uid,
              lastUpdated: new Date().toISOString(),
              createdAt: new Date().toISOString(),
              embeddingHash: await computeHash(`${moduleData.title} ${moduleData.summary || ''}`),
              embeddingModel: 'gemini-embedding-2-preview',
              lastEmbeddedAt: new Date().toISOString(),
              embedding: moduleEmbedding,
              lens: 'Feature'
            };

            await dbManager.saveNote(moduleNote);
            
            domainNote.childNoteIds.push(moduleId);
            await dbManager.saveNote(domainNote);

            for (const logicId of moduleData.logicIds) {
              const logicIdx = logicNotes.findIndex(l => l.id === logicId);
              if (logicIdx !== -1) {
                const updatedLogic = {
                  ...logicNotes[logicIdx],
                  parentNoteIds: [...(logicNotes[logicIdx].parentNoteIds || []), moduleId],
                  lastUpdated: new Date().toISOString()
                };
                logicNotes[logicIdx] = updatedLogic;
                await dbManager.saveNote(updatedLogic);
              }
            }
          }
        }
      }

      addLog(`Auto-Reconstruct complete!`);
      if (onSyncComplete) onSyncComplete();

    } catch (error) {
      addLog(`Auto-Reconstruct failed: ${error}`);
      console.error(error);
    } finally {
      setIsReconstructing(false);
    }
  };

  const executeReset = async () => {
    if (!projectId || !user) return;
    setResetting(true);
    setConfirmReset(false);
    addLog('Resetting snapshots...');
    try {
      const allLocalNotes = await dbManager.getAllNotes();
      const localSnapshots = allLocalNotes.filter(n => 
        n.projectId === projectId && 
        n.noteType === 'Snapshot'
      );
      
      for (const note of localSnapshots) {
        await dbManager.deleteNote(note.id);
      }
      
      const localLogics = allLocalNotes.filter(n => n.projectId === projectId && n.noteType === 'Logic');
      const updatedLogics = localLogics.map(l => ({ 
        ...l, 
        childNoteIds: [] 
      }));
      
      if (updatedLogics.length > 0) {
        await dbManager.bulkSaveNotes(updatedLogics);
      }
      
      addLog(`Cleared local snapshot references.`);
      if (onSyncComplete) onSyncComplete();
    } catch (error) {
      addLog(`Reset failed: ${error}`);
      console.error(error);
    } finally {
      setResetting(false);
    }
  };

  const handleSync = async () => {
    if (!repoUrl || !user || !projectId) return;
    setSyncing(true);
    cancelSyncRef.current = false;
    setLogs([]);
    addLog(`Starting sync for ${repoUrl}...`);

    try {
      await dbManager.saveProject({
        id: projectId,
        repoUrl,
        uid: user.uid
      });

      addLog('Checking for changes...');
      console.log(`[Sync] ProjectId: ${projectId}`);
      const currentSHA = await getCurrentCommitSHA(repoUrl);
      const lastAnalyzedSHA = await dbManager.getSetting(`lastAnalyzedSHA_${projectId}`);
      console.log(`[Sync] LastAnalyzedSHA: ${lastAnalyzedSHA}`);
      
      let filesToProcess: any[] = [];
      
      if (lastAnalyzedSHA) {
        addLog(`Comparing with last analyzed commit: ${lastAnalyzedSHA.substring(0, 7)}`);
        try {
          const changedFiles = await getChangedFiles(repoUrl, lastAnalyzedSHA, currentSHA);
          addLog(`${changedFiles.length} files changed.`);
          
          const tree = await fetchRepoTree(repoUrl);
          filesToProcess = tree.filter((item: any) => 
            item.type === 'blob' && 
            (item.path.endsWith('.ts') || item.path.endsWith('.tsx') || item.path.endsWith('.js') || item.path.endsWith('.jsx')) &&
            changedFiles.includes(item.path)
          );
        } catch (e) {
          addLog('Failed to compare commits, syncing all files...');
          const tree = await fetchRepoTree(repoUrl);
          filesToProcess = tree.filter((item: any) => 
            item.type === 'blob' && 
            (item.path.endsWith('.ts') || item.path.endsWith('.tsx') || item.path.endsWith('.js') || item.path.endsWith('.jsx'))
          );
        }
      } else {
        addLog('No previous analysis found. Syncing all files...');
        const tree = await fetchRepoTree(repoUrl);
        filesToProcess = tree.filter((item: any) => 
          item.type === 'blob' && 
          (item.path.endsWith('.ts') || item.path.endsWith('.tsx') || item.path.endsWith('.js') || item.path.endsWith('.jsx'))
        );
      }

      addLog(`Processing ${filesToProcess.length} files.`);

      const allLocalNotes = await dbManager.getAllNotes();
      const allNotes = allLocalNotes.filter(n => n.projectId === projectId);

      addLog('Pre-computing embeddings for existing Logic notes...');
      const existingLogicNotes = allNotes.filter(n => n.noteType === 'Logic');
      let existingLogicEmbeddings: number[][] = [];
      
      if (existingLogicNotes.length > 0) {
        const textsToEmbed: string[] = [];
        const indicesToEmbed: number[] = [];
        
        existingLogicEmbeddings = new Array(existingLogicNotes.length).fill([]);
        
        existingLogicNotes.forEach((n, idx) => {
          const text = `${n.title} ${n.summary}`;
          if (n.embedding && n.embedding.length > 0) {
            existingLogicEmbeddings[idx] = n.embedding;
          } else {
            textsToEmbed.push(text);
            indicesToEmbed.push(idx);
          }
        });

        if (textsToEmbed.length > 0) {
          addLog(`Calculating missing embeddings for ${textsToEmbed.length} existing Logic notes...`);
          const newEmbeddings = await getEmbeddingsBulk(textsToEmbed);
          newEmbeddings.forEach((emb, i) => {
            const originalIdx = indicesToEmbed[i];
            existingLogicEmbeddings[originalIdx] = emb;
          });
        }
      }

      addLog(`Starting sequential synchronization for ${filesToProcess.length} files...`);
      const claimedEmptyLogics = new Set<string>();

      for (let fileIndex = 0; fileIndex < filesToProcess.length; fileIndex++) {
        if (cancelSyncRef.current) break;
        
        const file = filesToProcess[fileIndex];
        addLog(`\n[${fileIndex + 1}/${filesToProcess.length}] Processing file: ${file.path}`);
        
        try {
          addLog(`  Phase 1: Extracting logic units...`);
          const content = await fetchFileContent(repoUrl, file.path);
          const logicUnits = parseCodeToNodes(file.path, content, granularity);
          const fileLogicUnits: any[] = [];
          
          for (const unit of logicUnits) {
            const normalizedCode = (unit.code || "").replace(/\s+/g, '');
            const unitHash = await computeHash(normalizedCode || (unit.title + content));
            fileLogicUnits.push({ unit, file, content, unitHash });
          }
          
          addLog(`  Extracted ${fileLogicUnits.length} logic units.`);

          if (cancelSyncRef.current) break;

          addLog(`  Phase 2: AI Deep Analysis...`);
          const BATCH_SIZE = 3;
          for (let i = 0; i < fileLogicUnits.length; i += BATCH_SIZE) {
            if (cancelSyncRef.current) break;
            const batchUnits = fileLogicUnits.slice(i, i + BATCH_SIZE);

            await Promise.all(batchUnits.map(async (item) => {
              const { unit, file, unitHash } = item;
              const cachedNote = allNotes.find(n => n.noteType === 'Snapshot' && n.contentHash === unitHash && n.originPath === file.path);
              
              if (cachedNote) {
                addLog(`    Cache Hit: Skipping AI analysis for ${unit.title}`);
                const parentLogic = allNotes.find(n => n.noteType === 'Logic' && n.childNoteIds.includes(cachedNote.id));
                if (parentLogic) {
                  item.isCacheHit = true;
                  item.cachedNote = cachedNote;
                  item.parentLogic = parentLogic;
                  item.businessLogic = {
                    title: parentLogic.title,
                    summary: parentLogic.summary,
                    components: parentLogic.components,
                    flow: parentLogic.flow,
                    io: parentLogic.io
                  };
                  item.analysis = {
                    title: cachedNote.title,
                    summary: cachedNote.summary,
                    components: cachedNote.components,
                    flow: cachedNote.flow,
                    io: cachedNote.io
                  };
                  item.caseType = '4-1';
                  item.targetLogicB = parentLogic;
                  item.targetSnapshotB = cachedNote;
                  item.isConflict = parentLogic.status === 'Conflict';
                  item.conflictDetails = parentLogic.conflictDetails;
                  item.logicAEmbedding = null;
                  item.logicHash = parentLogic.embeddingHash || null;
                }
              }

              if (!item.isCacheHit) {
                try {
                  addLog(`    Analyzing: ${unit.title}`);
                  item.analysis = await analyzeLogicUnit(unit.title, unit.code);
                } catch (err) {
                  addLog(`    Error analyzing ${unit.title}: ${err}`);
                  item.error = true;
                }
              }
            }));
            await new Promise(resolve => setTimeout(resolve, 500));
          }

          if (cancelSyncRef.current) break;

          addLog(`  Phase 3: Generating Business Logic...`);
          for (let i = 0; i < fileLogicUnits.length; i += BATCH_SIZE) {
            if (cancelSyncRef.current) break;
            const batchUnits = fileLogicUnits.slice(i, i + BATCH_SIZE).filter(item => !item.isCacheHit && !item.error);
            
            if (batchUnits.length > 0) {
              await Promise.all(batchUnits.map(async (item) => {
                try {
                  addLog(`    Translating: ${item.unit.title}`);
                  item.businessLogic = await translateToBusinessLogic({ title: item.unit.title, ...item.analysis });
                } catch (err) {
                  addLog(`    Error translating ${item.unit.title}: ${err}`);
                  item.error = true;
                }
              }));
              await new Promise(resolve => setTimeout(resolve, 500));
            }
          }

          if (cancelSyncRef.current) break;

          addLog(`  Phase 4: Vector Search Mapping...`);
          const unitsToEmbed = fileLogicUnits.filter(item => !item.isCacheHit && !item.error);
          const textsToEmbed: string[] = [];
          const indicesToEmbed: number[] = [];
          
          for (let i = 0; i < unitsToEmbed.length; i++) {
            const item = unitsToEmbed[i];
            const logicText = `${item.businessLogic.title} ${item.businessLogic.summary}`;
            const logicHash = await computeHash(logicText);
            item.logicHash = logicHash;
            
            const existingLogicWithSameHash = allNotes.find(n => n.noteType === 'Logic' && n.embeddingHash === logicHash && n.embedding && n.embedding.length > 0);
            
            if (existingLogicWithSameHash && existingLogicWithSameHash.embedding) {
              item.logicAEmbedding = existingLogicWithSameHash.embedding;
            } else {
              textsToEmbed.push(logicText);
              indicesToEmbed.push(i);
            }
          }

          if (textsToEmbed.length > 0) {
            addLog(`    Calculating embeddings for ${textsToEmbed.length} units...`);
            const EMBED_CHUNK_SIZE = 20;
            for (let i = 0; i < textsToEmbed.length; i += EMBED_CHUNK_SIZE) {
              if (cancelSyncRef.current) break;
              const chunkTexts = textsToEmbed.slice(i, i + EMBED_CHUNK_SIZE);
              const chunkIndices = indicesToEmbed.slice(i, i + EMBED_CHUNK_SIZE);
              try {
                const newEmbeddings = await getEmbeddingsBulk(chunkTexts);
                newEmbeddings.forEach((emb, idx) => {
                  const originalIdx = chunkIndices[idx];
                  unitsToEmbed[originalIdx].logicAEmbedding = emb;
                });
              } catch (err) {
                addLog(`    Error calculating embeddings: ${err}`);
                chunkIndices.forEach(idx => {
                   unitsToEmbed[idx].error = true;
                });
              }
            }
          }

          if (cancelSyncRef.current) break;

          for (const item of unitsToEmbed) {
            if (cancelSyncRef.current) break;
            if (item.error || !item.logicAEmbedding) continue;

            let bestMatchLogicB = null;
            let highestSimilarity = -1;

            for (let j = 0; j < existingLogicNotes.length; j++) {
              const sim = cosineSimilarity(item.logicAEmbedding, existingLogicEmbeddings[j]);
              if (sim > highestSimilarity) {
                highestSimilarity = sim;
                bestMatchLogicB = existingLogicNotes[j];
              }
            }

            const SIMILARITY_THRESHOLD = similarityThreshold;
            item.caseType = '4-3';
            item.targetLogicB = null;
            item.targetSnapshotB = null;
            item.isConflict = false;
            item.conflictDetails = undefined;

            if (bestMatchLogicB && highestSimilarity >= SIMILARITY_THRESHOLD) {
              const childSnapshots = allNotes.filter(n => n.noteType === 'Snapshot' && bestMatchLogicB.childNoteIds.includes(n.id));
              const isAlreadyClaimed = claimedEmptyLogics.has(bestMatchLogicB.id);
              
              if (childSnapshots.length > 0 || isAlreadyClaimed) {
                const existingSnapshotForThisFile = childSnapshots.find(s => s.originPath === item.file.path);
                
                if (existingSnapshotForThisFile && !isAlreadyClaimed) {
                  item.caseType = '4-1';
                  item.targetLogicB = bestMatchLogicB;
                  item.targetSnapshotB = existingSnapshotForThisFile;
                  addLog(`    [Queue] Matched existing logic '${bestMatchLogicB.title}' (4-1).`);
                } else {
                  item.caseType = '4-3';
                  item.targetLogicB = null;
                  item.targetSnapshotB = null;
                  addLog(`    [Queue] Room '${bestMatchLogicB.title}' is already occupied! Creating new room (4-3).`);
                }
              } else {
                item.caseType = '4-2';
                item.targetLogicB = bestMatchLogicB;
                claimedEmptyLogics.add(bestMatchLogicB.id);
                addLog(`    [Queue] Claimed empty room '${bestMatchLogicB.title}' (4-2).`);
              }
              
              if (item.caseType !== '4-3') {
                try {
                  const conflictResult = await checkImplementationConflict(item.businessLogic, item.targetLogicB);
                  item.isConflict = conflictResult.isConflict;
                  item.conflictDetails = conflictResult.conflictDetails;
                } catch (err) {
                  addLog(`    Error checking conflict for ${item.businessLogic.title}: ${err}`);
                }
              }
            } else {
              addLog(`    [Queue] No match found. Creating new room (4-3).`);
            }
            await new Promise(resolve => setTimeout(resolve, 1000));
          }

          if (cancelSyncRef.current) break;

          addLog(`  Phase 5: Tree Assembly & Persistence...`);
          for (const result of fileLogicUnits) {
            if (result.error) continue;
            
            const { unit, file: currentFile, analysis, businessLogic, unitHash, caseType, targetLogicB, targetSnapshotB, isConflict, conflictDetails, logicAEmbedding, logicHash } = result;

            const snapshotId = targetSnapshotB ? targetSnapshotB.id : crypto.randomUUID();
            
            if (caseType === '4-1') {
              const logicUpdates: any = {
                ...targetLogicB,
                status: isConflict ? 'Conflict' : 'Done',
                lastUpdated: new Date().toISOString(),
                uid: user.uid,
                sha: currentFile.sha,
                lens: 'Feature',
                ...(conflictDetails ? { conflictDetails } : {}),
                ...(unitHash ? { contentHash: unitHash } : {}),
                ...(logicAEmbedding ? { embedding: logicAEmbedding } : {}),
                ...(logicHash ? { embeddingHash: logicHash } : {}),
                embeddingModel: 'gemini-embedding-2-preview',
                lastEmbeddedAt: new Date().toISOString()
              };

              if (!isConflict && !result.isCacheHit) {
                logicUpdates.title = businessLogic.title.substring(0, 200);
                logicUpdates.summary = businessLogic.summary;
                logicUpdates.components = businessLogic.components;
                logicUpdates.flow = businessLogic.flow;
                logicUpdates.io = businessLogic.io;
              }

              await dbManager.saveNote(logicUpdates);

              const snapshotNote: Note = {
                id: snapshotId,
                title: analysis.title,
                projectId,
                summary: analysis.summary,
                body: unit.code || '',
                components: analysis.components,
                flow: analysis.flow,
                io: analysis.io,
                noteType: 'Snapshot',
                status: 'Done',
                priority: 'Done',
                parentNoteIds: [targetLogicB.id],
                childNoteIds: [],
                uid: user.uid,
                originPath: currentFile.path,
                startLine: unit.startLine,
                endLine: unit.endLine,
                codeSnippet: unit.code,
                contentHash: unitHash,
                lastUpdated: new Date().toISOString(),
                createdAt: targetSnapshotB ? targetSnapshotB.createdAt : new Date().toISOString(),
                lens: 'Snapshot'
              };
              await dbManager.saveNote(snapshotNote);

            } else if (caseType === '4-2') {
              const logicUpdates: any = {
                ...targetLogicB,
                title: businessLogic.title.substring(0, 200),
                summary: businessLogic.summary,
                components: businessLogic.components,
                flow: businessLogic.flow,
                io: businessLogic.io,
                status: isConflict ? 'Conflict' : 'Done',
                lastUpdated: new Date().toISOString(),
                uid: user.uid,
                sha: currentFile.sha,
                lens: 'Feature',
                childNoteIds: [...(targetLogicB.childNoteIds || []), snapshotId],
                ...(conflictDetails ? { conflictDetails } : {}),
                ...(unitHash ? { contentHash: unitHash } : {}),
                ...(logicAEmbedding ? { embedding: logicAEmbedding } : {}),
                ...(logicHash ? { embeddingHash: logicHash } : {}),
                embeddingModel: 'gemini-embedding-2-preview',
                lastEmbeddedAt: new Date().toISOString()
              };

              await dbManager.saveNote(logicUpdates);

              const snapshotNote: Note = {
                id: snapshotId,
                title: analysis.title,
                projectId,
                summary: analysis.summary,
                body: unit.code || '',
                components: analysis.components,
                flow: analysis.flow,
                io: analysis.io,
                noteType: 'Snapshot',
                status: 'Done',
                priority: 'Done',
                parentNoteIds: [targetLogicB.id],
                childNoteIds: [],
                uid: user.uid,
                originPath: currentFile.path,
                startLine: unit.startLine,
                endLine: unit.endLine,
                codeSnippet: unit.code,
                contentHash: unitHash,
                lastUpdated: new Date().toISOString(),
                createdAt: new Date().toISOString(),
                lens: 'Snapshot'
              };
              await dbManager.saveNote(snapshotNote);

            } else {
              const newLogicId = crypto.randomUUID();
              const logicNote: Note = {
                id: newLogicId,
                title: businessLogic.title.substring(0, 200),
                projectId,
                summary: businessLogic.summary,
                body: '',
                components: businessLogic.components,
                flow: businessLogic.flow,
                io: businessLogic.io,
                noteType: 'Logic',
                status: 'Done',
                priority: 'Done',
                parentNoteIds: [],
                childNoteIds: [snapshotId],
                uid: user.uid,
                originPath: currentFile.path,
                sha: currentFile.sha,
                contentHash: unitHash,
                lastUpdated: new Date().toISOString(),
                createdAt: new Date().toISOString(),
                embeddingHash: logicHash,
                embeddingModel: 'gemini-embedding-2-preview',
                lastEmbeddedAt: new Date().toISOString(),
                embedding: logicAEmbedding,
                lens: 'Feature'
              };
              await dbManager.saveNote(logicNote);

              const snapshotNote: Note = {
                id: snapshotId,
                title: analysis.title,
                projectId,
                summary: analysis.summary,
                body: unit.code || '',
                components: analysis.components,
                flow: analysis.flow,
                io: analysis.io,
                noteType: 'Snapshot',
                status: 'Done',
                priority: 'Done',
                parentNoteIds: [newLogicId],
                childNoteIds: [],
                uid: user.uid,
                originPath: currentFile.path,
                startLine: unit.startLine,
                endLine: unit.endLine,
                codeSnippet: unit.code,
                contentHash: unitHash,
                lastUpdated: new Date().toISOString(),
                createdAt: new Date().toISOString(),
                lens: 'Snapshot'
              };
              await dbManager.saveNote(snapshotNote);
            }
          }

        } catch (err) {
          addLog(`  Error processing file ${file.path}: ${err}`);
        }
      }

      addLog('Sync complete!');
      await dbManager.saveSetting(`lastAnalyzedSHA_${projectId}`, currentSHA);
      if (onSyncComplete) onSyncComplete();
    } catch (error) {
      addLog(`Sync failed: ${error}`);
      console.error(error);
    } finally {
      setSyncing(false);
    }
  };

  return (
    <div className="flex flex-col h-full bg-background">
      <div className="p-4 border-b border-border flex items-center justify-between bg-card/50 backdrop-blur-sm sticky top-0 z-10">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-primary/10 rounded-xl text-primary">
            <Github size={20} />
          </div>
          <div>
            <h2 className="text-sm font-bold tracking-tight">GitHub Sync</h2>
            <p className="text-[10px] text-muted-foreground uppercase tracking-wider font-medium">Repository Engine</p>
          </div>
        </div>
        <button onClick={onClose} className="p-2 hover:bg-muted rounded-xl transition-all active:scale-95">
          <X size={18} className="text-muted-foreground" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-6">
        <div className="space-y-4">
          <div className="space-y-2">
            <label className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest ml-1">Repository URL</label>
            <div className="flex gap-2">
              <div className="relative flex-1 group">
                <div className="absolute inset-y-0 left-3 flex items-center pointer-events-none text-muted-foreground group-focus-within:text-primary transition-colors">
                  <Github size={14} />
                </div>
                <input
                  type="text"
                  value={repoUrl}
                  onChange={(e) => setRepoUrl(e.target.value)}
                  placeholder="https://github.com/user/repo"
                  className="w-full pl-9 pr-4 py-2.5 bg-muted/50 border border-border rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all"
                />
              </div>
              <button
                onClick={handleSaveUrl}
                className="px-4 py-2.5 bg-primary text-primary-foreground rounded-xl text-sm font-bold hover:bg-primary/90 transition-all active:scale-95 shadow-lg shadow-primary/20 flex items-center gap-2"
              >
                <RefreshCw size={14} />
                Save
              </button>
            </div>
          </div>

          {/* Collapsible Settings Section */}
          <div className="bg-card/30 border border-border rounded-2xl overflow-hidden transition-all duration-300">
            <button 
              onClick={() => setIsSettingsExpanded(!isSettingsExpanded)}
              className="w-full flex items-center justify-between p-4 hover:bg-muted/30 transition-colors"
            >
              <div className="flex items-center gap-2">
                <RefreshCw size={14} className="text-primary" />
                <h3 className="text-[10px] font-black text-foreground/70 uppercase tracking-widest">Sync & Analysis Settings</h3>
              </div>
              {isSettingsExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
            </button>

            {isSettingsExpanded && (
              <div className="p-4 pt-0 space-y-6 animate-in slide-in-from-top-2 duration-200">
                {/* Decomposition Level (AST) */}
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <h4 className="text-[9px] font-black text-muted-foreground uppercase tracking-widest">Decomposition Level (AST)</h4>
                    <span className="text-[9px] font-bold text-primary uppercase tracking-wider">Level {granularity}</span>
                  </div>
                  
                  <div className="px-1">
                    <input 
                      type="range" 
                      min="1" 
                      max="3" 
                      step="1"
                      value={granularity}
                      onChange={(e) => setGranularity(parseInt(e.target.value))}
                      className="w-full h-1.5 bg-muted rounded-lg appearance-none cursor-pointer accent-primary"
                    />
                  </div>

                  <div className="grid grid-cols-3 gap-2">
                    {[
                      { val: 1, label: '1. FILE' },
                      { val: 2, label: '2. STANDARD' },
                      { val: 3, label: '3. DEEP' }
                    ].map((opt) => (
                      <button
                        key={opt.val}
                        onClick={() => setGranularity(opt.val)}
                        className={`py-2 rounded-xl text-[8px] font-black uppercase tracking-wider transition-all border ${
                          granularity === opt.val 
                            ? 'bg-primary/10 border-primary/40 text-primary shadow-sm' 
                            : 'bg-muted/30 border-transparent text-muted-foreground hover:bg-muted/50'
                        }`}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Mapping Strictness (Github Sync) */}
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <h4 className="text-[9px] font-black text-muted-foreground uppercase tracking-widest">Mapping Strictness (Github Sync)</h4>
                    <span className="text-[9px] font-bold text-primary uppercase tracking-wider">{Math.round(similarityThreshold * 100)}%</span>
                  </div>
                  
                  <div className="px-1">
                    <input 
                      type="range" 
                      min="0.5" 
                      max="0.95" 
                      step="0.05"
                      value={similarityThreshold}
                      onChange={(e) => setSimilarityThreshold(parseFloat(e.target.value))}
                      className="w-full h-1.5 bg-muted rounded-lg appearance-none cursor-pointer accent-primary"
                    />
                  </div>

                  <div className="grid grid-cols-3 gap-2">
                    {[
                      { val: 0.6, label: 'RELAXED' },
                      { val: 0.75, label: 'NORMAL' },
                      { val: 0.9, label: 'STRICT' }
                    ].map((opt) => (
                      <button
                        key={opt.val}
                        onClick={() => setSimilarityThreshold(opt.val)}
                        className={`py-2 rounded-xl text-[8px] font-black uppercase tracking-wider transition-all border ${
                          Math.abs(similarityThreshold - opt.val) < 0.01
                            ? 'bg-primary/10 border-primary/40 text-primary shadow-sm' 
                            : 'bg-muted/30 border-transparent text-muted-foreground hover:bg-muted/50'
                        }`}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Mapping Strictness (Reconstruct) */}
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <h4 className="text-[9px] font-black text-muted-foreground uppercase tracking-widest">Mapping Strictness (Reconstruct)</h4>
                    <span className="text-[9px] font-bold text-primary uppercase tracking-wider">{Math.round(reconstructStrictness * 100)}%</span>
                  </div>
                  
                  <div className="px-1">
                    <input 
                      type="range" 
                      min="0.5" 
                      max="0.95" 
                      step="0.05"
                      value={reconstructStrictness}
                      onChange={(e) => setReconstructStrictness(parseFloat(e.target.value))}
                      className="w-full h-1.5 bg-muted rounded-lg appearance-none cursor-pointer accent-primary"
                    />
                  </div>

                  <div className="grid grid-cols-3 gap-2">
                    {[
                      { val: 0.6, label: 'RELAXED' },
                      { val: 0.75, label: 'NORMAL' },
                      { val: 0.9, label: 'STRICT' }
                    ].map((opt) => (
                      <button
                        key={opt.val}
                        onClick={() => setReconstructStrictness(opt.val)}
                        className={`py-2 rounded-xl text-[8px] font-black uppercase tracking-wider transition-all border ${
                          Math.abs(reconstructStrictness - opt.val) < 0.01
                            ? 'bg-primary/10 border-primary/40 text-primary shadow-sm' 
                            : 'bg-muted/30 border-transparent text-muted-foreground hover:bg-muted/50'
                        }`}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Danger Zone */}
                <div className="pt-4 border-t border-border">
                  <div className="bg-destructive/5 border border-destructive/20 rounded-2xl p-4 space-y-4">
                    <div>
                      <h4 className="text-[9px] font-black text-destructive uppercase tracking-widest flex items-center gap-2">
                        <AlertCircle size={12} />
                        Danger Zone
                      </h4>
                      <p className="text-[10px] text-muted-foreground mt-1 leading-relaxed">
                        Resetting will clear all snapshots and sync history for this project. This cannot be undone.
                      </p>
                    </div>
                    
                    {confirmReset ? (
                      <div className="flex gap-2">
                        <button
                          onClick={executeReset}
                          disabled={resetting}
                          className="flex-1 px-4 py-2.5 bg-destructive text-destructive-foreground rounded-xl text-[10px] font-bold hover:bg-destructive/90 transition-all active:scale-95"
                        >
                          {resetting ? 'Resetting...' : 'Confirm Reset'}
                        </button>
                        <button
                          onClick={() => setConfirmReset(false)}
                          className="px-4 py-2.5 bg-muted text-muted-foreground rounded-xl text-[10px] font-bold hover:bg-muted/80 transition-all active:scale-95"
                        >
                          Cancel
                        </button>
                      </div>
                    ) : (
                      <button
                        onClick={() => setConfirmReset(true)}
                        className="w-full px-4 py-2.5 bg-destructive/10 text-destructive rounded-xl text-[10px] font-bold hover:bg-destructive/20 transition-all active:scale-95 border border-destructive/20"
                      >
                        Reset Project Data
                      </button>
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3">
            {syncing ? (
              <button
                onClick={handleCancelSync}
                className="flex items-center justify-center gap-2 px-4 py-3 bg-destructive/10 text-destructive rounded-xl text-sm font-bold hover:bg-destructive/20 transition-all active:scale-95 border border-destructive/20"
              >
                <X size={16} />
                Abort Sync
              </button>
            ) : (
              <button
                onClick={handleSync}
                disabled={syncing || !repoUrl}
                className="flex items-center justify-center gap-2 px-4 py-3 bg-secondary text-secondary-foreground rounded-xl text-sm font-bold hover:bg-secondary/80 disabled:opacity-50 transition-all active:scale-95 border border-border"
              >
                {syncing ? <Loader2 size={16} className="animate-spin" /> : <RefreshCw size={16} />}
                Sync Code
              </button>
            )}
            {isReconstructing ? (
              <button
                onClick={handleCancelSync}
                className="flex items-center justify-center gap-2 px-4 py-3 bg-destructive/10 text-destructive rounded-xl text-sm font-bold hover:bg-destructive/20 transition-all active:scale-95 border border-destructive/20"
              >
                <X size={16} />
                Abort
              </button>
            ) : (
              <button
                onClick={handleAutoReconstruct}
                disabled={isReconstructing}
                className="flex items-center justify-center gap-2 px-4 py-3 bg-primary/10 text-primary rounded-xl text-sm font-bold hover:bg-primary/20 disabled:opacity-50 transition-all active:scale-95 border border-primary/20"
              >
                {isReconstructing ? <Loader2 size={16} className="animate-spin" /> : <Sparkles size={16} />}
                Reconstruct
              </button>
            )}
          </div>
        </div>

        <div className="space-y-4">
          <div className="flex items-center justify-between px-1">
            <h3 className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">Sync Logs</h3>
            <button 
              onClick={() => setLogs([])}
              className="text-[10px] font-bold text-primary hover:underline uppercase tracking-widest"
            >
              Clear
            </button>
          </div>
          <div className="bg-black/5 dark:bg-black/40 rounded-2xl border border-border overflow-hidden flex flex-col h-[400px]">
            <div className="flex-1 overflow-y-auto p-4 font-mono text-[11px] space-y-1.5 scrollbar-thin">
              {logs.length === 0 ? (
                <div className="h-full flex flex-col items-center justify-center text-muted-foreground/40 gap-3">
                  <RefreshCw size={24} className="opacity-20" />
                  <p>Waiting for sync activity...</p>
                </div>
              ) : (
                logs.map((log, i) => (
                  <div key={i} className="flex gap-3 group">
                    <span className="text-muted-foreground/40 shrink-0 select-none">{log.time}</span>
                    <span className="text-foreground/80 break-all leading-relaxed">{log.msg}</span>
                  </div>
                ))
              )}
              <div ref={logsEndRef} />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
