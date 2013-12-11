ThreeAudio.Source = function (options) {
  if (typeof options == 'number') {
    options = { fftSize: options };
  }
  options = _.extend({
    fftSize: 1024,
    detectors: [ThreeAudio.LevelDetect, ThreeAudio.BeatDetect],
  }, options);

  this.fftSize = options.fftSize;
  this.detectors = options.detectors;

  this.filters = {};
  this.playing = false;

  this.processingDelay = 0;

  if (!(webkitAudioContext || AudioContext)) {
    throw "Web Audio API not supported";
  }
  else {
    this.initElement(options.element);
  }
}

ThreeAudio.Source.prototype = {

  initElement: function (element) {
    var c = this.context = new (webkitAudioContext || AudioContext)();

    // Create source
    if (element) {
      this.element = element;
    }
    else {
      this.element = new Audio();
      this.element.preload = 'auto';
    }

    // Create buffers for time/freq data.
    this.samples = this.fftSize / 2;
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

    // Create audible/inaudible inputs for analysis
    this.audible = c.createDelayNode();
    this.inaudible = c.createDelayNode();

    // Wait for audio metadata before initializing analyzer
    if (this.element.readyState >= 3) {
      this.initAnalyzer();
    }
    else {
      this.element.addEventListener('canplay', function () {
        this.initAnalyzer();
      }.bind(this));
    }

  },

  initAnalyzer: function () {
    var c = this.context;

    this.source = c.createMediaElementSource(this.element);
    this.source.connect(this.audible);

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
    this.processingDelay = this.fftSize * 2 / c.sampleRate;
    this.delay.delayTime.value = this.processingDelay;

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

    // Create detectors
    this.detectors = _.map(this.detectors, function (klass) {
      return (new klass(this.data));
    }.bind(this));
  },

  update: function () {
    var a = this.analyser, d = this.data;

    if (a) {
      // Get freq/time data.
      a.smoothingTimeConstant = 0;
      a.getByteFrequencyData(d.freq);
      a.getByteTimeDomainData(d.time);

      // Get filtered signals.
      _.each(this.filters, function (filter) {
        filter.analyser.getByteTimeDomainData(d.filter[filter.key]);
      });

      // Update detectors.
      _.each(this.detectors, function (det) {
        det.analyse();
      });
    }

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

  size: function () {
    return this.analyser.frequencyBinCount;
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
    this.startTime = (+new Date() / 1000) - this.element.currentTime;
    this.element.play();
  },

  _stop: function () {
    this.element.pause();
  },

  time: function () {
    return this.startTime ? ((+new Date() / 1000) - this.startTime) : 0;
  },

};

// tQuery-like naming.
ThreeAudio.Source.prototype.start = ThreeAudio.Source.prototype.play;
