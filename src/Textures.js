ThreeAudio.Textures = function (renderer, source, history) {

  this.renderer = renderer;
  this.source = source;
  this.textures = {};

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
