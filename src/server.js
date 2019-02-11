import { ResourceNode } from '@chip-in/resource-node';
import Dadget from '@chip-in/dadget';
import { CORE_SERVER, RN_SERVER } from './config';


let node = new ResourceNode(CORE_SERVER, RN_SERVER);
Dadget.registerServiceClasses(node);
node.start().then(() => {
  function sigHandle() {
    node.stop().then(() => {
      process.exit()
    })
  }
  process.on('SIGINT', sigHandle);
  process.on('SIGTERM', sigHandle);
})

