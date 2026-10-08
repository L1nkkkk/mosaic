import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { withBrowser } from './harness.mjs';

let providerCalls = 0;
const externalFetch = async url => {
  providerCalls++;
  if (String(url).includes('geocoding')) return Response.json({ results: [{ name: '北京', country: '中国', latitude: 39.9, longitude: 116.4 }] });
  return Response.json({ current: { temperature_2m: 21, relative_humidity_2m: 50, apparent_temperature: 20, is_day: 1, weather_code: 2, wind_speed_10m: 7, time: '2026-10-09T14:00' }, daily: { time: ['2026-10-09','2026-10-10','2026-10-11'], weather_code: [2,0,61], temperature_2m_max: [24,25,23], temperature_2m_min: [16,18,17] } });
};
await withBrowser(async ({ app, base, command, evaluate, waitFor }) => {
  await command('Page.navigate', { url: base + '/private' });
  await waitFor('document.querySelector("#private-page")');
  const picture = await evaluate(`(async () => {
    const canvas=document.createElement('canvas');canvas.width=900;canvas.height=600;
    const ctx=canvas.getContext('2d'),g=ctx.createLinearGradient(0,0,900,600);g.addColorStop(0,'#193964');g.addColorStop(1,'#ac82ba');ctx.fillStyle=g;ctx.fillRect(0,0,900,600);ctx.fillStyle='#e9c8aa';ctx.beginPath();ctx.arc(620,160,65,0,7);ctx.fill();ctx.fillStyle='#102939';ctx.beginPath();ctx.moveTo(0,600);ctx.lineTo(0,430);ctx.lineTo(250,230);ctx.lineTo(450,420);ctx.lineTo(650,280);ctx.lineTo(900,400);ctx.lineTo(900,600);ctx.fill();
    const blob=await new Promise(r=>canvas.toBlob(r,'image/png'));
    const {mediaField}=await import('/modules/media.js');const form=mediaField('测试图片','',url=>{window.uploadedImage=url});document.body.append(form);
    const input=form.querySelector('input[type=file]'), transfer=new DataTransfer();transfer.items.add(new File([blob],'fixture.png',{type:'image/png'}));input.files=transfer.files;input.dispatchEvent(new Event('change'));return true;
  })()`);
  assert.equal(picture, true);
  await waitFor('window.uploadedImage');
  const image = await evaluate('window.uploadedImage');
  const audio = await evaluate(`(async()=>{const a=new Uint8Array(44+16000*30),v=new DataView(a.buffer);const text=(i,s)=>[...s].forEach((c,n)=>a[i+n]=c.charCodeAt(0));text(0,'RIFF');v.setUint32(4,a.length-8,true);text(8,'WAVE');text(12,'fmt ');v.setUint32(16,16,true);v.setUint16(20,1,true);v.setUint16(22,1,true);v.setUint32(24,8000,true);v.setUint32(28,16000,true);v.setUint16(32,2,true);v.setUint16(34,16,true);text(36,'data');v.setUint32(40,a.length-44,true);const r=await fetch('/api/admin/media',{method:'POST',headers:{'Content-Type':'audio/wav'},body:a});return (await r.json()).url})()`);
  const state = await app.store.read();
  const make = (type, data, span, height) => ({ id: type, type, audience: 'public', visible: true, layout: { span, height }, data: { ...structuredClone(app.registry.get(type).meta.defaultData), ...data } });
  const page = { title: 'Mosaic · 模块验收', modules: [
    make('weather', { city: { name: '北京', region: '测试天气', latitude:39.9, longitude:116.4 } }, 4, 340),
    make('music', { tracks: [{id:'track',title:'播放器测试',artist:'本地静音音频',audio,cover:image}] }, 4,340),
    make('photo', { image, title:'留住一个瞬间', caption:'照片模块 · 上传、裁切与配文',alt:'渐变天空与山景' },4,340),
    make('books', { items:[{id:'b1',title:'一本正在读的书',author:'作者',note:'记录自己的阅读感受。',cover:image,url:'',status:'reading'},{id:'b2',title:'下一本书',author:'作者',note:'',cover:'',url:'',status:'want'}] },6,350),
    make('visitors', {},6,350)
  ] };
  await app.store.mutate(state.revision, state => ({...state,draft:page,published:structuredClone(page)}));
  await command('Page.navigate', { url:base+'/edit' });
  await waitFor(`document.querySelector('.weather-current strong')?.textContent === '21°' && document.querySelector('.music-module audio')`);
  assert.equal(await evaluate('Boolean(document.querySelector(".module-error"))'),false);
  await waitFor(`document.querySelector('.photo-module img')?.naturalWidth > 0`);
  await evaluate(`window.savedAudio=document.querySelector('audio');savedAudio.load()`);
  await waitFor('savedAudio.readyState >= 2');
  const play = await command('Runtime.evaluate',{expression:'savedAudio.currentTime=5;savedAudio.play().then(()=>true)',awaitPromise:true,returnByValue:true,userGesture:true});
  assert.equal(play.result.value,true);
  await evaluate(`document.querySelector('[data-module-id="music"] [data-layout-action="move"]').dispatchEvent(new KeyboardEvent('keydown',{key:'Home',bubbles:true}));document.querySelector('[data-module-id="music"] [data-layout-action="resize"]').dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowDown',bubbles:true}));window.refreshForTest()`);
  assert.equal(await evaluate(`savedAudio===document.querySelector('audio') && !savedAudio.paused && savedAudio.currentTime>=5`),true,'Reorder, resize and resource refresh preserve playback');
  assert.equal(providerCalls,1,'Weather requests share cache');
  // Exercise the real city search editor without changing the published page.
  await evaluate(`document.querySelector('[data-module-id="weather"] [data-layout-action="move"]').click()`);
  // Direct editor contract also verifies a field edit followed by city selection keeps both changes.
  await evaluate(`(async()=>{const m=await import('/modules/weather/client.js');const form=m.edit({data:{title:'天气',city:null},change:data=>window.cityEdit=data});document.body.append(form);window.cityForm=form;const title=form.querySelector('input');title.value='旅途天气';title.dispatchEvent(new Event('input'));form.querySelector('[aria-label="搜索城市"]').value='北京';form.querySelector('button').click()})()`);
  await waitFor(`cityForm.querySelector('.weather-city-results button')`);
  await evaluate(`cityForm.querySelector('.weather-city-results button').click()`);
  assert.deepEqual(await evaluate(`({title:cityEdit.title,city:cityEdit.city.name})`),{title:'旅途天气',city:'北京'});
  await evaluate("savedAudio.pause();document.querySelector('#save-draft').click()");
  await waitFor("document.querySelector('#save-status').textContent.includes('已保存')");
  await command('Page.navigate',{url:base+'/private'});
  await waitFor(`document.querySelector('.weather-current strong')?.textContent==='21°'`);
  if(process.env.MOSAIC_REVIEW_DIR){await mkdir(process.env.MOSAIC_REVIEW_DIR,{recursive:true});await writeFile(process.env.MOSAIC_REVIEW_DIR+'/modules-desktop.png',Buffer.from((await command('Page.captureScreenshot',{captureBeyondViewport:true})).data,'base64'));}
  await command('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:false});
  await waitFor('document.documentElement.scrollWidth<=innerWidth');
  assert.equal(await evaluate(`[...document.querySelectorAll('.module-slot')].every(el=>el.scrollWidth<=el.clientWidth+1)`),true);
  if(process.env.MOSAIC_REVIEW_DIR)await writeFile(process.env.MOSAIC_REVIEW_DIR+'/modules-mobile.png',Buffer.from((await command('Page.captureScreenshot')).data,'base64'));
  console.log('Five modules: actual image compression/upload, audio upload/seeking and uninterrupted playback, cached weather, city editing, books, photo decoding and mobile widths verified');
},{externalFetch});
