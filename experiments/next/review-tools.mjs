import { readFileSync } from 'node:fs';
import { resolve, dirname, relative } from 'node:path';
import { builtinModules } from 'node:module';

export function worstDeciles(rows) {
  if(!rows.length)throw Error('Пустой набор');
  const n=Math.ceil(rows.length/10),mean=a=>a.reduce((s,x)=>s+x,0)/a.length;
  const ordered=[...rows].sort((a,b)=>a.base.profit-b.base.profit);
  const baseMean=mean(ordered.slice(0,n).map(x=>x.base.profit));
  const pairedCandidateMean=mean(ordered.slice(0,n).map(x=>x.cand.profit));
  const candidateMean=mean(rows.map(x=>x.cand.profit).sort((a,b)=>a-b).slice(0,n));
  return {worlds:n,baseMean,candidateMean,pairedCandidateMean,lossPct:baseMean>0?(baseMean-candidateMean)/baseMean*100:null};
}

export function validateHttpEvidence(evidence,{candidateHash,timeout,hashes={},candidateDependencies=[],candidatePath,deployedPath}) {
  if(!evidence||evidence.source!=='http'||candidatePath!==undefined&&candidatePath!==deployedPath||!Number.isFinite(timeout)||timeout<=0||evidence.candidateHash!==candidateHash||evidence.timeout!==timeout||Object.entries(hashes).some(([p,h])=>evidence.hashes?.[p]!==h)||candidateDependencies.some(h=>!Object.values(evidence.hashes??{}).includes(h))||!Number.isInteger(evidence.count)||evidence.count<1||!Array.isArray(evidence.worlds)||!evidence.worlds.length||evidence.worlds.some(w=>w.invalid!==0||w.errors!==0||w.timeouts!==0||w.stopReason)||!Number.isFinite(evidence.p99)||!Number.isFinite(evidence.max)||evidence.p99<0||evidence.max<evidence.p99)return {status:'unverified'};
  return {status:evidence.p99<timeout*0.5&&evidence.max<timeout?'pass':'fail',p99:evidence.p99,max:evidence.max};
}

export function assertExperimentAllowed({set,outputExists,finalUsed}) {
  if(outputExists)throw Error('Файл результата уже существует');
  if(set==='final'&&finalUsed)throw Error('Финальный набор уже использован; требуется новый независимый набор');
}

export function moduleGraph(entry) {
  const root=process.cwd(),visited=new Set();
  function visit(file) {
    const absolute=resolve(file);if(visited.has(absolute))return;visited.add(absolute);
    const text=readFileSync(absolute,'utf8');
    const imports=/(?:^|[;\n])\s*(?:import|export)\s+(?:[^'";\n]*?\s+from\s*)?['"]([^'"]+)['"]|\bimport\(\s*['"]([^'"]+)['"]\s*\)/gm;
    for(const m of text.matchAll(/\bimport\s*\(([^)]*)\)/g))if(!/^\s*['"][^'"]+['"]\s*$/.test(m[1]))throw Error(`Динамическая зависимость не зафиксирована: ${absolute}`);
    for(const m of text.matchAll(imports)){const spec=m[1]??m[2];if(spec.startsWith('.'))visit(resolve(dirname(absolute),spec));else if(!spec.startsWith('node:')&&!builtinModules.includes(spec))throw Error(`Внешняя зависимость не зафиксирована: ${spec}`);}
  }
  visit(entry);return [...visited].map(p=>relative(root,p)).sort();
}
