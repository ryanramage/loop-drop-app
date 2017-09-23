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

var Dict = require('mutant/dict')
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

var DittyGridStream = require('lib/ditty-grid-stream')

var computed = require('mutant/computed')
var watch = require('mutant/watch')
var mapWatchDiff = require('lib/map-watch-diff-stack')
var mapGridValue = require('observ-grid/map-values')
var computeIndexesWhereContains = require('observ-grid/indexes-where-contains')
var MidiParam = require('lib/midi-to-param')
var getPortSiblings = require('lib/get-port-siblings')
var mappings = {
  row1: ['176/5', '208', '176/73', '176/75', '176/72', '176/93', '176/91', '176/4']
}

var repeatStates = [2, 1, 2/3, 1/2, 1/3, 1/4, 1/6, 1/8]
var turnOffAll = [240, 0, 32, 41, 2, 24, 14, 0, 247]

var stateLights = {
  green: 33,
  greenLow: 35,
  red: 120,
  yellow: 63,
  redLow: 7,
  grey: 117,
  purpleLow: 55,
  brown: 11
}


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
    // lastPort && lastPort.write(turnOffAll)
    // if (port) {
    //   port.write(turnOffAll)
    //   activatedAt = Date.now()
    // }
  })

  // extend loop-grid instance
  var obs = ObservStruct({
    port: midiPort,
    loopLength: loopGrid.loopLength,
    chunkPositions: Dict({})
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
  var button = MidiButton(midiPort.stream, '176/19')
  button(value => {
    looper.store()
  })

  var flatten = MidiButton(midiPort.stream, '176/21')
  flatten(value => {
    if (value){
      var active = activeIndexes()
      if (looper.isTransforming() || active.length){
        looper.transform(holdActive, active)
        looper.flatten()
        transforms.selector.stop()
        this.flash(stateLights.green, 100)
      } else {
        transforms.suppressor.start(scheduler.getCurrentPosition(), transforms.selector.selectedIndexes())
        looper.flatten()
        transforms.suppressor.stop()
        transforms.selector.stop()
      }
    }
  })

  var repeatButtons = MidiButtons(midiPort.stream, {
    0: '176/0',
    1: '176/1',
    2: '176/2',
    3: '176/3',
    4: '176/4',
    5: '176/5',
    6: '176/6',
    7: '176/7'
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


  // cleanup / disconnect from keyboard on destroy
  obs.destroy = function () {
    recording.destroy()
    midiPort.destroy()
    output.destroy()
    loopGrid.destroy()
    releaseLooper()
  }

  return obs
}

function round(value, dp){
  var pow = Math.pow(10, dp || 0)
  return Math.round(value * pow) / pow
}

function getEdirolGridMapping(){
  var result = ['144/41', '144/43', '144/45', '144/47', '144/48'
   , '144/50', '144/52', '144/53', '144/55', '144/57', '144/59'
   , '144/60', '144/62', '144/64', '144/65', '144/67', '144/69'
  , '144/71', '144/72']
  return ArrayGrid(result, [1,19])
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
