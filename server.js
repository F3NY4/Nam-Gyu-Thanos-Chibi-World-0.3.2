const path=require('path');
const http=require('http');
const express=require('express');
const {Server}=require('socket.io');
const app=express();
const server=http.createServer(app);
const io=new Server(server,{cors:{origin:'*'},transports:['websocket','polling']});
app.use(express.static(__dirname));
const rooms=new Map();
const allowedCharacters=new Set(['namgyu','thanos']);
const allowedScenes=new Set(['street','home','park','cafe']);
const allowedActions=new Set(['kiss','hug','wave','laugh','heart','sit','sleep','eat','dance','cook','bath','sleepTogether','changeDay','changeSleep','changeHot','changeCold']);
const clamp=(n,a,b)=>Math.max(a,Math.min(b,n));
const starts={street:{x:870,y:520},home:{x:850,y:600},park:{x:850,y:520},cafe:{x:850,y:560}};
function getRoom(id){if(!rooms.has(id))rooms.set(id,{players:new Map(),started:Date.now(),weather:'clear',time:8.5,history:[],lastSaved:Date.now()});return rooms.get(id)}
function publicPlayer(s){return {id:s.id,character:s.character,x:s.x,y:s.y,scene:s.scene||'street',dir:s.dir||1,energy:s.energy,hunger:s.hunger,mood:s.mood,emote:s.emote||null,emoteUntil:s.emoteUntil||0,bubble:s.bubble||null,bubbleUntil:s.bubbleUntil||0,outfit:s.outfit||'day',action:s.action||'idle'}}
function state(r){const out={};for(const s of r.players.values())out[s.id]=publicPlayer(s);return out}
function cleanRoom(r){r.time=(8.5+((Date.now()-r.started)/1000/20))%24}
function sameScene(a,b){return a&&b&&a.scene===b.scene}
function distance(a,b){return Math.hypot(a.x-b.x,a.y-b.y)}
function nearZone(s,zone){if(!s||s.scene!=='home')return false;const zones={bed:{x:1080,y:390,w:480,h:280},bath:{x:1260,y:560,w:320,h:190},kitchen:{x:760,y:120,w:360,h:260}};const z=zones[zone];return z&&s.x>z.x-70&&s.x<z.x+z.w+70&&s.y>z.y-70&&s.y<z.y+z.h+70}
function setAction(s,action){s.action=action;s.emote=action;s.emoteUntil=Date.now()+2300}
io.on('connection',socket=>{
 socket.on('joinRoom',({room:rawRoom,character,save})=>{
  const roomId=String(rawRoom||'couple').replace(/[^a-zA-Z0-9_\- ]/g,'').trim().slice(0,24)||'couple';
  if(!allowedCharacters.has(character))return socket.emit('joinDenied',{reason:'Неизвестный персонаж.'});
  const r=getRoom(roomId);
  if(r.players.size>=2)return socket.emit('joinDenied',{reason:'Комната уже заполнена (максимум 2 игрока).'});
  for(const s of r.players.values())if(s.character===character)return socket.emit('joinDenied',{reason:'Этот персонаж уже занят в комнате.'});
  socket.roomId=roomId;socket.character=character;
  socket.scene=save?.scene&&allowedScenes.has(save.scene)?save.scene:'street';
  const st=starts[socket.scene];socket.x=st.x+(character==='thanos'?45:0);socket.y=st.y;socket.dir=character==='namgyu'?1:-1;
  socket.energy=clamp(Number(save?.energy??100),0,100);socket.hunger=clamp(Number(save?.hunger??100),0,100);socket.mood=clamp(Number(save?.mood??85),0,100);socket.emote=null;socket.bubble=null;socket.outfit=allowedOutfit(save?.outfit)?save.outfit:'day';socket.action='idle';
  r.players.set(socket.id,socket);socket.join(roomId);cleanRoom(r);
  socket.emit('roomState',{room:roomId,players:state(r),time:r.time,weather:r.weather,history:r.history.slice(-80)});
  socket.to(roomId).emit('playerJoined',publicPlayer(socket));
  io.to(roomId).emit('system',{text:`${character==='namgyu'?'Нам Гю':'Танос'} вошёл в комнату.`});
 });
 socket.on('move',data=>{if(!socket.roomId)return;const r=rooms.get(socket.roomId);if(!r?.players.has(socket.id))return;socket.x=clamp(Number(data.x)||socket.x,55,1745);socket.y=clamp(Number(data.y)||socket.y,95,985);if(allowedScenes.has(data?.scene))socket.scene=data.scene;socket.dir=Number(data.dir)<0?-1:1;socket.action='walk';socket.energy=clamp(socket.energy-.018,0,100);socket.hunger=clamp(socket.hunger-.008,0,100);socket.to(socket.roomId).emit('playerMoved',publicPlayer(socket));});
 socket.on('sceneChange',data=>{if(!socket.roomId)return;const r=rooms.get(socket.roomId);if(!r?.players.has(socket.id))return;const scene=String(data?.scene||'');if(!allowedScenes.has(scene))return;socket.scene=scene;const st=starts[scene];socket.x=st.x+(socket.character==='thanos'?45:0);socket.y=st.y;socket.action='idle';socket.emote=null;io.to(socket.roomId).emit('sceneChanged',publicPlayer(socket));});
 socket.on('action',data=>{if(!socket.roomId)return;const r=rooms.get(socket.roomId);if(!r?.players.has(socket.id)||!allowedActions.has(data?.action))return;const a=data.action;const o=[...r.players.values()].find(s=>s.id!==socket.id);
  if(a==='sleepTogether'||a==='bath'||a==='cook'){if(!o||!sameScene(socket,o))return socket.emit('actionDenied',{reason:'Для этого действия вы должны быть в одной локации.'});if(a==='sleepTogether'&&(!nearZone(socket,'bed')||!nearZone(o,'bed')))return socket.emit('actionDenied',{reason:'Для совместного сна подойдите вдвоём к кровати.'});if(a==='bath'&&!nearZone(socket,'bath'))return socket.emit('actionDenied',{reason:'Подойди к ванной в квартире.'});if(a==='cook'&&!nearZone(socket,'kitchen'))return socket.emit('actionDenied',{reason:'Подойди к кухонной стойке.'});}
  if(a==='sleepTogether'&&o){setAction(socket,'sleepTogether');setAction(o,'sleepTogether');socket.outfit='sleep';o.outfit='sleep';}
  else if(a==='bath'){setAction(socket,'bath');socket.outfit='bath';}
  else if(a==='cook'){setAction(socket,'cook');socket.energy=clamp(socket.energy+2,0,100);socket.hunger=clamp(socket.hunger+8,0,100);}
  else if(a==='eat'){setAction(socket,'eat');socket.hunger=clamp(socket.hunger+18,0,100)}
  else {setAction(socket,a);if(a==='changeDay')socket.outfit='day';if(a==='changeSleep')socket.outfit='sleep';if(a==='changeHot')socket.outfit='hot';if(a==='changeCold')socket.outfit='cold';}
  io.to(socket.roomId).emit('playerAction',publicPlayer(socket));if(a==='sleepTogether'&&o)io.to(socket.roomId).emit('playerAction',publicPlayer(o));
 });
 socket.on('interaction',data=>{if(!socket.roomId)return;const r=rooms.get(socket.roomId);if(!r?.players.has(socket.id))return;const o=[...r.players.values()].find(s=>s.id!==socket.id);if(!o||!sameScene(socket,o))return socket.emit('actionDenied',{reason:'Нужно находиться рядом в одной локации.'});const type=['kiss','hug','highfive','dance'].includes(data?.type)?data.type:'hug';if(distance(socket,o)>105)return socket.emit('actionDenied',{reason:'Подойди ближе к '+(o.character==='namgyu'?'Нам Гю':'Таносу')+'.'});setAction(socket,type);setAction(o,type);io.to(socket.roomId).emit('interaction',{type,from:publicPlayer(socket),to:publicPlayer(o)});});
 socket.on('chat',data=>{if(!socket.roomId)return;const text=String(data?.text||'').trim().slice(0,180);if(!text)return;const msg={id:socket.id,name:socket.character==='namgyu'?'Нам Гю':'Танос',character:socket.character,text,at:Date.now()};const r=rooms.get(socket.roomId);r.history.push(msg);r.history=r.history.slice(-80);io.to(socket.roomId).emit('chat',msg);socket.bubble=text;socket.bubbleUntil=Date.now()+6500;io.to(socket.roomId).emit('playerBubble',publicPlayer(socket));});
 socket.on('saveRoom',data=>{if(!socket.roomId)return;const r=rooms.get(socket.roomId);r.lastSaved=Date.now();socket.emit('saved',{room:socket.roomId,at:r.lastSaved,note:'Комната сохранена в памяти текущего сервера и на устройстве.'});});
 socket.on('disconnect',()=>{if(!socket.roomId)return;const r=rooms.get(socket.roomId);if(!r)return;r.players.delete(socket.id);socket.to(socket.roomId).emit('playerLeft',socket.id);if(r.players.size===0){r.lastSaved=Date.now();rooms.delete(socket.roomId)}});
});
function allowedOutfit(v){return ['day','sleep','hot','cold','bath'].includes(v)}
setInterval(()=>{for(const [id,r] of rooms){cleanRoom(r);io.to(id).emit('worldClock',{time:r.time,weather:r.weather});for(const s of r.players.values()){if(Date.now()>(s.emoteUntil||0)){s.emote=null;if(['dance','wave','laugh','heart','kiss','hug','highfive','cook','eat'].includes(s.action))s.action='idle'}if(Date.now()>(s.bubbleUntil||0))s.bubble=null;s.energy=clamp(s.energy-.005,0,100);s.hunger=clamp(s.hunger-.003,0,100)}}},1000);
const PORT=process.env.PORT||3000;server.listen(PORT,'0.0.0.0',()=>console.log(`Chibi World 0.3.2 listening on ${PORT}`));
