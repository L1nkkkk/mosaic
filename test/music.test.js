import test from 'node:test';
import assert from 'node:assert/strict';
import { neteaseId, coverUrl, nextTrack } from '../modules/music/source.js';
import { validate } from '../modules/music/definition.js';
import { musicProvider, playbackUrl } from '../server/music.js';

test('NetEase share links normalize IDs and strip tracking; old audio fields remain readable', () => {
  for (const url of ['https://music.163.com/song?id=2700386313&uct2=tracking','https://music.163.com/#/song?id=2700386313','https://y.music.163.com/m/song?id=2700386313']) assert.equal(neteaseId(url), '2700386313');
  for (const url of ['https://music.163.com.evil.test/song?id=1','https://user:pass@music.163.com/song?id=1','https://music.163.com/playlist?id=1','https://music.163.com/song?id=-1','https://music.163.com/song?id=1%26evil=1']) assert.equal(neteaseId(url),'');
  const data = validate({title:'Music',tracks:[{id:'a',title:'',artist:'',cover:'',audio:'https://music.163.com/song?id=2700386313&uct2=tracking'}]});
  assert.equal(data.mode,'sequence');assert.equal(data.autoplay,false);assert.equal(data.tracks[0].neteaseId,'2700386313');assert.equal(data.tracks[0].audio,'');assert.ok(!JSON.stringify(data).includes('tracking'));
  assert.throws(()=>validate({...data,mode:'anything'}));assert.throws(()=>validate({...data,autoplay:'true'}));
  assert.throws(()=>coverUrl('https://evil.test/cover.jpg'));
});

test('play modes stop, wrap, repeat and avoid immediate random repeats', () => {
  const tracks=['a','b','c'].map(id=>({id}));
  assert.equal(nextTrack(tracks,'a','sequence',1,true),'b');assert.equal(nextTrack(tracks,'c','sequence',1,true),undefined);
  assert.equal(nextTrack(tracks,'c','loop',1,true),'a');assert.equal(nextTrack(tracks,'b','single',1,true),'b');
  assert.equal(nextTrack(tracks,'b','single',1,false),'c');assert.equal(nextTrack(tracks,'a','loop',-1),'c');
  assert.equal(nextTrack(tracks,'b','shuffle',1,true,()=>0),'a');assert.equal(nextTrack(tracks,'b','shuffle',1,true,()=>.999),'c');
  assert.equal(nextTrack([{id:'a'}],'a','shuffle',1,true),'a');
});

test('provider caches metadata and upgrades only trusted public audio redirects to HTTPS', async () => {
  let calls=0;
  const provider=musicProvider(async (url,options)=>{
    calls++;
    if(url.includes('/api/song/detail')) return Response.json({songs:[{id:2700386313,name:'Song',artists:[{name:'Artist'}],album:{picUrl:'http://p1.music.126.net/cover.jpg'}}]});
    assert.equal(options.redirect,'manual');return new Response(null,{status:302,headers:{Location:'http://m801.music.126.net/audio.mp3?token=public'}});
  });
  const first=await provider.resolve('2700386313'),second=await provider.resolve('2700386313');
  assert.equal(calls,2);assert.deepEqual(first,second);assert.equal(first.title,'Song');assert.equal(first.audio,'https://m801.music.126.net/audio.mp3?token=public');assert.equal(first.cover,'https://p1.music.126.net/cover.jpg?param=240y240');
  for(const value of ['http://127.0.0.1/file','https://evil.music.126.net.evil.test/file','https://music.163.com/404','https://user:pass@m801.music.126.net/file']) assert.equal(playbackUrl(value),'');
  const unavailable=musicProvider(async url=>url.includes('detail')?Response.json({songs:[{id:1,name:'Restricted',artists:[]}]}):new Response(null,{status:302,headers:{Location:'https://music.163.com/404'}}));
  assert.deepEqual((await unavailable.resolve('1')).playable,false);
});
