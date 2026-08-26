import test from 'node:test';
import assert from 'node:assert/strict';
import { ttt } from '../games/ttt.js';
import { connect4 } from '../games/connect4.js';
import { rps } from '../games/rps.js';
import { battleship } from '../games/battleship.js';

function apply(game,state,action,p){return game.apply(state,action,p).state;}

test('tic tac toe enforces turns and occupied cells',()=>{
  let s=ttt.create();s=apply(ttt,s,{index:0},0);
  assert.throws(()=>ttt.apply(s,{index:1},0),/Chưa tới lượt/);
  assert.throws(()=>ttt.apply(s,{index:0},1),/Ô đã có quân/);
});

test('tic tac toe winner is server-derived',()=>{
  let s=ttt.create();
  s=apply(ttt,s,{index:0},0);s=apply(ttt,s,{index:3},1);s=apply(ttt,s,{index:1},0);s=apply(ttt,s,{index:4},1);
  const out=ttt.apply(s,{index:2},0);assert.equal(out.result.winnerIndex,0);
});

test('connect4 rejects a full column',()=>{
  let s=connect4.create();for(let i=0;i<6;i++)s=apply(connect4,s,{col:0},i%2);
  assert.throws(()=>connect4.apply(s,{col:0},0),/đầy/);
});

test('rps hides the opponent pick until both lock',()=>{
  let s=rps.create();s=apply(rps,s,{choice:'rock'},0);
  assert.deepEqual(rps.view(s,1).picks,['locked',null]);
  const out=rps.apply(s,{choice:'scissors'},1);
  assert.equal(out.result.winnerIndex,0);
  assert.deepEqual(rps.view(out.state,1).picks,['rock','scissors']);
});

test('battleship never exposes the opponent fleet in player view',()=>{
  const s=battleship.create();const view=battleship.view(s,0);
  assert.ok(Array.isArray(view.myBoard));
  assert.equal(Object.hasOwn(view,'boards'),false);
  assert.equal(JSON.stringify(view).includes(JSON.stringify(s.boards[1])),false);
});
