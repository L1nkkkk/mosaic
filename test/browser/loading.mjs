import assert from 'node:assert/strict';
import { withBrowser } from './harness.mjs';

await withBrowser(async ({base,command,evaluate,waitFor}) => {
  await command('Network.enable');
  await command('Network.clearBrowserCache');
  await command('Network.emulateNetworkConditions',{offline:false,latency:100,downloadThroughput:200000,uploadThroughput:100000});
  await command('Page.navigate',{url:base+'/private'});
  await waitFor('document.querySelectorAll(".module-slot").length > 0');
  const cardsAt = await evaluate('performance.now()');
  const result = await evaluate(`(async()=>{
    const url=getComputedStyle(document.body,'::before').backgroundImage.match(/url\\("?([^"\\)]+)"?\\)/)?.[1];
    if(url) await new Promise((resolve,reject)=>{const img=new Image();img.onload=resolve;img.onerror=reject;img.src=url});
    const rows=performance.getEntriesByType('resource');
    const background=rows.find(row=>row.name===url);
    return {backgroundBytes:background?.encodedBodySize,backgroundReadyMs:Math.round(background?.responseEnd||0),requests:rows.length,transferredBytes:rows.reduce((sum,row)=>sum+row.transferSize,0)};
  })()`);
  console.log(JSON.stringify({connection:'1.6 Mbps / 100ms RTT',cardsAtMs:Math.round(cardsAt),...result}));
  assert.ok(result.backgroundBytes < 350000,'First-load background must stay below 350 KB');
});
