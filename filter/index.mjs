import {Cluster as Cluster} from 'puppeteer-cluster';
import { adsLists, PuppeteerBlocker, Request } from '@cliqz/adblocker-puppeteer';
import * as fs from 'fs';
//import * as puppeteer from 'puppeteer';
import * as readline from 'readline';
import { parseArgs } from 'node:util';


const consentOMatic = '~/snap/chromium/common/chromium/Default/Extensions/mdjildafknihdffpkfmmpnpoiajfjnjd';

const {values, positionals} = parseArgs({
  options: {
    'concurrency': {
      type: 'string',
      short: 'c',
    },
    'starting-host-abs': {
      type: 'string',
      short: 'S',
    },
    'starting-host-rel': {
      type: 'string',
      short: 's',
    },
    'ad-wait': {
      type: 'string',
      short: 'w',
    },
    'maxw-wait': {
      type: 'string',
      short: 'W',
    },
  },
  allowPositionals: true,
});


const listName = positionals[0];
if (!listName) throw new Error('list name argument missing');
const startingHost = values['starting-host-abs'] ?? (() => {
  try {
    const text = fs.readFileSync(`../data/${listName}/last.txt` , 'utf-8');
    return parseInt(text) + 1 + parseInt(values['starting-host-rel'] ?? 0);
  } catch (e) {
    return 1; 
  }
})();
const concurrency = parseInt(values['concurrency'] ?? 1);
const maxWait = parseInt(values['max-wait'] ?? 30000);
const adWait = parseInt(values['ad-wait'] ?? 5000);



const log = x => console.log(x);

log([listName, startingHost, concurrency, maxWait]);


function parseHost(l) {
  const fields = l.split('\t');
  return {
    id: parseInt(fields[0]),
    domain: fields[4].split('.').reverse().join('.'),
    hc: fields[1],
    pr: fields[3],
  };
}


async function* getHosts() {
  //TODO skip already crawled
  const file = readline.createInterface({
    input: fs.createReadStream(`../data/${listName}/in.txt`),
    terminal: false
  });
  //for await (const l of file) break; //skipping first line
  file[Symbol.asyncIterator]().next();
  for await (const l of file) {
    const host = parseHost(l);
    if (host.id >= startingHost) {
      await fs.promises.writeFile(`../data/${listName}/last.txt`, JSON.stringify(host.id));
      yield host;
    }
  }
}
const hosts = getHosts();






async function isLegit(page, url, blocker) {
  await blocker.enableBlockingInPage(page);
  let bl = new Promise((resolve) => {
    blocker.once('request-blocked', (request) => {
      resolve([url, false]);
    });
  });
  let pl = new Promise(async (resolve) => {
    try {
      const response = await page.goto(url, { waitUntil: 'load'});
      if (response.status() !== 200) resolve([url, `status - ${response.status()}`]);
      await new Promise(r => setTimeout(() => r(), adWait));
    } catch (e) {
      resolve([url, "page error"]);
    }
    resolve([url, true]);
  });
  let tl = new Promise(async (resolve) => {
    setTimeout(() => {
      //console.log('hard time out');
      resolve([url, 'hard time out']);
    }, maxWait)
  })
  return await Promise.race([pl, bl, tl]);
}


async function visit(page, url) {
  log('trying to visit ' + url);
  const pl = new Promise(async resolve => {
    try {
      resolve(await page.goto(url, {waitUntil: 'domcontentloaded'}));
    } catch (e) {
      resolve('error');
    }
  });
  const res = await Promise.race([pl, new Promise(r => setTimeout(() => r('timeout'), 5000))]);
  return res === 'timeout' ? res : res.status();
}





const genBlocker = async () => (
    PuppeteerBlocker.fromLists(
    fetch, 
    adsLists,
    {
      enableCompression: true,
    },
    {
      path: 'engine.bin',
      read: fs.promises.readFile,
      write: fs.promises.writeFile,
    },
  )
);

let lastCompletedTime = 0;

const tasks = Array(concurrency);

const blockers = await Promise.all(Array.from(Array(concurrency), genBlocker));
log('blockers initialized');


async function genCluster() {
  const cluster = await Cluster.launch({
	  puppeteerOptions: {
      args: [
        `--load-extension=${consentOMatic}`
      ]
    },
    concurrency: Cluster.CONCURRENCY_PAGE,
    //concurrency: Cluster.CONCURRENCY_BROWSER,
    maxConcurrency: concurrency,
  });
  await cluster.task(async ({worker, page, data: host}) => { // "data: host" wut?
    if (tasks[worker.id]) log('wtf?');
    tasks[worker.id] = host;
    const url = 'https://' + host.domain;
    const res = await isLegit(page, url, blockers[worker.id]);
    //const res = await visit(page, url);
    console.log(`[worker ${worker.id}]:`, host.id, res);
    if (res[1] === true) { 
      await fs.promises.appendFile(`../data/${listName}/out.txt`, Object.values(host).join(' ') + '\n'); //why can't use async stuff?
      //^^ format it more sanely TODO
    }
    tasks[worker.id] = null;
    lastCompletedTime = Date.now();
    const next = await hosts.next();
    if (!next.done) cluster.queue(next.value);
  });
  return cluster;
}

let cluster;

async function initFoo() {
  cluster = await genCluster();
  console.log('cluster initialized');
  lastCompletedTime = Date.now();
  for (let i=0; i<concurrency; i++) {
    cluster.queue((await hosts.next()).value);	
  }
}
await initFoo();

