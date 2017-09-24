var LoopGrid = require('../loop-grid/object')
var Looper = require('../loop-grid/looper')
var computedRecording = require('../loop-grid/recording')
var computeTargets = require('../loop-grid/compute-targets')
var computeFlags = require('../loop-grid/compute-flags')
var holdActive = require('lib/hold-active-transform')
var computeActiveIndexes = require('lib/active-indexes')
var watchKnobs = require('lib/watch-knobs')
var Selector = require('../loop-grid/selector')
var Holder = require('../loop-grid/holder')
var Mover = require('../loop-grid/mover')
var Repeater = require('../loop-grid/repeater')
var Suppressor = require('../loop-grid/suppressor')
var ParamLooper = require('lib/param-looper')
var Param = require('lib/param')
var Value = require('mutant/value')
var Dict = require('mutant/dict')
var MutantMap = require('mutant/map')
var ObservStruct = require('mutant/struct')
var Observ = require('mutant/value')
var ObservMidi = require('observ-midi')
var ObservGridStack = require('observ-grid-stack')
var GrabGrid = require('lib/grab-grid')
var MidiPort = require('lib/midi-port')
var MidiButton = require('observ-midi/value')
var MidiButtons = require('observ-midi/struct')
var watchButtons = require('lib/watch-buttons')
var scaleInterpolate = require('lib/scale-interpolate')
var Observ = require('mutant/value')
var ArrayGrid = require('array-grid')
var Property = require('lib/property')
var DittyGridStream = require('lib/ditty-grid-stream')

var computed = require('mutant/computed')
var watch = require('mutant/watch')
var mapWatchDiff = require('lib/map-watch-diff-stack')
var mapGridValue = require('observ-grid/map-values')
var computeIndexesWhereContains = require('observ-grid/indexes-where-contains')
var MidiParam = require('lib/midi-to-param')
var getPortSiblings = require('lib/get-port-siblings')

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

var repeatStates = [2, 1, 2/3, 1/2, 1/3, 1/4, 1/6, 1/8]
var turnOffAll = [240, 0, 32, 41, 2, 24, 14, 0, 247]

module.exports = function(context){
  var loopGrid = LoopGrid(context)
  var looper = Looper(loopGrid)
  var recording = computedRecording(loopGrid)
  var project = context.project
  var scheduler = context.scheduler
  var gridMapping = getEdirolGridMapping()
  loopGrid.shape.set(gridMapping.shape)

  var activatedAt = 0
  var shiftHeld = false

  var midiPort = MidiPort(context, function (port, lastPort) {
    // turn off on switch
    lastPort && lastPort.write(turnOffAll)
    if (port) {
      port.write(turnOffAll)
      activatedAt = Date.now()
    }
  })

  // extend loop-grid instance
  var obs = ObservStruct({
    port: midiPort,
    loopLength: loopGrid.loopLength,
    chunkPositions: Dict({}),
    chunkIds: Property([])
  })

  obs.gridState = ObservStruct({
    active: loopGrid.active,
    playing: loopGrid.playing,
    recording: recording,
    triggers: loopGrid.grid
  })

  obs.activeInput = computed([midiPort.stream], function (value) {
    return !!value
  })

  var releaseLooper = watch(looper, loopGrid.loops.set)

  obs.context = context
  obs.playback = loopGrid
  obs.looper = looper
  obs.repeatLength = Observ(2)

  var flags = computeFlags(context.chunkLookup, obs.chunkPositions, loopGrid.shape)

  watch( // compute targets from chunks
    computeTargets(context.chunkLookup, obs.chunkPositions, loopGrid.shape),
    loopGrid.targets.set
  )

  // grab the midi for the current port
  obs.grabInput = function () {
    midiPort.grab()
  }

  var transforms = {
    selector: Selector(gridMapping.shape, gridMapping.stride),
    holder: Holder(looper.transform),
    repeater: Repeater(looper.transformTop),
    suppressor: Suppressor(looper.transform, gridMapping.shape, gridMapping.stride)
  }

  var controllerGrid = ObservMidi(midiPort.stream, gridMapping)
  var inputGrabber = GrabGrid(controllerGrid)

  var noRepeat = computeIndexesWhereContains(flags, 'noRepeat')
  var freezeSuppress = computeIndexesWhereContains(flags, 'freezeSuppress')

  var grabInputExcludeNoRepeat = function (listener) {
    return inputGrabber(listener, { exclude: noRepeat })
  }

  var inputGrid = Observ()
  watch(inputGrabber, inputGrid.set)
  var activeIndexes = computeActiveIndexes(inputGrid)

  // trigger notes at bottom of input stack
  var output = DittyGridStream(inputGrid, loopGrid.grid, context.scheduler)
  output.on('data', loopGrid.triggerEvent)

  obs.currentlyPressed = computed([controllerGrid, loopGrid.grid], function (value, grid) {
    return grid.data.filter(function (name, index) {
      if (value.data[index]) {
        return true
      }
    })
  })

  // store button mapping
  var storeButton = MidiButton(midiPort.stream, '176/19')
  storeButton(value => {
    looper.store()
  })

  var flattenButton = MidiButton(midiPort.stream, '176/21')
  flattenButton(value => {
    if (value){
      var active = activeIndexes()
      if (looper.isTransforming() || active.length){
        looper.transform(holdActive, active)
        looper.flatten()
        transforms.selector.stop()
      } else {
        transforms.suppressor.start(scheduler.getCurrentPosition(), transforms.selector.selectedIndexes())
        looper.flatten()
        transforms.suppressor.stop()
        transforms.selector.stop()
      }
    }
  })

  // var repeatButtons = MidiButtons(midiPort.stream, {
  //   0: '176/0',
  //   1: '176/1',
  //   2: '176/2',
  //   3: '176/3',
  //   4: '176/4',
  //   5: '176/5',
  //   6: '176/6',
  //   7: '176/7'
  // })
  var repeatButtons = MidiButtons(midiPort.stream, {
    0: '224/0',
    1: '224/1',
    2: '224/10',
    3: '224/16',
    4: '224/64',
    5: '224/90',
    6: '224/110',
    7: '224/127'
  })
  // repeater
  mapWatchDiff(repeatStates, repeatButtons, obs.repeatLength.set)
  watch(obs.repeatLength, function (value) {
    transforms.holder.setLength(value)
    if (value < 2 || shiftHeld) {
      transforms.repeater.start(grabInputExcludeNoRepeat, value, shiftHeld)
    } else {
      transforms.repeater.stop()
    }
  })

  // start of mixer
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



  // end of mixer

  // cleanup / disconnect from keyboard on destroy
  obs.destroy = function () {
    recording.destroy()
    midiPort.destroy()
    output.destroy()
    loopGrid.destroy()
    releaseLooper()
    while (releases.length) {
      releases.pop()()
    }
    for (var fn of bindingReleases.values()) {
      fn()
    }
    bindingReleases.clear()
    paramLoopers.forEach(items => items.forEach(param => param.destroy()))
  }

  return obs
}

function round(value, dp){
  var pow = Math.pow(10, dp || 0)
  return Math.round(value * pow) / pow
}

function getEdirolGridMapping(){
  var result = ['144/60', '144/61','144/62', '144/63','144/64',
  '144/65', '144/66','144/67', '144/68','144/69',
  '144/70' , '144/71', '144/72']
  return ArrayGrid(result, [1,13])
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

function addIfUnique (result, item) {
  if (!result.includes(item)) {
    result.push(item)
  }
  return result
}
