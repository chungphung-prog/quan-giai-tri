import { GameRuleError, asInt, assertTurn, clone } from './common.js';
// Cờ vua mini server-authoritative: đủ di chuyển/ăn quân/phong cấp; chưa có nhập thành, en passant, chiếu/chiếu bí.
const START=['♜','♞','♝','♛','♚','♝','♞','♜','♟','♟','♟','♟','♟','♟','♟','♟',...Array(32).fill(null),'♙','♙','♙','♙','♙','♙','♙','♙','♖','♘','♗','♕','♔','♗','♘','♖'];
const WHITE=new Set(['♙','♖','♘','♗','♕','♔']); const BLACK=new Set(['♟','♜','♞','♝','♛','♚']);
const color=(p)=>WHITE.has(p)?0:BLACK.has(p)?1:null; const rc=(i)=>[Math.floor(i/8),i%8];
function legal(board,from){
  const p=board[from],side=color(p); if(side==null)return [];
  const [r,c]=rc(from),out=[]; const add=(rr,cc)=>{if(rr<0||rr>7||cc<0||cc>7)return false;const i=rr*8+cc;if(board[i]==null){out.push(i);return true;}if(color(board[i])!==side)out.push(i);return false;};
  const slide=(dirs)=>{for(const[dr,dc]of dirs){let rr=r+dr,cc=c+dc;while(add(rr,cc)){rr+=dr;cc+=dc;}}};
  if(p==='♙'||p==='♟'){const d=p==='♙'?-1:1,start=p==='♙'?6:1;const one=(r+d)*8+c;if(r+d>=0&&r+d<8&&board[one]==null){out.push(one);const two=(r+2*d)*8+c;if(r===start&&board[two]==null)out.push(two);}for(const dc of[-1,1]){const rr=r+d,cc=c+dc;if(rr>=0&&rr<8&&cc>=0&&cc<8){const i=rr*8+cc;if(board[i]!=null&&color(board[i])!==side)out.push(i);}}}
  else if(p==='♘'||p==='♞') for(const[dr,dc]of[[2,1],[2,-1],[-2,1],[-2,-1],[1,2],[1,-2],[-1,2],[-1,-2]])add(r+dr,c+dc);
  else if(p==='♗'||p==='♝')slide([[1,1],[1,-1],[-1,1],[-1,-1]]);
  else if(p==='♖'||p==='♜')slide([[1,0],[-1,0],[0,1],[0,-1]]);
  else if(p==='♕'||p==='♛')slide([[1,0],[-1,0],[0,1],[0,-1],[1,1],[1,-1],[-1,1],[-1,-1]]);
  else if(p==='♔'||p==='♚')for(const[dr,dc]of[[1,0],[-1,0],[0,1],[0,-1],[1,1],[1,-1],[-1,1],[-1,-1]])add(r+dr,c+dc);
  return out;
}
export const chess={key:'chess',name:'Cờ vua mini',icon:'♟️',create:()=>({board:[...START],turn:0}),apply(input,action,playerIndex){const state=clone(input);assertTurn(state,playerIndex);const from=asInt(action.from,0,63,'ô đi'),to=asInt(action.to,0,63,'ô đến');if(color(state.board[from])!==playerIndex)throw new GameRuleError('Không phải quân của bạn');if(!legal(state.board,from).includes(to))throw new GameRuleError('Nước đi không hợp lệ');const captured=state.board[to];state.board[to]=state.board[from];state.board[from]=null;const [r]=rc(to);if(state.board[to]==='♙'&&r===0)state.board[to]='♕';if(state.board[to]==='♟'&&r===7)state.board[to]='♛';if(captured==='♔'||captured==='♚')return {state,result:{winnerIndex:playerIndex}};state.turn=1-playerIndex;return {state};},view:(state)=>state};
