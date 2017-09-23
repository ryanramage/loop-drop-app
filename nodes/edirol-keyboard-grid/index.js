module.exports = {
  name: 'Edirol',
  group: 'loop-grids',
  portMatch: /^PCR PCR 1$/,
  node: 'controller/edirol-keyboard',
  render: require('./view'),
  object: require('./object')
}
