/**
 * Audio analyser: provide RMS levels + filters / derivatives.
 */
ThreeAudio.BeatDetect = function (data) {
  this.data = data;

  // Add output structure to data.
  data.beat = {
    permanence: 0,
    confidence: 0,
    predicted: false,
    maybe: false,
    is: false,
    was: 0,
    bpm: 0//,
  };

  this.initDebug();

  // Sample buffers
  this.n = 512;
  this.history = [[],[],[]];
  this.buffer = new Float32Array(this.n);
  this.spectrum = new Float32Array(this.n);
  this.fft = new FFT(this.n, 44100);
  this.energy = 0;
  this.measure = 0;
  this.sample = 0;
  this.debounceMaybe = 0;
  this.debouncePredict = 0;
  this.missed = 0;
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
    // Tweak value with derivative to enhance higher frequencies in autocorrelation.
    var sample = levels.direct[0];//(levels.direct[0] * 2 - this.sample);
    this.sample = levels.direct[0];

    // Keep track of sound levels up to n samples.
    history.unshift(sample);
    while (history.length > n) history.pop();

    // Update float buffer
    buffer.set(history);

    // Calculate autocorrelation of buffer in frequency domain.
    fft.forward(buffer);
    var real = fft.real, imag = fft.image, spectrum;
    for (var i = 0; i < n; ++i) {
      fft.real[i] = fft.real[i] * fft.real[i] + fft.imag[i] * fft.imag[i];
    }
    spectrum = fft.real;

    // Find maximum of autocorrelation spectrum in region of interest.
    var spectrumMax = 0;
    for (var i = 2; i < n/8; ++i) {
      spectrumMax = Math.max(spectrumMax, spectrum[i]);
    }

    // Find peaks in autocorrelation spectrum.
    var peaks = {};
    var cutoff = spectrumMax / 16;
    for (var i = this.fMin + 1; i < this.fMax; ++i) {
      var energy = spectrum[i];
      if (energy > cutoff) {
        var max = Math.max(spectrum[i - 1], spectrum[i + 1]);
        if (energy > max) {
          var min = Math.min(spectrum[i - 1], spectrum[i + 1]);
          var diff = Math.abs(energy - min),
              discriminant = diff / energy;

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
    function comparePeaks(reference, factor) {
      var result = 0, cutoff = reference.offset * (1 + .5 / factor);

      // Pairwise comparison
      _.each(histogramSorted, function (peak) {
        if (peak == reference) return;
        if (peak.offset < cutoff) return;

        // Calculate match value based on narrow window around integer ratios.
        var ratio = peak.offset / reference.offset * factor,
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

      // Try both real bpm and half bpm, as the
      // second harmonic is often stronger than the first.
      var factors = [1];
      _.each(factors, function (factor) {
        if (reference.offset / factor < fMin) return;
        var result = comparePeaks(reference, factor);

        if (result > accum) {
          accum = result;
        }
      });

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

    // Find energy impulse of bass to mark beginning of measure
    var energy = levels.direct[1] + levels.direct[3];
    this.energy = this.energy + (energy - this.energy) * .2;
    maybe = (energy - this.energy * 1.2);

    // Prepare beat data
    data.beat.maybe = false;
    data.beat.is = false;
    data.beat.predicted = false;
    if (this.beat) {
      data.beat.confidence = this.beat.confidence;
      data.beat.permanence = this.beat.permanence;
      data.beat.bpm = this.beat.bpm;
    }

    // Find a maybe beat to get started.
    if (maybe > 0.1 && this.debounceMaybe > 10) {
      this.debounceMaybe = 0;

      // Prediction is not working, use maybe beat.
      if (!this.beat || this.beat.confidence < .5) {
        // But ignore rapid beats in succession
        this.measure = 0;
        data.beat.maybe = true;
      }
      else if (this.beat) {
        // See how well it matches our model
        var half = this.beat.window / 2;
        var offset = ((this.measure + half) % this.beat.window) - half;

        // Resynchronize beat if close to prediction
        if (Math.abs(offset) < 5) {
          this.measure -= offset;
          // If prediction is late, pre-empt it.
          if (offset < 0 && this.debouncePredict > 10) {
            data.beat.is = true;
            this.debouncePredict = 0;
            this.missed -= 2;
          }
        }
        // Ignore otherwise
      }
    }

    // Predict a beat.
    if (this.beat && (this.beat.confidence > .5)) {
      // See if we passed beat.window samples.
      var predict = (this.measure + 1) > this.beat.window;
      if (predict) {
        this.measure -= this.beat.window;

        // Check if prediction matches sound.
        if (maybe < 0) {
          this.missed++;
          console.log('missed')
        }
        else {
          this.missed = Math.max(0, this.missed - 2);
        }

        // Drop prediction if 4 beats were mispredicted
        if (this.missed > 6) {
          console.log('dropped')
          this.missed = 0;
          this.beat = null;
          this.debounceMaybe = Math.floor(4 + Math.random() * 4);
        }
      }

      // Ignore rapid predictions due to shifting BPM
      if (predict && this.debouncePredict > 10) {
        this.debouncePredict = 0;
        data.beat.is = true;
        data.beat.predicted = true;
      }
    }

    // Provide decayed beat value
    this.decay = this.decay + (+data.beat.is * 5 - this.decay) * .2;
    data.beat.was = data.beat.was + (this.decay * 2 - data.beat.was) * .5;

    // Advance a frame.
    this.debounceMaybe++;
    this.debouncePredict++;
    this.measure++;

    //////////////
    this.debug(levels.direct, sample, energy, maybe, spectrum, peaks, histogramSorted, data.beat);
  },


  // Draw debug info into canvas / dom
  debug: function (levels, sample, energy, maybe, spectrum, peaks, histogram, beat) {
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
        g.fillStyle = beat.predicted ? 'rgba(255,0,0,.5)' : 'rgba(255,180,0,.5)';
        g.fillRect(this.i, 0, 1, 100)
      }
      var c = Math.round(Math.max(0, Math.min(255, beat.was * 255)));
      g.fillStyle = 'rgb('+c+','+c+','+c+')';
      g.fillRect(412, 240, 100, 100)

      // Show maybe beats
      if (beat.maybe) {
        g.fillStyle = 'rgba(0,180,255,.5)';
        g.fillRect(this.i, 0, 1, 100)
      }

      // Show sample
      if (sample) {
        sample = Math.floor(Math.max(0, Math.min(1, sample)) * 255);
        g.fillStyle = 'rgba(0,'+sample+',' + sample +',1)';
        g.fillRect(this.i, 80, 1, 20)
      }

      // Show energy
      if (energy) {
        energy = Math.floor(Math.max(0, Math.min(1, energy)) * 255);
        g.fillStyle = 'rgba('+energy+',0,' + energy +',1)';
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
