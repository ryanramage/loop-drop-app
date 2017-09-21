var Param = require('lib/param')
var Value = require('mutant/value')
var Dict = require('mutant/dict')

var Observ = require('mutant/value')
var MidiPort = require('lib/midi-port')
var ObservMidi = require('observ-midi')
var Property = require('lib/property')
var MutantMap = require('mutant/map')
var ObservStruct = require('mutant/struct')
var ArrayStack = require('lib/array-stack')
var FlashArray = require('lib/flash-array')
var AnyTrigger = require('lib/on-trigger')
var LightStack = require('observ-midi/light-stack')
var MidiButton = require('observ-midi/value')
var MidiParam = require('lib/midi-to-param')

var watch = require('mutant/watch')
var computed = require('mutant/computed')
var watchKnobs = require('lib/watch-knobs')
var scaleInterpolate = require('lib/scale-interpolate')
var findItemByPath = require('lib/find-item-by-path')

var possibleMidiChannels = 16

var channels = {
  knobs: [176, 176, 176, 176, 176, 176, 176, 176],
  sliders: [176, 208, 176, 176, 176, 176, 176, 176]
}
var suffix = {
  knobs: ['/74', '/71', '/76', '/77', '/78', '/6', '/38', '/10'],
  sliders: ['/5', '', '/73', '/75', '/72', '/93', '/91', '/7']
}

var allKnobsCombos = []
for (var _i=0; _i<possibleMidiChannels; _i++) {
  for (var _j=0; _j<channels.knobs.length; _j++) {
    var midi_channel = channels.knobs[_j] + _i;
    var full = String(midi_channel) + suffix.knobs[_j]
    allKnobsCombos.push(full)
  }
}

var allSliderCombos = []
for (var _i=0; _i<possibleMidiChannels; _i++) {
  for (var _j=0; _j<channels.sliders.length; _j++) {
    var midi_channel = channels.sliders[_j] + _i;
    var full = String(midi_channel) + suffix.sliders[_j]
    allSliderCombos.push(full)
  }
}

module.exports = function (context) {
  var unloadState = { lastSuppressId: null, lastSuppressAt: 0 }
  var lastSuppress = null
  var turnOffSuppressLight = null

  var midiPort = MidiPort(context, function (port, lastPort) {})
  var obs = ObservStruct({
    port: midiPort,
    chunkIds: Property([])
  })
  var releases = []
  var bindingReleases = new Map()
  var bindings = MutantMap(obs.chunkIds, (id, invalidateOn) => {
    var item = context.chunkLookup.get(id)
    var index = obs.chunkIds().indexOf(id)
    invalidateOn(computed([context.chunkLookup, obs.chunkIds], (_, chunkIds) => {
      // rebind when chunk is changed
      return item !== context.chunkLookup.get(id) || chunkIds.indexOf(id) !== index
    }))
    if (item) {
      bindingReleases.set(item, item.overrideParams(paramLoopers[index]))
    }
    return item
  }, {
    onRemove: function (item) {
      if (bindingReleases.has(item)) {
        bindingReleases.get(item)()
        bindingReleases.delete(item)
      }
    }
  })

  releases.push(watch(bindings))



  // grab the midi for the current port
  obs.grabInput = function () {
    midiPort.grab()
  }
  obs.context = context
  var setup = context.setup
  var project = context.project
  var onTrigger = AnyTrigger(project.items)

  watchKnobs(midiPort.stream, allKnobsCombos, function (id, data) {
    var selectedSetup = Math.floor(id / 8)
    let buttonIndex = Math.floor(id % 8)
    var item = project.items.get(selectedSetup)
    if (isSetup(item)) {
      var setup = item.node
      let chunkId = setup.selectedChunkId()
      var item = setup.context.chunkLookup.get(chunkId)
      var keys = item.paramValues.keys()
      var key = keys[buttonIndex]
      if (!key) return
      var value = data / 127
      item.paramValues.put(key, value)
    }
  })

  var sliderState = []
  watchKnobs(midiPort.stream, allSliderCombos, function (id, data) {
    var state = sliderState[id] = sliderState[id] || {}
    var item = project.items.get(id)
    // this is a setup!
    if (isSetup(item)) {
      var setup = item.node

      // var volume = setup.overrideVolume
      // var currentPosition = Math.pow(volume(), 1 / Math.E) * 128
      // var newPosition = scaleInterpolate(currentPosition, data, state)
      // volume.set(Math.pow(newPosition / 128, Math.E))
    }
  }, 127)

  var button = MidiButton(midiPort.stream, '252')
  button(value => {
    if (!project.selected()) return
    var setup = findItemByPath(project.items, project.selected())
    if (setup) {
      var node = setup.node
      var chunks = setup().chunks

      var length = chunks.length
      var selectedChunkId = setup().selectedChunkId
      var found = false
      var nextChunkId
      for (var i = 0; i < length; i++) {
        var chunk = chunks[i]
        if (found) {
          nextChunkId = chunk.id
          found = false
        }
        if (chunk.id === selectedChunkId) {
          found = true
        }
      }
      if (found && !nextChunkId) nextChunkId = chunks[0].id
      node.selectedChunkId.set(nextChunkId)

    }

  })


  obs.destroy = function () {
    onTrigger.destroy()
    midiPort.destroy()
    // params.forEach(function (id) {
    //   context.paramLookup.delete(id)
    // })
  }
  return obs
}


function setValue (object, value) {
  if (object instanceof Object) {
    var result = JSON.parse(JSON.stringify(object))
    while (result != null) {
      if (result.maxValue != null) {
        result.maxValue = value
        break
      } else if (result.value instanceof Object) {
        result = result.value
      } else {
        result.value = value
        break
      }
    }
    return result
  } else {
    return value
  }
}

function isSetup (item) {
  return item && item.node && item.node._type === 'LoopDropSetup'
}

function getValue (value) {
  while (value instanceof Object) {
    if (value.maxValue != null) {
      value = value.maxValue
    } else {
      value = value.value
    }
  }
  return value
}
