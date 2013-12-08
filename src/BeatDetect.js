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
 * If the variance between detected beats becomes small enough (minus outliers),
 * the BPM is locked in and the autocorrelator is ignored to help ride through quiet sections.
 *
 * Works well for anything with a regular beat.
 *
 * Uses the levels of LevelDetect as input.
 */
var __taDebug = false;

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
    stddev: 0,
    bpm: 0,
  };

  __taDebug && this.initDebug();

  // Sample buffers
  this.n = 512;
  this.history = [[],[],[]];
  this.buffer = new Float32Array(this.n);
  this.spectrum = null;
  this.fft = new FFT(this.n, 44100);
  this.sample = 0; // Sample to feed into the autocorrelator
  this.background = 0; // Long-term energy level
  this.energy = 0; // Short-term energy level
  this.signal = 0; // Signal as distinguished from background
  this.measure = 0; // Frames since last beat
  this.maybe = 0; // Heuristic for instant beat detection
  this.maxMaybe = 0; // Normalization for maybe
  this.debounceMaybe = 0; // Debounce maybe beats
  this.debouncePredict = 0; // Debounce predicted beats
  this.decay = 0; // Decay value for beat flasher
  this.intervals = []; // Inter-beat intervals
  this.mean = 0; // Mean of beat intervals
  this.stddev = 0; // Variance/stddev in beat intervals
  this.jitter = 0; // Range to adjust to
  this.missed = 3;  // Missed beats score
  this.found = 0;   // Found beats score
  this.predicted = false; // Whether last predicted beat was used.
  this.green = 0; // Number of good beats found in succession

  // Acceptable range 50-300 bpm
  this.fMin = Math.floor(this.bpmToOffset(50));
  this.fMax = Math.ceil(this.bpmToOffset(400));

  // Histogram of autocorrelation peaks seen
  this.histogram = {};
  this.histogramSorted = [];
  this.beat = null;
  this.frames = 0;
};

ThreeAudio.BeatDetect.prototype = {
  initDebug: function () {
    this.c = document.createElement('canvas');
    this.c.className = 'ta-debug';
    this.c.width = 512;
    this.c.height = 340;
    this.c.style.position = 'absolute';
    this.c.style.zIndex = 20;
    this.c.style.marginTop = '70px';
    this.c.style.top = 0;
    this.g = this.c.getContext('2d');
    this.i = 0;

    this.t = document.createElement('div');
    this.t.className = 'ta-debug';
    this.t.width = 256;
    this.t.height = 200;
    this.t.style.background = 'rgba(0,0,0,.3)';
    this.t.style.color = '#fff';
    this.t.style.fontSize = '10px';
    this.t.style.position = 'absolute';
    this.t.style.zIndex = 20;
    this.t.style.marginTop = '350px';
    this.c.style.top = 0;

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

    // Prepare beat data
    data.beat.missed = false;
    data.beat.maybe = false;
    data.beat.is = false;
    data.beat.predicted = false;
    data.beat.locked = false;
    data.beat.adjusted = false;
    if (this.beat) {
      data.beat.confidence = this.beat.confidence;
      data.beat.permanence = this.beat.permanence;
      data.beat.bpm = this.beat.bpm;
    }
    else {
      data.beat.confidence = 0;
      data.beat.permanence = 0;
      data.beat.bpm = '';
    }

    // Process energy to find impulses of sound
    var energy = levels.direct[0];

    // Separate signal from background
    this.background = this.background + (energy - this.background) * .2;
    this.energy = this.energy + (energy - this.energy) * .4;
    var signal = (this.energy - this.background) / (1 - this.background) * 3;
    this.signal = signal;

    // Normalize and threshold for 'maybe' beat value.
    var lastMaybe = this.maybe;
    maybe = signal;
    this.maxMaybe = Math.max(this.maxMaybe * .99, maybe);
    this.maybe = maybe = maybe / Math.max(.2, this.maxMaybe) - .7;

    // Calculate sample to autocorrelate
    var sample = signal;
    this.sample = signal;

    // Keep track of sound levels up to n samples.
    history.unshift(signal);
    while (history.length > n) history.pop();

    // Update float buffer
    buffer.set(history);

    // Calculate autocorrelation of buffer in frequency domain.
    fft.forward(buffer);
    var spectrum = this.spectrum = fft.real, real = fft.real, imag = fft.imag;
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
            window: 0,
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
            match = Math.max(0, 1 - Math.abs(ratio - Math.round(ratio)) * 4);

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
      beat.confidence = Math.min(1, beat.score + beat.permanence);

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

      // Limit BPM to a more reasonable range
      if (this.beat.bpm > 240) {
        this.beat.bpm /= 2;
        this.beat.window *= 2;
      }
    }

    // Constants for rejection algorithm.
    var foundBonus = 3,
        missedPenalty = 1,
        maxPenalty = 10,
        maxFound = 10,
        debounceFrames = 5;

    var lastMeasure = this.measure;

    // Choose window for beat prediction based on accuracy
    var beatWindow = 0;
    if (this.beat) {
      beatWindow = this.beat.window;
      // If beat intervals are regular, we've locked in to the beat
      if (this.mean && (this.stddev < 2)) {
        beatWindow = this.mean;
        data.beat.locked = true;
        data.beat.bpm = this.offsetToBPM(this.n / beatWindow);
      }
    }

    // Find a maybe beat to get started.
    if (maybe > 0 && lastMaybe <= 0 && this.debounceMaybe > debounceFrames) {
      // Ignore rapid maybe beats in succession
      this.debounceMaybe = 0;

      // Prediction is not working, use maybe beat.
      if (!this.beat || (!data.beat.locked && this.beat.confidence < .3)) {
        // Accept as real beat and reset measure
        this.measure = 0;
        data.beat.is = true;
        data.beat.maybe = true;
      }
      else if (this.beat) {

        // See how well this maybe beat matches our model
        var half = this.beat.window / 2;
        var offset = ((this.measure + half) % beatWindow) - half;
        var jitter = this.jitter && Math.max(3, Math.min(this.jitter + 1, 10)) || 10;

        // Realign beat if close to prediction
        if (Math.abs(offset) < jitter) {
          this.measure = 0;

          // If prediction is late, pre-empt it.
          // If prediction was early but dropped, restore it.
          if ((offset <= 1 && this.debouncePredict > debounceFrames)
           || !this.predicted) {
            data.beat.is = true;
            if (offset >= 0) data.beat.predicted = true;
            this.debouncePredict = 0;

            this.found = Math.min(maxFound, this.found + 1);

            // Count as beat for interval measurement
            data.beat.adjusted = true;
          }
          else {
            // Ignore beat, prediction was early and used.
            data.beat.maybe = true;

            // Undo penalties from last miss
            this.found = Math.min(maxFound, this.found + 1);
            this.missed = Math.max(0, this.missed - missedPenalty);
          }

          // Give bonus for found beat
          this.found = Math.min(maxFound, this.found + 1);
          this.missed = Math.max(0, this.missed - foundBonus);
        }
        // Reset if there is a powerful enough impulse. Be more generous the more we've missed.
        else if ((maybe > (1 + this.found*.2  + .5/this.stddev - this.missed / maxPenalty))
              || (this.found == 0 || this.missed > 4)) {
          this.measure = 0;
          data.beat.is = true;
          this.debouncePredict = 0;

          // Give bonus for found beat
          this.found = Math.min(maxFound, this.found + 1);
          this.missed = Math.max(0, this.missed - foundBonus);
        }
        else {
          // Ignore maybe beat
          data.beat.maybe = true;
        }
      }
    }

    // Predict a beat.
    if (this.beat && (this.beat.confidence > .3)) {
      // Debounce predictions
      var debounce = this.debouncePredict > debounceFrames;

      // See if we passed beat.window samples.
      var predict = this.measure >= beatWindow;
      if (predict) {
        this.measure -= beatWindow;
      }

      // Check if prediction matches sound.
      if (predict && debounce) {
        if (maybe < 0) {
          // Give penalty for missed beat
          this.found = Math.max(0, this.found - 1);
          this.missed = Math.min(maxPenalty, this.missed + missedPenalty);
          data.beat.missed = true;
          data.beat.predicted = true;
        }
        else {
          // Give bonus for found beat
          this.found = Math.min(maxFound, this.found + 1);
          this.missed = Math.max(0, this.missed - foundBonus);
        }

        if (this.found < 1) {
          // Ignore prediction if not certain yet
          predict = false;
          data.beat.maybe = true;
          data.beat.predicted = true;
          this.debouncePredict = 0;
        }
        else if (this.missed > 4) {
          // Previous 4 beats were mispredicted
          predict = false;
          data.beat.maybe = true;
          data.beat.predicted = true;

          // Shift decounce randomly to attempt to hit the right beat.
          this.measure += Math.random() * debounceFrames;
          this.debounceMaybe += Math.random() * debounceFrames;
          this.debouncePredict = 0;
        }

        this.predicted = predict;
      }

      // If prediction not rejected, use it.
      if (predict && debounce) {
        this.debouncePredict = 0;
        data.beat.is = true;
        data.beat.predicted = true;
      }
    }

    // Analyse beats for consistency.
    var interval = 0;

    // Don't check interval if beats are being missed.
    if (this.missed > 3) {
      this.green = 0;
    }
    // Measure intervals between beats
    else if (data.beat.is || data.beat.adjusted) {
      if (this.green++) {
        // Use beat BPM
        interval = this.frames - this.lastGreen;
      }
      this.lastGreen = this.frames;
    }
    if (interval) {
      var intervals = this.intervals;

      // Keep track of last 12 intervals
      intervals.unshift(lastMeasure);
      if (intervals.length > 12) {
        intervals.pop();
      }

      // Remove outliers, keep middle half.
      var working = intervals.slice();
      working.sort();
      working = working.slice(2, 10);

      // Calculate mean/stddev
      if (working.length > 6) {
        var sum = 0, variance = 0;
        l = working.length;
        for (var i = 0; i < l; ++i) {
          sum += working[i];
          variance += working[i] * working[i];
        }
        sum /= l;
        variance /= l;

        this.mean = sum;
        this.stddev = Math.sqrt(variance - sum*sum);
      }
    }

    // Lock in on a wider range if missed
    this.jitter = (this.stddev + this.missed * .5) * (1 + this.missed);

    // Provide decayed beat value
    this.decay = this.decay + (+data.beat.is * 2.5 - this.decay) * .4;
    data.beat.was = data.beat.was + (this.decay * 2.5 - data.beat.was) * .4;

    // Advance a frame.
    this.debounceMaybe++;
    this.debouncePredict++;
    this.measure++;
    this.frames++;

    //////////////
    __taDebug && this.debug();
  },


  // Draw debug info into canvas / dom
  debug: function () {
    var levels = this.data.levels.direct,
        sample = this.sample,
        diff = this.signal,
        maybe = this.maybe,
        spectrum = this.spectrum,
        histogram = this.histogram,
        beat = this.data.beat,
        mean = this.mean,
        stddev = this.stddev;

    var that = this;
    var n = this.n;

    // Mark histogram beats according to active BPM.
    if (this.beat) {
      var reference = this.beat;
      var cutoff = reference.offset * 1.5;
      _.each(histogram, function (peak) {
        var match = (peak == reference ? 1 : 0);
        if (peak.offset > cutoff) {
          // Calculate match value based on narrow window around integer ratios.
          var ratio = peak.offset / reference.offset;
          match = Math.max(0, 1 - Math.abs(ratio - Math.round(ratio)) * 4);
        }
        peak.match = match;
      });
    }

    var locked = beat.locked ? ' style="color: rgb(180,255,0)"' : '';

    var out = [ '<strong><span'+locked+'>' + Math.round(beat.bpm * 10) / 10
              + ' BPM </span> (' + Math.round(100 * beat.confidence)
              + '%) P:' + Math.round(beat.permanence * 100)
              + ' µ = ' + Math.round(this.mean * 10) / 10
              + ' σ = '+ Math.round(this.stddev * 100) / 100
              +'</strong> '+ this.found + 'f ' + this.missed +'m'];

    _.each(histogram, function (peak) {
      var bpm = Math.round(that.offsetToBPM(peak.offset) * 10) / 10;
      out.push([
        bpm, ' bpm - ',
        Math.round(peak.strength * 100), '%',
        ' P: ', Math.round(peak.permanence * 100)].join(''));
    });
    this.t.innerHTML = out.join('<br>');

    var g = this.g;

    // Draw graph bg
    g.fillStyle = '#000000';
    g.fillRect(0, 169, 512, 102);

    // Draw spectrum
    var max = 0;
    for (var i = 2; i < n/8; ++i) {
      max = Math.max(spectrum[i], max);
    }
    var norm = 1/max;
    g.beginPath();
    g.moveTo(0, 270);
    for (var i = 2; i < n/8; ++i) {
      g.lineTo((i-2)*8, 270-(spectrum[i]*norm)*100);
    }
    g.strokeStyle = '#ffffff';
    g.stroke();

    // Highlight peaks
    _.each(histogram, function (peak) {
      var alpha = peak.strength *.75 + .25;
      var color = peak.active ? [Math.round(255 - 195 * peak.match), Math.round(180 + 40 * peak.match), 0].join(',') : '255,10,10';
      g.fillStyle = 'rgba('+color+','+ alpha +')';
      g.fillRect((peak.offset - 2) * 8, 170, 1, 100);
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

    //plot(levels[0]);
    plot(levels[1]);
    plot(levels[2]);
    plot(levels[3]);
    plot(0);
    plot(0);
    plot(0);
    plot(0);
    plot(0);

    // Show time bar
    g.fillStyle = 'rgba(160,160,255,.85)';
    g.fillRect(i+1, 0, 2, 120)

    // Show beats
    if (beat.is) {
      g.fillStyle = beat.missed ? 'rgba(255,0,0,.7)'
                    : (beat.maybe ? 'rgba(0,180,255,.9)'
                    : (beat.predicted ? 'rgba(255,200,0,1)' : 'rgba(60,220,0,1)'));
      g.fillRect(this.i, 120, 2, 40)
    }
    var c = Math.round(Math.max(0, Math.min(255, beat.was * 255)));
    g.fillStyle = 'rgb('+c+','+c+','+c+')';
    g.fillRect(342, 270, 170, 30)

    // Show maybe beats
    if (beat.maybe && !beat.is) {
      g.fillStyle = 'rgba(64,64,64,.75)';
      g.fillRect(this.i, 120, 2, 40)
    }

    // Show sample
    sample = Math.floor(Math.max(0, Math.min(1, sample*1.4+.5)) * 255);
    g.fillStyle = 'rgba('+Math.round(sample*.2)+','+Math.round(sample*.6)+',' + sample +',1)';
    g.fillRect(this.i, 60, 1, 20)

    // Show diff
    diff = Math.floor(Math.max(0, Math.min(1, diff*2)) * 255);
    g.fillStyle = 'rgba('+Math.round(diff*.2)+','+Math.round(diff)+','+ Math.round(diff*.5) +',1)';
    g.fillRect(this.i, 80, 1, 20)

    // Show maybe
    maybe = (beat.is || beat.maybe) ? Math.floor(Math.max(0, Math.min(1, maybe*1.2 + .5)) * 255) : 0;
    g.fillStyle = 'rgba('+Math.round(maybe)+',' + maybe +','+Math.round(maybe)+',1)';
    g.fillRect(this.i, 100, 1, 20)

    this.i = (i + 1) % 512;

  }

}
