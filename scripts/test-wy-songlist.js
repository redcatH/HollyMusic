const path = require('path')
// run from project root: node scripts/test-wy-songlist.js
const songList = require(path.join(__dirname, '..', 'lib', 'music-core', 'songList', 'index.js'))

async function main() {
  try {
    console.log('--- getListDetail ---')
    const res = await songList.getListDetail('wy', '19723756', 1)
    console.dir(res, { depth: 2 })
  } catch (e) {
    console.error('getListDetail ERROR', e && e.stack ? e.stack : e)
  }

  try {
    console.log('--- getTags ---')
    const tags = await songList.getTags('wy')
    console.dir(tags, { depth: 2 })
  } catch (e) {
    console.error('getTags ERROR', e && e.stack ? e.stack : e)
  }

  try {
    console.log('--- search ---')
    const s = await songList.search('wy', '飙升', 1, 10)
    console.dir(s, { depth: 2 })
  } catch (e) {
    console.error('search ERROR', e && e.stack ? e.stack : e)
  }
}

main()
