import cluster from 'cluster';
import argv from 'argv';
import AsyncLock from 'async-lock';
import { ResourceNode } from '@chip-in/resource-node';
import Dadget from '@chip-in/dadget';
import { CORE_SERVER, RN_EXECUTOR, DATABASE } from './config';

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
  }
]);

let options = argv.run().options;
let parallel = options.parallel;
let interval = options.interval;
let time = options.time;
let size = options.size;
if (!parallel || !interval || !time || !size) {
  argv.help();
  process.exit();
}

if (cluster.isMaster) {
  let counts = [];
  let queryTimes = [];
  let updateTimes = [];
  for (let i = 0; i < parallel; i++) {
    let worker = cluster.fork();
    worker.on('message', function (msg) {
      counts.push(msg.count);
      queryTimes.push(msg.queryTime);
      updateTimes.push(msg.updateTime);
      if (counts.length == parallel) {
        let count = counts.reduce((a, x) => a += x, 0);
        let queryTime = Math.round(queryTimes.reduce((a, x) => a += x, 0) / count);
        let updateTime = Math.round(updateTimes.reduce((a, x) => a += x, 0) / count);
        console.log('total count: ' + count);
        console.log('mean query time(ms): ' + queryTime);
        console.log('mean update time(ms): ' + updateTime);
      }
    });
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
    let updateTime = 0;
    let finish = false;
    let dataLength = Math.floor((size * 1024 - 94) / 10);
    insertData(dadget, dataLength)
      .then((target) => {
        let startTime = (new Date()).getTime();
        let intervalID = setInterval(() => {
          if ((new Date()).getTime() - startTime >= time * 1000) {
            finish = true;
            clearInterval(intervalID);
          }
          lock.acquire("interval", () => {
            let start = new Date();
            return query(dadget, target._id)
              .then((result) => {
                let time = (new Date()).getTime() - start.getTime();
                // console.log("query time: " + time);
                queryTime += time;
                start = new Date();
                return updateData(dadget, result);
              })
              .then((result) => {
                let time = (new Date()).getTime() - start.getTime();
                // console.log("update time: " + time);
                updateTime += time;
                count++;
                if (finish) {
                  if (result.count != count) {
                    console.error("count check error");
                  }
                  if (result.data.length != dataLength) {
                    console.error("data.length check error");
                  }
                  process.send({ count, queryTime, updateTime });
                  return deleteData(dadget, result)
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

function query(dadget, id) {
  return dadget.query({ _id: id });
}

function getRandomInt(min, max) {
  return Math.floor(Math.random() * (max - min)) + min;
}

function insertData(dadget, dataLength) {
  let id = Dadget.uuidGen();
  let data = new Array(dataLength);
  for (let i = 0; i < dataLength; i++) {
    data[i] = getRandomInt(100000000, 999999999);
  }
  return dadget.exec(0, {
    type: "insert",
    target: id,
    new: {
      count: 0,
      subset: false,
      data
    }
  });
}

function updateData(dadget, result) {
  let csn = result.csn;
  let obj = result.resultSet[0];
  return dadget.exec(csn, {
    type: "update",
    target: obj._id,
    before: obj,
    operator: {
      "$inc": {
        "count": 1
      }
    }
  });
}

function deleteData(dadget, obj) {
  return dadget.exec(obj.csn, {
    type: "delete",
    target: obj._id,
    before: obj
  });
}
