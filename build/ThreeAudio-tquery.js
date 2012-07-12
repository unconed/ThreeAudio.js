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
    this.analyser.fftSize = this.fftSize;

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
        frequency: 400,
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
      filter.analyser.fftSize = 512;

      // Create delay node to compensate for fftSize difference/lag
      // Note: disabled, Texture.js signal smoothing ends up adding enough filter delay to compensate.
      filter.delayNode = c.createDelayNode();
      filter.delayNode.delayTime.value = 0;
      //*(this.fftSize - 512) / c.sampleRate;

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
        bass: new Uint8Array(256),
        mid: new Uint8Array(256),
        treble: new Uint8Array(256)//,
      }//,
    };
  },

  update: function () {
    var a = this.analyser, d = this.data;
    a.smoothingTimeConstant = 0;
    a.getByteFrequencyData(d.freq);
    a.getByteTimeDomainData(d.time);

    _.each(this.filters, function (filter) {
      filter.analyser.getByteTimeDomainData(d.filter[filter.key]);
    });

    return this;
  },

  size: function () {
    return this.analyser.frequencyBinCount;
  },

  load: function (url, callback) {
    var context = this.context,
        source = this.source;

    // Load file via AJAX
    var request = new XMLHttpRequest();
    request.open("GET", url, true);
    request.responseType = "arraybuffer";

    request.onload = (function() {
      // Link databuffer to source
      var buffer = context.createBuffer(request.response, false);
      source.buffer = buffer;
      source.loop = true;

      // Begin playback if requested earlier.
      if (this.playing) {
        this._play();
      }

      callback && callback();
    }).bind(this);

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

};/**
 * Helper for making ShaderMaterials that read from the audio buffers.
 */
ThreeAudio.Material = function (audioTextures, vertexShader, fragmentShader, textures, uniforms, attributes) {
  attributes = attributes || [];

  // Uniform for time scrolling
  uniforms = _.extend(uniforms || {}, {
    audioLevels: {
      type: 'fv1',
      value: 0//,
    },
    audioLevelsSmooth: {
      type: 'fv1',
      value: 0//,
    },
    audioLevelsChange: {
      type: 'fv1',
      value: 0//,
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
      texture: texture//,
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
  this.materials = [];

  this.history = history || 128;
  this.timeIndex = 0;

  this.init();
}

ThreeAudio.Textures.prototype = {

  init: function () {
    var renderer = this.renderer,
        gl = renderer.getContext(),
        textures = this.textures,
        source = this.source,
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

      d = source.data[key];
      empty = new Uint8Array(d.length * history);
      if (key == 'time') {
        for (var i = 0; i < d.length * history; ++i) empty[i] = 128;
      }

      gl.texImage2D(gl.TEXTURE_2D, 0, gl.ALPHA, d.length, history, 0, gl.ALPHA, gl.UNSIGNED_BYTE, empty);
    });

    this.audioLevels = [[1, 0, 0, 0]];
    this.audioLevelsSmooth = [0, 0, 0, 0];
    this.audioLevelsChange = [0, 0, 0, 0];
  },

  update: function () {
    var renderer = this.renderer,
        gl = renderer.getContext(),
        textures = this.textures,
        source = this.source,
        history = this.history,
        index = this.timeIndex,
        data = source.data;
        levels = this.audioLevels,
        smooth = this.audioLevelsSmooth,
        change = this.audioLevelsChange,
        bins = [0, 0, 0, 0];

    // Ensure audio data is up to date
    source.update();

    // Calculate RMS of time data.
    function rms(data) {
      var size = data.length, accum = 0;
      for (var i = 0; i < size; ++i) {
        var s = (data[i] - 128) / 128;
        accum += s*s;
      }
      return accum / size;
    }

    // Calculate energy level for all bins.
    var waveforms = [data.time, data.filter.bass, data.filter.mid, data.filter.treble];
    for (var j = 0; j < 4; ++j) {
      // Apply square root for compression, evens out response.
      bins[j] = Math.sqrt(rms(waveforms[j]));
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
    factors = [1, 3, 2, -2, -3, -1], gain = 6, decay = .3, Math.min(levels.length, factors.length);
    for (var i = 0; i < 4; ++i) {
      accum = 0;
      for (var j = 0; j < samples; ++j) {
        accum += (levels[j] && levels[j][i] || 0) * factors[j];
      }
      // Apply additional decay filter to make less erratic.
      change[i] = change[i] + (accum / gain - change[i]) * decay;
    }

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
    return {
      audioLevels: this.audioLevels[0],
      audioLevelsSmooth: this.audioLevelsSmooth,
      audioLevelsChange: this.audioLevelsChange,
      audioOffset: this.timeIndex / this.history,
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
 * Create an audio source.
 */
tQuery.register('createAudio', function (fftSize) {
  // Create source
  var world = this;
  var source = new ThreeAudio.Source(fftSize);

  // Add .textures() method.
  source.textures = function (history) {
    return world.createAudioTextures(this, history);
  };

  return source;
});

/**
 * Create a set of audio textures for sound data.
 */
tQuery.register('createAudioTextures', function (source, history) {
  var world = this;
  var textures = new ThreeAudio.Textures(this._renderer, source, history);

  // Add .material() method.
  textures.material = function (vertexShader, fragmentShader, textures,
                                uniforms, attributes) {
    return world.createAudioMaterial(this, vertexShader, fragmentShader, textures,
                                     uniforms, attributes);
  };

  return textures;
});

/**
 * Create an audio material for shading sound data.
 */
tQuery.register('createAudioMaterial',
  function (audioTextures, vertexShader, fragmentShader, textures, uniforms, attributes) {
    var world = this;

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
      return world.createAudioGrid(audioTextures, width, height, segmentsW, segmentsH, this);
    };

    return material;
  }
);

/**
 * Create an audio grid for rendering sound data with.
 */
tQuery.register('createAudioGrid', function (textures) {
	var ctor	= ThreeAudio.GridGeometry;
	var dflGeometry	= [textures, 1, 1, 0, 0];
	return this._createMesh(ctor, dflGeometry, arguments)
});
