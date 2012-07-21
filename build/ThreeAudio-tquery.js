/**
 * MicroEvent - to make any js object an event emitter (server or browser)
 * 
 * - pure javascript - server compatible, browser compatible
 * - dont rely on the browser doms
 * - super simple - you get it immediatly, no mistery, no magic involved
 *
 * - create a MicroEventDebug with goodies to debug
 *   - make it safer to use
*/

var MicroEvent	= function(){}
MicroEvent.prototype	= {
	bind	: function(event, fct){
		this._events = this._events || {};
		this._events[event] = this._events[event]	|| [];
		this._events[event].push(fct);
	},
	unbind	: function(event, fct){
		this._events = this._events || {};
		if( event in this._events === false  )	return;
		this._events[event].splice(this._events[event].indexOf(fct), 1);
	},
	trigger	: function(event /* , args... */){
		this._events = this._events || {};
		if( event in this._events === false  )	return;
		for(var i = 0; i < this._events[event].length; i++){
			this._events[event][i].apply(this, Array.prototype.slice.call(arguments, 1))
		}
	}
};

/**
 * mixin will delegate all MicroEvent.js function in the destination object
 *
 * - require('MicroEvent').mixin(Foobar) will make Foobar able to use MicroEvent
 *
 * @param {Object} the object which will support MicroEvent
*/
MicroEvent.mixin	= function(destObject){
	var props	= ['bind', 'unbind', 'trigger'];
	for(var i = 0; i < props.length; i ++){
		destObject.prototype[props[i]]	= MicroEvent.prototype[props[i]];
	}
}

// export in common js
if( typeof module !== "undefined" && ('exports' in module)){
	module.exports	= MicroEvent
}// Check dependencies.
(function (deps) {
  for (i in deps) {
    if (!window[i]) throw "Error: ThreeAudio requires " + deps[i];
  }
})({
  'THREE': 'Three.js',
  'MicroEvent': 'MicroEvent.js'//,
});

// Namespace
window.ThreeAudio = window.ThreeAudio || {};

// Fetch shader from <script> tag by id
// or pass through string if not exists.
ThreeAudio.getShader = function (id) {
  var elem = document.getElementById(id);
  return elem && elem.innerText || id;
};

// Simple array/object iterator.
// (can be replaced with underscore.js)
window._ = window._ || {};
_.each = _.each || function (object, callback) {
  if (object.forEach) {
    return object.forEach(callback);
  }
  for (key in object) {
    callback(object[key], key, object);
  }
};

// Simple object extender
// (can be replaced with underscore.js)
_.extend = _.extend || function (destination) {
  _.each([].slice.call(arguments, 1), function (source) {
    for (var key in source) {
      destination[key] = source[key];
    }
  });
  return destination;
}

// Make microevent methods chainable.
MicroEvent.prototype.on   = function () { MicroEvent.prototype.bind.apply(this, arguments);    return this; }
MicroEvent.prototype.emit = function () { MicroEvent.prototype.trigger.apply(this, arguments); return this; }
MicroEvent.mixin	= function(destObject){
	var props	= ['bind', 'unbind', 'trigger', 'on', 'emit'];
	for(var i = 0; i < props.length; i ++){
		destObject.prototype[props[i]]	= MicroEvent.prototype[props[i]];
	}
}

// Compatibility with ThreeRTT/ThreeBox
ThreeAudio.toTexture = function (texture) {
  return (ThreeRTT && ThreeRTT.toTexture && ThreeRTT.toTexture(texture)) || texture;
}

// Math!
var π = Math.PI,
    τ = π * 2;
ThreeAudio.Source = function (fftSize) {
  this.fftSize = fftSize || 1024;

  this.filters = {};
  this.playing = false;

  this.init();
}

ThreeAudio.Source.prototype = {

  init: function () {
    var c = this.context = new webkitAudioContext();

    // Create source
    this.source = c.createBufferSource();

    // Create main analyser
    this.analyser = c.createAnalyser();
    var fftSize = this.analyser.fftSize = this.fftSize;

    // Create filter nodes for bass/mid/treble signals.
    var parameters = {
      bass: {
        type: 0, // LOWPASS
        frequency: 160,
        Q: 1.2,
        gain: 2.0//,
      },
      mid: {
        type: 2, // BANDPASS
        frequency: 500,
        Q: 1.2,
        gain: 4.0//,
      },
      treble: {
        type: 1, //HIGHPASS
        frequency: 2000,
        Q: 1.2,
        gain: 3.0//,
      }//,
    };
    var filters = this.filters;
    _.each(parameters, function (spec, key) {
      var filter = c.createBiquadFilter();
      filter.key = key;
      filter.type = spec.type;
      filter.frequency.value = spec.frequency;
      filter.Q.value = spec.Q;

      // Create analyser for filtered signal.
      filter.analyser = c.createAnalyser();
      filter.analyser.fftSize = fftSize;

      // Create delay node to compensate for FFT lag.
      filter.delayNode = c.createDelayNode();
      filter.delayNode.delayTime.value = 0;

      // Create gain node to offset filter loss.
      filter.gainNode = c.createGainNode();
      filter.gainNode.gain.value = spec.gain;

      filters[key] = filter;
    });

    // Create playback delay to compensate for FFT lag.
    this.delay = c.createDelayNode();
    this.delay.delayTime.value = this.fftSize * 2 / c.sampleRate;

    // Connect main audio processing pipe
    this.source.connect(this.analyser);
    this.analyser.connect(this.delay);
    this.delay.connect(c.destination);

    // Connect secondary filters + analysers + gain.
    var source = this.source;
    _.each(filters, function (filter) {
      source.connect(filter.delayNode);
      filter.delayNode.connect(filter);
      filter.connect(filter.gainNode);
      filter.gainNode.connect(filter.analyser);
    });

    // Create buffers for time/freq data.
    this.samples = this.analyser.frequencyBinCount;
    this.data = {
      // High resolution FFT for frequency / time data
      freq: new Uint8Array(this.samples),
      time: new Uint8Array(this.samples),
      // Low resolution filtered signals, time data only.
      filter: {
        bass: new Uint8Array(this.samples),
        mid: new Uint8Array(this.samples),
        treble: new Uint8Array(this.samples)//,
      }//,
    };

    // Create levels detector
    this.levelDetect = new ThreeAudio.LevelDetect(this.data);

    // Create beat detector
    this.beatDetect = new ThreeAudio.BeatDetect(this.data);
  },

  update: function () {
    var a = this.analyser, d = this.data;

    // Get freq/time data.
    a.smoothingTimeConstant = 0;
    a.getByteFrequencyData(d.freq);
    a.getByteTimeDomainData(d.time);

    // Get filtered signals.
    _.each(this.filters, function (filter) {
      filter.analyser.getByteTimeDomainData(d.filter[filter.key]);
    });

    // Update level detector.
    this.levelDetect.analyse();

    // Update beat detector.
    this.beatDetect.analyse();

    return this;
  },

  size: function () {
    return this.analyser.frequencyBinCount;
  },

  load: function (url, callback) {
    var context = this.context,
        source = this.source,
        that = this;

    // Load file via AJAX
    var request = new XMLHttpRequest();
    request.open("GET", url, true);
    request.responseType = "arraybuffer";

    request.onload = function() {
      // Link databuffer to source
      var buffer = context.createBuffer(request.response, false);
      source.buffer = buffer;
      source.loop = true;

      // Begin playback if requested earlier.
      if (that.playing) {
        that._play();
      }

      callback && callback();
    };

    request.send();

    return this;
  },

  play: function () {
    this.playing = true;
    if (this.source.buffer) {
      this._play();
    }
    return this;
  },

  stop: function () {
    this.playing = false;
    if (this.source.buffer) {
      this._stop();
    }
    return this;
  },

  _play: function () {
    this.source.noteOn(0);
  },

  _stop: function () {
    this.source.noteOff(0);
  }//,

};

// tQuery-like naming.
ThreeAudio.Source.prototype.start = ThreeAudio.Source.prototype.play;
/**
 * Helper for making ShaderMaterials that read from the audio buffers.
 */
ThreeAudio.Material = function (audioTextures, vertexShader, fragmentShader, textures, uniforms, attributes) {
  attributes = attributes || [];

  // Uniform for time scrolling
  uniforms = _.extend(uniforms || {}, {
    audioIsBeat: {
      type: 'f',
      value: 0//,
    },
    audioWasBeat: {
      type: 'f',
      value: 0//,
    },
    audioLevels: {
      type: 'fv1',
      value: [0,0,0,0]//,
    },
    audioLevelsSmooth: {
      type: 'fv1',
      value: [0,0,0,0]//,
    },
    audioLevelsChange: {
      type: 'fv1',
      value: [0,0,0,0]//,
    },
    audioOffset: {
      type: 'f',
      value: 0//,
    },
    audioStep: {
      type: 'v2',
      value: { x: 0, y: 0 }//,
    }//,
  });

  // Generate uniforms for freq/time textures
  var i = 0;
  _.each(audioTextures.get(), function (texture, key) {

    // Make wrapper texture object.
    var textureObject = new THREE.Texture(
      new Image(),
      new THREE.UVMapping(),
      THREE.ClampToEdgeWrapping,
      THREE.RepeatWrapping,
      THREE.NearestFilter,
      THREE.NearestFilter//,
    );

    // Pre-init texture to trick WebGLRenderer
    textureObject.__webglInit = true;
    textureObject.__webglTexture = texture;

    uniforms[key + 'Data'] = {
      type: 't',
      texture: textureObject,
      value: i++//,
    };
  });

  // Make uniforms for input textures.
  _.each(textures || [], function (texture, key) {
    uniforms[key] = {
      type: 't',
      value: i++,
      texture: ThreeAudio.toTexture(texture)//,
    };
  });

  // Auto-update uniforms when textures are updated.
  audioTextures.on('update', function (_uniforms) {
    // Apply uniform values from texture object.
    _.each(_uniforms, function (value, key) {
      uniforms[key].value = value;
    });
  });

  // Lookup shaders and build material
  return new THREE.ShaderMaterial({
    attributes:     attributes,
    uniforms:       uniforms,
    vertexShader:   ThreeAudio.getShader(vertexShader),
    fragmentShader: ThreeAudio.getShader(fragmentShader)//,
  });
};
ThreeAudio.Textures = function (renderer, source, history) {

  this.renderer = renderer;
  this.source = source;
  this.textures = {};

  this.history = history || 128;
  this.timeIndex = 0;

  this.data = source.data;

  this.init();
}

ThreeAudio.Textures.prototype = {

  init: function () {
    var renderer = this.renderer,
        gl = renderer.getContext(),
        textures = this.textures,
        data = this.data,
        history = this.history,
        t, d, empty;

    // Create textures for frequency/time domain data.
    _.each(['freq', 'time'], function (key) {

      if (textures[key]) {
        gl.deleteTexture(textures[key]);
  			renderer.info.memory.textures--;
      }
      t = textures[key] = gl.createTexture();
			renderer.info.memory.textures++;

      gl.bindTexture(gl.TEXTURE_2D, t);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S,     gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T,     gl.REPEAT);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);

      d = data[key];
      empty = new Uint8Array(d.length * history);
      if (key == 'time') {
        for (var i = 0; i < d.length * history; ++i) empty[i] = 128;
      }

      gl.texImage2D(gl.TEXTURE_2D, 0, gl.ALPHA, d.length, history, 0, gl.ALPHA, gl.UNSIGNED_BYTE, empty);
    });
  },

  update: function () {
    var renderer = this.renderer,
        gl = renderer.getContext(),
        textures = this.textures,
        source = this.source,
        history = this.history,
        index = this.timeIndex,
        data = source.data;

    // Ensure audio data is up to date
    source.update();

    // Update textures for frequency/time domain data.
    _.each(['freq', 'time'], function (key) {
      gl.bindTexture(gl.TEXTURE_2D, textures[key]);
      gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, index, data[key].length, 1, gl.ALPHA, gl.UNSIGNED_BYTE, data[key]);
    });

    // Notify all linked materials of updated uniforms.
    this.emit('update', this.uniforms());

    // Circular buffer index
    this.timeIndex = (index + 1) % history;
  },

  get: function () {
    return this.textures;
  },

  uniforms: function () {
    var levels = this.data.levels,
        beat = this.data.beat;
    return {
      audioIsBeat:       beat.is,
      audioWasBeat:      beat.was, 
      audioLevels:       levels.direct,
      audioLevelsSmooth: levels.smooth,
      audioLevelsChange: levels.change,
      audioOffset:       this.timeIndex / this.history,
      audioStep: {
        x: 1 / (this.source.samples - 1),
        y: 1 / this.history//,
      }//,
    };
  }//,
}

// Event emitter
MicroEvent.mixin(ThreeAudio.Textures);
/**
 * Plane geometry for drawing audio. UV's are corrected to ensure pixel-perfect sampling.
 */
ThreeAudio.GridGeometry = function (textures, width, depth, segmentsW, segmentsH) {
  // Reach audio source
  var source = textures.source;

  // Auto set segment counts
  segmentsW = (segmentsW || source.samples) - 1;
  segmentsH = Math.min(textures.history, segmentsH || textures.history) - 1;

  // UV correction for accurate sampling.
  var scale = segmentsH / textures.history,
      offsetU = .5 / (source.samples - 1); // Clamp to Edge wrapping
      offsetV = .5 / textures.history;     // Repeat wrapping

  // Need one less H segment due to history not looping.
  var geometry = new THREE.PlaneGeometry(width, depth, segmentsW, segmentsH);
  _.each(geometry.faceVertexUvs[0], function (face) {
    _.each(face, function (uv) {
      uv.u += offsetU;
      uv.v = 1 - uv.v * scale + offsetV;
    });
  });

  return geometry;
};
/**
 * Audio analyser: provide RMS levels + filters / derivatives.
 */
ThreeAudio.LevelDetect = function (data) {
  this.data = data;

  this.levels = [[0, 0, 0, 0]];
  this.smooth = [0, 0, 0, 0];
  this.change = [0, 0, 0, 0];

  // Add output structure to data.
  data.levels = {
    direct: this.levels[0],
    smooth: this.smooth,
    change: this.change//,
  };
};

ThreeAudio.LevelDetect.prototype.analyse = function () {
  var data = this.data,
      levels = this.levels,
      smooth = this.smooth,
      change = this.change,
      bins = [0, 0, 0, 0];

  // Calculate RMS of time data.
  function rms(data) {
    var size = data.length, accum = 0;
    for (var i = 0; i < size; ++i) {
      var s = (data[i] - 128) / 128;
      accum += s*s;
    }
    return Math.sqrt(accum / size);
  }

  // Calculate energy level for all bins.
  var waveforms = [data.time, data.filter.bass, data.filter.mid, data.filter.treble];
  for (var j = 0; j < 4; ++j) {
    bins[j] = rms(waveforms[j]);
  }

  // Keep 7 last level values
  levels.unshift(bins);
  if (levels.length > 7) levels.pop();

  // Filter helpers
  var accum, factors, gain, decay, samples;

  // Calculate averages over 3 frames
  factors = [1, 2, 1], gain = 4, samples = Math.min(levels.length, factors.length);
  for (var i = 0; i < 4; ++i) {
    accum = 0;
    for (var j = 0; j < samples; ++j) {
      accum += (levels[j] && levels[j][i] || 0) * factors[j];
    }
    smooth[i] = accum / gain;
  }

  // Calculate difference over 6 frames
  factors = [1, 3, 2, -2, -3, -1], gain = 6, decay = .5, Math.min(levels.length, factors.length);
  for (var i = 0; i < 4; ++i) {
    accum = 0;
    for (var j = 0; j < samples; ++j) {
      accum += (levels[j] && levels[j][i] || 0) * factors[j];
    }
    // Apply additional decay filter to make less erratic.
    change[i] = change[i] + (accum / gain - change[i]) * decay;
  }

  // Write results to data structure.
  this.data.levels.direct = this.levels[0];
  // Smooth / change updated by reference.
}
/**
 * Audio analyser: provide beat detection
 *
 * It works in two stages:
 * - Uses autocorrelation of the RMS of the signal over time to find the BPM.
 * - Uses energy detection to find major beats, and predicts missing beats using the BPM.
 *
 * The autocorrelation helps figure out complicated drum patterns,
 * while the prediction helps smooth out the noise.
 *
 * Any piece of periodic music will be periodic in its autocorrelation.
 * This translates into a base frequency + harmonics in the frequency domain. By finding
 * the peaks of the frequency domain and matching up the harmonics, we can identify the
 * dominant BPM. Peaks are interpolated quadratically and tracked across frames to
 * rank them by strength and permanence.
 *
 * Energy detection uses short filters and differentiation to find 'impulses'. These are used
 * to seed the prediction of the next beat. This prediction is constantly adjusted as new
 * impulses come in. The more accurate the prediction, the more locked in the pattern is and
 * the more energy is needed to reset it. If too many beats are mispredicted, prediction stops
 * and it tries to find the beat again.
 *
 * Kinda crappy for anything but 4/4 house.
 *
 * Uses the levels of LevelDetect as input.
 */
ThreeAudio.BeatDetect = function (data) {
  this.data = data;

  // Add output structure to data.
  data.beat = {
    permanence: 0,
    confidence: 0,
    missed: false,
    predicted: false,
    maybe: false,
    is: false,
    was: 0,
    bpm: 0//,
  };

  //this.initDebug();

  // Sample buffers
  this.n = 512;
  this.history = [[],[],[]];
  this.buffer = new Float32Array(this.n);
  this.spectrum = new Float32Array(this.n);
  this.fft = new FFT(this.n, 44100);
  this.sample = 0;
  this.energy = 0;
  this.background = 0;
  this.last = 0;
  this.measure = 0;
  this.debounceMaybe = 0;
  this.debouncePredict = 0;
  this.missed = 3;
  this.decay = 0;

  // Acceptable range 50-300 bpm
  this.fMin = Math.floor(this.bpmToOffset(50));
  this.fMax = Math.ceil(this.bpmToOffset(400));

  // Histogram of autocorrelation peaks seen
  this.histogram = {};
  this.histogramSorted = [];
  this.beat = null;
};

ThreeAudio.BeatDetect.prototype = {
  initDebug: function () {
    this.c = document.createElement('canvas');
    this.c.width = 512;
    this.c.height = 340;
    this.c.style.position = 'absolute';
    this.c.style.zIndex = 20;
    this.c.style.marginTop = '100px';
    this.g = this.c.getContext('2d');
    this.i = 0;

    this.t = document.createElement('div');
    this.t.width = 512;
    this.t.height = 200;
    this.t.style.background = 'rgba(0,0,0,.3)';
    this.t.style.color = '#fff';
    this.t.style.position = 'absolute';
    this.t.style.zIndex = 20;
    this.t.style.marginTop = '340px';

    document.body.appendChild(this.c);
    document.body.appendChild(this.t);
  },

  bpmToOffset: function (bpm) {
    return this.n * bpm / (60 * 60); // Assume 60 fps
  },

  offsetToBPM: function (freq) {
    return 60 * 60 * freq / this.n; // Assume 60 fps
  },

  analyse: function () {
    var data = this.data,
        levels = data.levels,
        buffer = this.buffer,
        fft = this.fft,
        n = this.n,
        history = this.history,
        histogram = this.histogram,
        histogramSorted = this.histogramSorted,
        that = this;

    // Calculate sample to autocorrelate
    var sample = levels.direct[0];
//    this.sample = levels.direct[0];

    // Keep track of sound levels up to n samples.
    history.unshift(sample);
    while (history.length > n) history.pop();

    // Update float buffer
    buffer.set(history);

    // Calculate autocorrelation of buffer in frequency domain.
    fft.forward(buffer);
    var spectrum = fft.real, real = fft.real, imag = fft.imag;
    for (var i = 0; i < n; ++i) {
      spectrum[i] = real[i] * real[i] + imag[i] * imag[i];
    }

    // Find maximum of autocorrelation spectrum in region of interest.
    var spectrumMax = 0;
    for (var i = 2; i < n/8; ++i) {
      spectrumMax = Math.max(spectrumMax, spectrum[i]);
    }

    // Find peaks in autocorrelation spectrum.
    var peaks = {};
    var cutoff = spectrumMax / 16; // Ignore peaks less than 1/16th of maximum.
    for (var i = this.fMin + 1; i < this.fMax; ++i) {
      var energy = spectrum[i];
      if (energy > cutoff) {
        var max = Math.max(spectrum[i - 1], spectrum[i + 1]);
        // Is this point higher than its neighbours?
        if (energy > max) {
          var min = Math.min(spectrum[i - 1], spectrum[i + 1]);
          var diff = Math.abs(energy - min),
              discriminant = diff / energy;

          // Peak must dip 50% on at least one side
          if (discriminant > .5) {
            var strength = Math.sqrt(energy / spectrumMax);
            peaks[i] = strength;
          }
        }
      }
    }

    // Decay all peak strengths
    _.each(histogramSorted, function (peak, key) {
      peak.permanence = peak.permanence * .99;
      decay = Math.min(1, (Math.log(1 + peak.permanence) / Math.log(10)));
      peak.strength = peak.strength * decay;
      peak.active = false;
    });

    // Find fractional offset of each peak and add to histogram
    _.each(peaks, function (strength, i) {
      // Cast key to int.
      i = +i;

      // Get neighbouring points
      var l = spectrum[i-1],
          m = spectrum[i],
          r = spectrum[i+1];

      // Use quadratic fit to interpolate
      var a2 = (l + r) - m * 2;
          b = (r - l) / 2,
          fraction = -b/a2;

      // Add peak to histogram
      var peak = histogram[i];
      if (!peak) {
        // See if we need to move a neighbouring peak over.
        if (peak = histogram[i+1]) {
          delete histogram[i+1];
          peak.index = i;
          peak.fraction += 1;
          histogram[i] = peak;
        }
        else if (peak = histogram[i-1]) {
          delete histogram[i-1];
          peak.index = i;
          peak.fraction -= 1;
          histogram[i] = peak;
        }
        // Create new peak
        else {
          peak = histogram[i] = {
            index: i,
            fraction: fraction,
            offset: 0,
            strength: 0,
            permanence: 0,
            score: 0,
            window: 0//,
          };
          histogramSorted.push(peak);
        }
      }

      // Update histogram peak
      peak.fraction = peak.fraction + (fraction - peak.fraction) * .1;
      peak.strength = strength;
      peak.permanence += peak.strength * .01;
      peak.offset = peak.index + peak.fraction;
      peak.bpm = that.offsetToBPM(peak.offset);
      peak.window = n / (peak.offset);
      peak.active = true;
    });

    // Sort histogram by permanence
    histogramSorted.sort(function (a, b) {
      return b.permanence - a.permanence;
    });

    // Cull peaks with too low a value.
    var last;
    while ((last = histogramSorted[histogramSorted.length - 1]) && (last.strength < 0.01)) {
      histogramSorted.splice(histogramSorted.length - 1, 1);
      delete histogram[last.index];
    }

    // Compare peaks against reference peak
    function comparePeaks(reference) {
      var result = 0, cutoff = reference.offset * 1.5;

      // Pairwise comparison
      _.each(histogramSorted, function (peak) {
        if (peak == reference) return;
        if (peak.offset < cutoff) return;

        // Calculate match value based on narrow window around integer ratios.
        var ratio = peak.offset / reference.offset,
            match = Math.max(0, 1 - Math.abs(ratio - Math.round(ratio)) * 8);

        // Scale by peak strength
        strength = peak.strength * peak.permanence * ratio;
        result += match * strength;
      });

      return result;
    }

    // Figure out the true BPM by finding sets of peaks that are multiples of each other.
    var h = histogramSorted.length, fMin = this.fMin,
        score = 0, second = 0, beat = null;
    _.each(histogramSorted, function (reference) {
      var accum = 0;

      if (reference.offset < fMin) return;
      var result = comparePeaks(reference);

      if (result > accum) {
        accum = result;
      }

      // Add this peak's strength
      accum += reference.strength * reference.permanence;
      reference.score = accum;

      // Keep track of two maximum values.
      if (accum > score) {
        beat = reference;
        second = score;
        score = accum;
      }
      else if (accum > second) {
        second = accum;
      }
    });

    // See if new BPM is better.
    if (beat) {
      // Score based on first and second BPM strength.
      beat.score = score ? (1 - second / score) : 0;

      // Confidence = score x permanence
      beat.confidence = Math.sqrt(beat.score * beat.permanence);

      // Only pick new BPM if it has higher confidence.
      if (this.beat) {
        if (this.beat.confidence < beat.confidence) {
          // Accept new bpm.
          this.beat = beat;
        }
        else if (this.beat != beat) {
          // Decay current confidence.
          this.beat.confidence *= 0.95;
        }
      }
      else {
        // Accept new bpm.
        this.beat = beat;
      }
    }

    // Find energy impulse to mark beginning of measure
    var energy = levels.direct[0];
    // Separate signal from background
    this.background = this.background + (energy - this.background) * .2;
    this.energy = this.energy + (energy - this.energy) * .4;
    var signal = (this.energy - this.background) / (1 - this.background) * 3;

    // Tweak with derivative
    maybe = (signal * 2 - this.last) - .2;
    this.last = signal;

    // Prepare beat data
    data.beat.missed = false;
    data.beat.maybe = false;
    data.beat.is = false;
    data.beat.predicted = false;
    if (this.beat) {
      data.beat.confidence = this.beat.confidence;
      data.beat.permanence = this.beat.permanence;
      data.beat.bpm = this.beat.bpm;
    }

    // Constants for rejection algorithm.
    var foundBonus = 3,
        missedPenalty = 1,
        maxPenalty = 10,
        debounceFrames = 10;

    // Find a maybe beat to get started.
    if (maybe > 0.1 && this.debounceMaybe > debounceFrames) {
      this.debounceMaybe = 0;

      // Prediction is not working, use maybe beat.
      if (!this.beat || this.beat.confidence < .3) {
        // But ignore rapid beats in succession
        this.measure = 0;

        // If strong enough, accept as real beat
        if (maybe > .4) {
          data.beat.is = true;
        }
        else {
          data.beat.maybe = true;
        }
      }
      else if (this.beat) {
        // See how well it matches our model
        var half = this.beat.window / 2;
        var offset = ((this.measure + half) % this.beat.window) - half;

        // Resynchronize beat if close to prediction
        if (Math.abs(offset) < 5) {
          this.measure -= offset;
          // If prediction is late, pre-empt it.
          if (offset <= 0 && this.debouncePredict > debounceFrames) {
            data.beat.is = true;
            if (offset == 0) data.beat.predicted = true;
            this.debouncePredict = 0;
            this.missed = Math.max(0, this.missed - foundBonus);
          }
        }
        // Realign if there is a powerful enough impulse. Be more generous the more we've missed.
        else if (maybe > (1 - this.missed / maxPenalty)) {
          this.measure = 0;
          data.beat.is = true;
          this.debouncePredict = 0;
          this.missed = Math.max(0, this.missed - foundBonus);
        }
        // Ignore otherwise
      }
    }

    // Predict a beat.
    if (this.beat && (this.beat.confidence > .3)) {
      var debounce = this.debouncePredict > debounceFrames;

      // See if we passed beat.window samples.
      var predict = this.measure > this.beat.window;
      if (predict) {
        this.measure -= this.beat.window;
      }

      // Check if prediction matches sound.
      if (predict && debounce) {
        if (maybe < 0) {
          this.missed = Math.min(maxPenalty, this.missed + missedPenalty);
          data.beat.missed = true;
        }
        else {
          this.missed = Math.max(0, this.missed - foundBonus);
        }

        if (this.missed > 4) {
          // Ignore prediction if previous 4 beats were mispredicted
          predict = false;

          data.beat.maybe = true;
          data.beat.predicted = true;

          // Shift decounce randomly to attempt to hit the right beat.
          this.debounceMaybe += Math.random() * debounceFrames;
          this.debouncePredict = 0;
        }
      }

      // Ignore rapid predictions due to shifting BPM
      if (predict && debounce) {
        this.debouncePredict = 0;
        data.beat.is = true;
        data.beat.predicted = true;
      }
    }

    // Provide decayed beat value
    this.decay = this.decay + (+data.beat.is * 3 - this.decay) * .33;
    data.beat.was = data.beat.was + (this.decay * 3 - data.beat.was) * .33;

    // Advance a frame.
    this.debounceMaybe++;
    this.debouncePredict++;
    this.measure++;

    //////////////
    this.debug(levels.direct, sample, signal, maybe, spectrum, peaks, histogramSorted, data.beat);
  },


  // Draw debug info into canvas / dom
  debug: function (levels, sample, diff, maybe, spectrum, peaks, histogram, beat) {
    var that = this;
    var n = this.n;

    if (this.g) {
      var out = [ '<strong>' + Math.round(beat.bpm * 10) / 10 + ' BPM (' + (Math.round(100 * beat.confidence)) + '%) ' + Math.round(beat.permanence * 100) + '</strong>' ];
      _.each(histogram, function (peak) {
        var bpm = Math.round(that.offsetToBPM(peak.offset) * 10) / 10;
        out.push([bpm, ' bpm - ', Math.round(peak.offset * 10) / 10, ' ', Math.round(peak.fraction * 100) / 100, ' - %: ', Math.round(peak.strength * 100), ' - p: ', Math.round(peak.permanence * 100)].join(''));
      });
      this.t.innerHTML = out.join('<br>');

      var g = this.g;

      // Draw graph bg
      g.fillStyle = '#000000';
      g.fillRect(0, 140, 512, 100);

      // Draw spectrum
      var max = 0;
      for (var i = 2; i < n/8; ++i) {
        max = Math.max(spectrum[i], max);
      }
      var norm = 1/max;
      g.beginPath();
      g.moveTo(0, 200);
      for (var i = 2; i < n/8; ++i) {
        g.lineTo((i-2)*8, 240-(spectrum[i]*norm)*100);
      }
      g.strokeStyle = '#ffffff';
      g.stroke();

      // Highlight peaks
      _.each(histogram, function (peak) {
        var alpha = peak.strength *.5 + .5;
        var active = peak.active ? '255' : '0';
        g.fillStyle = 'rgba(255,'+active+',0,'+ alpha +')';
        g.fillRect((peak.offset - 2) * 8, 140, 1, 100);
      })

      // Plot levels voiceprint
      var i = this.i;
      var j = 0;
      function plot(l) {
        l = Math.round(Math.max(0, Math.min(255, l * 255)));
        g.fillStyle = 'rgb(' + [l,l,l].join(',') + ')';
        g.fillRect(i, j, 1, 20)
        j += 20;
      }
      plot(levels[0]);
      plot(levels[1]);
      plot(levels[2]);
      plot(levels[3]);

      // Show beats
      if (beat.is) {
        g.fillStyle = beat.missed ? 'rgba(255,0,0,.5)'
                      : (beat.predicted ? 'rgba(255,180,0,.5)' : 'rgba(30,180,0,.5)');
        g.fillRect(this.i, 0, 1, 100)
      }
      var c = Math.round(Math.max(0, Math.min(255, beat.was * 255)));
      g.fillStyle = 'rgb('+c+','+c+','+c+')';
      g.fillRect(412, 240, 100, 100)

      // Show maybe beats
      if (beat.maybe) {
        g.fillStyle = beat.predicted ? 'rgba(100,0,230,.5)' : 'rgba(0,180,255,.5)';
        g.fillRect(this.i, 0, 1, 100)
      }

      // Show sample
      if (sample) {
        sample = Math.floor(Math.max(0, Math.min(1, sample)) * 255);
        g.fillStyle = 'rgba(0,'+sample+',' + sample +',1)';
        g.fillRect(this.i, 80, 1, 20)
      }

      // Show diff
      if (diff) {
        diff = Math.floor(Math.max(0, Math.min(1, diff)) * 255);
        g.fillStyle = 'rgba('+diff+',0,' + diff +',1)';
        g.fillRect(this.i, 100, 1, 20)
      }

      // Show maybe
      if (maybe) {
        maybe = Math.floor(Math.max(0, Math.min(1, maybe)) * 255);
        g.fillStyle = 'rgba('+maybe+',' + maybe +',0,1)';
        g.fillRect(this.i, 120, 1, 20)
      }

      this.i = (i + 1) % 512;

    }
  }

}
/**
 * Create an audio source.
 */
tQuery.World.register('audio', function (fftSize) {
  return tQuery.createAudioSource(this, fftSize);
});

/**
 * Create an audio source.
 */
tQuery.register('createAudioSource', function (world, fftSize) {
  // Create source
  var source = new ThreeAudio.Source(fftSize);

  // Add .textures() method.
  source.textures = function (history) {
    return tQuery.createAudioTextures(world, this, history);
  };

  return source;
});

/**
 * Create a set of audio textures for sound data.
 */
tQuery.register('createAudioTextures', function (world, source, history) {
  var audioTextures = new ThreeAudio.Textures(world.tRenderer(), source, history);

  // Add .material() method.
  audioTextures.material = function (vertexShader, fragmentShader, textures,
                                uniforms, attributes) {
    return tQuery.createAudioMaterial(this, vertexShader, fragmentShader, textures,
                                     uniforms, attributes);
  };

  // Auto-update textures before render.
  world.loop().hookPreRender(function () {
    audioTextures.update();
  });

  return audioTextures;
});

/**
 * Create an audio material for shading sound data.
 */
tQuery.register('createAudioMaterial',
  function (audioTextures, vertexShader, fragmentShader, textures, uniforms, attributes) {
    var material = new ThreeAudio.Material(
      audioTextures,
      vertexShader,
      fragmentShader,
      textures,
      uniforms,
      attributes//,
    );

    // Add .grid() method.
    material.grid = function (width, height, segmentsW, segmentsH) {
      return tQuery.createAudioGrid(audioTextures, width, height, segmentsW, segmentsH, this);
    };

    return material;
  }
);

/**
 * Create an audio grid for rendering sound data with.
 */
tQuery.register('createAudioGrid', function (textures, width, depth, segmentsW, segmentsH, material) {
  var defaults  = [textures, 1, 1, 0, 0];
  for (i in defaults) {
    arguments[i] = arguments[i] || defaults[i];
  }

  var geometry = new ThreeAudio.GridGeometry(
    textures,
    width || 1,
    depth || 1,
    segmentsW,
    segmentsH
  );

  var material = material || tQuery.defaultObject3DMaterial;

  var mesh = new THREE.Mesh(geometry, material);
  mesh.doubleSided = true;
  mesh.frustumCulled = false;

  return tQuery(mesh);
});
