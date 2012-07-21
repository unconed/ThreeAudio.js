/**
 * Audio analyser: provide RMS levels + filters / derivatives.
 */
ThreeAudio.BeatDetect = function (data) {
  this.data = data;

  // Add output structure to data.
  data.beat = {
    is: false,
    bpm: 0//,
  };

  this.initDebug();

  // Sample buffers
  this.n = 1024;
  this.history = [];
  this.buffer = new Float32Array(this.n);
  this.fft = new FFT(this.n, 44100);

  // Acceptable range 30-250 bpm
  this.fMin = Math.floor(this.bpmToFreq(40));
  this.fMax = Math.ceil(this.bpmToFreq(200));

  // Histogram of autocorrelation peaks seen
  this.histogram = {};
  this.histogramSorted = [];
  this.frames = 0;
  this.beatFrames = 0;
};

ThreeAudio.BeatDetect.prototype = {
  initDebug: function () {
    this.c = document.createElement('canvas');
    this.c.width = 600;
    this.c.height = 200;
    this.c.style.position = 'absolute';
    this.c.style.zIndex = 20;
    this.c.style.marginTop = '100px';
    this.g = this.c.getContext('2d');
    this.i = 0;

    this.t = document.createElement('div');
    this.t.width = 600;
    this.t.height = 200;
    this.t.style.background = 'rgba(0,0,0,.3)';
    this.t.style.color = '#fff';
    this.t.style.position = 'absolute';
    this.t.style.zIndex = 20;
    this.t.style.marginTop = '300px';

    document.body.appendChild(this.c);
    document.body.appendChild(this.t);
  },

  bpmToFreq: function (bpm) {
    return this.n * bpm / (60 * 60); // Assume 60 fps
  },

  freqToBPM: function (freq) {
    return 60 * 60 * freq / this.n; // Assume 60 fps
  },

  analyse: function () {
    var data = this.data,
        levels = data.levels,
        buffer = this.buffer;
        fft = this.fft;
        n = this.n,
        history = this.history,
        histogram = this.histogram,
        histogramSorted = this.histogramSorted,
        that = this;

    // Keep track of sound levels.
    history.push(levels.direct[1]);
    if (history.length > n) history.shift();
    buffer.set(history);
    for (var i = 0; i < n; ++i) {
      buffer[i] *= .5-.5*Math.cos(i / n * τ);
    }

    // Calculate autocorrelation of buffer in frequency domain.
    fft.forward(buffer);
    var real = fft.real, imag = fft.image;
    for (var i = 0; i < n; ++i) {
      fft.real[i] = fft.real[i] * fft.real[i] + fft.imag[i] * fft.imag[i];
    }
    var spectrum = fft.real;

    // Find maximum of autocorrelation spectrum in region of interest.
    var spectrumMax = 0;
    for (var i = 2; i < n/8; ++i) {
      spectrumMax = Math.max(spectrumMax, spectrum[i]);
    }

    // Find peaks in autocorrelation spectrum.
    var peaks = {};
    var cutoff = spectrumMax / 3;
    for (var i = this.fMin + 1; i < this.fMax; ++i) {
      var energy = spectrum[i];
      if (energy > cutoff) {
        var max = Math.max(spectrum[i - 1], spectrum[i + 1]);
        var min = Math.min(spectrum[i - 1], spectrum[i + 1]);
        if (energy > max) {
          var diff = Math.abs(energy - min),
              discriminant = diff / energy;

          if (discriminant > .05) {
            var strength = discriminant;
            peaks[i] = strength;
          }
        }
      }
    }

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
          fractional = -b/a2;

      // Ignore false peaks
      if (Math.abs(fractional) >= 1) return;

      // Add peak to histogram
      var peak = histogram[i];
      if (!peak) {
        // See if we need to move a neighbouring peak over.
        if (peak = histogram[i+1]) {
          delete histogram[i+1];
          peak.index = i;
          peak.offset += 1;
          histogram[i] = peak;
        }
        else if (peak = histogram[i-1]) {
          delete histogram[i-1];
          peak.index = i;
          peak.offset -= 1;
          histogram[i] = peak;
        }
        else {
          peak = histogram[i] = {
            index: i,
            offset: fractional,
            strength: 0,
            permanence: 0,
            window: n / i//,
          };
          histogramSorted.push(peak);
        }
      }

      // Update active histogram peaks
      peak.offset = peak.offset + (fractional - peak.offset) * .1;
      peak.strength = peak.strength + (Math.max(peak.strength, strength) - peak.strength) * .5;
      peak.permanence += peak.strength;
      peak.window = n / (peak.index + peak.offset);
    });

    // Decay all peak strengths
    _.each(histogramSorted, function (peak, key) {
      peak.permanence = peak.permanence * .999;
      decay = Math.min(1, (Math.log(1 + peak.permanence) / Math.log(100)));
      peak.strength = peak.strength * decay;
    });

    // Sort histogram by permanence
    histogramSorted.sort(function (a, b) {
      return b.permanence - a.permanence;
    });

    // Keep track of beats
    this.frames++;
    this.beatFrames++;
    var beat, beatWindow;

    data.beat.is = false;

    if ((beat = histogramSorted[0]) && (beatWindow = beat.window) && (this.beatFrames > beatWindow)) {
      this.beatFrames -= beatWindow;
      data.beat.is = true;
    }

    // Cull peaks with too low a value.
    var last;
    while ((last = histogramSorted[histogramSorted.length - 1]) && (last.strength < 0.001)) {
      histogramSorted.splice(histogramSorted.length - 1, 1);
      delete histogram[last.index];
    }

    this.debug(levels, spectrum, peaks, histogramSorted, data.beat);
  },

  debug: function (levels, spectrum, peaks, histogram, beat) {
    var that = this;

    if (this.g) {
      var out = [];
      _.each(histogram, function (peak) {
        var bpm = Math.round(that.freqToBPM(peak.index + peak.offset) * 10) / 10;
        out.push([bpm, ' bpm - ', peak.index, ' ', Math.round(peak.offset * 100) / 100, ' - %: ', Math.round(peak.strength * 100), ' - p: ', Math.round(peak.permanence)].join(''));
      });
      this.t.innerHTML = out.join('<br>');

      var g = this.g;

      // Draw graph bg
      g.fillStyle = '#000000';
      g.fillRect(0, 100, 512, 100);

      // Draw spectrum
      var max = 0;
      for (var i = 2; i < n/16; ++i) {
        max = Math.max(spectrum[i], max);
      }
      var norm = 1/max;
      g.beginPath();
      g.moveTo(0, 200);
      for (var i = 2; i < n/16; ++i) {
        g.lineTo((i-2)*8, 200-(spectrum[i]*norm)*100);
      }
      g.strokeStyle = '#ffffff';
      g.stroke();

      // Highlight peaks
      _.each(histogram, function (peak) {
        var alpha = peak.strength *.5 + .5;
        g.fillStyle = 'rgba(255,0,0,'+ alpha +')';
        g.fillRect((peak.index + peak.offset - 2) * 8, 100, 1, 200);
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
      plot(levels.direct[0]);
      plot(levels.direct[1]);
      plot(levels.direct[2]);
      plot(levels.direct[3]);

      // Show beats
      if (beat.is) {
        g.fillStyle = 'rgba(255,180,0,.5)';
        g.fillRect(i, 0, 1, 100)
      }

      this.i = (this.i + 1) % 600
    }
  }

}
