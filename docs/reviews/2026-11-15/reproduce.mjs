// Diagnostic reproductions for the 2026-11-15 review.
// These print current behavior; they are not regression tests asserting fixed behavior.
// Run: node docs/reviews/2026-11-15/reproduce.mjs

import { scoreSteps, barForOnset } from '../../../app/src/score.js';
import { createMic } from '../../../app/src/mic.js';
import { buildScaleRunChart } from '../../../app/src/drills.js';
const report = (...values) => process.stdout.write(values.join(' ') + '\n');
const steps=[0,1,2].map(beat=>({beat,target:{midi:60}}));
const sustain=[{type:'onset',atMs:0},...[0,250,500,750,1000].map(atMs=>({type:'pitch',atMs,midi:60}))];
report('one sustained C scores repeated C',scoreSteps(sustain,steps,{bpm:120}).hits);
const c=buildScaleRunChart({bpm:120});
const perfect=c.steps.map(s=>({type:'pitch',atMs:s.beat*500,midi:s.target.midi}));
report('perfect on-click performance',scoreSteps(perfect,c.steps,{bpm:120,clickTimesMs:c.audioEvents.filter(e=>e.type==='click').map(e=>e.beat*500)}).hits,'of',c.steps.length);
let resolve;let stopped=0;const pending=new Promise(r=>resolve=r);
const mic=createMic({getUserMedia:()=>{},capture:()=>({start:()=>pending,stop:()=>stopped++})});
const arm=mic.arm();mic.stop();resolve();await arm;report('stop during arm ->',mic.state,'capture stops',stopped);
import { createRun, reduce, summarizeDrill } from '../../../app/src/drills.js';
import { emptyProgress, applyResult, skillState, addDays } from '../../../app/src/progress.js';
const now=Date.now();let r={...createRun(c),hintLevel:3};
r=reduce(r,{type:'START',at:0,wallAt:now}).state;
r=reduce(r,{type:'TICK',beat:4}).state;
r=reduce(r,{type:'FINISH',at:27000,wallAt:now+27000,syncScore:{accuracy:0,timing:{medianMs:500}}}).state;
r=reduce(r,{type:'SELF_REPORT',clean:true}).state;
const progress=applyResult(emptyProgress(),summarizeDrill(r),{now});
report('0% accuracy + Clean -> mastered',Boolean(progress.skills[c.id].masteredAt));
report('30-day review, day 15 state',skillState({masteredAt:now,lastCleanRecallAt:now,dueAt:addDays(now,30)},addDays(now,15)));
import { buildChordChangeChart } from '../../../app/src/drills.js';
import { scoreBars } from '../../../app/src/score.js';
const chord=buildChordChangeChart({pairId:'C-G',bpm:120,bars:8});let ch=reduce(createRun(chord),{type:'START',at:0,wallAt:now}).state;ch=reduce(ch,{type:'TICK',beat:7.94}).state;
const atMs=3970;const bar=barForOnset(atMs-2000,{bars:8,barSpanMs:2000});ch=reduce(ch,{type:'CHANGE_ONSET',bar,atMs}).state;
report('30ms-early bar-2 strum: live count',ch.changes.counted,'final count',scoreBars([{type:'onset',atMs:atMs-2000}],{bars:8,barSpanMs:2000}).counted);
