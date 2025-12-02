const wy = require('./wy')

const sources = {
  wy,
}

function getSource(name) {
  const s = sources[name]
  if (!s) throw new Error(`source ${name} not supported`)
  return s
}

module.exports = {
  getSource,
  getList: (source, ...args) => getSource(source).getList(...args),
  getListDetail: (source, ...args) => getSource(source).getListDetail(...args),
  getTags: (source, ...args) => getSource(source).getTags(...args),
  search: (source, ...args) => getSource(source).search(...args),
  getDetailPageUrl: (source, ...args) => getSource(source).getDetailPageUrl(...args),
}
