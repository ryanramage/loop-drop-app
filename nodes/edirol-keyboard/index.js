module.exports = {
  name: 'Edirol',
  portMatch: /^PCR PCR 1$/,
  node: 'global/edirol-keyboard',
  group: 'global-controllers',
  object: require('./object')
}
