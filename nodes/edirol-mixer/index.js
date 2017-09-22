module.exports = {
  name: 'Edirol Mixer',
  group: 'mixers',
  portMatch: /^PCR PCR 1$/,
  node: 'controller/edirol-mixer',
  render: require('./view'),
  object: require('./object')
}
