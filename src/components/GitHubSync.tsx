import React, { useState, useEffect, useRef } from 'react';
import { fetchRepoTree, fetchFileContent } from '../services/github';
import { analyzeLogicUnit, translateToBusinessLogic, checkImplementationConflict, mapLogicsToModulesBulk, getEmbeddingsBulk, cosineSimilarity, generateModuleFromCluster, generateDomainsFromModules } from '../services/gemini';
import { kMeansClustering } from '../lib/clustering';
import { parseCodeToNodes } from '../services/astParser';
import { db, auth } from '../firebase';
import { useAuth } from '../contexts/AuthContext';
import { collection, addDoc, serverTimestamp, query, where, getDocs, doc, setDoc, updateDoc, arrayUnion, getDoc, deleteDoc, writeBatch } from 'firebase/firestore';
import { Note, SyncLedger, OperationType, LensType } from '../types';
import { handleFirestoreError, computeHash } from '../lib/utils';
import * as dbManager from '../services/dbManager';
import { Github, RefreshCw, AlertCircle, PanelRightClose, X, Trash2, ChevronDown, Loader2, Sparkles } from 'lucide-react';
import { toast } from 'sonner';

export const GitHubSync = ({ onClose, projectId, onSyncComplete, activeLens, setActiveLens }: { onClose: () => void, projectId: string | null, onSyncComplete?: () => void, activeLens: LensType, setActiveLens: (lens: LensType) => void }) => {
  const { user } = useAuth();
  const [repoUrl, setRepoUrl] = useState('');
  const [syncing, setSyncing] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [isMapping, setIsMapping] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);
  const [logs, setLogs] = useState<{ msg: string, time: string }[]>([]);
  const [granularity, setGranularity] = useState<number>(2);
  const [similarityThreshold, setSimilarityThreshold] = useState<number>(0.75);
  const [isDecompExpanded, setIsDecompExpanded] = useState<boolean>(false);
  const [isMappingExpanded, setIsMappingExpanded] = useState<boolean>(false);
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
        let projectRepoUrl = '';
        if (db) {
          const docSnap = await getDoc(doc(db, 'projects', projectId));
          if (docSnap.exists() && docSnap.data().repoUrl) {
            projectRepoUrl = docSnap.data().repoUrl;
          }
        } else {
          const localProjects = await dbManager.getAllProjects();
          const localProject = localProjects.find(p => p.id === projectId);
          if (localProject && localProject.repoUrl) {
            projectRepoUrl = localProject.repoUrl;
          }
        }
        setRepoUrl(projectRepoUrl);
      } catch (error) {
        if (db) handleFirestoreError(error, OperationType.GET, `projects/${projectId}`);
        else console.error("Error fetching local project", error);
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
      await updateDoc(doc(db, 'projects', projectId), { 
        repoUrl,
        uid: user?.uid
      });
      addLog('Repository URL saved.');
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `projects/${projectId}`);
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
      // 1. Fetch all Logic notes and existing structure for the active lens
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

      // 1.5 Delete existing Domains and Modules for this lens
      if (existingLensNotes.length > 0) {
        addLog(`Clearing ${existingLensNotes.length} existing Domains/Modules for Lens: ${activeLens}...`);
        let deleteBatch = writeBatch(db);
        let deleteCount = 0;
        
        for (const note of existingLensNotes) {
          deleteBatch.delete(doc(db, 'notes', note.id));
          await dbManager.deleteNote(note.id);
          deleteCount++;
          if (deleteCount >= 450) {
            await deleteBatch.commit();
            deleteBatch = writeBatch(db);
            deleteCount = 0;
          }
        }
        if (deleteCount > 0) await deleteBatch.commit();
        
        // Remove these deleted module IDs from all Logic notes' parentNoteIds
        const deletedIds = new Set(existingLensNotes.map(n => n.id));
        let updateBatch = writeBatch(db);
        let updateCount = 0;
        const updatedLogics: Note[] = [];
        
        for (const logic of logicNotes) {
          if (logic.parentNoteIds && logic.parentNoteIds.some(id => deletedIds.has(id))) {
            const newParentIds = logic.parentNoteIds.filter(id => !deletedIds.has(id));
            updateBatch.update(doc(db, 'notes', logic.id), { parentNoteIds: newParentIds });
            updatedLogics.push({ ...logic, parentNoteIds: newParentIds });
            updateCount++;
            if (updateCount >= 450) {
              await updateBatch.commit();
              updateBatch = writeBatch(db);
              updateCount = 0;
            }
          }
        }
        if (updateCount > 0) await updateBatch.commit();
        if (updatedLogics.length > 0) await dbManager.bulkSaveNotes(updatedLogics);
        
        // Update logicNotes array with the cleaned parentNoteIds
        updatedLogics.forEach(ul => {
          const idx = logicNotes.findIndex(l => l.id === ul.id);
          if (idx !== -1) logicNotes[idx] = ul;
        });
      }

      // 2. Ensure all Logic notes have embeddings
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
        newEmbeddings.forEach((emb, i) => {
          const originalIdx = indicesToEmbed[i];
          logicEmbeddings[originalIdx] = emb;
          // Also update the logic note in DB so we don't have to embed again
          const logicRef = doc(db, 'notes', logicNotes[originalIdx].id);
          updateDoc(logicRef, {
            embedding: emb,
            lastEmbeddedAt: serverTimestamp()
          });
        });
      }

      // 3. Cluster Logic notes using K-Means
      const k = Math.max(1, Math.ceil(logicNotes.length / 5));
      addLog(`Clustering ${logicNotes.length} logics into ${k} modules...`);
      const assignments = kMeansClustering(logicEmbeddings, k);

      // Group logics by cluster
      const clusters: { [key: number]: Note[] } = {};
      for (let i = 0; i < assignments.length; i++) {
        const clusterId = assignments[i];
        if (!clusters[clusterId]) clusters[clusterId] = [];
        clusters[clusterId].push(logicNotes[i]);
      }

      // 4. Generate Module notes for each cluster
      addLog(`Generating Module details using AI...`);
      const generatedModules: { id: string, title: string, summary: string, body: string, logicIds: string[] }[] = [];
      
      const clusterPromises = Object.entries(clusters).map(async ([clusterId, logics], idx) => {
        const logicsData = logics.map(l => ({ title: l.title, summary: l.summary }));
        const moduleData = await generateModuleFromCluster(logicsData);
        generatedModules.push({
          id: `MOD_${idx}`,
          ...moduleData,
          logicIds: logics.map(l => l.id)
        });
      });

      await Promise.all(clusterPromises);

      // 5. Generate Domains from Modules
      addLog(`Grouping ${generatedModules.length} Modules into Domains...`);
      const modulesData = generatedModules.map(m => ({ id: m.id, title: m.title, summary: m.summary }));
      const domainsBlueprint = await generateDomainsFromModules(modulesData);

      if (!domainsBlueprint.domains || domainsBlueprint.domains.length === 0) {
        throw new Error("Failed to generate domains blueprint.");
      }
      
      // Ensure all modules are assigned to a domain (handle AI omissions)
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

      // 6. Create Domains and Modules in Firestore
      let batch = writeBatch(db);
      let batchCount = 0;
      let localNotesBatch: Note[] = [];

      const commitBatch = async () => {
        if (batchCount > 0) {
          try {
            if (localNotesBatch.length > 0) {
              const localNotes = localNotesBatch.map(note => ({
                ...note,
                lastUpdated: new Date().toISOString(),
                lastEmbeddedAt: note.lastEmbeddedAt ? new Date().toISOString() : undefined
              }));
              await dbManager.bulkSaveNotes(localNotes as Note[]);
            }
            await batch.commit();
          } finally {
            batch = writeBatch(db);
            batchCount = 0;
            localNotesBatch = [];
          }
        }
      };

      for (const domainData of domainsBlueprint.domains) {
        const domainRef = doc(collection(db, 'notes'));
        const domainId = domainRef.id;
        
        const domainNote: Note = {
          id: domainId,
          title: domainData.title.substring(0, 200),
          projectId,
          summary: domainData.summary || '',
          body: '',
          folder: '',
          noteType: 'Domain',
          status: 'Planned',
          priority: 'C',
          parentNoteIds: [],
          childNoteIds: [],
          relatedNoteIds: [],
          uid: user.uid,
          lastUpdated: db ? serverTimestamp() : new Date().toISOString(),
          createdAt: db ? serverTimestamp() : new Date().toISOString(),
          lens: 'Feature'
        };

        batch.set(domainRef, domainNote);
        localNotesBatch.push(domainNote);
        batchCount++;

        if (domainData.moduleIds) {
          for (const moduleIdKey of domainData.moduleIds) {
            const moduleData = generatedModules.find(m => m.id === moduleIdKey);
            if (!moduleData) continue;

            const moduleRef = doc(collection(db, 'notes'));
            const moduleId = moduleRef.id;
            
            const [moduleEmbedding] = await getEmbeddingsBulk([`${moduleData.title} ${moduleData.summary || ''}`]);
            
            const moduleNote: Note = {
              id: moduleId,
              title: moduleData.title.substring(0, 200),
              projectId,
              summary: moduleData.summary || '',
              body: moduleData.body || '',
              folder: '',
              noteType: 'Module',
              status: 'Planned',
              priority: 'C',
              parentNoteIds: [domainId],
              childNoteIds: moduleData.logicIds, // Map logics to this module
              relatedNoteIds: [],
              uid: user.uid,
              lastUpdated: db ? serverTimestamp() : new Date().toISOString(),
              createdAt: db ? serverTimestamp() : new Date().toISOString(),
              embeddingHash: await computeHash(`${moduleData.title} ${moduleData.summary || ''}`),
              embeddingModel: 'gemini-embedding-2-preview',
              lastEmbeddedAt: db ? serverTimestamp() : new Date().toISOString(),
              embedding: moduleEmbedding,
              lens: 'Feature'
            };

            batch.set(moduleRef, moduleNote);
            localNotesBatch.push(moduleNote);
            batchCount++;
            
            // Update Domain's childNoteIds
            domainNote.childNoteIds.push(moduleId);
            batch.update(domainRef, { childNoteIds: arrayUnion(moduleId) });
            batchCount++;

            // Update Logics to point to this Module in Firestore and Local Batch
            for (const logicId of moduleData.logicIds) {
              const logicRef = doc(db, 'notes', logicId);
              batch.update(logicRef, {
                parentNoteIds: arrayUnion(moduleId),
                lastUpdated: serverTimestamp()
              });
              batchCount++;

              // Update local note object for IndexedDB
              const logicIdx = logicNotes.findIndex(l => l.id === logicId);
              if (logicIdx !== -1) {
                const updatedLogic = {
                  ...logicNotes[logicIdx],
                  parentNoteIds: [...(logicNotes[logicIdx].parentNoteIds || []), moduleId]
                };
                logicNotes[logicIdx] = updatedLogic;
                localNotesBatch.push(updatedLogic);
              }
            }
            
            if (batchCount >= 400) await commitBatch();
          }
        }
      }
      await commitBatch();

      addLog(`Auto-Reconstruct complete!`);
      if (onSyncComplete) onSyncComplete();

    } catch (error) {
      addLog(`Auto-Reconstruct failed: ${error}`);
      handleFirestoreError(error, OperationType.UPDATE, 'notes');
    } finally {
      setIsReconstructing(false);
    }
  };

  const executeReset = async () => {
    if (!projectId || !user) return;
    setResetting(true);
    setConfirmReset(false);
    addLog('Resetting snapshots and sync ledger...');
    try {
      if (db) {
        // 1. Delete all Snapshot notes for this project (Remote)
        const snapshotQuery = query(
          collection(db, 'notes'),
          where('uid', '==', user.uid),
          where('projectId', '==', projectId),
          where('noteType', '==', 'Snapshot')
        );
        const snapshotDocs = await getDocs(snapshotQuery);
        
        let batch = writeBatch(db);
        let count = 0;
        for (const d of snapshotDocs.docs) {
          batch.delete(doc(db, 'notes', d.id));
          count++;
          if (count >= 450) {
            await batch.commit();
            batch = writeBatch(db);
            count = 0;
          }
        }
        if (count > 0) await batch.commit();
        addLog(`Deleted ${snapshotDocs.docs.length} remote snapshots.`);

        // 2. Clear child references from all Logic notes (Remote)
        const logicQuery = query(
          collection(db, 'notes'),
          where('uid', '==', user.uid),
          where('projectId', '==', projectId),
          where('noteType', '==', 'Logic')
        );
        const logicDocs = await getDocs(logicQuery);
        batch = writeBatch(db);
        count = 0;
        for (const d of logicDocs.docs) {
          batch.update(doc(db, 'notes', d.id), { 
            childNoteIds: [] 
          });
          count++;
          if (count >= 450) {
            await batch.commit();
            batch = writeBatch(db);
            count = 0;
          }
        }
        if (count > 0) await batch.commit();
        addLog(`Cleared remote snapshot references from ${logicDocs.docs.length} logic notes.`);
      }

      // 3. Sync with local DB (IndexedDB)
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

      if (db) {
        // 4. Reset Sync Ledger (Remote)
        const ledgerQuery = query(
          collection(db, 'syncLedgers'),
          where('uid', '==', user.uid),
          where('projectId', '==', projectId)
        );
        const ledgerDocs = await getDocs(ledgerQuery);
        for (const ledgerDoc of ledgerDocs.docs) {
          await updateDoc(doc(db, 'syncLedgers', ledgerDoc.id), { 
            fileShaMap: {},
            uid: user.uid 
          });
        }
        addLog('Remote sync ledger reset successfully.');
      }
      
      if (onSyncComplete) onSyncComplete();
    } catch (error) {
      addLog(`Reset failed: ${error}`);
      if (db) handleFirestoreError(error, OperationType.DELETE, 'notes/reset');
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

    let batch = db ? writeBatch(db) : null;
    let batchCount = 0;
    let localNotesBatch: Note[] = [];

    const commitBatch = async () => {
      if (batchCount > 0) {
        try {
          if (localNotesBatch.length > 0) {
            addLog(`Saving ${localNotesBatch.length} notes locally...`);
            // Convert serverTimestamp to ISO string for local DB
            const localNotes = localNotesBatch.map(note => ({
              ...note,
              lastUpdated: new Date().toISOString(),
              lastEmbeddedAt: note.lastEmbeddedAt ? new Date().toISOString() : undefined
            }));
            await dbManager.bulkSaveNotes(localNotes as Note[]);
          }
          if (batch) {
            await batch.commit();
          }
        } finally {
          // Always reset batch to avoid "batch already committed" errors even if commit fails
          if (db) batch = writeBatch(db);
          batchCount = 0;
          localNotesBatch = [];
        }
      }
    };

    try {
      // Update project repoUrl if changed
      if (db) {
        await updateDoc(doc(db, 'projects', projectId), { 
          repoUrl,
          uid: user.uid
        });
      }
      // Always save locally
      await dbManager.saveProject({
        id: projectId,
        repoUrl,
        uid: user.uid
      });

      // 1. Fetch Ledger
      let ledger: Partial<SyncLedger> = { repoUrl, projectId, fileShaMap: {}, uid: user.uid };
      let ledgerId = '';

      if (db) {
        const ledgerQuery = query(
          collection(db, 'syncLedgers'), 
          where('uid', '==', user.uid),
          where('projectId', '==', projectId)
        );
        const ledgerSnap = await getDocs(ledgerQuery);
        
        const existingLedger = ledgerSnap.docs.find(doc => doc.data().repoUrl === repoUrl);
        if (existingLedger) {
          ledgerId = existingLedger.id;
          ledger = existingLedger.data() as SyncLedger;
        }
      }

      // 2. Fetch Repo Tree
      addLog('Fetching repository tree...');
      const tree = await fetchRepoTree(repoUrl);
      
      const filesToProcess = tree.filter((item: any) => 
        item.type === 'blob' && 
        (item.path.endsWith('.ts') || item.path.endsWith('.tsx') || item.path.endsWith('.js') || item.path.endsWith('.jsx'))
      );

      addLog(`Found ${filesToProcess.length} source files.`);

      // Fetch all existing notes to build path hierarchy
      const allLocalNotes = await dbManager.getAllNotes();
      const allNotes = allLocalNotes.filter(n => n.projectId === projectId);

      // Pre-compute embeddings for existing Logic notes
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

      // Fetch existing Modules for the current lens to enable auto-mapping of new Logic notes
      addLog(`Fetching existing Modules for Lens: ${activeLens}...`);
      const existingModules = allNotes.filter(n => n.noteType === 'Module' && n.lens === activeLens);
      let moduleEmbeddings: number[][] = [];
      
      if (existingModules.length > 0) {
        const moduleTexts: string[] = [];
        const moduleIndices: number[] = [];
        moduleEmbeddings = new Array(existingModules.length).fill([]);
        
        existingModules.forEach((m, idx) => {
          if (m.embedding && m.embedding.length > 0) {
            moduleEmbeddings[idx] = m.embedding;
          } else {
            moduleTexts.push(`${m.title} ${m.summary}`);
            moduleIndices.push(idx);
          }
        });
        
        if (moduleTexts.length > 0) {
          addLog(`Calculating embeddings for ${moduleTexts.length} Modules...`);
          const newModuleEmbeddings = await getEmbeddingsBulk(moduleTexts);
          newModuleEmbeddings.forEach((emb, i) => {
            const originalIdx = moduleIndices[i];
            moduleEmbeddings[originalIdx] = emb;
          });
        }
      }

      const newShaMap = { ...ledger.fileShaMap };
      let processedCount = 0;

      const filesNeedingSync = filesToProcess.filter((file: any) => !ledger.fileShaMap || ledger.fileShaMap[file.path] !== file.sha);
      addLog(`Phase 0: Selected ${filesNeedingSync.length} files for synchronization.`);

      if (filesNeedingSync.length === 0) {
        addLog('No files need synchronization.');
        setSyncing(false);
        return;
      }

      addLog(`Starting sequential synchronization for ${filesNeedingSync.length} files...`);
      const claimedEmptyLogics = new Set<string>();

      for (let fileIndex = 0; fileIndex < filesNeedingSync.length; fileIndex++) {
        if (cancelSyncRef.current) break;
        
        const file = filesNeedingSync[fileIndex];
        addLog(`\n[${fileIndex + 1}/${filesNeedingSync.length}] Processing file: ${file.path}`);
        
        try {
          // Phase 1: Extract Logic Units (AST Parsing)
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

          // Phase 2: AI Deep Analysis (IPO Model)
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

          // Phase 3: Generating Business Logic
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

          // Phase 4: Vector Search Mapping
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

          // Similarity matching
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

            // Add a 1-second delay to simulate queueing and prevent race conditions visually
            await new Promise(resolve => setTimeout(resolve, 1000));
          }

          if (cancelSyncRef.current) break;

          // Phase 5: Tree Assembly & Persistence
          addLog(`  Phase 5: Tree Assembly & Persistence...`);
          for (const result of fileLogicUnits) {
            if (result.error) continue;
            
            const { unit, file: currentFile, analysis, businessLogic, unitHash, caseType, targetLogicB, targetSnapshotB, isConflict, conflictDetails, logicAEmbedding, logicHash } = result;

            const snapshotRef = targetSnapshotB ? doc(db, 'notes', targetSnapshotB.id) : doc(collection(db, 'notes'));
            const snapshotId = targetSnapshotB ? targetSnapshotB.id : snapshotRef.id;
            
            if (caseType === '4-1') {
              const logicRef = db ? doc(db, 'notes', targetLogicB.id) : null;
              const logicUpdates: any = {
                status: isConflict ? 'Conflict' : 'Done',
                lastUpdated: db ? serverTimestamp() : new Date().toISOString(),
                uid: user.uid,
                sha: currentFile.sha,
                lens: 'Feature',
                ...(conflictDetails ? { conflictDetails } : {}),
                ...(unitHash ? { contentHash: unitHash } : {}),
                ...(logicAEmbedding ? { embedding: logicAEmbedding } : {}),
                ...(logicHash ? { embeddingHash: logicHash } : {}),
                embeddingModel: 'gemini-embedding-2-preview',
                lastEmbeddedAt: db ? serverTimestamp() : new Date().toISOString()
              };

              if (!isConflict && !result.isCacheHit) {
                logicUpdates.title = businessLogic.title.substring(0, 200);
                logicUpdates.summary = businessLogic.summary;
                logicUpdates.components = businessLogic.components;
                logicUpdates.flow = businessLogic.flow;
                logicUpdates.io = businessLogic.io;
                logicUpdates.conflictDetails = null;
              }

              if (batch && logicRef) batch.update(logicRef, logicUpdates);
              batchCount++;
              localNotesBatch.push({ ...targetLogicB, ...logicUpdates, id: targetLogicB.id } as Note);
              
              const snapshotRef = db ? (targetSnapshotB ? doc(db, 'notes', targetSnapshotB.id) : doc(collection(db, 'notes'))) : null;
              const snapshotId = targetSnapshotB ? targetSnapshotB.id : (snapshotRef ? snapshotRef.id : crypto.randomUUID());
              
              const snapshotUpdates: any = {
                lastUpdated: db ? serverTimestamp() : new Date().toISOString(),
                sha: currentFile.sha,
                uid: user.uid,
                lens: 'Snapshot',
                ...(unitHash ? { contentHash: unitHash } : {})
              };
              
              if (!result.isCacheHit) {
                snapshotUpdates.title = analysis.title.substring(0, 200);
                snapshotUpdates.summary = analysis.summary;
                snapshotUpdates.components = analysis.components;
                snapshotUpdates.flow = analysis.flow;
                snapshotUpdates.io = analysis.io;
                snapshotUpdates.body = unit.code;
              }

              if (batch && snapshotRef) batch.update(snapshotRef, snapshotUpdates);
              batchCount++;
              localNotesBatch.push({ ...targetSnapshotB, ...snapshotUpdates, id: targetSnapshotB.id } as Note);
              
            } else if (caseType === '4-2') {
              const snapshotRef = db ? (targetSnapshotB ? doc(db, 'notes', targetSnapshotB.id) : doc(collection(db, 'notes'))) : null;
              const snapshotId = targetSnapshotB ? targetSnapshotB.id : (snapshotRef ? snapshotRef.id : crypto.randomUUID());

              const logicRef = db ? doc(db, 'notes', targetLogicB.id) : null;
              const logicUpdates: any = {
                childNoteIds: db ? arrayUnion(snapshotId) : [...(targetLogicB.childNoteIds || []), snapshotId],
                status: isConflict ? 'Conflict' : 'Done',
                lastUpdated: db ? serverTimestamp() : new Date().toISOString(),
                uid: user.uid,
                sha: currentFile.sha,
                lens: 'Feature',
                ...(conflictDetails ? { conflictDetails } : {}),
                ...(unitHash ? { contentHash: unitHash } : {}),
                ...(logicAEmbedding ? { embedding: logicAEmbedding } : {}),
                ...(logicHash ? { embeddingHash: logicHash } : {}),
                embeddingModel: 'gemini-embedding-2-preview',
                lastEmbeddedAt: db ? serverTimestamp() : new Date().toISOString()
              };

              if (!isConflict) {
                logicUpdates.conflictDetails = null;
              }

              if (batch && logicRef) batch.update(logicRef, logicUpdates);
              batchCount++;
              localNotesBatch.push({ ...targetLogicB, ...logicUpdates, id: targetLogicB.id } as Note);
              
              const snapshotData: Partial<Note> = {
                id: snapshotId,
                title: analysis.title.substring(0, 200),
                projectId,
                summary: analysis.summary || '',
                components: analysis.components || null,
                flow: analysis.flow || null,
                io: analysis.io || null,
                body: unit.code || '',
                folder: currentFile.path,
                noteType: 'Snapshot',
                status: 'Done',
                priority: 'Done',
                parentNoteIds: [targetLogicB.id],
                childNoteIds: [],
                relatedNoteIds: [],
                originPath: currentFile.path,
                sha: currentFile.sha,
                uid: user.uid,
                lastUpdated: db ? serverTimestamp() : new Date().toISOString(),
                lens: 'Snapshot',
                ...(unitHash ? { contentHash: unitHash } : {})
              };
              if (batch && snapshotRef) batch.set(snapshotRef, snapshotData);
              batchCount++;
              allNotes.push(snapshotData as Note);
              localNotesBatch.push(snapshotData as Note);
              
            } else if (caseType === '4-3') {
              const logicRef = db ? doc(collection(db, 'notes')) : null;
              const logicId = logicRef ? logicRef.id : crypto.randomUUID();
              
              const snapshotRef = db ? (targetSnapshotB ? doc(db, 'notes', targetSnapshotB.id) : doc(collection(db, 'notes'))) : null;
              const snapshotId = targetSnapshotB ? targetSnapshotB.id : (snapshotRef ? snapshotRef.id : crypto.randomUUID());

              // Find best matching module for the new logic note
              let parentModuleIds: string[] = [];
              if (moduleEmbeddings.length > 0 && logicAEmbedding) {
                let bestModule = null;
                let maxSim = -1;
                for (let j = 0; j < existingModules.length; j++) {
                  const sim = cosineSimilarity(logicAEmbedding, moduleEmbeddings[j]);
                  if (sim > maxSim) {
                    maxSim = sim;
                    bestModule = existingModules[j];
                  }
                }
                // Use a threshold for module mapping during sync as well
                if (bestModule && maxSim >= 0.7) {
                  parentModuleIds = [bestModule.id];
                  addLog(`    [Auto-Map] Assigned new logic '${businessLogic.title}' to module '${bestModule.title}' (sim: ${maxSim.toFixed(2)})`);
                }
              }

              const logicData: Partial<Note> = {
                id: logicId,
                title: businessLogic.title.substring(0, 200),
                projectId,
                summary: businessLogic.summary || '',
                components: businessLogic.components || null,
                flow: businessLogic.flow || null,
                io: businessLogic.io || null,
                body: '',
                folder: currentFile.path,
                noteType: 'Logic',
                status: 'Done',
                priority: 'C',
                parentNoteIds: parentModuleIds,
                childNoteIds: [snapshotId],
                relatedNoteIds: [],
                uid: user.uid,
                lastUpdated: db ? serverTimestamp() : new Date().toISOString(),
                sha: currentFile.sha,
                lens: 'Feature',
                ...(unitHash ? { contentHash: unitHash } : {}),
                ...(logicAEmbedding ? { embedding: logicAEmbedding } : {}),
                ...(logicHash ? { embeddingHash: logicHash } : {}),
                embeddingModel: 'gemini-embedding-2-preview',
                lastEmbeddedAt: db ? serverTimestamp() : new Date().toISOString()
              };
              if (batch && logicRef) batch.set(logicRef, logicData);
              batchCount++;
              localNotesBatch.push(logicData as Note);

              // If we assigned a parent module, we need to update the module's childNoteIds
              if (parentModuleIds.length > 0) {
                const moduleRef = db ? doc(db, 'notes', parentModuleIds[0]) : null;
                if (batch && moduleRef) {
                  batch.update(moduleRef, {
                    childNoteIds: arrayUnion(logicId),
                    lastUpdated: serverTimestamp()
                  });
                }
                batchCount++;
                // Update local module as well
                const mod = existingModules.find(m => m.id === parentModuleIds[0]);
                if (mod) {
                  localNotesBatch.push({
                    ...mod,
                    childNoteIds: [...(mod.childNoteIds || []), logicId]
                  } as Note);
                }
              }
              
              const snapshotData: Partial<Note> = {
                id: snapshotId,
                title: analysis.title.substring(0, 200),
                projectId,
                summary: analysis.summary || '',
                components: analysis.components || null,
                flow: analysis.flow || null,
                io: analysis.io || null,
                body: unit.code || '',
                folder: currentFile.path,
                noteType: 'Snapshot',
                status: 'Done',
                priority: 'Done',
                parentNoteIds: [logicId],
                childNoteIds: [],
                relatedNoteIds: [],
                originPath: currentFile.path,
                sha: currentFile.sha,
                uid: user.uid,
                lastUpdated: db ? serverTimestamp() : new Date().toISOString(),
                lens: 'Snapshot',
                ...(unitHash ? { contentHash: unitHash } : {})
              };
              if (batch && snapshotRef) batch.set(snapshotRef, snapshotData);
              batchCount++;
              localNotesBatch.push(snapshotData as Note);
              
              allNotes.push(logicData as Note);
              allNotes.push(snapshotData as Note);
              existingLogicNotes.push(logicData as Note);
              if (logicAEmbedding) {
                existingLogicEmbeddings.push(logicAEmbedding);
              }
            }
            
            if (batchCount >= 450) await commitBatch();
          }

          if (!cancelSyncRef.current) {
            newShaMap[file.path] = file.sha;
            processedCount++;
          }
          
          await commitBatch();

        } catch (err) {
          addLog(`Error processing file ${file.path}: ${err}`);
        }
      }

      if (cancelSyncRef.current) {
        addLog('Sync stopped by user.');
        setSyncing(false);
        return;
      }

      // 3. Update Ledger
      addLog('Updating sync ledger...');
      const { id: _, ...ledgerBase } = ledger;
      const ledgerData = {
        ...ledgerBase,
        fileShaMap: newShaMap,
        lastSyncedAt: db ? serverTimestamp() : new Date().toISOString(),
        uid: user.uid
      };

      if (db) {
        if (ledgerId) {
          await setDoc(doc(db, 'syncLedgers', ledgerId), ledgerData);
        } else {
          await addDoc(collection(db, 'syncLedgers'), ledgerData);
        }
      }
      // Always save ledger locally
      await dbManager.saveSyncLedger({
        ...ledgerData,
        id: ledgerId || crypto.randomUUID()
      });

      addLog(`Sync complete! Processed ${processedCount} files.`);
    } catch (error) {
      addLog(`Sync failed: ${error}`);
      handleFirestoreError(error, OperationType.WRITE, 'syncLedgers');
    } finally {
      setSyncing(false);
      if (onSyncComplete) onSyncComplete();
    }
  };

  const handleModuleMapping = async () => {
    if (!user || !projectId) return;
    setIsMapping(true);
    cancelSyncRef.current = false;
    setLogs([]);
    addLog(`Starting Auto-Map Modules...`);

    let batch = db ? writeBatch(db) : null;
    let batchCount = 0;
    let localNotesBatch: Note[] = [];

    const commitBatch = async () => {
      if (batchCount > 0) {
        try {
          if (localNotesBatch.length > 0) {
            addLog(`Saving ${localNotesBatch.length} notes locally...`);
            const localNotes = localNotesBatch.map(note => ({
              ...note,
              lastUpdated: new Date().toISOString(),
              lastEmbeddedAt: note.lastEmbeddedAt ? new Date().toISOString() : undefined
            }));
            await dbManager.bulkSaveNotes(localNotes as Note[]);
          }
          if (batch) {
            await batch.commit();
          }
        } finally {
          if (db) batch = writeBatch(db);
          batchCount = 0;
          localNotesBatch = [];
        }
      }
    };

    try {
      // Fetch existing Module notes from Local DB for the ACTIVE LENS
      const allLocalNotes = await dbManager.getAllNotes();
      const existingModules = allLocalNotes.filter(n => 
        n.projectId === projectId && 
        n.noteType === 'Module' &&
        n.lens === activeLens
      );
      const existingModuleIdsForLens = new Set(existingModules.map(m => m.id));

      // Fetch all unassigned Logic notes from Local DB (unassigned for the current lens)
      const unassignedLogics = allLocalNotes.filter(n => {
        if (n.projectId !== projectId || n.noteType !== 'Logic') return false;
        // Check if it has any parent that is a module in the current lens
        const hasParentInLens = n.parentNoteIds?.some(pid => existingModuleIdsForLens.has(pid));
        return !hasParentInLens;
      });

      if (unassignedLogics.length === 0) {
        addLog(`No unassigned Logic notes found for Lens: ${activeLens}. Everything is mapped!`);
        setIsMapping(false);
        return;
      }
      addLog(`Found ${unassignedLogics.length} unassigned Logic notes for Lens: ${activeLens}.`);

      let moduleEmbeddings: number[][] = [];
      if (existingModules.length > 0) {
        addLog(`Preparing embeddings for ${existingModules.length} existing modules...`);
        const textsToEmbed: string[] = [];
        const indicesToEmbed: number[] = [];
        
        moduleEmbeddings = new Array(existingModules.length).fill([]);
        
        existingModules.forEach((m, idx) => {
          if (m.embedding && m.embedding.length > 0) {
            moduleEmbeddings[idx] = m.embedding;
          } else {
            textsToEmbed.push(`${m.title} ${m.summary}`);
            indicesToEmbed.push(idx);
          }
        });

        if (textsToEmbed.length > 0) {
          addLog(`Calculating missing embeddings for ${textsToEmbed.length} existing modules...`);
          const newEmbeddings = await getEmbeddingsBulk(textsToEmbed);
          newEmbeddings.forEach((emb, i) => {
            const originalIdx = indicesToEmbed[i];
            moduleEmbeddings[originalIdx] = emb;
          });
        }
      }

      const CHUNK_SIZE = 20;
      for (let i = 0; i < unassignedLogics.length; i += CHUNK_SIZE) {
        if (cancelSyncRef.current) {
          addLog('Mapping stopped by user.');
          break;
        }

        const chunk = unassignedLogics.slice(i, i + CHUNK_SIZE);
        addLog(`Processing Module Mapping Chunk (${i + 1} ~ ${i + chunk.length})...`);

        const logicTexts = chunk.map(logic => `${logic.title} ${logic.summary}`);
        
        let logicEmbeddings: number[][] = [];
        if (existingModules.length > 0) {
          const textsToEmbed: string[] = [];
          const indicesToEmbed: number[] = [];
          
          logicEmbeddings = new Array(chunk.length).fill([]);
          
          chunk.forEach((logic, idx) => {
            if (logic.embedding && logic.embedding.length > 0) {
              logicEmbeddings[idx] = logic.embedding;
            } else {
              textsToEmbed.push(`${logic.title} ${logic.summary}`);
              indicesToEmbed.push(idx);
            }
          });

          if (textsToEmbed.length > 0) {
            addLog(`Calculating missing embeddings for ${textsToEmbed.length} logics in chunk...`);
            const newEmbeddings = await getEmbeddingsBulk(textsToEmbed);
            newEmbeddings.forEach((emb, i) => {
              const originalIdx = indicesToEmbed[i];
              logicEmbeddings[originalIdx] = emb;
            });
          }
        }

        const logicsWithCandidates = chunk.map((logic, idx) => {
          let candidateModules: any[] = [];
          
          if (existingModules.length > 0) {
            const logicEmb = logicEmbeddings[idx];
            if (logicEmb && logicEmb.length > 0) {
              const similarities = existingModules.map((mod, modIdx) => ({
                module: mod,
                score: cosineSimilarity(logicEmb, moduleEmbeddings[modIdx] || [])
              }));
              similarities.sort((a, b) => b.score - a.score);
              candidateModules = similarities.slice(0, 5).map(s => ({
                id: s.module.id,
                title: s.module.title,
                summary: s.module.summary
              }));
            } else {
              candidateModules = existingModules.slice(0, 5).map(m => ({ id: m.id, title: m.title, summary: m.summary }));
            }
          }

          return {
            index: idx,
            title: logic.title,
            summary: logic.summary,
            candidateModules
          };
        });

        const bulkMappingResults = await mapLogicsToModulesBulk(logicsWithCandidates);
        const newModulesCreatedInChunk: Record<string, any> = {};

        for (const mapping of bulkMappingResults) {
          const logic = chunk[mapping.index];
          if (!logic) continue;

          let moduleId = mapping.mappedModuleId;
          let isNew = false;
          let newModuleData = null;

          if (!moduleId && mapping.suggestedTitle) {
            if (newModulesCreatedInChunk[mapping.suggestedTitle]) {
              moduleId = newModulesCreatedInChunk[mapping.suggestedTitle].id;
            } else {
              const moduleRef = db ? doc(collection(db, 'notes')) : null;
              moduleId = moduleRef ? moduleRef.id : crypto.randomUUID();
              
              // We calculate the embedding for the new module right away so it can be used for subsequent mappings
              const [newModuleEmbedding] = await getEmbeddingsBulk([`${mapping.suggestedTitle} ${mapping.suggestedSummary || ''}`]);
              
              newModuleData = {
                id: moduleId,
                title: mapping.suggestedTitle.substring(0, 200),
                projectId,
                summary: mapping.suggestedSummary || '',
                body: '',
                folder: logic.folder || '',
                noteType: 'Module',
                status: 'Planned',
                priority: 'C',
                parentNoteIds: [],
                childNoteIds: [],
                relatedNoteIds: [],
                uid: user.uid,
                lastUpdated: db ? serverTimestamp() : new Date().toISOString(),
                embeddingHash: await computeHash(`${mapping.suggestedTitle} ${mapping.suggestedSummary || ''}`),
                embeddingModel: 'gemini-embedding-2-preview',
                lastEmbeddedAt: db ? serverTimestamp() : new Date().toISOString(),
                embedding: newModuleEmbedding,
                lens: 'Feature'
              };
              
              existingModules.push(newModuleData as Note);
              moduleEmbeddings.push(newModuleEmbedding);
              newModulesCreatedInChunk[mapping.suggestedTitle] = newModuleData;
              isNew = true;
              addLog(`Proposed new Module: ${newModuleData.title}`);
            }
          }

          if (isNew && newModuleData) {
            const moduleRef = db ? doc(db, 'notes', newModuleData.id) : null;
            if (batch && moduleRef) batch.set(moduleRef, newModuleData);
            batchCount++;
            localNotesBatch.push(newModuleData as Note);
            if (batchCount >= 450) await commitBatch();
          }

          if (moduleId) {
            // Update Logic Note
            const logicRef = db ? doc(db, 'notes', logic.id) : null;
            if (batch && logicRef) {
              batch.update(logicRef, {
                parentNoteIds: arrayUnion(moduleId),
                lastUpdated: serverTimestamp(),
                uid: user.uid
              });
            }
            batchCount++;
            localNotesBatch.push({ ...logic, parentNoteIds: [...logic.parentNoteIds, moduleId] } as Note);
            if (batchCount >= 450) await commitBatch();

            // Update Module Note
            const moduleRef = db ? doc(db, 'notes', moduleId) : null;
            if (batch && moduleRef) {
              batch.update(moduleRef, {
                childNoteIds: arrayUnion(logic.id),
                lastUpdated: serverTimestamp(),
                uid: user.uid
              });
            }
            batchCount++;
            const existingModule = existingModules.find(m => m.id === moduleId);
            if (existingModule) {
              localNotesBatch.push({ ...existingModule, childNoteIds: [...existingModule.childNoteIds, logic.id] } as Note);
            } else if (newModuleData && newModuleData.id === moduleId) {
              newModuleData.childNoteIds = [...(newModuleData.childNoteIds || []), logic.id];
              localNotesBatch.push(newModuleData as Note);
            }
            if (batchCount >= 450) await commitBatch();
          }
        }
        await commitBatch();
      }

      await commitBatch();
      addLog(`Auto-Map Modules complete!`);
    } catch (error) {
      addLog(`Auto-Map failed: ${error}`);
      handleFirestoreError(error, OperationType.UPDATE, 'notes');
    } finally {
      setIsMapping(false);
    }
  };

  return (
    <div className="flex flex-col h-full bg-card/95 backdrop-blur-2xl border-l border-border glass shadow-2xl">
      <div className="p-4 sm:p-8 border-b border-border flex justify-between items-center bg-muted/5">
        <div>
          <h2 className="font-black text-foreground flex items-center gap-2 sm:gap-3 uppercase tracking-[0.3em] text-[10px] sm:text-xs italic">
            <Github size={18} className="text-primary glow-primary" /> Sync Engine
          </h2>
          <p className="text-[8px] sm:text-[10px] font-bold text-muted-foreground/40 uppercase tracking-widest mt-1">Repository Architect</p>
        </div>
        <button 
          onClick={onClose} 
          className="hidden sm:flex p-2 text-muted-foreground hover:bg-muted rounded-xl transition-all active:scale-95 border border-transparent hover:border-border/50" 
          title="Close Engine"
        >
          <PanelRightClose size={18} />
        </button>
        <button 
          onClick={onClose} 
          className="sm:hidden p-2 text-muted-foreground hover:bg-muted rounded-xl transition-all active:scale-95 border border-transparent hover:border-border/50" 
          title="Close Engine"
        >
          <X size={18} />
        </button>
      </div>
      
      <div className="p-4 sm:p-8 flex flex-col h-full overflow-hidden space-y-6 sm:space-y-8">
        {!projectId ? (
          <div className="flex-1 flex flex-col items-center justify-center text-center p-8 space-y-6">
            <div className="w-16 h-16 bg-muted rounded-2xl flex items-center justify-center text-muted-foreground/30 shadow-inner">
              <Github size={32} />
            </div>
            <div className="space-y-2">
              <h3 className="text-sm font-bold text-foreground uppercase tracking-widest italic">No Project Selected</h3>
              <p className="text-[10px] text-muted-foreground/60 leading-relaxed max-w-[200px] mx-auto uppercase tracking-widest font-bold">
                Please select a project from the explorer to activate the sync engine.
              </p>
            </div>
          </div>
        ) : (
          <div className="space-y-4 sm:space-y-6">
            <div className="space-y-2 sm:space-y-3">
              <label className="text-[9px] sm:text-[10px] font-black text-muted-foreground uppercase tracking-[0.2em] ml-1">Source Repository</label>
              <div className="flex flex-col sm:flex-row gap-2 sm:gap-3">
                <input 
                  type="text" 
                  placeholder="https://github.com/owner/repo"
                  value={repoUrl}
                  onChange={e => setRepoUrl(e.target.value)}
                  className="flex-1 p-3 sm:p-4 bg-background/50 border border-border rounded-xl sm:rounded-2xl focus:ring-2 focus:ring-primary/20 outline-none text-[10px] sm:text-xs font-mono"
                />
                <button 
                  onClick={handleSaveUrl}
                  disabled={syncing}
                  className="px-6 py-2 bg-muted text-muted-foreground rounded-xl sm:rounded-2xl hover:bg-muted/80 disabled:opacity-50 text-[9px] sm:text-[10px] font-black uppercase tracking-widest transition-all border border-border/50"
                >
                  Save
                </button>
              </div>
            </div>

            <div className="bg-background/30 p-4 rounded-2xl border border-border/50 transition-all">
              <button 
                onClick={() => setIsDecompExpanded(!isDecompExpanded)}
                className="w-full flex justify-between items-center"
              >
                <label className="text-[9px] sm:text-[10px] font-black text-foreground uppercase tracking-[0.2em] cursor-pointer">Decomposition Level</label>
                <div className="flex items-center gap-3">
                  <span className="text-[10px] font-mono text-primary font-bold">Level {granularity}</span>
                  <ChevronDown size={14} className={`text-muted-foreground transition-transform ${isDecompExpanded ? 'rotate-180' : ''}`} />
                </div>
              </button>
              
              {isDecompExpanded && (
                <div className="space-y-3 mt-4 animate-in fade-in slide-in-from-top-2 duration-200">
                  <input 
                    type="range" 
                    min="1" 
                    max="3" 
                    step="1" 
                    value={granularity}
                    onChange={(e) => setGranularity(parseInt(e.target.value))}
                    disabled={syncing}
                    className="w-full h-2 bg-muted rounded-lg appearance-none cursor-pointer accent-primary"
                  />
                  
                  <div className="grid grid-cols-3 gap-2 mt-3">
                    <button 
                      onClick={() => setGranularity(1)}
                      disabled={syncing}
                      className={`py-2 px-1 text-[9px] font-bold uppercase tracking-wider rounded-lg transition-all border ${granularity === 1 ? 'bg-primary/10 text-primary border-primary/30' : 'bg-transparent text-muted-foreground border-border/50 hover:bg-muted'}`}
                    >
                      1. File
                    </button>
                    <button 
                      onClick={() => setGranularity(2)}
                      disabled={syncing}
                      className={`py-2 px-1 text-[9px] font-bold uppercase tracking-wider rounded-lg transition-all border ${granularity === 2 ? 'bg-primary/10 text-primary border-primary/30' : 'bg-transparent text-muted-foreground border-border/50 hover:bg-muted'}`}
                    >
                      2. Standard
                    </button>
                    <button 
                      onClick={() => setGranularity(3)}
                      disabled={syncing}
                      className={`py-2 px-1 text-[9px] font-bold uppercase tracking-wider rounded-lg transition-all border ${granularity === 3 ? 'bg-primary/10 text-primary border-primary/30' : 'bg-transparent text-muted-foreground border-border/50 hover:bg-muted'}`}
                    >
                      3. Deep
                    </button>
                  </div>
                </div>
              )}
            </div>

            <div className="bg-background/30 p-4 rounded-2xl border border-border/50 transition-all">
              <button 
                onClick={() => setIsMappingExpanded(!isMappingExpanded)}
                className="w-full flex justify-between items-center"
              >
                <label className="text-[9px] sm:text-[10px] font-black text-foreground uppercase tracking-[0.2em] cursor-pointer">Mapping Strictness</label>
                <div className="flex items-center gap-3">
                  <span className="text-[10px] font-mono text-primary font-bold">{(similarityThreshold * 100).toFixed(0)}%</span>
                  <ChevronDown size={14} className={`text-muted-foreground transition-transform ${isMappingExpanded ? 'rotate-180' : ''}`} />
                </div>
              </button>
              
              {isMappingExpanded && (
                <div className="space-y-3 mt-4 animate-in fade-in slide-in-from-top-2 duration-200">
                  <input 
                    type="range" 
                    min="0.5" 
                    max="0.95" 
                    step="0.05" 
                    value={similarityThreshold}
                    onChange={(e) => setSimilarityThreshold(parseFloat(e.target.value))}
                    disabled={syncing}
                    className="w-full h-2 bg-muted rounded-lg appearance-none cursor-pointer accent-primary"
                  />
                  
                  <div className="grid grid-cols-3 gap-2 mt-3">
                    <button 
                      onClick={() => setSimilarityThreshold(0.60)}
                      disabled={syncing}
                      className={`py-2 px-1 text-[9px] font-bold uppercase tracking-wider rounded-lg transition-all border ${similarityThreshold <= 0.65 ? 'bg-primary/10 text-primary border-primary/30' : 'bg-transparent text-muted-foreground border-border/50 hover:bg-muted'}`}
                    >
                      Relaxed
                    </button>
                    <button 
                      onClick={() => setSimilarityThreshold(0.75)}
                      disabled={syncing}
                      className={`py-2 px-1 text-[9px] font-bold uppercase tracking-wider rounded-lg transition-all border ${similarityThreshold > 0.65 && similarityThreshold < 0.85 ? 'bg-primary/10 text-primary border-primary/30' : 'bg-transparent text-muted-foreground border-border/50 hover:bg-muted'}`}
                    >
                      Normal
                    </button>
                    <button 
                      onClick={() => setSimilarityThreshold(0.90)}
                      disabled={syncing}
                      className={`py-2 px-1 text-[9px] font-bold uppercase tracking-wider rounded-lg transition-all border ${similarityThreshold >= 0.85 ? 'bg-primary/10 text-primary border-primary/30' : 'bg-transparent text-muted-foreground border-border/50 hover:bg-muted'}`}
                    >
                      Strict
                    </button>
                  </div>
                </div>
              )}
            </div>

            <div className="flex flex-col gap-2 sm:gap-4">
              {syncing || isMapping ? (
                <button 
                  onClick={handleCancelSync}
                  className="w-full flex justify-center items-center gap-3 px-4 py-3 sm:py-4 bg-destructive text-destructive-foreground rounded-xl sm:rounded-2xl hover:opacity-90 text-[9px] sm:text-[10px] font-black uppercase tracking-[0.2em] shadow-xl shadow-destructive/20 transition-all active:scale-95"
                >
                  <X size={16} /> Abort
                </button>
              ) : (
                <>
                  {/* Top Row: Sync & Reset */}
                  <div className="grid grid-cols-2 gap-2 sm:gap-4">
                    <button 
                      onClick={handleSync}
                      disabled={!repoUrl || resetting}
                      className="flex justify-center items-center gap-3 px-4 py-3 sm:py-4 bg-primary text-primary-foreground rounded-xl sm:rounded-2xl hover:opacity-90 disabled:opacity-50 text-[9px] sm:text-[10px] font-black uppercase tracking-[0.2em] shadow-xl shadow-primary/20 transition-all active:scale-95 glow-primary"
                    >
                      <RefreshCw size={16} className={syncing ? 'animate-spin' : ''} /> Sync
                    </button>

                    <button 
                      onClick={() => confirmReset ? executeReset() : setConfirmReset(true)}
                      disabled={syncing || resetting || isMapping || isReconstructing}
                      className={`flex justify-center items-center gap-3 px-4 py-3 sm:py-4 rounded-xl sm:rounded-2xl text-[9px] sm:text-[10px] font-black uppercase tracking-[0.2em] transition-all active:scale-95 border ${
                        confirmReset 
                          ? 'bg-destructive text-destructive-foreground shadow-xl shadow-destructive/20 border-transparent' 
                          : 'bg-muted/30 text-muted-foreground hover:bg-destructive/10 hover:text-destructive border-border/50'
                      } disabled:opacity-50`}
                    >
                      <Trash2 size={16} /> {confirmReset ? 'Confirm' : 'Reset'}
                    </button>
                  </div>

                  {/* Bottom Row: Reconstruct & Auto-Map */}
                  <div className="grid grid-cols-2 gap-2 sm:gap-4">
                    <button 
                      onClick={handleAutoReconstruct}
                      disabled={syncing || resetting || isMapping || isReconstructing}
                      className="flex justify-center items-center gap-3 px-4 py-3 sm:py-4 bg-primary text-primary-foreground rounded-xl sm:rounded-2xl hover:opacity-90 disabled:opacity-50 text-[9px] sm:text-[10px] font-black uppercase tracking-[0.2em] shadow-xl shadow-primary/20 transition-all active:scale-95"
                    >
                      <Sparkles size={16} className={isReconstructing ? 'animate-pulse' : ''} /> {isReconstructing ? 'Reconstructing' : `Reconstruct`}
                    </button>

                    <button 
                      onClick={handleModuleMapping}
                      disabled={syncing || resetting || isMapping || isReconstructing}
                      className="flex justify-center items-center gap-3 px-4 py-3 sm:py-4 bg-secondary text-secondary-foreground rounded-xl sm:rounded-2xl hover:opacity-90 disabled:opacity-50 text-[9px] sm:text-[10px] font-black uppercase tracking-[0.2em] shadow-xl shadow-secondary/20 transition-all active:scale-95"
                    >
                      <RefreshCw size={16} className={isMapping ? 'animate-spin' : ''} /> {isMapping ? 'Mapping' : 'Auto-Map'}
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        )}

        <div className="flex-1 flex flex-col min-h-0">
          <div className="flex justify-between items-center mb-2 sm:mb-3 ml-1">
            <label className="text-[9px] sm:text-[10px] font-black text-muted-foreground uppercase tracking-[0.2em]">System Logs</label>
            <span className="text-[8px] font-mono text-muted-foreground/40 uppercase tracking-widest">Live Stream</span>
          </div>
          <div className="flex-1 bg-background/30 border border-border rounded-2xl sm:rounded-3xl p-4 sm:p-6 overflow-y-auto font-mono text-[9px] sm:text-[10px] text-foreground/60 custom-scrollbar shadow-inner relative">
            {logs.length === 0 ? (
              <div className="h-full flex flex-col items-center justify-center text-muted-foreground/20 italic gap-4">
                <div className="w-12 h-12 rounded-2xl border-2 border-dashed border-muted-foreground/10 flex items-center justify-center">
                  <AlertCircle size={24} />
                </div>
                <span>System standby. Awaiting commands.</span>
              </div>
            ) : (
              <div className="space-y-2">
                {logs.map((log, i) => (
                  <div key={i} className="flex gap-3 animate-in fade-in slide-in-from-left-2 duration-300">
                    <span className="text-primary/30 shrink-0 font-bold">[{log.time}]</span>
                    <span className="leading-relaxed">{log.msg}</span>
                  </div>
                ))}
                <div ref={logsEndRef} />
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
