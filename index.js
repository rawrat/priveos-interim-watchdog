'use strict'
const axios = require('axios')
axios.defaults.timeout = 5000
const Promise = require('bluebird')
const { Api, JsonRpc, RpcError } = require('eosjs')
const { JsSignatureProvider } = require('eosjs/dist/eosjs-jssig')
const { TextEncoder, TextDecoder } = require('util')
const fetch = require('node-fetch')
const seconds = 1000
const minutes = 60*seconds

const DEBUG = true
let log
if(DEBUG) {
  log = {
    debug: console.log,
    error: console.log,
  }
} else {
  log = {
    debug: function() {},
    error: function() {},
  }
}

const chains = [{
  name: 'eos',
  contract: 'priveosrules',
  watchdog_account: 'slantagpurse',
  watchdog_permission: 'active',
  chainId: 'e70aaab8997e1dfce58fbfac80cbbb8fecec7b99cf982a9444273cbc64c41473',
  eos_config: {
    httpEndpoint: 'https://jungle2.cryptolions.io',
    keyProvider: ['5KXtuBpLc6Y9Q8Q8s8CQm2G7L98bV8PK1ZKnSKvNeoiuhZw6uDH'],
  },
}, 
]

function main() {
  for(const chain of chains) {
    const w = new Watchdog(chain)
    w.run()
  }
}

class Watchdog {
  constructor(chain) {
    this.chain = chain
    this.rpc = new JsonRpc(chain.eos_config.httpEndpoint, { fetch })
    this.eos = new Api({ 
      rpc: this.rpc,
      signatureProvider: new JsSignatureProvider(chain.eos_config.keyProvider), 
      textDecoder: new TextDecoder(), 
      textEncoder: new TextEncoder() 
    })
  }
  
  async run() {
    while(true) {
      try {
        await this.inner_loop()
      } catch(e) {
        log.debug(e)
        await Promise.delay(10*seconds)
        console.log("Error during execution of inner_loop. Continuing...")
      }
    }
  }
  
  async inner_loop() {
    const nodes = await this.get_nodes()
    log.debug("Node: ", nodes)
    for(const node of nodes) {
      await this.handle_node(node)
    }
    if(nodes.length < 10) {
      await Promise.delay(30*minutes)
    }
  }
  
  async handle_node(node) {
    if(await this.is_node_okay(node)) {
      log.debug(`Node ${node.owner} is OKAY`)
      if(!node.is_active) {
        await this.approve(node)
      }
    } else {
      log.debug(`Node ${node.owner} is NOT okay`)
      if(node.is_active) {
        await this.disapprove(node);
      }
    }
  }
  
  async approve(node) {
    return this.execute_transaction(node, 'admactivate')
  }
  
  async disapprove(node) {
    return this.execute_transaction(node, 'admdisable')
  }
  
  async execute_transaction(node, action_name) {
    const actions = [{
      account: this.chain.contract,
      name: action_name,
      authorization: [{
        actor: this.chain.watchdog_account,
        permission: this.chain.watchdog_permission,
      }],
      data: {
        sender: this.chain.watchdog_account,
        owner: node.owner,
      }
    }]
    try { 
      log.debug("Executing tx: ", JSON.stringify(actions, null, 2))
      const res = await this.eos.transact({actions}, {
        blocksBehind: 3,
        expireSeconds: 30,
      })
      log.debug("EOS returned: ", res)
      this.status = 'ok'
      return res
    } catch(e) {
      log.error(`${this.chain.chainId} Error while executing transaction: ${e}`)
      this.status = "error while executing transaction"
      throw e
    }
  }
  
  async is_node_okay(node) {
    const url = new URL('/broker/status/', node.url)
    log.debug(`${this.chain.chainId} Trying ${url.href}`)
    let okay = false
    try {
      const res = await axios.get(url.href)
      const data = res.data
      log.debug("RES: ", JSON.stringify(data, null, 2))
      const all_chains = data['chains']
      if(all_chains) {
        /* New Format */
        const this_chain = all_chains.find(x => x.chainId === this.chain.chainId)
        if(this_chain && this_chain.status === 'ok') {
          okay = true
        }
      } else {
        /* 
         * Disapprove old Format without multiple chains 
         */
        okay = false
      }      
    } catch(e) {
      log.debug("Exception while trying to connect to node.url: ", e)
      // log.debug(e)
      okay = false
    }
    return okay
  }
  
  async get_nodes() {
    const res = await this.rpc.get_table_rows({json:true, scope: this.chain.contract, code: this.chain.contract,  table: 'nodes', limit:1000})
    return res.rows
  }
}

main()
