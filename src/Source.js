ThreeAudio.Source = function (fftSize) {
  this.fftSize = fftSize || 1024;

  this.filters = {};
  this.playing = false;

  this.init();
}

ThreeAudio.Source.prototype = {

  init: function () {
    var c = this.context = new webkitAudioContext();

    // Abstract source
    this.source = c.createDelayNode();

    // Create media source
    this.element = new Audio();
    this.element.preload = 'auto';
    this.mediaElementSource = c.createMediaElementSource(this.element);
    this.mediaElementSource.connect(this.source);

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

  mic: function (callback) {
    var c = this.context, source = this.source;
    try {
      navigator.webkitGetUserMedia({
          audio: true
        }, function (stream) {
          // Create an AudioNode from the stream.
          var mediaStreamSource = this.mediaStreamSource = c.createMediaStreamSource(stream);
          mediaStreamSource.connect(source);

          callback && callback();
        });
    } catch (e) { };

    return this;
  },

  load: function (url, callback) {
    var context = this.context,
        source = this.source,
        that = this;

    var ping = function () {
      // Begin playback if requested earlier.
      if (that.playing) {
        that._play();
      }

      // Remove event listener
      that.element.removeEventListener('canplaythrough', ping);

      // Fire callback
      callback && callback();
    };

    // Add event listener for when loading is complete
    this.element.addEventListener('canplaythrough', ping);
    this.element.src = url;

    return this;
  },

  play: function () {
    this.playing = true;
    if (this.element.readyState == 4) {
      this._play();
    }
    return this;
  },

  stop: function () {
    this.playing = false;
    if (this.element.readyState == 4) {
      this._stop();
    }
    return this;
  },

  _play: function () {
    this.element.play();
  },

  _stop: function () {
    this.element.pause();
  }//,

};

// tQuery-like naming.
ThreeAudio.Source.prototype.start = ThreeAudio.Source.prototype.play;
