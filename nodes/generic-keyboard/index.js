// very ugly but since we are limited to a module exports right now we have
// to handle any json errors the user may have made and store it to display later
var config
try {
  config = require('rc')('loopdrop')
} catch (e) {
  config = { portMatch: 'ERROR', error: e }
}

module.exports = {
  name: 'Keyboard',
  group: 'loop-grids',
  portMatch: new RegExp(config.portMatch),
  node: 'controller/generic-keyboard',
  render: require('./view'),
  object: require('./object')(config)
}
