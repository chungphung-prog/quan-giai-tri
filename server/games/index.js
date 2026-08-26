import { ttt } from './ttt.js';
import { caro } from './caro.js';
import { connect4 } from './connect4.js';
import { reversi } from './reversi.js';
import { rps } from './rps.js';
import { dots } from './dots.js';
import { battleship } from './battleship.js';
import { chess } from './chess.js';
import { xiangqi } from './xiangqi.js';

const engines=[ttt,caro,connect4,reversi,rps,dots,battleship,chess,xiangqi];
export const games=new Map(engines.map(g=>[g.key,g]));
export const gameCatalog=engines.map(({key,name,icon})=>({key,name,icon}));
export function getGame(key){const game=games.get(key);if(!game){const e=new Error('Game không hỗ trợ online');e.status=400;throw e;}return game;}
