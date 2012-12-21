ThreeAudio.Source = function (options) {
  if (typeof options == 'number') {
    options = { fftSize: options };
  }
  options = _.extend({
    fftSize: 1024,
    levels: true,
    beats: true,
  }, options);

  this.fftSize = options.fftSize;
  this.levels = options.levels;
  this.beats = options.beats;

  this.filters = {};
  this.buffer = null;
  this.playing = false;
  this.seek = 0;

  this.init();
}

ThreeAudio.Source.prototype = {

  init: function () {
    var c = this.context = new webkitAudioContext();

    // Abstract sources, use a 0 delay node.
    this.audible = c.createDelayNode();
    this.inaudible = c.createDelayNode();

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
    this.audible.connect(this.analyser);
    this.inaudible.connect(this.analyser);

    // Connect audible output through
    this.audible.connect(this.delay);
    this.delay.connect(c.destination);

    // Connect secondary filters + analysers + gain.
    var audible = this.audible,
        inaudible = this.inaudible;
    _.each(filters, function (filter) {
      audible.connect(filter.delayNode);
      inaudible.connect(filter.delayNode);

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
    if (this.levels) {
      this.levelDetect = new ThreeAudio.LevelDetect(this.data);
    }

    // Create beat detector
    if (this.beats) {
      this.beatDetect = new ThreeAudio.BeatDetect(this.data);
    }
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
    this.levels && this.levelDetect.analyse();

    // Update beat detector.
    this.beats && this.beatDetect.analyse();

    return this;
  },

  size: function () {
    return this.analyser.frequencyBinCount;
  },

  mic: function (callback) {
    var c = this.context, inaudible = this.inaudible;
    try {
      navigator.webkitGetUserMedia({
          audio: true
        }, function (stream) {
          // Create an AudioNode from the stream.
          var mediaStreamSource = this.mediaStreamSource = c.createMediaStreamSource(stream);
          mediaStreamSource.connect(inaudible);

          callback && callback();
        });
    } catch (e) { };

    return this;
  },

  immediate: function (data) {
    // Link databuffer to source
    this.buffer = this.context.createBuffer(data, false);
    // Begin playback if requested earlier.
    if (this.playing) {
      that._play();
    }

    return this;
  },

  load: function (url, callback) {
    var context = this.context,
        that = this;

    // Load file via AJAX
    var request = new XMLHttpRequest();
    request.open("GET", url, true);
    request.responseType = "arraybuffer";

    request.onload = function() {
      // Link databuffer to source
      that.buffer = context.createBuffer(request.response, false);

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
    if (this.playing) return;

    this.playing = true;
    if (this.buffer) {
      this._play();
    }
    return this;
  },

  stop: function () {
    if (!this.playing) return;

    this.playing = false;
    if (this.buffer) {
      this._stop();
    }
    return this;
  },

  _play: function () {
    // Create buffer source
    this.bufferSource = this.context.createBufferSource();
    this.bufferSource.connect(this.audible);
    this.bufferSource.buffer = this.buffer;

    this.bufferSource.noteOn(0);
    this.startTime = +new Date() - this.seek;
  },

  _stop: function () {
    this.bufferSource.noteOff(0);
    this.bufferSource.disconnect(0);
  },

  time: function () {
    return this.startTime ? +new Date() - this.startTime : 0;
  },

};

// tQuery-like naming.
ThreeAudio.Source.prototype.start = ThreeAudio.Source.prototype.play;
