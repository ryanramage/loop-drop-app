var Param = require('lib/param')
var Value = require('mutant/value')
var Dict = require('mutant/dict')

var MidiPort = require('lib/midi-port')
var ObservMidi = require('observ-midi')
var ObservStruct = require('mutant/struct')
var MutantMap = require('mutant/map')
var Property = require('lib/property')
var ParamLooper = require('lib/param-looper')

var ArrayStack = require('lib/array-stack')
var FlashArray = require('lib/flash-array')
var LightStack = require('observ-midi/light-stack')

var watch = require('mutant/watch')
var computed = require('mutant/computed')
var watchKnobs = require('lib/watch-knobs')
var scaleInterpolate = require('lib/scale-interpolate')

var turnOffAll = [176 + 8, 0, 0]
// var mappings = {
//   row1: ['176/74', '176/71', '176/76', '176/77', '176/78', '176/6', '176/38', '176/10'],
//   row2: ['177/74', '177/71', '177/76', '177/77', '177/78', '177/6', '177/38', '177/10'],
//   row3: ['178/74', '178/71', '178/76', '178/77', '178/78', '178/6', '178/38', '178/10'],
//   sliders: ['176/5', '208', '176/73', '176/75', '176/72', '176/93', '176/91', '176/7'],
//   trackControl: ['192/0', '192/1', '176/65', '176/127', '176/126'],
//   mute: '152/106',
//   solo: '152/107'
// }

var mappings = {
  row1: ['176/72', '177/72', '178/72', '179/72', '180/72', '181/72', '182/72', '183/72'],
  row2: ['176/73', '177/73', '178/73', '179/73', '180/73', '181/73', '182/73', '183/73'],
  row3: ['176/74', '177/74', '178/74', '179/74', '180/74', '181/74', '182/74', '183/74'],
  row4: ['176/75', '177/75', '178/75', '179/75', '180/75', '181/75', '182/75', '183/75'],
  row5: ['176/76', '177/76', '178/76', '179/76', '180/76', '181/76', '182/76', '183/76'],
  row6: ['176/77', '177/77', '178/77', '179/77', '180/77', '181/77', '182/77', '183/77'],
  row7: ['176/78', '177/78', '178/78', '179/78', '180/78', '181/78', '182/78', '183/78'],
  row8: ['176/79', '177/79', '178/79', '179/79', '180/79', '181/79', '182/79', '183/79'],
  sliders: ['176/64', '176/65', '176/66', '176/67', '176/68', '176/69', '176/70', '176/71'],
  trackControl: ['176/22', '177/22','178/22','179/22','180/22','181/22','182/22','183/22'],
  mute: '152/106',
  solo: '152/107'
}


module.exports = function (context) {
  var midiPort = MidiPort(context, function (port, lastPort) {
    // turn off on switch
    lastPort && lastPort.write(turnOffAll)
    port && port.write(turnOffAll)
  })

  var obs = ObservStruct({
    port: midiPort,
    chunkIds: Property([])
  })

  var releases = []
  var params = []
  var paramLoopers = []

  var recordingIndexes = Dict()
  var playingIndexes = Dict()
  var recordStarts = {}

  for (var i = 0; i < 8; i++) {
    params[i] = [
      Value(0),
      Value(0),
      Value(0),
      Value(0),
      Value(0),
      Value(0),
      Value(0),
      Value(0)
    ]

    paramLoopers[i] = [
      ParamLooper(context, params[i][0]),
      ParamLooper(context, params[i][1]),
      ParamLooper(context, params[i][2]),
      ParamLooper(context, params[i][3]),
      ParamLooper(context, params[i][4]),
      ParamLooper(context, params[i][5]),
      ParamLooper(context, params[i][6]),
      ParamLooper(context, params[i][7]),
    ]

    recordingIndexes.put(i, computed(paramLoopers[i].map(x => x.recording), (...args) => args.some(Boolean)))
    playingIndexes.put(i, computed(paramLoopers[i].map(x => x.playing), (...args) => args.some(Boolean)))
  }

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
  watchKnobs(midiPort.stream, mappings.row1.concat(mappings.row2, mappings.row3, mappings.row4, mappings.row5, mappings.row6, mappings.row7, mappings.row8), function (id, data) {
    var param = params[id % 8][Math.floor(id / 8)]
    var chunk = setup.context.chunkLookup.get(obs.chunkIds()[id % 8])
    if (chunk && chunk.overrideParams && chunk.params) {
      param.set(data / 127)
    }
  })
  var sliderState = []
  watchKnobs(midiPort.stream, mappings.sliders, function (id, data) {
    var chunk = setup.context.chunkLookup.get(obs.chunkIds()[id])
    if (chunk && chunk.overrideVolume) {
      var currentPosition = Math.pow(chunk.overrideVolume(), 1 / Math.E) * 108
      var newPosition = scaleInterpolate(currentPosition, data, sliderState[id] = sliderState[id] || {})
      chunk.overrideVolume.set(Math.pow(newPosition / 108, Math.E))
    }
  }, 108)
  var pressed = computed(MutantMap(setup.controllers, function (controller) {
    return controller && controller.currentlyPressed
  }), function (items) {
    return items.reduce(function (result, pressed) {
      if (pressed) {
        pressed.map(x => x && x.split('/')[0]).reduce(addIfUnique, result)
      }
      return result
    }, [])
  })
  var recordButtonBase = computed([recordingIndexes, playingIndexes], function (recordingIndexes, playingIndexes) {
    var result = []
    for (var i = 0; i < 8; i++) {
      if (recordingIndexes[i]) {
        result[i] = light(3, 0)
      } else if (playingIndexes[i]) {
        result[i] = light(0, 3)
      } else {
        result[i] = 0
      }
    }
    return result
  })

  var recordButtons = ObservMidi(midiPort.stream, mappings.trackControl, recordButtonBase)
  recordButtons(function (values) {
    values.forEach(function (val, i) {
      paramLoopers[i].forEach(looper => looper.recording.set(!!val))

      if (val) {
        recordStarts[i] = Date.now()
      } else if (Date.now() - recordStarts[i] < 200) {
        paramLoopers[i].forEach(looper => looper.set(0))
      }
    })
  })


  obs.destroy = function () {
    while (releases.length) {
      releases.pop()()
    }
    for (var fn of bindingReleases.values()) {
      fn()
    }
    bindingReleases.clear()
    midiPort.destroy()
    paramLoopers.forEach(items => items.forEach(param => param.destroy()))
  }

  return obs
}

function light(r, g, flag){
  if (!r || r < 0)  r = 0
  if (r > 3)        r = 3
  if (!g || g < 0)  g = 0
  if (g > 3)        g = 3
  if (flag == 'flash') {
    flag = 8
  } else if (flag == 'buffer') {
    flag = 0
  } else {
    flag = 12
  }

  return ((16 * g) + r) + flag
}

function setValue (object, value) {
  if (object instanceof Object && Object.keys(object).length) {
    var result = JSON.parse(JSON.stringify(object))
    while (result != null) {
      if (result.minValue != null) {
        if (result.minValue instanceof Object) {
          result = result.minValue
        } else {
          result.minValue = value
          break
        }
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

function resolveValue (value) {
  while (value instanceof Object) {
    if (value.minValue != null) {
      value = value.minValue
    } else {
      value = value.value
    }
  }
  return value
}

function addIfUnique (result, item) {
  if (!result.includes(item)) {
    result.push(item)
  }
  return result
}
