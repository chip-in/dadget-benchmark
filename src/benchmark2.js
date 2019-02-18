import cluster from 'cluster';
import argv from 'argv';
import AsyncLock from 'async-lock';
import { ResourceNode } from '@chip-in/resource-node';
import Dadget from '@chip-in/dadget';
import { CORE_SERVER, RN_EXECUTOR, DATABASE } from './config';

process.on('unhandledRejection', (e) => {
  console.log("unhandledRejection")
  console.dir(e)
});

argv.option([
  {
    name: 'parallel',
    short: 'p',
    type: 'int',
    description: '並列数'
  },
  {
    name: 'interval',
    short: 'i',
    type: 'int',
    description: '実行間隔(ms)'
  },
  {
    name: 'time',
    short: 't',
    type: 'int',
    description: '実行時間(s)'
  },
  {
    name: 'size',
    short: 's',
    type: 'int',
    description: 'データサイズ(KiB)'
  },
  {
    name: 'length',
    short: 'l',
    type: 'int',
    description: 'データ数'
  }
]);

let options = argv.run().options;
let parallel = options.parallel;
let interval = options.interval;
let time = options.time;
let size = options.size;
let length = options.length;
if (!parallel || !interval || !time || !size | !length) {
  argv.help();
  process.exit();
}

if (cluster.isMaster) {
  let counts = [];
  let queryTimes = [];
  for (let i = 0; i < parallel; i++) {
    setTimeout(() => {
      let worker = cluster.fork();
      worker.on('message', function (msg) {
        counts.push(msg.count);
        queryTimes.push(msg.queryTime);
        if (counts.length == parallel) {
          let count = counts.reduce((a, x) => a += x, 0);
          let queryTime = Math.round(queryTimes.reduce((a, x) => a += x, 0) / count);
          console.log('total count: ' + count);
          console.log('mean query time(ms): ' + queryTime);
        }
      });
    }, i * interval / parallel);
  }
} else {
  doWorker();
}

function doWorker() {
  let node = new ResourceNode(CORE_SERVER, RN_EXECUTOR);
  Dadget.registerServiceClasses(node);

  node.start().then(() => {
    process.on('SIGINT', function () {
      node.stop().then(() => {
        process.exit();
      })
    })
    let seList = node.searchServiceEngine("Dadget", { database: DATABASE });
    if (seList.length != 1) {
      throw new Error("Dadget取得エラー")
    }
    let dadget = seList[0];

    var lock = new AsyncLock();
    let count = 0;
    let queryTime = 0;
    let finish = false;
    let dataLength = Math.floor((size * 1024 - 100) / 10);
    let testNo = getRandomInt(100000000, 999999999);
    insertData(dadget, dataLength, length, testNo)
      .then((target) => {
        let startTime = (new Date()).getTime();
        let intervalID = setInterval(() => {
          if ((new Date()).getTime() - startTime >= time * 1000) {
            finish = true;
            clearInterval(intervalID);
          }
          lock.acquire("interval", () => {
            let start = new Date();
            return query(dadget, testNo)
              .then((result) => {
                let time = (new Date()).getTime() - start.getTime();
                // console.log("query time: " + time);
                queryTime += time;
                count++;
                console.log("query:" + count);
                if (finish) {
                  process.send({ count, queryTime });
                  return deleteData(dadget, testNo)
                    .then(() => process.exit());
                }
              })
              .catch(reason => {
                console.error("faild", reason)
              });
          });
        }, interval);
      });
  })
}

function query(dadget, testNo) {
  return dadget.query({ test_no: testNo });
}

function getRandomInt(min, max) {
  return Math.floor(Math.random() * (max - min)) + min;
}

async function insertData(dadget, dataLength, length, testNo) {
  for (let j = 0; j < length; j++) {
    const id = Dadget.uuidGen();
    const data = new Array(dataLength);
    for (let i = 0; i < dataLength; i++) {
      data[i] = getRandomInt(100000000, 999999999);
    }
    await dadget.exec(0, {
      type: "insert",
      target: id,
      new: {
        test_no: testNo,
        subset: j % 2 == 0,
        data
      }
    });
  }
}

function deleteData(dadget, testNo) {
  return query(dadget, testNo)
    .then(async (result) => {
      const csn = result.csn;
      for (const obj of result.resultSet) {
        await dadget.exec(csn, {
          type: "delete",
          target: obj._id,
          before: obj
        });
      }
    });
}
