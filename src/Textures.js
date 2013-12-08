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

      gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
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
      audioIsBeat:       beat && beat.is || 0,
      audioWasBeat:      beat && beat.was || 0, 
      audioLevels:       levels && levels.direct || 0,
      audioLevelsSmooth: levels && levels.smooth || 0,
      audioLevelsChange: levels && levels.change || 0,
      audioOffset:       this.timeIndex / this.history,
      audioStep: {
        x: 1 / (this.source.samples - 1),
        y: 1 / this.history,
      },
    };
  },
}

// Event emitter
MicroEvent.mixin(ThreeAudio.Textures);
